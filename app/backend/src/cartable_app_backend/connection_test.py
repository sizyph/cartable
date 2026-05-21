"""End-to-end Pronote connectivity test.

Walks through each capability the rest of the app depends on, returning a
traffic-light status per check. The user can re-run this from Settings any
time Pronote behaves oddly (their protocol or the school's data exposure
sometimes changes mid-year).
"""

from __future__ import annotations

import datetime as dt
import logging
import time
from pathlib import Path
from typing import Any, Callable

import pronotepy

from pronote_cli import client as cli_client_mod
from pronote_cli.config import Config

from . import secure_creds

log = logging.getLogger("cartable_app.conntest")


def _config_from_keychain() -> Config:
    acc = secure_creds.load()
    pwd = secure_creds.get_password() or ""
    if not acc.get("pronote_url") or not acc.get("username") or not pwd:
        raise RuntimeError("No credentials configured — finish Welcome first.")
    return Config(
        pronote_url=acc["pronote_url"],
        auth_mode=acc.get("auth_mode") or "password",
        username=acc["username"],
        password=pwd,
        ent_provider=acc.get("ent_provider") or "",
        child_name=acc.get("child_name") or "",
        data_dir=Path.home() / "Documents/Claude/cartable/data",
    )


def _run_one(name: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    started = time.monotonic()
    try:
        result = fn()
        duration_ms = int((time.monotonic() - started) * 1000)
        return {"name": name, "duration_ms": duration_ms, **result}
    except Exception as exc:  # noqa: BLE001 — pronotepy errors vary
        duration_ms = int((time.monotonic() - started) * 1000)
        log.warning("connection_test step %s failed: %s", name, exc)
        return {
            "name": name,
            "status": "error",
            "duration_ms": duration_ms,
            "message": f"{type(exc).__name__}: {exc}",
        }


def run() -> dict[str, Any]:
    cfg = _config_from_keychain()
    overall_started = time.monotonic()

    checks: list[dict[str, Any]] = []

    # 1. Login (shared client used by subsequent steps)
    state: dict[str, Any] = {}
    def _login() -> dict[str, Any]:
        c = cli_client_mod.login(cfg)
        state["client"] = c
        info = cli_client_mod.active_student_info(c)
        is_parent = isinstance(c, pronotepy.ParentClient)
        return {
            "status": "ok",
            "message": (
                f"Logged in as {info.name or '?'} ({'ParentClient' if is_parent else 'Client'})"
            ),
            "data": {"is_parent_account": is_parent, "student_name": info.name},
        }
    checks.append(_run_one("login", _login))

    # If login failed everything else is meaningless — bail out cleanly.
    if checks[0]["status"] == "error":
        return {
            "ok": False,
            "started_at": dt.datetime.now().isoformat(timespec="seconds"),
            "duration_ms": int((time.monotonic() - overall_started) * 1000),
            "checks": checks,
        }

    client = state["client"]

    # 2. Student info — class, school
    def _student_info() -> dict[str, Any]:
        info = cli_client_mod.active_student_info(client)
        bits = [info.name or "?"]
        if info.class_name:
            bits.append(info.class_name)
        if info.establishment:
            bits.append(info.establishment)
        return {"status": "ok", "message": " · ".join(bits)}
    checks.append(_run_one("student_info", _student_info))

    # 3. Periods (trimesters / semesters)
    def _periods() -> dict[str, Any]:
        ps = list(client.periods)
        if not ps:
            return {"status": "warning", "message": "No periods found on this account."}
        current = next((p.name for p in ps if p == client.current_period), None)
        return {
            "status": "ok",
            "message": f"{len(ps)} periods" + (f", current = {current}" if current else ""),
        }
    checks.append(_run_one("periods", _periods))

    # 4. Grades — current period
    def _grades() -> dict[str, Any]:
        period = client.current_period
        if not period:
            return {"status": "warning", "message": "No current period."}
        grades = list(period.grades)
        if not grades:
            return {"status": "warning", "message": "Current period has 0 grades yet."}
        return {"status": "ok", "message": f"{len(grades)} grades in {period.name}"}
    checks.append(_run_one("grades", _grades))

    # 5. Averages — current period
    def _averages() -> dict[str, Any]:
        period = client.current_period
        if not period:
            return {"status": "warning", "message": "No current period."}
        avgs = list(period.averages)
        if not avgs:
            return {"status": "warning", "message": "Current period has 0 averages yet."}
        return {"status": "ok", "message": f"{len(avgs)} subject averages"}
    checks.append(_run_one("averages", _averages))

    # 6. Homework — next 14 days
    def _homework() -> dict[str, Any]:
        today = dt.date.today()
        items = list(client.homework(today, today + dt.timedelta(days=14)))
        if not items:
            return {"status": "warning", "message": "No homework in the next 14 days."}
        return {"status": "ok", "message": f"{len(items)} homework items in next 14 days"}
    checks.append(_run_one("homework", _homework))

    # 7. Lessons — current week (week-by-week to dodge the holiday KeyError)
    def _lessons() -> dict[str, Any]:
        today = dt.date.today()
        items: list = []
        for offset in range(0, 7, 7):
            start = today + dt.timedelta(days=offset)
            end = start + dt.timedelta(days=6)
            try:
                items.extend(client.lessons(start, end))
            except Exception:  # noqa: BLE001
                continue
        if not items:
            return {"status": "warning", "message": "No lessons in the current week."}
        return {"status": "ok", "message": f"{len(items)} lessons this week"}
    checks.append(_run_one("lessons", _lessons))

    # 8. Bulletins — count periods with a published report
    def _bulletins() -> dict[str, Any]:
        n = 0
        for p in client.periods:
            try:
                if p.report is not None:
                    n += 1
            except Exception:  # noqa: BLE001
                pass
        if n == 0:
            return {"status": "warning", "message": "No published bulletins yet."}
        return {"status": "ok", "message": f"{n} published bulletins"}
    checks.append(_run_one("bulletins", _bulletins))

    # 9. Teaching staff
    def _teachers() -> dict[str, Any]:
        staff = client.get_teaching_staff()
        if not staff:
            return {"status": "warning", "message": "No teaching staff returned."}
        return {"status": "ok", "message": f"{len(staff)} teachers"}
    checks.append(_run_one("teaching_staff", _teachers))

    # 10. Information & surveys
    def _info() -> dict[str, Any]:
        items = client.information_and_surveys(
            date_from=dt.datetime.now() - dt.timedelta(days=60),
            date_to=dt.datetime.now(),
        )
        if not items:
            return {"status": "warning", "message": "No information / surveys in last 60 days."}
        return {"status": "ok", "message": f"{len(items)} information / surveys"}
    checks.append(_run_one("information", _info))

    overall_duration_ms = int((time.monotonic() - overall_started) * 1000)
    statuses = [c["status"] for c in checks]
    if "error" in statuses:
        overall_status = "error"
    elif "warning" in statuses:
        overall_status = "warning"
    else:
        overall_status = "ok"

    return {
        "ok": overall_status != "error",
        "overall_status": overall_status,
        "started_at": dt.datetime.now().isoformat(timespec="seconds"),
        "duration_ms": overall_duration_ms,
        "checks": checks,
    }
