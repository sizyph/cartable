"""Push the next N days of Pronote lessons into a dedicated Google Calendar.

One-time setup (per user):
  1. Create a Google Cloud project, enable the Google Calendar API.
  2. Create an OAuth 2.0 Client ID (type: Desktop) and download the JSON.
  3. Save it to  ~/Library/Application Support/Cartable/google_credentials.json
  4. From the app, click "Connect Google Calendar" — that opens the browser
     and writes a token to .../google_token.json that is refreshed automatically.

The Pronote sync runs server-side from cartable's SQLite. We deduplicate by
generating a stable event ID from (date, start_time, subject_name).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from . import db

log = logging.getLogger("cartable_app.calendar")

SCOPES = ["https://www.googleapis.com/auth/calendar"]
DEFAULT_CALENDAR_NAME = "Pronote — Cartable"
DEFAULT_LOOKAHEAD_DAYS = 14
EVENT_ID_PREFIX = "cartable"


def _calendar_name() -> str:
    """Honor an explicit override, else build a personalised name from the
    student's `name` row in the DB so different families' calendars don't
    collide if they share a Google account."""
    if os.environ.get("CARTABLE_CALENDAR_NAME"):
        return os.environ["CARTABLE_CALENDAR_NAME"]
    try:
        from . import db as _db
        student = (_db.student_info().get("name") or "").strip()
    except Exception:  # noqa: BLE001
        student = ""
    if student:
        # Use the first name only — Pronote stores "FAMILY First".
        parts = student.split()
        first = parts[-1] if parts else student
        return f"Pronote — {first}"
    return DEFAULT_CALENDAR_NAME


def _timezone() -> str:
    """Default to the system timezone; let the user override via env."""
    if os.environ.get("CARTABLE_CALENDAR_TIMEZONE"):
        return os.environ["CARTABLE_CALENDAR_TIMEZONE"]
    try:
        import time as _time
        # tzname is ("CET", "CEST") etc. — not a tzdata key. Use /etc/localtime.
        tz_path = Path("/etc/localtime").resolve()
        marker = "/zoneinfo/"
        if marker in str(tz_path):
            return str(tz_path).split(marker, 1)[1]
    except Exception:  # noqa: BLE001
        pass
    return "UTC"


def _data_dir() -> Path:
    """Where we keep credentials/token. macOS-friendly, gitignored on the user side."""
    if os.environ.get("CARTABLE_APP_CONFIG_DIR"):
        return Path(os.environ["CARTABLE_APP_CONFIG_DIR"]).expanduser()
    return Path.home() / "Library" / "Application Support" / "Cartable"


def _credentials_path() -> Path:
    return _data_dir() / "google_credentials.json"


def _token_path() -> Path:
    return _data_dir() / "google_token.json"


def status() -> dict[str, Any]:
    return {
        "has_credentials": _credentials_path().exists(),
        "has_token": _token_path().exists(),
        "credentials_path": str(_credentials_path()),
        "calendar_name": _calendar_name(),
    }


def _load_creds() -> Credentials | None:
    token_path = _token_path()
    if not token_path.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _save_creds(creds)
    return creds


def _save_creds(creds: Credentials) -> None:
    data_dir = _data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    p = _token_path()
    p.write_text(creds.to_json())
    os.chmod(p, 0o600)


def authorize() -> dict[str, Any]:
    """Run the OAuth flow — opens the user's browser, blocks until they consent."""
    if not _credentials_path().exists():
        raise FileNotFoundError(
            f"Missing OAuth credentials at {_credentials_path()}. "
            "Create a Desktop OAuth client in Google Cloud and save the JSON there."
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(_credentials_path()), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=True)
    _save_creds(creds)
    return {"ok": True, "scopes": list(creds.scopes or [])}


def _service():
    creds = _load_creds()
    if not creds or not creds.valid:
        raise RuntimeError("Not authorized. Run /api/calendar/authorize first.")
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _find_or_create_calendar(svc) -> str:
    """Return the calendarId of our dedicated calendar, creating it if needed."""
    name = _calendar_name()
    page_token = None
    while True:
        resp = svc.calendarList().list(pageToken=page_token).execute()
        for entry in resp.get("items", []):
            if entry.get("summary") == name:
                return entry["id"]
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    created = svc.calendars().insert(body={
        "summary": name,
        "timeZone": _timezone(),
    }).execute()
    log.info("Created calendar %s (%s)", name, created["id"])
    return created["id"]


def _event_id(lesson: dict) -> str:
    """Stable, deterministic event ID for upsert.

    Google Calendar event IDs accept base32-without-padding characters [a-v0-9]
    and a length of 5..1024. We hash the lesson key fields and strip out any
    non-conforming chars.
    """
    key = "|".join(str(lesson.get(k) or "") for k in ("start_dt", "subject_name", "teacher_names"))
    raw = hashlib.sha1(key.encode("utf-8")).hexdigest()
    # hex → only [0-9a-f], which is a subset of [a-v0-9]. Prefix to identify ours.
    return f"{EVENT_ID_PREFIX}{raw}"


def _to_event(lesson: dict) -> dict:
    start = lesson["start_dt"]
    end = lesson.get("end_dt") or _add_minutes(start, 55)
    tz = _timezone()
    summary_parts = [lesson.get("subject_name") or "Cours"]
    if lesson.get("is_test"):
        summary_parts.append("(test)")
    desc_lines = []
    if lesson.get("teacher_names"):
        desc_lines.append(f"Prof: {lesson['teacher_names']}")
    if lesson.get("status"):
        desc_lines.append(f"Status: {lesson['status']}")
    if lesson.get("memo"):
        desc_lines.append(lesson["memo"])
    return {
        "id": _event_id(lesson),
        "summary": " ".join(summary_parts),
        "location": lesson.get("classroom") or "",
        "description": "\n".join(desc_lines),
        "start": {"dateTime": start, "timeZone": tz},
        "end": {"dateTime": end, "timeZone": tz},
        "status": "cancelled" if lesson.get("canceled") else "confirmed",
        "colorId": "6" if lesson.get("is_test") else None,
    }


def _add_minutes(iso: str, minutes: int) -> str:
    d = dt.datetime.fromisoformat(iso)
    return (d + dt.timedelta(minutes=minutes)).isoformat()


def sync_two_weeks(days: int = DEFAULT_LOOKAHEAD_DAYS) -> dict[str, Any]:
    """Read the next `days` days of lessons from SQLite and upsert into the calendar."""
    today = dt.date.today()
    lessons = db.lessons(today.isoformat(), (today + dt.timedelta(days=days)).isoformat())

    # Deduplicate by event_id — same lesson appears once per group from Pronote.
    by_id: dict[str, dict] = {}
    for l in lessons:
        ev = _to_event(l)
        prev = by_id.get(ev["id"])
        # prefer the variant with a classroom set
        if not prev or (not prev.get("location") and ev.get("location")):
            by_id[ev["id"]] = ev

    svc = _service()
    cal_id = _find_or_create_calendar(svc)

    inserted, updated, errors = 0, 0, 0
    for ev in by_id.values():
        try:
            svc.events().insert(calendarId=cal_id, body=ev).execute()
            inserted += 1
        except HttpError as e:
            if e.resp.status == 409:
                # already exists — patch it instead
                try:
                    svc.events().patch(calendarId=cal_id, eventId=ev["id"], body=ev).execute()
                    updated += 1
                except HttpError as e2:
                    log.warning("patch failed for %s: %s", ev["id"], e2)
                    errors += 1
            else:
                log.warning("insert failed for %s: %s", ev["id"], e)
                errors += 1

    return {
        "calendar": _calendar_name(),
        "calendar_id": cal_id,
        "window_days": days,
        "inserted": inserted,
        "updated": updated,
        "errors": errors,
        "lessons_seen": len(lessons),
        "deduplicated": len(by_id),
    }
