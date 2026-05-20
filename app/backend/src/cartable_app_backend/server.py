"""FastAPI server — local HTTP API the Tauri frontend talks to."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
import subprocess
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response, StreamingResponse
from pydantic import BaseModel

from . import agent, bulletin_html, calendar_sync, db, settings as settings_mod

log = logging.getLogger("cartable_app")
app = FastAPI(title="Cartable", version="0.1.0")

# Tauri's dev server runs on 1420 (Vite). In production, the Tauri webview
# loads the bundled assets and hits us via localhost — same-origin in practice,
# but Vite needs CORS for dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "https://tauri.localhost",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

CARTABLE_DIR = Path(os.environ.get(
    "CARTABLE_DIR", Path.home() / "Documents/Claude/cartable"
)).expanduser()


# ---------- models -----------------------------------------------------------


class TriggerSyncResponse(BaseModel):
    started: bool
    detail: str


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None


class AccountUpdate(BaseModel):
    pronote_url: str
    auth_mode: str = "password"
    username: str
    password: str = ""  # blank = keep existing
    ent_provider: str = ""
    child_name: str = ""


class AutoSyncRequest(BaseModel):
    enabled: bool
    interval_seconds: int = 1800


# ---------- read-only endpoints ---------------------------------------------


@app.get("/api/health")
def health() -> dict:
    try:
        last = db.last_sync()
        info = db.student_info()
        return {
            "status": "ok",
            "last_sync": last,
            "student": info,
            "db_path": str(db.db_path()),
        }
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/student")
def student() -> dict:
    return db.student_info()


@app.get("/api/periods")
def periods() -> list[dict]:
    return db.periods()


@app.get("/api/lessons")
def lessons(
    date_from: str = Query(..., description="YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYY-MM-DD"),
) -> list[dict]:
    return db.lessons(date_from, date_to)


@app.get("/api/lessons/today")
def lessons_today() -> list[dict]:
    today = dt.date.today().isoformat()
    return db.lessons(today, today)


@app.get("/api/lessons/week")
def lessons_week(weeks_ahead: int = 0) -> list[dict]:
    today = dt.date.today()
    monday = today - dt.timedelta(days=today.weekday()) + dt.timedelta(weeks=weeks_ahead)
    sunday = monday + dt.timedelta(days=6)
    return db.lessons(monday.isoformat(), sunday.isoformat())


@app.get("/api/grades/recent")
def grades_recent(limit: int = 20) -> list[dict]:
    return db.grades_recent(limit)


@app.get("/api/grades")
def grades(period_id: str | None = None) -> list[dict]:
    pid = period_id or db.current_period_id()
    if not pid:
        return []
    return db.grades_for_period(pid)


@app.get("/api/averages")
def averages(period_id: str | None = None) -> list[dict]:
    pid = period_id or db.current_period_id()
    return db.averages(pid)


@app.get("/api/averages/trend")
def averages_trend() -> list[dict]:
    return db.subject_trend()


@app.get("/api/homework")
def homework(
    date_from: str | None = None,
    date_to: str | None = None,
    only_pending: bool = False,
) -> list[dict]:
    today = dt.date.today()
    df = date_from or today.isoformat()
    dtt = date_to or (today + dt.timedelta(days=21)).isoformat()
    return db.homework(df, dtt, only_pending)


@app.get("/api/teachers")
def teachers() -> list[dict]:
    return db.teachers()


# ---------- actions ---------------------------------------------------------


@app.post("/api/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    """SSE-stream of agent messages for a single user turn."""
    return StreamingResponse(
        agent.chat_stream(req.message, req.session_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/bulletins")
def bulletins() -> list[dict]:
    return db.bulletins()


@app.get("/api/bulletins/{period_id}")
def bulletin_json(period_id: str) -> dict:
    b = db.bulletin(period_id)
    if b is None:
        raise HTTPException(404, f"No bulletin for period {period_id}")
    return b


@app.get("/api/bulletins/{period_id}/html", response_class=HTMLResponse)
def bulletin_render(period_id: str) -> HTMLResponse:
    b = db.bulletin(period_id)
    if b is None:
        raise HTTPException(404, f"No bulletin for period {period_id}")
    return HTMLResponse(bulletin_html.render(b))


# ---------- settings --------------------------------------------------------


@app.get("/api/settings/account")
def settings_account() -> dict:
    return settings_mod.account_info()


@app.post("/api/settings/account")
def settings_account_update(req: AccountUpdate) -> dict:
    try:
        return settings_mod.update_account(req.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/settings/logout")
def settings_logout() -> dict:
    return settings_mod.logout()


@app.get("/api/settings/version")
def settings_version() -> dict:
    return settings_mod.version_info()


@app.get("/api/settings/update-check")
async def settings_update_check() -> dict:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, settings_mod.check_update)


@app.get("/api/settings/auto-sync")
def settings_autosync() -> dict:
    return settings_mod.autosync_status()


@app.post("/api/settings/auto-sync")
def settings_autosync_set(req: AutoSyncRequest) -> dict:
    try:
        if req.enabled:
            return settings_mod.autosync_enable(req.interval_seconds)
        return settings_mod.autosync_disable()
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(500, str(exc)) from exc


@app.get("/api/settings/backup")
def settings_backup() -> Response:
    try:
        data = settings_mod.build_backup_zip()
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f'attachment; filename="{settings_mod.backup_filename()}"',
        },
    )


@app.post("/api/settings/restore")
async def settings_restore(file: UploadFile = File(...)) -> dict:
    content = await file.read()
    try:
        return settings_mod.restore_backup(content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/calendar/status")
def calendar_status() -> dict:
    return calendar_sync.status()


@app.post("/api/calendar/authorize")
async def calendar_authorize() -> dict:
    """Run the OAuth flow (opens the user's browser, blocks the request)."""
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, calendar_sync.authorize)
        return result
    except FileNotFoundError as exc:
        raise HTTPException(412, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Authorization failed: {exc}") from exc


@app.post("/api/calendar/sync")
async def calendar_sync_endpoint(days: int = 14) -> dict:
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, calendar_sync.sync_two_weeks, days)
    except RuntimeError as exc:
        raise HTTPException(412, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Sync failed: {exc}") from exc


@app.post("/api/sync", response_model=TriggerSyncResponse)
async def trigger_sync() -> TriggerSyncResponse:
    """Fire-and-forget: run `cartable sync` in the background."""
    if not (CARTABLE_DIR / "pyproject.toml").exists():
        raise HTTPException(503, f"Cartable not found at {CARTABLE_DIR}")
    try:
        # Detach: don't block the HTTP call.
        subprocess.Popen(
            ["uv", "run", "cartable", "sync"],
            cwd=CARTABLE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Could not start sync: {exc}") from exc
    return TriggerSyncResponse(started=True, detail="cartable sync running in background")


# ---------- entry point -----------------------------------------------------


def main() -> None:
    import uvicorn
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    host = os.environ.get("CARTABLE_APP_HOST", "127.0.0.1")
    port = int(os.environ.get("CARTABLE_APP_PORT", "7531"))
    uvicorn.run("cartable_app_backend.server:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
