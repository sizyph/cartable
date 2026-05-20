"""Environment + filesystem configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Config:
    pronote_url: str
    auth_mode: str  # "password" or "ent"
    username: str
    password: str
    ent_provider: str  # only used when auth_mode == "ent"
    child_name: str   # only used when the URL is a parent account with several children
    data_dir: Path

    @property
    def db_path(self) -> Path:
        return self.data_dir / "pronote.db"

    @property
    def token_path(self) -> Path:
        return self.data_dir / "token.json"

    @property
    def is_parent_account(self) -> bool:
        return "parent.html" in self.pronote_url.lower()


def load() -> Config:
    load_dotenv(PROJECT_ROOT / ".env")

    data_dir_str = os.environ.get("CARTABLE_DATA_DIR") or str(PROJECT_ROOT / "data")
    data_dir = Path(data_dir_str).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    auth_mode = (os.environ.get("PRONOTE_AUTH_MODE") or "password").lower()
    if auth_mode not in ("password", "ent"):
        raise ValueError(
            f"PRONOTE_AUTH_MODE must be 'password' or 'ent', got {auth_mode!r}"
        )

    cfg = Config(
        pronote_url=_require("PRONOTE_URL"),
        auth_mode=auth_mode,
        username=_require("PRONOTE_USERNAME"),
        password=_require("PRONOTE_PASSWORD"),
        ent_provider=os.environ.get("PRONOTE_ENT_PROVIDER", "").strip(),
        child_name=os.environ.get("PRONOTE_CHILD", "").strip(),
        data_dir=data_dir,
    )
    if cfg.auth_mode == "ent" and not cfg.ent_provider:
        raise ValueError("PRONOTE_ENT_PROVIDER is required when PRONOTE_AUTH_MODE=ent")
    return cfg


def _require(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise ValueError(f"Missing required env var: {name}")
    return val
