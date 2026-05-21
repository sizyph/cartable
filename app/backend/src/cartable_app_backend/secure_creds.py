"""Cartable's own secure credential storage.

The password (and the rotating token) live in the macOS Keychain, accessed
via `keyring`. Non-sensitive fields (URL, username, auth mode, ENT provider,
child name) live in a JSON file under `~/Library/Application Support/Cartable`.

We also mirror the credentials to `~/Documents/Claude/cartable/.env` because
the CLI half (`uv run cartable sync`, the launchd job) still expects that
file. Long-term plan: teach the CLI to read Keychain too; for now the mirror
keeps existing workflows working.

Locking down the .env mirror:
- chmod 0600 — readable only by the user.
- The PASSWORD inside is the secret; Keychain is the canonical store, the
  .env is a derived cache. If the user wipes Keychain via logout, the .env
  is wiped too.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import keyring

log = logging.getLogger("cartable_app.secure_creds")

KEYRING_SERVICE = "io.github.sizyph.cartable"
KEY_PASSWORD = "pronote-password"
KEY_TOKEN = "pronote-token"


def _app_dir() -> Path:
    if os.environ.get("CARTABLE_APP_CONFIG_DIR"):
        return Path(os.environ["CARTABLE_APP_CONFIG_DIR"]).expanduser()
    return Path.home() / "Library" / "Application Support" / "Cartable"


def _account_path() -> Path:
    return _app_dir() / "account.json"


def _cli_dir() -> Path:
    return Path(os.environ.get(
        "CARTABLE_DIR", Path.home() / "Documents/Claude/cartable"
    )).expanduser()


def _cli_env_path() -> Path:
    return _cli_dir() / ".env"


# ---------- public reads ----------------------------------------------------


def load() -> dict[str, Any]:
    """Returns the account record from JSON (no password)."""
    path = _account_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def has_password() -> bool:
    try:
        return bool(keyring.get_password(KEYRING_SERVICE, KEY_PASSWORD))
    except Exception:  # noqa: BLE001
        return False


def get_password() -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, KEY_PASSWORD)
    except Exception as exc:  # noqa: BLE001
        log.warning("keyring read failed: %s", exc)
        return None


def get_token_blob() -> str | None:
    try:
        return keyring.get_password(KEYRING_SERVICE, KEY_TOKEN)
    except Exception as exc:  # noqa: BLE001
        log.warning("keyring token read failed: %s", exc)
        return None


def is_configured() -> bool:
    d = load()
    return bool(d.get("pronote_url") and d.get("username") and has_password())


# ---------- public writes ---------------------------------------------------


def save(payload: dict[str, Any], *, password: str | None) -> None:
    """Persist non-sensitive fields to JSON and password to Keychain.

    `password=None` means "keep whatever's already there"; an empty string
    is an explicit no-password (which we treat as missing).
    """
    fields = {
        "pronote_url": (payload.get("pronote_url") or "").strip(),
        "auth_mode": (payload.get("auth_mode") or "password").strip(),
        "username": (payload.get("username") or "").strip(),
        "ent_provider": (payload.get("ent_provider") or "").strip(),
        "child_name": (payload.get("child_name") or "").strip(),
    }
    if not fields["pronote_url"] or not fields["username"]:
        raise ValueError("pronote_url and username are required")

    d = _app_dir()
    d.mkdir(parents=True, exist_ok=True)
    p = _account_path()
    p.write_text(json.dumps(fields, indent=2))
    os.chmod(p, 0o600)

    if password is not None:
        if password:
            keyring.set_password(KEYRING_SERVICE, KEY_PASSWORD, password)
        else:
            try:
                keyring.delete_password(KEYRING_SERVICE, KEY_PASSWORD)
            except keyring.errors.PasswordDeleteError:
                pass

    # Mirror to CLI's .env so existing launchd jobs and `uv run cartable`
    # keep working from the same credentials.
    if password is None:
        # Read current password from Keychain to write the mirror.
        password = get_password() or ""
    if password:
        _write_cli_env(fields, password)


def save_token_blob(blob: str) -> None:
    """Stash the rotating-token JSON in Keychain."""
    try:
        keyring.set_password(KEYRING_SERVICE, KEY_TOKEN, blob)
    except Exception as exc:  # noqa: BLE001
        log.warning("keyring token write failed: %s", exc)


def clear() -> None:
    """Wipe app-managed state: Keychain entries + the JSON in Application Support.

    The CLI's `.env` is **not** touched. Even though `save()` mirrors creds
    to it, the .env may also be user-managed (created by hand before the
    Mac app existed); we'd rather leave a stale mirror in place than wipe
    a file the user might depend on. Remove it manually if you want it gone.
    """
    for key in (KEY_PASSWORD, KEY_TOKEN):
        try:
            keyring.delete_password(KEYRING_SERVICE, key)
        except keyring.errors.PasswordDeleteError:
            pass
    p = _account_path()
    if p.exists():
        p.unlink()


# ---------- .env mirror (CLI compat) ----------------------------------------


def _write_cli_env(fields: dict[str, str], password: str) -> None:
    env = _cli_env_path()
    env.parent.mkdir(parents=True, exist_ok=True)
    body = (
        "# Cartable app — credential mirror for the CLI's `uv run cartable sync`.\n"
        "# The authoritative store is the macOS Keychain (service "
        "'io.github.sizyph.cartable'). This file is rewritten whenever you\n"
        "# update credentials in Settings, and wiped when you log out.\n"
        f"PRONOTE_URL={fields.get('pronote_url', '')}\n"
        f"PRONOTE_AUTH_MODE={fields.get('auth_mode', 'password')}\n"
        f"PRONOTE_USERNAME={fields.get('username', '')}\n"
        f"PRONOTE_PASSWORD={password}\n"
        f"PRONOTE_ENT_PROVIDER={fields.get('ent_provider', '')}\n"
        f"PRONOTE_CHILD={fields.get('child_name', '')}\n"
        "CARTABLE_DATA_DIR=\n"
    )
    env.write_text(body)
    os.chmod(env, 0o600)


# ---------- CLI .env discovery + import -------------------------------------


def detect_cli_env() -> dict[str, Any]:
    """Look for an existing CLI `.env` and return what's in it (no password).

    Used by the Welcome screen to offer 'Import from CLI' if the user already
    set up the standalone CLI before installing the Mac app.
    """
    env = _cli_env_path()
    if not env.exists():
        return {"found": False, "path": str(env)}
    try:
        values = _parse_env(env.read_text())
    except OSError:
        return {"found": False, "path": str(env)}
    return {
        "found": True,
        "path": str(env),
        "pronote_url": values.get("PRONOTE_URL", ""),
        "username": values.get("PRONOTE_USERNAME", ""),
        "auth_mode": values.get("PRONOTE_AUTH_MODE", "password"),
        "ent_provider": values.get("PRONOTE_ENT_PROVIDER", ""),
        "child_name": values.get("PRONOTE_CHILD", ""),
        "has_password": bool(values.get("PRONOTE_PASSWORD", "").strip()),
    }


def import_from_cli() -> dict[str, Any]:
    """Read the CLI's .env and move the credentials into Keychain + JSON.

    The CLI's .env is preserved as the mirror; it's not deleted because the
    launchd auto-sync still reads from it. After import, both sources hold
    the same values; subsequent edits via Settings flow through Keychain
    (with the .env mirror updated automatically).
    """
    env = _cli_env_path()
    if not env.exists():
        raise FileNotFoundError(f"No CLI .env at {env}")
    values = _parse_env(env.read_text())
    password = values.get("PRONOTE_PASSWORD", "").strip()
    if not password:
        raise ValueError("CLI .env has no PRONOTE_PASSWORD.")

    payload = {
        "pronote_url": values.get("PRONOTE_URL", ""),
        "auth_mode": values.get("PRONOTE_AUTH_MODE", "password"),
        "username": values.get("PRONOTE_USERNAME", ""),
        "ent_provider": values.get("PRONOTE_ENT_PROVIDER", ""),
        "child_name": values.get("PRONOTE_CHILD", ""),
    }
    save(payload, password=password)
    return {"ok": True, "imported_username": payload["username"]}


def _parse_env(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out
