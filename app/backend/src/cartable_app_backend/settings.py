"""Settings operations: account info, credentials, backup/restore, launchd, version.

All of these touch the user's local filesystem under ~/Documents/Claude/cartable/
(or wherever CARTABLE_DIR points). We carefully avoid moving secrets into any
file that gets exposed by the frontend — the .env stays on disk only.
"""

from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from . import db

# ---------- paths -----------------------------------------------------------

CARTABLE_DIR = Path(os.environ.get(
    "CARTABLE_DIR", Path.home() / "Documents/Claude/cartable"
)).expanduser()

LAUNCHD_LABEL = "com.user.cartable.sync"
LAUNCHD_PLIST_TARGET = Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"
LAUNCHD_PLIST_TEMPLATE = CARTABLE_DIR / "launchd" / f"{LAUNCHD_LABEL}.plist"

BACKUP_SCHEMA_VERSION = 1


def _env_path() -> Path:
    return CARTABLE_DIR / ".env"


def _data_dir() -> Path:
    custom = os.environ.get("CARTABLE_DATA_DIR")
    if custom:
        return Path(custom).expanduser().resolve()
    return CARTABLE_DIR / "data"


# ---------- account ---------------------------------------------------------


def _parse_env(text: str) -> dict[str, str]:
    """Read a .env file's KEY=VALUE pairs (ignoring comments and blanks)."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _format_env(values: dict[str, str], example_path: Path | None = None) -> str:
    """Rewrite an .env file preserving any comments/structure from .env.example."""
    if example_path and example_path.exists():
        template = example_path.read_text()
    else:
        template = "\n".join(f"{k}=" for k in values)

    out_lines: list[str] = []
    seen: set[str] = set()
    for raw in template.splitlines():
        s = raw.strip()
        if not s or s.startswith("#") or "=" not in s:
            out_lines.append(raw)
            continue
        key = s.split("=", 1)[0].strip()
        seen.add(key)
        out_lines.append(f"{key}={values.get(key, '')}")
    # Append any keys that weren't in the template
    for k, v in values.items():
        if k not in seen:
            out_lines.append(f"{k}={v}")
    return "\n".join(out_lines) + "\n"


def account_info() -> dict[str, Any]:
    """Account-related state shown in Settings (no password, no token)."""
    env_path = _env_path()
    env_vars: dict[str, str] = {}
    if env_path.exists():
        env_vars = _parse_env(env_path.read_text())
    student = db.student_info() if _data_dir().joinpath("pronote.db").exists() else {}
    has_url = bool(env_vars.get("PRONOTE_URL", ""))
    has_username = bool(env_vars.get("PRONOTE_USERNAME", ""))
    has_password = bool(env_vars.get("PRONOTE_PASSWORD", ""))
    return {
        "pronote_url": env_vars.get("PRONOTE_URL", ""),
        "auth_mode": env_vars.get("PRONOTE_AUTH_MODE", "password"),
        "username": env_vars.get("PRONOTE_USERNAME", ""),
        "ent_provider": env_vars.get("PRONOTE_ENT_PROVIDER", ""),
        "child_name": env_vars.get("PRONOTE_CHILD", ""),
        "has_password": has_password,
        "is_configured": has_url and has_username and has_password,
        "env_path": str(env_path),
        "student": {
            "name": student.get("name") or "",
            "class_name": student.get("class_name") or "",
            "establishment": student.get("establishment") or "",
        },
    }


def update_account(payload: dict[str, Any]) -> dict[str, Any]:
    """Write a new .env from the supplied fields.

    The password is only overwritten when a non-empty value is supplied; this
    lets the UI keep the field blank to mean "leave the existing password in
    place".
    """
    env_path = _env_path()
    current = _parse_env(env_path.read_text()) if env_path.exists() else {}

    new_password = payload.get("password") or current.get("PRONOTE_PASSWORD", "")
    values = {
        "PRONOTE_URL": (payload.get("pronote_url") or current.get("PRONOTE_URL", "")).strip(),
        "PRONOTE_AUTH_MODE": (payload.get("auth_mode") or current.get("PRONOTE_AUTH_MODE", "password")).strip(),
        "PRONOTE_USERNAME": (payload.get("username") or current.get("PRONOTE_USERNAME", "")).strip(),
        "PRONOTE_PASSWORD": new_password,
        "PRONOTE_ENT_PROVIDER": (payload.get("ent_provider") or "").strip(),
        "PRONOTE_CHILD": (payload.get("child_name") or "").strip(),
        "CARTABLE_DATA_DIR": current.get("CARTABLE_DATA_DIR", ""),
    }

    if not values["PRONOTE_URL"] or not values["PRONOTE_USERNAME"] or not values["PRONOTE_PASSWORD"]:
        raise ValueError("PRONOTE_URL, PRONOTE_USERNAME and PRONOTE_PASSWORD are all required.")

    env_path.write_text(_format_env(values, CARTABLE_DIR / ".env.example"))
    os.chmod(env_path, 0o600)
    # Drop the rotating token — credentials may have changed.
    token_file = _data_dir() / "token.json"
    if token_file.exists():
        token_file.unlink()
    return {"ok": True}


def logout() -> dict[str, Any]:
    """Wipe credentials and the rotating token. The DB is preserved."""
    env_path = _env_path()
    if env_path.exists():
        env_path.unlink()
    for fname in ("token.json", "device_uuid"):
        f = _data_dir() / fname
        if f.exists():
            f.unlink()
    return {"ok": True}


# ---------- QR-code login ---------------------------------------------------


def _stable_uuid() -> str:
    """Read or create a stable per-installation UUID. Pronote ties tokens to it."""
    import uuid as _uuid

    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    f = data_dir / "device_uuid"
    if f.exists():
        return f.read_text().strip()
    new = str(_uuid.uuid4())
    f.write_text(new)
    os.chmod(f, 0o600)
    return new


def login_qr(qr_data: dict[str, Any], pin: str) -> dict[str, Any]:
    """Bootstrap an account from a Pronote mobile QR code + 4-digit PIN.

    The QR JSON has {login, jeton, url}. After a successful handshake
    pronotepy hands us back a rotating token in `client.password` — we
    persist that into .env (so the CLI can `token_login` next time) and
    drop a fresh token.json at the same time.
    """
    import pronotepy
    import json as _json

    required = {"login", "jeton", "url"}
    if not required.issubset(qr_data):
        raise ValueError(
            f"QR payload missing keys {required - qr_data.keys()}. "
            "Generate the code from Pronote mobile: Compte → Connecter un nouvel appareil."
        )
    if not (pin and pin.isdigit() and len(pin) == 4):
        raise ValueError("PIN must be exactly 4 digits.")

    uuid = _stable_uuid()
    cls = (
        pronotepy.ParentClient
        if "parent.html" in qr_data["url"].lower()
        else pronotepy.Client
    )
    try:
        client = cls.qrcode_login(qr_data, pin, uuid)
    except Exception as exc:  # noqa: BLE001 — pronotepy errors vary
        raise ValueError(f"Pronote rejected the QR / PIN: {exc}") from exc

    # Persist .env (without a real password — only the rotating token).
    update_account({
        "pronote_url": client.pronote_url,
        "auth_mode": "password",
        "username": client.username,
        "password": client.password,
    })

    # Drop the freshly-issued credentials so the next sync uses token_login.
    creds = client.export_credentials()
    token_path = _data_dir() / "token.json"
    token_path.write_text(_json.dumps(creds, indent=2))
    os.chmod(token_path, 0o600)

    info = client._selected_child if isinstance(client, pronotepy.ParentClient) else client.info
    return {
        "ok": True,
        "url": client.pronote_url,
        "username": client.username,
        "student": {
            "name": getattr(info, "name", None),
            "class_name": getattr(info, "class_name", None),
            "establishment": getattr(info, "establishment", None),
        },
        "is_parent_account": isinstance(client, pronotepy.ParentClient),
    }


# ---------- backup / restore -----------------------------------------------


def backup_filename() -> str:
    student = db.student_info() if _data_dir().joinpath("pronote.db").exists() else {}
    name = (student.get("name") or "cartable").strip()
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", name.replace(" ", "_")).strip("-").lower() or "cartable"
    ts = datetime.now().strftime("%Y%m%d-%H%M")
    return f"cartable-{slug}-{ts}.cartable"


def build_backup_zip() -> bytes:
    """Pack the SQLite DB + a manifest into an in-memory .cartable zip.

    Credentials are deliberately excluded. Restoring on another machine still
    requires the user to supply Pronote credentials.
    """
    data_dir = _data_dir()
    db_file = data_dir / "pronote.db"
    if not db_file.exists():
        raise FileNotFoundError(f"No DB found at {db_file}")

    student = db.student_info()
    last = db.last_sync()

    manifest = {
        "schema_version": BACKUP_SCHEMA_VERSION,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "student": student,
        "last_sync": last,
        "files": ["pronote.db"],
        "notes": (
            "Backup produced by Cartable. Pronote credentials and the rotating "
            "auth token are intentionally NOT included. After restoring, you "
            "will need to log back into Pronote from Settings."
        ),
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))
        z.write(db_file, arcname="pronote.db")
    buf.seek(0)
    return buf.getvalue()


def restore_backup(content: bytes) -> dict[str, Any]:
    """Restore a .cartable zip. Backs up the existing DB to *.bak first."""
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            names = set(z.namelist())
            if "manifest.json" not in names or "pronote.db" not in names:
                raise ValueError("Invalid .cartable archive: missing manifest.json or pronote.db.")
            manifest = json.loads(z.read("manifest.json").decode("utf-8"))
            if manifest.get("schema_version") != BACKUP_SCHEMA_VERSION:
                raise ValueError(
                    f"Backup schema_version={manifest.get('schema_version')} "
                    f"isn't supported by this app (expected {BACKUP_SCHEMA_VERSION})."
                )
            target = data_dir / "pronote.db"
            if target.exists():
                stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
                shutil.move(target, data_dir / f"pronote.db.bak-{stamp}")
            with z.open("pronote.db") as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    except zipfile.BadZipFile as e:
        raise ValueError(f"Not a valid .cartable file: {e}") from e

    return {
        "ok": True,
        "manifest": manifest,
        "restored_to": str(target),
    }


# ---------- launchd (auto-sync schedule) ------------------------------------


def _launchctl(*args: str) -> tuple[int, str, str]:
    p = subprocess.run(["launchctl", *args], capture_output=True, text=True, timeout=10)
    return p.returncode, p.stdout, p.stderr


def autosync_status() -> dict[str, Any]:
    installed = LAUNCHD_PLIST_TARGET.exists()
    loaded = False
    interval = None
    if installed:
        # `launchctl print gui/<uid>/<label>` returns details; non-zero if not loaded.
        uid = os.getuid()
        code, _, _ = _launchctl("print", f"gui/{uid}/{LAUNCHD_LABEL}")
        loaded = code == 0
        interval = _read_interval_from_plist(LAUNCHD_PLIST_TARGET)
    return {
        "installed": installed,
        "loaded": loaded,
        "interval_seconds": interval,
        "plist_target": str(LAUNCHD_PLIST_TARGET),
        "template_exists": LAUNCHD_PLIST_TEMPLATE.exists(),
    }


def _read_interval_from_plist(path: Path) -> int | None:
    try:
        txt = path.read_text()
    except OSError:
        return None
    m = re.search(r"<key>StartInterval</key>\s*<integer>(\d+)</integer>", txt)
    return int(m.group(1)) if m else None


def autosync_enable(interval_seconds: int) -> dict[str, Any]:
    """Render the template into ~/Library/LaunchAgents and bootstrap it."""
    if interval_seconds < 900:
        raise ValueError("Minimum interval is 900 seconds — Pronote rate-limits.")
    if not LAUNCHD_PLIST_TEMPLATE.exists():
        raise FileNotFoundError(f"Missing template at {LAUNCHD_PLIST_TEMPLATE}")
    rendered = (
        LAUNCHD_PLIST_TEMPLATE.read_text()
        .replace("__HOME__", str(Path.home()))
        .replace(
            "<key>StartInterval</key>\n    <integer>1800</integer>",
            f"<key>StartInterval</key>\n    <integer>{interval_seconds}</integer>",
        )
    )
    LAUNCHD_PLIST_TARGET.parent.mkdir(parents=True, exist_ok=True)
    LAUNCHD_PLIST_TARGET.write_text(rendered)

    uid = os.getuid()
    # Bootout first in case it's already loaded (idempotent).
    _launchctl("bootout", f"gui/{uid}/{LAUNCHD_LABEL}")
    code, out, err = _launchctl("bootstrap", f"gui/{uid}", str(LAUNCHD_PLIST_TARGET))
    if code != 0:
        raise RuntimeError(f"launchctl bootstrap failed: {err or out}")
    return autosync_status()


def autosync_disable() -> dict[str, Any]:
    uid = os.getuid()
    _launchctl("bootout", f"gui/{uid}/{LAUNCHD_LABEL}")
    if LAUNCHD_PLIST_TARGET.exists():
        LAUNCHD_PLIST_TARGET.unlink()
    return autosync_status()


# ---------- version / update check -----------------------------------------


def app_version() -> str:
    """Best-effort: read from the backend package, then fall back to the app's package.json."""
    try:
        from . import __version__
        return __version__
    except Exception:  # noqa: BLE001
        pass
    pkg = CARTABLE_DIR / "app" / "package.json"
    if pkg.exists():
        try:
            return json.loads(pkg.read_text()).get("version", "0.0.0")
        except json.JSONDecodeError:
            pass
    return "0.0.0"


def version_info() -> dict[str, Any]:
    student = db.student_info() if _data_dir().joinpath("pronote.db").exists() else {}
    return {
        "version": app_version(),
        "backend_started_at": getattr(version_info, "_started_at", time.time()),
        "data_dir": str(_data_dir()),
        "cartable_dir": str(CARTABLE_DIR),
        "student_name": student.get("name") or "",
    }


# Mark process start once on import for the uptime field above.
version_info._started_at = time.time()  # type: ignore[attr-defined]


def check_update(repo: str = "Sizyph/cartable") -> dict[str, Any]:
    """Check GitHub Releases for a newer tagged version. Network-bound."""
    import urllib.request
    import urllib.error

    url = f"https://api.github.com/repos/{repo}/releases/latest"
    try:
        with urllib.request.urlopen(url, timeout=8) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"ok": True, "current": app_version(), "latest": None, "is_newer": False,
                    "note": "No releases published yet."}
        return {"ok": False, "error": f"GitHub returned HTTP {e.code}: {e.reason}"}
    except urllib.error.URLError as e:
        return {"ok": False, "error": f"Could not reach GitHub: {e.reason}"}
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"Bad JSON from GitHub: {e}"}

    latest_tag = (data.get("tag_name") or "").lstrip("v")
    current = app_version()
    return {
        "ok": True,
        "current": current,
        "latest": latest_tag,
        "is_newer": _is_newer(latest_tag, current),
        "html_url": data.get("html_url"),
        "name": data.get("name"),
        "published_at": data.get("published_at"),
    }


def _is_newer(remote: str, local: str) -> bool:
    """Tolerant semver-ish comparison for tag strings like 0.1.2 / v0.1.2."""
    def parts(s: str) -> list[int]:
        out: list[int] = []
        for chunk in re.split(r"[.\-+]", s):
            if chunk.isdigit():
                out.append(int(chunk))
            else:
                break
        return out
    return parts(remote) > parts(local)
