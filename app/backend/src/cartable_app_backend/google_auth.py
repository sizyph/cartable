"""Shared Google OAuth — one credential / one token file across Calendar + Drive.

When a user adds Drive on top of an existing Calendar install, they need to
re-authorise once (the OAuth consent screen records the set of granted
scopes, and we can't silently add scopes to an existing token). After that,
both halves use the same `google_token.json`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Sequence

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

# Both halves of Cartable share these scopes.
SCOPES: tuple[str, ...] = (
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/drive.file",      # write files we own
    "https://www.googleapis.com/auth/drive.readonly",  # browse user files
)


def data_dir() -> Path:
    if os.environ.get("CARTABLE_APP_CONFIG_DIR"):
        return Path(os.environ["CARTABLE_APP_CONFIG_DIR"]).expanduser()
    return Path.home() / "Library" / "Application Support" / "Cartable"


def credentials_path() -> Path:
    return data_dir() / "google_credentials.json"


def token_path() -> Path:
    return data_dir() / "google_token.json"


def load_creds() -> Credentials | None:
    path = token_path()
    if not path.exists():
        return None
    creds = Credentials.from_authorized_user_file(str(path), list(SCOPES))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_creds(creds)
    # Tokens from older Cartable builds (Calendar-only) won't have Drive scopes —
    # report this to the caller via has_all_scopes() below.
    return creds


def save_creds(creds: Credentials) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = token_path()
    p.write_text(creds.to_json())
    os.chmod(p, 0o600)


def has_all_scopes(creds: Credentials | None) -> bool:
    if not creds:
        return False
    granted = set(creds.scopes or [])
    return all(s in granted for s in SCOPES)


def authorize() -> dict:
    """Run the OAuth flow with the full Cartable scope set."""
    if not credentials_path().exists():
        raise FileNotFoundError(
            f"Missing OAuth credentials at {credentials_path()}. "
            "Create a Desktop OAuth client in Google Cloud and save the JSON there."
        )
    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path()), list(SCOPES))
    creds = flow.run_local_server(port=0, open_browser=True)
    save_creds(creds)
    return {"ok": True, "scopes": list(creds.scopes or [])}


def is_authorized() -> bool:
    creds = load_creds()
    return bool(creds and creds.valid and has_all_scopes(creds))
