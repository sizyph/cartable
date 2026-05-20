"""Library: user-curated reading list + auto-discovered local PDFs.

Two sources surface in the UI as one list:

  1. **Manual entries**, stored in the `library_items` SQLite table (created
     by the cartable CLI schema). Backed up inside .cartable archives.
  2. **Local PDFs** dropped under ``data/library/`` — surfaced directly from
     the filesystem so a user can curate by drag-and-drop without touching
     any form. These get a stable id of ``file:<relative-path>``.

Both kinds expose enough metadata (title, subject, kind, url/path) to
power a single mixed view. The backend serves local PDFs on demand so
the webview can open them in a child window.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from . import db

LIBRARY_DIRNAME = "library"
ALLOWED_KINDS = ("textbook", "companion", "reference")


def _library_dir() -> Path:
    d = db.db_path().parent / LIBRARY_DIRNAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _conn_rw() -> sqlite3.Connection:
    """Read-write connection. The default `db.connect()` opens read-only."""
    c = sqlite3.connect(db.db_path())
    c.row_factory = sqlite3.Row
    return c


# ---------- manual entries --------------------------------------------------


def list_items() -> list[dict[str, Any]]:
    with db.connect() as c:
        rows = db.rows_to_dicts(c.execute(
            "SELECT id, title, author, subject, kind, url, file_path, notes, "
            "       cover_url, added_at, updated_at "
            "FROM library_items ORDER BY added_at DESC, id DESC"
        ).fetchall())
    for r in rows:
        r["source"] = "manual"
        r["id"] = f"manual:{r['id']}"
    return rows


def create_item(payload: dict[str, Any]) -> dict[str, Any]:
    title = (payload.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    kind = (payload.get("kind") or "reference").strip()
    if kind not in ALLOWED_KINDS:
        raise ValueError(f"kind must be one of {ALLOWED_KINDS}")
    url = (payload.get("url") or "").strip() or None
    file_path = (payload.get("file_path") or "").strip() or None
    if not url and not file_path:
        raise ValueError("Either a URL or a file_path is required.")

    now = _now()
    with _conn_rw() as c:
        cur = c.execute(
            "INSERT INTO library_items "
            "  (title, author, subject, kind, url, file_path, notes, cover_url, added_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                title,
                (payload.get("author") or "").strip() or None,
                (payload.get("subject") or "").strip() or None,
                kind,
                url,
                file_path,
                (payload.get("notes") or "").strip() or None,
                (payload.get("cover_url") or "").strip() or None,
                now,
                now,
            ),
        )
        new_id = cur.lastrowid
    return {"id": f"manual:{new_id}", "ok": True}


def update_item(item_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    title = (payload.get("title") or "").strip()
    kind = (payload.get("kind") or "reference").strip()
    if not title:
        raise ValueError("title is required")
    if kind not in ALLOWED_KINDS:
        raise ValueError(f"kind must be one of {ALLOWED_KINDS}")
    with _conn_rw() as c:
        cur = c.execute(
            "UPDATE library_items SET "
            "  title=?, author=?, subject=?, kind=?, url=?, file_path=?, "
            "  notes=?, cover_url=?, updated_at=? "
            "WHERE id=?",
            (
                title,
                (payload.get("author") or "").strip() or None,
                (payload.get("subject") or "").strip() or None,
                kind,
                (payload.get("url") or "").strip() or None,
                (payload.get("file_path") or "").strip() or None,
                (payload.get("notes") or "").strip() or None,
                (payload.get("cover_url") or "").strip() or None,
                _now(),
                item_id,
            ),
        )
        if cur.rowcount == 0:
            raise FileNotFoundError(f"Library item {item_id} not found")
    return {"ok": True}


def delete_item(item_id: int) -> dict[str, Any]:
    with _conn_rw() as c:
        cur = c.execute("DELETE FROM library_items WHERE id=?", (item_id,))
        if cur.rowcount == 0:
            raise FileNotFoundError(f"Library item {item_id} not found")
    return {"ok": True}


# ---------- auto-discovered local PDFs --------------------------------------


def list_local_files() -> list[dict[str, Any]]:
    """Walk data/library/ for PDF / EPUB files, ignoring dotfiles and the
    .DS_Store noise macOS sprinkles around."""
    root = _library_dir()
    items: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if path.suffix.lower() not in {".pdf", ".epub"}:
            continue
        stat = path.stat()
        items.append({
            "id": f"file:{rel.as_posix()}",
            "title": rel.stem,
            "author": None,
            "subject": rel.parts[0] if len(rel.parts) > 1 else None,
            "kind": "textbook",  # default — user can override by adding a manual entry pointing at the same file
            "url": None,
            "file_path": rel.as_posix(),
            "notes": None,
            "cover_url": None,
            "size_bytes": stat.st_size,
            "added_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "updated_at": datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
            "source": "file",
        })
    return items


def serve_file(file_path: str) -> tuple[Path, str]:
    """Resolve a relative file path inside data/library/ to an absolute path.

    Refuses anything that tries to escape the library root.
    """
    root = _library_dir().resolve()
    # Reject absolute paths and traversal up-front.
    candidate = (root / file_path).resolve()
    if not str(candidate).startswith(str(root) + os.sep) and candidate != root:
        raise PermissionError(f"Path escapes the library root: {file_path}")
    if not candidate.exists() or not candidate.is_file():
        raise FileNotFoundError(file_path)
    media = "application/pdf" if candidate.suffix.lower() == ".pdf" else "application/epub+zip"
    return candidate, media


def library_dir_path() -> str:
    return str(_library_dir())


# ---------- helpers ---------------------------------------------------------


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")
