"""Google Drive integration: pick a root folder, browse it, and push
Cartable artefacts (e.g. .cartable backups) into it.

OAuth is shared with Calendar via `google_auth.py` (same credentials.json,
same token, combined scopes). The root folder ID is stored in a small JSON
config file alongside the token.
"""

from __future__ import annotations

import io
import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaInMemoryUpload

from . import google_auth, settings as settings_mod

log = logging.getLogger("cartable_app.drive")


def _config_path() -> Path:
    return google_auth.data_dir() / "drive_config.json"


def _read_config() -> dict[str, Any]:
    p = _config_path()
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text())
    except json.JSONDecodeError:
        return {}


def _write_config(d: dict[str, Any]) -> None:
    p = _config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, indent=2))
    os.chmod(p, 0o600)


# ---------- status -----------------------------------------------------------


def status() -> dict[str, Any]:
    cfg = _read_config()
    creds = google_auth.load_creds()
    root_name: str | None = None
    if cfg.get("root_folder_id") and creds and creds.valid and google_auth.has_all_scopes(creds):
        try:
            svc = _service()
            meta = svc.files().get(
                fileId=cfg["root_folder_id"],
                fields="id,name",
                supportsAllDrives=True,
            ).execute()
            root_name = meta.get("name")
        except HttpError as e:
            log.warning("Could not load root folder name: %s", e)
    return {
        "has_credentials": google_auth.credentials_path().exists(),
        "has_token": google_auth.token_path().exists(),
        "scopes_ok": google_auth.has_all_scopes(creds),
        "credentials_path": str(google_auth.credentials_path()),
        "root_folder_id": cfg.get("root_folder_id"),
        "root_folder_name": root_name,
    }


def authorize() -> dict[str, Any]:
    return google_auth.authorize()


def set_root(folder_id: str) -> dict[str, Any]:
    folder_id = (folder_id or "").strip()
    if not folder_id:
        raise ValueError("folder_id is required")
    svc = _service()
    try:
        meta = svc.files().get(
            fileId=folder_id,
            fields="id,name,mimeType",
            supportsAllDrives=True,
        ).execute()
    except HttpError as e:
        raise ValueError(f"Drive rejected folder id {folder_id}: {e}") from e
    if meta.get("mimeType") != "application/vnd.google-apps.folder":
        raise ValueError(f"{meta.get('name')!r} is not a folder.")
    cfg = _read_config()
    cfg["root_folder_id"] = folder_id
    cfg["root_folder_name"] = meta.get("name")
    _write_config(cfg)
    return {"ok": True, "id": meta["id"], "name": meta.get("name")}


# ---------- browse -----------------------------------------------------------


def list_folder(folder_id: str | None = None, page_size: int = 200) -> list[dict[str, Any]]:
    cfg = _read_config()
    fid = folder_id or cfg.get("root_folder_id")
    if not fid:
        raise ValueError("No root folder configured. POST /api/drive/root first.")
    svc = _service()
    # Folders first, then files, both alphabetical.
    q = f"'{fid}' in parents and trashed = false"
    fields = (
        "nextPageToken, files("
        "id, name, mimeType, modifiedTime, size, webViewLink, iconLink, parents"
        ")"
    )
    items: list[dict[str, Any]] = []
    page_token: str | None = None
    while True:
        resp = svc.files().list(
            q=q,
            fields=fields,
            pageSize=min(page_size, 1000),
            pageToken=page_token,
            orderBy="folder,name",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        ).execute()
        items.extend(resp.get("files", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    for it in items:
        it["is_folder"] = it.get("mimeType") == "application/vnd.google-apps.folder"
    return items


def search(query: str, page_size: int = 50) -> list[dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    svc = _service()
    safe = q.replace("'", "\\'")
    drive_q = f"name contains '{safe}' and trashed = false"
    resp = svc.files().list(
        q=drive_q,
        fields="files(id, name, mimeType, modifiedTime, webViewLink, parents)",
        pageSize=min(page_size, 1000),
        orderBy="modifiedTime desc",
        supportsAllDrives=True,
        includeItemsFromAllDrives=True,
    ).execute()
    items = resp.get("files", [])
    for it in items:
        it["is_folder"] = it.get("mimeType") == "application/vnd.google-apps.folder"
    return items


# ---------- upload -----------------------------------------------------------


def upload_backup() -> dict[str, Any]:
    """Build a fresh .cartable archive and upload it to the configured root."""
    cfg = _read_config()
    fid = cfg.get("root_folder_id")
    if not fid:
        raise ValueError("No root folder configured.")
    data = settings_mod.build_backup_zip()
    name = settings_mod.backup_filename()
    return _upload_bytes(data, name, fid, "application/zip")


def upload_bytes(name: str, content: bytes, mime_type: str | None = None) -> dict[str, Any]:
    cfg = _read_config()
    fid = cfg.get("root_folder_id")
    if not fid:
        raise ValueError("No root folder configured.")
    return _upload_bytes(content, name, fid, mime_type or "application/octet-stream")


def _upload_bytes(content: bytes, name: str, parent_id: str, mime_type: str) -> dict[str, Any]:
    svc = _service()
    media = MediaInMemoryUpload(content, mimetype=mime_type, resumable=False)
    body = {"name": name, "parents": [parent_id]}
    created = svc.files().create(
        body=body,
        media_body=media,
        fields="id, name, webViewLink, size, mimeType",
        supportsAllDrives=True,
    ).execute()
    log.info("Uploaded %s to Drive (%s, %s bytes)", name, created.get("id"), created.get("size"))
    return {
        "ok": True,
        "id": created.get("id"),
        "name": created.get("name"),
        "size": created.get("size"),
        "web_view_link": created.get("webViewLink"),
        "uploaded_at": datetime.now().isoformat(timespec="seconds"),
    }


# ---------- service handle --------------------------------------------------


def _service():
    creds = google_auth.load_creds()
    if not creds or not creds.valid:
        raise RuntimeError("Not authorized. Run /api/drive/authorize first.")
    if not google_auth.has_all_scopes(creds):
        raise RuntimeError(
            "Token missing Drive scopes. Re-authorize from Settings to add them."
        )
    return build("drive", "v3", credentials=creds, cache_discovery=False)
