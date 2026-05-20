//! Cartable — Tauri shell.
//!
//! Owns the lifetime of the Python backend:
//!  - In a packaged .app, spawns the bundled `cartable-app-backend` sidecar
//!    from Contents/MacOS/ (next to the main binary).
//!  - In `tauri dev`, looks for a sibling `backend/` directory and runs
//!    `uv run cartable-app-backend` (so we don't have to rebuild the
//!    PyInstaller artifact for every Python change during development).
//!
//! Kills whatever it spawned when the window closes.

use std::env;
use std::fs::{File, OpenOptions};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{Manager, RunEvent};

#[derive(Default)]
struct BackendProcess(Mutex<Option<Child>>);

fn dirs_home() -> Option<PathBuf> {
    env::var_os("HOME").map(PathBuf::from)
}

/// Locate the bundled sidecar. Tauri places externalBin entries next to the
/// main binary in Contents/MacOS/ on macOS, with the platform-triple suffix
/// stripped. We check a handful of plausible locations to stay tolerant of
/// future Tauri layout changes.
fn find_sidecar(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Sibling of the main binary (the usual place for externalBin on macOS).
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() {
            for name in ["cartable-app-backend", "cartable-app-backend-aarch64-apple-darwin"] {
                candidates.push(parent.join(name));
            }
        }
    }
    // Resources directory.
    if let Ok(resource_dir) = app.path().resource_dir() {
        for name in [
            "cartable-app-backend",
            "cartable-app-backend-aarch64-apple-darwin",
            "binaries/cartable-app-backend",
            "binaries/cartable-app-backend-aarch64-apple-darwin",
        ] {
            candidates.push(resource_dir.join(name));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Dev fallback: locate `uv` and the local backend dir, run `uv run cartable-app-backend`.
fn dev_command() -> Result<Command, String> {
    if let Ok(p) = env::var("CARTABLE_APP_UV") {
        let path = PathBuf::from(p);
        if !path.exists() {
            return Err(format!("CARTABLE_APP_UV={} does not exist", path.display()));
        }
        return build_uv_command(path);
    }
    for candidate in ["/opt/homebrew/bin/uv", "/usr/local/bin/uv", "/usr/bin/uv"] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return build_uv_command(p);
        }
    }
    Err("Could not find `uv`. Install it (`brew install uv`) or set CARTABLE_APP_UV.".to_string())
}

fn build_uv_command(uv: PathBuf) -> Result<Command, String> {
    let home = dirs_home().ok_or_else(|| "HOME not set".to_string())?;
    let dir = env::var("CARTABLE_APP_BACKEND_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| home.join("Documents/Claude/cartable/app/backend"));
    if !dir.exists() {
        return Err(format!("Backend dir not found at {}", dir.display()));
    }
    let mut cmd = Command::new(uv);
    cmd.args(["run", "cartable-app-backend"]).current_dir(&dir);
    Ok(cmd)
}

fn log_file() -> Result<File, String> {
    // ~/Library/Logs/Cartable/backend.log — standard macOS user-log location.
    let home = dirs_home().ok_or_else(|| "HOME not set".to_string())?;
    let dir = home.join("Library/Logs/Cartable");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create log dir: {e}"))?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("backend.log"))
        .map_err(|e| format!("Could not open backend log: {e}"))
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<Child, String> {
    let mut cmd = if let Some(sidecar) = find_sidecar(app) {
        eprintln!("[cartable] using bundled sidecar at {}", sidecar.display());
        Command::new(sidecar)
    } else {
        eprintln!("[cartable] no bundled sidecar — falling back to dev mode (uv run)");
        dev_command()?
    };

    // We must give the child writable stdio. When the .app is launched by
    // Launch Services (the normal double-click flow), our own stdio points at
    // ASL/syslog and writes from PyInstaller's bundled Python silently block
    // a few seconds in. Redirecting to a real file fixes that.
    let log = log_file()?;
    let log2 = log.try_clone().map_err(|e| format!("clone log fd: {e}"))?;
    cmd.stdin(Stdio::null())
       .stdout(Stdio::from(log))
       .stderr(Stdio::from(log2))
       .env("PYTHONUNBUFFERED", "1");
    cmd.spawn().map_err(|e| format!("Failed to spawn backend: {e}"))
}

#[tauri::command]
fn backend_status(state: tauri::State<BackendProcess>) -> serde_json::Value {
    let guard = state.0.lock().unwrap();
    serde_json::json!({ "running": guard.is_some() })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(BackendProcess::default())
        .invoke_handler(tauri::generate_handler![backend_status])
        .setup(|app| {
            let handle = app.handle();
            match spawn_backend(handle) {
                Ok(child) => {
                    eprintln!("[cartable] backend spawned pid={}", child.id());
                    *handle.state::<BackendProcess>().0.lock().unwrap() = Some(child);
                }
                Err(e) => {
                    eprintln!("[cartable] backend NOT started: {e}");
                    eprintln!("[cartable] start it manually:");
                    eprintln!("           cd ~/Documents/Claude/cartable/app/backend && uv run cartable-app-backend");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                let state = app_handle.state::<BackendProcess>();
                let mut taken = state.0.lock().unwrap().take();
                if let Some(child) = taken.as_mut() {
                    eprintln!("[cartable] killing backend pid={}", child.id());
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
