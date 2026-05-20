"""Pull data from Pronote and upsert it into SQLite."""

from __future__ import annotations

import datetime as dt
import json
import logging
import sqlite3
import traceback
from dataclasses import dataclass
from typing import Any, Iterable

import pronotepy

from . import db
from .client import active_student_info, login
from .config import Config

log = logging.getLogger(__name__)

# How far back/forward to pull lessons & homework around "today".
LESSON_LOOKBACK_DAYS = 14
LESSON_LOOKAHEAD_DAYS = 35
INFO_LOOKBACK_DAYS = 60


@dataclass
class SyncCounts:
    periods: int = 0
    teachers: int = 0
    grades: int = 0
    averages: int = 0
    homework: int = 0
    lessons: int = 0
    absences: int = 0
    punishments: int = 0
    evaluations: int = 0
    information: int = 0

    def as_dict(self) -> dict[str, int]:
        return {k: getattr(self, k) for k in self.__annotations__}


def run(cfg: Config) -> SyncCounts:
    started_at = _now_iso()
    client = login(cfg)
    conn = db.connect(cfg.db_path)
    try:
        db.init_schema(conn)
        counts = SyncCounts()
        with conn:  # one transaction for the whole sync
            # Pronote returns session-scoped IDs that change on every login, so
            # `ON CONFLICT(id) DO UPDATE` doesn't dedupe — old rows pile up. We
            # take a clean snapshot each sync. student_info (keyed by stable
            # business keys) and sync_log are preserved.
            for table in (
                "periods", "teachers", "grades", "averages",
                "homework", "lessons", "absences", "punishments",
                "evaluations", "information",
            ):
                conn.execute(f"DELETE FROM {table}")
            _sync_student_info(conn, client)
            _sync_periods(conn, client, counts)
            _sync_teachers(conn, client, counts)
            _sync_grades_averages(conn, client, counts)
            _sync_absences_punishments_evals(conn, client, counts)
            _sync_homework(conn, client, counts)
            _sync_lessons(conn, client, counts)
            _sync_information(conn, client, counts)
        _log_sync(conn, started_at, success=True, counts=counts.as_dict(), error=None)
        return counts
    except Exception as exc:
        log.exception("Sync failed")
        _log_sync(
            conn,
            started_at,
            success=False,
            counts=None,
            error=f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}",
        )
        raise
    finally:
        conn.close()


# ---------- helpers ----------------------------------------------------------


def _now_iso() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return str(value)


def _upsert(conn: sqlite3.Connection, table: str, rows: Iterable[dict], pk: str | tuple[str, ...] = "id") -> int:
    rows = list(rows)
    if not rows:
        return 0
    columns = list(rows[0].keys())
    placeholders = ", ".join("?" * len(columns))
    cols_sql = ", ".join(columns)
    if isinstance(pk, str):
        pk_cols = (pk,)
    else:
        pk_cols = pk
    update_cols = [c for c in columns if c not in pk_cols]
    update_sql = ", ".join(f"{c}=excluded.{c}" for c in update_cols)
    sql = (
        f"INSERT INTO {table} ({cols_sql}) VALUES ({placeholders}) "
        f"ON CONFLICT({', '.join(pk_cols)}) DO UPDATE SET {update_sql}"
    )
    conn.executemany(sql, [tuple(r[c] for c in columns) for r in rows])
    return len(rows)


def _log_sync(
    conn: sqlite3.Connection,
    started_at: str,
    *,
    success: bool,
    counts: dict | None,
    error: str | None,
) -> None:
    conn.execute(
        "INSERT INTO sync_log (started_at, finished_at, success, error, counts_json) "
        "VALUES (?, ?, ?, ?, ?)",
        (
            started_at,
            _now_iso(),
            1 if success else 0,
            error,
            json.dumps(counts) if counts is not None else None,
        ),
    )


# ---------- individual syncs -------------------------------------------------


def _sync_student_info(conn: sqlite3.Connection, client: pronotepy.Client) -> None:
    info = active_student_info(client)

    # `name`, `class_name`, `establishment`, `delegue` come from `raw_resource`
    # and are always safe. `email`, `phone`, `address`, `ine_number` are
    # lazy-fetched from a `_cache()` endpoint that consistently returns
    # "Accès refusé" on parent accounts, and the failed call breaks the
    # whole session for subsequent requests — so we skip them on ParentClient.
    pairs: dict[str, str | None] = {
        "name": info.name,
        "class_name": info.class_name,
        "establishment": info.establishment,
        "delegue": ", ".join(_safe_attr(info, "delegue") or []) or None,
    }
    if not isinstance(client, pronotepy.ParentClient):
        pairs["email"] = _safe_attr(info, "email")
        pairs["phone"] = _safe_attr(info, "phone")
        addr = _safe_attr(info, "address") or []
        pairs["address"] = ", ".join(a for a in addr if a) or None
        pairs["ine_number"] = _safe_attr(info, "ine_number")

    now = _now_iso()
    _upsert(
        conn,
        "student_info",
        [{"key": k, "value": v, "updated_at": now} for k, v in pairs.items()],
        pk="key",
    )


def _safe_attr(obj: Any, name: str) -> Any:
    try:
        return getattr(obj, name)
    except Exception as exc:  # noqa: BLE001
        log.debug("info.%s unavailable on this account: %s", name, exc)
        return None


def _sync_periods(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    current_id = client.current_period.id if client.current_period else None
    now = _now_iso()
    # NOTE: we skip period.overall_average / class_overall_average here —
    # they hit DernieresNotes lazily and have been observed to expire the
    # parent session, breaking every subsequent call. The same data is
    # recoverable by averaging `averages` rows below.
    rows = [
        {
            "id": p.id,
            "name": p.name,
            "start_date": _iso(p.start),
            "end_date": _iso(p.end),
            "overall_average": None,
            "class_overall_average": None,
            "is_current": 1 if p.id == current_id else 0,
            "updated_at": now,
        }
        for p in client.periods
    ]
    counts.periods = _upsert(conn, "periods", rows)


def _sync_teachers(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    try:
        staff = client.get_teaching_staff()
    except Exception as exc:  # noqa: BLE001
        log.warning("get_teaching_staff() failed: %s", exc)
        return
    now = _now_iso()
    rows = [
        {
            "id": t.id,
            "name": t.name,
            "type": t.type,
            "num": getattr(t, "num", None),
            "subjects": json.dumps([s.name for s in (t.subjects or [])]),
            "updated_at": now,
        }
        for t in staff
    ]
    counts.teachers = _upsert(conn, "teachers", rows)


def _sync_grades_averages(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    now = _now_iso()
    grade_rows: list[dict] = []
    average_rows: list[dict] = []
    for period in client.periods:
        try:
            grades = period.grades
        except Exception as exc:  # noqa: BLE001
            log.warning("period %s grades: %s", period.name, exc)
            grades = []
        for g in grades:
            subject_name = g.subject.name if g.subject else None
            grade_rows.append({
                "id": g.id,
                "period_id": period.id,
                "period_name": period.name,
                "subject_name": subject_name,
                "grade": g.grade,
                "out_of": _safe_float(g.out_of),
                "coefficient": _safe_float(g.coefficient),
                "class_average": _safe_float(g.average),
                "min_grade": _safe_float(g.min),
                "max_grade": _safe_float(g.max),
                "date": _iso(g.date),
                "comment": g.comment,
                "is_bonus": _bool(g.is_bonus),
                "is_optional": _bool(g.is_optionnal),
                "is_out_of_20": _bool(g.is_out_of_20),
                "updated_at": now,
            })
        try:
            averages = period.averages
        except Exception as exc:  # noqa: BLE001
            log.warning("period %s averages: %s", period.name, exc)
            averages = []
        for a in averages:
            subject_name = a.subject.name if a.subject else None
            average_rows.append({
                "period_id": period.id,
                "subject_name": subject_name,
                "student": _safe_float(a.student),
                "class_average": _safe_float(a.class_average),
                "min_average": _safe_float(a.min),
                "max_average": _safe_float(a.max),
                "out_of": _safe_float(a.out_of),
                "updated_at": now,
            })
    counts.grades = _upsert(conn, "grades", grade_rows)
    counts.averages = _upsert(conn, "averages", average_rows, pk=("period_id", "subject_name"))


def _sync_absences_punishments_evals(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    now = _now_iso()
    abs_rows, pun_rows, eval_rows = [], [], []
    for period in client.periods:
        for a in _safe_iter(lambda: period.absences, f"period {period.name} absences"):
            abs_rows.append({
                "id": a.id,
                "period_id": period.id,
                "from_date": _iso(a.from_date),
                "to_date": _iso(a.to_date),
                "days": _safe_int(a.days),
                "hours": a.hours,
                "justified": _bool(a.justified),
                "reasons": ", ".join(a.reasons or []) or None,
                "updated_at": now,
            })
        for p in _safe_iter(lambda: period.punishments, f"period {period.name} punishments"):
            pun_rows.append({
                "id": p.id,
                "period_id": period.id,
                "nature": p.nature,
                "reasons": ", ".join(p.reasons or []) or None,
                "giver": p.giver,
                "given_at": _iso(p.given),
                "duration": _iso(p.duration),
                "exclusion": _bool(p.exclusion),
                "during_lesson": _bool(p.during_lesson),
                "updated_at": now,
            })
        for e in _safe_iter(lambda: period.evaluations, f"period {period.name} evaluations"):
            eval_rows.append({
                "id": e.id,
                "period_id": period.id,
                "name": e.name,
                "description": e.description,
                "subject_name": e.subject.name if e.subject else None,
                "domain": e.domain,
                "teacher": e.teacher,
                "coefficient": _safe_float(e.coefficient),
                "date": _iso(e.date),
                "acquisitions_json": json.dumps([
                    {
                        "name": getattr(ac, "name", None),
                        "abbreviation": getattr(ac, "abbreviation", None),
                        "level": getattr(ac, "level", None),
                        "coefficient": getattr(ac, "coefficient", None),
                    }
                    for ac in (e.acquisitions or [])
                ]),
                "updated_at": now,
            })
    counts.absences = _upsert(conn, "absences", abs_rows)
    counts.punishments = _upsert(conn, "punishments", pun_rows)
    counts.evaluations = _upsert(conn, "evaluations", eval_rows)


def _sync_homework(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    today = dt.date.today()
    date_from = today - dt.timedelta(days=LESSON_LOOKBACK_DAYS)
    date_to = today + dt.timedelta(days=LESSON_LOOKAHEAD_DAYS)
    try:
        items = client.homework(date_from, date_to)
    except Exception as exc:  # noqa: BLE001
        log.warning("homework: %s", exc)
        return
    now = _now_iso()
    rows = [
        {
            "id": h.id,
            "subject_name": h.subject.name if h.subject else None,
            "description": h.description,
            "due_date": _iso(h.date),
            "done": _bool(h.done),
            "files_json": json.dumps([
                {"name": f.name, "url": f.url} for f in (h.files or [])
            ]),
            "updated_at": now,
        }
        for h in items
    ]
    counts.homework = _upsert(conn, "homework", rows)


def _sync_lessons(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    today = dt.date.today()
    start = today - dt.timedelta(days=LESSON_LOOKBACK_DAYS)
    end = today + dt.timedelta(days=LESSON_LOOKAHEAD_DAYS)

    # Pronote returns `ListeCours` per week; some weeks (school holidays, weeks
    # outside the school year) come back without that key and pronotepy raises
    # a KeyError that aborts the whole range. Iterate week-by-week and skip
    # any week that blows up.
    items: list[pronotepy.dataClasses.Lesson] = []
    cursor = start
    while cursor <= end:
        week_end = min(cursor + dt.timedelta(days=6), end)
        try:
            items.extend(client.lessons(cursor, week_end))
        except Exception as exc:  # noqa: BLE001
            log.debug("lessons %s–%s: %s", cursor, week_end, exc)
        cursor = week_end + dt.timedelta(days=1)

    now = _now_iso()
    rows = [
        {
            "id": l.id,
            "start_dt": _iso(l.start),
            "end_dt": _iso(l.end),
            "subject_name": l.subject.name if l.subject else None,
            "teacher_names": ", ".join(l.teacher_names or []) or l.teacher_name,
            "classroom": l.classroom,
            "status": l.status,
            "canceled": _bool(l.canceled),
            "is_test": _bool(l.test),
            "memo": l.memo,
            "updated_at": now,
        }
        for l in items
    ]
    counts.lessons = _upsert(conn, "lessons", rows)


def _sync_information(conn: sqlite3.Connection, client: pronotepy.Client, counts: SyncCounts) -> None:
    today = dt.datetime.now()
    date_from = today - dt.timedelta(days=INFO_LOOKBACK_DAYS)
    try:
        items = client.information_and_surveys(date_from=date_from, date_to=today)
    except Exception as exc:  # noqa: BLE001
        log.warning("information_and_surveys: %s", exc)
        return
    now = _now_iso()
    rows = [
        {
            "id": i.id,
            "title": i.title,
            "author": i.author,
            "category": i.category,
            "content": i.content,
            "creation_date": _iso(i.creation_date),
            "start_date": _iso(i.start_date),
            "end_date": _iso(i.end_date),
            "read": _bool(i.read),
            "updated_at": now,
        }
        for i in items
    ]
    counts.information = _upsert(conn, "information", rows)


# ---------- tiny coercion helpers -------------------------------------------


def _safe_float(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def _safe_int(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None


def _bool(v: Any) -> int:
    return 1 if v else 0


def _safe_iter(fn, label: str):
    try:
        return list(fn() or [])
    except Exception as exc:  # noqa: BLE001
        log.warning("%s: %s", label, exc)
        return []
