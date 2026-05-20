"""Pronote login wrapper with rotating-token persistence."""

from __future__ import annotations

import json
import logging
import os
import uuid as uuid_lib
from pathlib import Path

import pronotepy
from pronotepy import ent as ent_module

from .config import Config

log = logging.getLogger(__name__)


class LoginError(RuntimeError):
    pass


def _ent_callable(name: str):
    fn = getattr(ent_module, name, None)
    if fn is None or not callable(fn):
        raise LoginError(
            f"Unknown ENT provider {name!r}. "
            "Run `cartable list-ents` to see the available providers."
        )
    return fn


def _load_token(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read token file %s: %s — re-authenticating from scratch.", path, exc)
        return None


def _save_token(path: Path, creds: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write atomically and tighten permissions — this file contains a secret.
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(creds, indent=2))
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def _stable_uuid(cfg: Config) -> str:
    """Derive a stable per-installation UUID — Pronote ties tokens to it."""
    uuid_file = cfg.data_dir / "device_uuid"
    if uuid_file.exists():
        return uuid_file.read_text().strip()
    new = str(uuid_lib.uuid4())
    uuid_file.write_text(new)
    os.chmod(uuid_file, 0o600)
    return new


def login(cfg: Config) -> pronotepy.Client:
    """Return a logged-in Client, preferring the saved token, falling back to password.

    For parent.html URLs returns a ParentClient with `child_name` (if any) selected.
    """
    cls = pronotepy.ParentClient if cfg.is_parent_account else pronotepy.Client

    token = _load_token(cfg.token_path)
    if token:
        try:
            log.info("Logging in with saved token (%s)…", cls.__name__)
            client = cls.token_login(
                pronote_url=token["pronote_url"],
                username=token["username"],
                password=token["password"],
                uuid=token["uuid"],
                client_identifier=token.get("client_identifier"),
            )
            _select_child(client, cfg)
            _save_token(cfg.token_path, client.export_credentials())
            return client
        except Exception as exc:  # noqa: BLE001 — pronotepy raises a variety of types
            log.warning("Token login failed (%s) — falling back to password login.", exc)

    log.info("Logging in with password (%s)…", cls.__name__)
    ent_fn = _ent_callable(cfg.ent_provider) if cfg.auth_mode == "ent" else None
    try:
        client = cls(
            cfg.pronote_url,
            username=cfg.username,
            password=cfg.password,
            ent=ent_fn,
            uuid=_stable_uuid(cfg),
        )
    except Exception as exc:  # noqa: BLE001
        raise LoginError(f"Password login failed: {exc}") from exc

    _select_child(client, cfg)
    _save_token(cfg.token_path, client.export_credentials())
    return client


def _select_child(client: pronotepy.Client, cfg: Config) -> None:
    """If this is a parent account and PRONOTE_CHILD is set, pick that child."""
    if not isinstance(client, pronotepy.ParentClient):
        return
    children = [c.name for c in client.children]
    log.info("Parent account: children=%s; default=%s", children, client.info.name)
    if not cfg.child_name:
        return
    try:
        client.set_child(cfg.child_name)
        log.info("Selected child: %s", client.info.name)
    except Exception as exc:  # noqa: BLE001
        raise LoginError(
            f"Cannot select child {cfg.child_name!r}. Available: {children}"
        ) from exc


def list_ent_providers() -> list[str]:
    return sorted(
        n for n in dir(ent_module)
        if not n.startswith("_") and callable(getattr(ent_module, n))
    )


def active_student_info(client: pronotepy.Client):
    """ClientInfo of the actually-selected student.

    On ParentClient, `client.info` stays the parent; the child is `_selected_child`.
    """
    if isinstance(client, pronotepy.ParentClient):
        return client._selected_child
    return client.info
