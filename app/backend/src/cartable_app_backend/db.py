"""Read-only queries against the cartable SQLite database.

The cartable sync (a sibling project) owns the writes. We just read.
"""

from __future__ import annotations

import json
import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable

DEFAULT_DB_PATH = Path.home() / "Documents/Claude/cartable/data/pronote.db"


def db_path() -> Path:
    return Path(os.environ.get("CARTABLE_DB", str(DEFAULT_DB_PATH))).expanduser()


def connect() -> sqlite3.Connection:
    path = db_path()
    if not path.exists():
        raise FileNotFoundError(
            f"Cartable DB not found at {path}. Run `cartable sync` first."
        )
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


# ---------- queries ---------------------------------------------------------


def student_info() -> dict[str, str | None]:
    with connect() as c:
        rows = c.execute("SELECT key, value FROM student_info").fetchall()
    return {r["key"]: r["value"] for r in rows}


def periods() -> list[dict[str, Any]]:
    with connect() as c:
        return rows_to_dicts(c.execute(
            "SELECT id, name, start_date, end_date, is_current "
            "FROM periods ORDER BY start_date"
        ).fetchall())


def current_period_id() -> str | None:
    with connect() as c:
        row = c.execute("SELECT id FROM periods WHERE is_current = 1").fetchone()
    return row["id"] if row else None


def lessons(date_from: str, date_to: str) -> list[dict[str, Any]]:
    with connect() as c:
        return rows_to_dicts(c.execute(
            "SELECT id, start_dt, end_dt, subject_name, teacher_names, classroom, "
            "       status, canceled, is_test, memo "
            "FROM lessons "
            "WHERE date(start_dt) BETWEEN date(?) AND date(?) "
            "ORDER BY start_dt",
            (date_from, date_to),
        ).fetchall())


def grades_recent(limit: int = 20) -> list[dict[str, Any]]:
    with connect() as c:
        return rows_to_dicts(c.execute(
            "SELECT date, subject_name, grade, out_of, coefficient, "
            "       class_average, min_grade, max_grade, comment, period_name "
            "FROM grades "
            "WHERE date IS NOT NULL "
            "ORDER BY date DESC "
            "LIMIT ?",
            (limit,),
        ).fetchall())


def grades_for_period(period_id: str) -> list[dict[str, Any]]:
    with connect() as c:
        return rows_to_dicts(c.execute(
            "SELECT date, subject_name, grade, out_of, coefficient, "
            "       class_average, min_grade, max_grade, comment "
            "FROM grades "
            "WHERE period_id = ? "
            "ORDER BY date DESC",
            (period_id,),
        ).fetchall())


def averages(period_id: str | None = None) -> list[dict[str, Any]]:
    sql = (
        "SELECT period_id, subject_name, student, class_average, "
        "       min_average, max_average, out_of "
        "FROM averages "
    )
    params: tuple[Any, ...] = ()
    if period_id:
        sql += "WHERE period_id = ? "
        params = (period_id,)
    sql += "ORDER BY subject_name"
    with connect() as c:
        return rows_to_dicts(c.execute(sql, params).fetchall())


def subject_trend() -> list[dict[str, Any]]:
    """For each (subject, period), the student average normalised /20.

    Used by the trend chart.
    """
    with connect() as c:
        return rows_to_dicts(c.execute(
            "SELECT a.subject_name, p.name AS period_name, p.start_date, "
            "       a.student, a.class_average, a.out_of "
            "FROM averages a "
            "JOIN periods p ON p.id = a.period_id "
            "WHERE a.student IS NOT NULL "
            "ORDER BY a.subject_name, p.start_date"
        ).fetchall())


def homework(date_from: str, date_to: str, only_pending: bool = False) -> list[dict[str, Any]]:
    sql = (
        "SELECT id, subject_name, description, due_date, done, files_json "
        "FROM homework "
        "WHERE date(due_date) BETWEEN date(?) AND date(?) "
    )
    if only_pending:
        sql += "AND done = 0 "
    sql += "ORDER BY due_date, subject_name"
    with connect() as c:
        rows = rows_to_dicts(c.execute(sql, (date_from, date_to)).fetchall())
    for r in rows:
        if r.get("files_json"):
            try:
                r["files"] = json.loads(r["files_json"])
            except json.JSONDecodeError:
                r["files"] = []
        r.pop("files_json", None)
    return rows


def teachers() -> list[dict[str, Any]]:
    with connect() as c:
        rows = rows_to_dicts(c.execute(
            "SELECT id, name, type, num, subjects FROM teachers ORDER BY name"
        ).fetchall())
    for r in rows:
        if r.get("subjects"):
            try:
                r["subjects"] = json.loads(r["subjects"])
            except json.JSONDecodeError:
                r["subjects"] = []
    return rows


def bulletins() -> list[dict[str, Any]]:
    """List periods that have a published bulletin."""
    with connect() as c:
        rows = rows_to_dicts(c.execute(
            "SELECT b.period_id, b.period_name, b.global_comments, p.start_date, p.end_date "
            "FROM bulletin_reports b "
            "LEFT JOIN periods p ON p.id = b.period_id "
            "ORDER BY p.start_date, b.period_name"
        ).fetchall())
    for r in rows:
        try:
            r["global_comments"] = json.loads(r["global_comments"] or "[]")
        except json.JSONDecodeError:
            r["global_comments"] = []
    return rows


def bulletin(period_id: str) -> dict[str, Any] | None:
    """Full bulletin payload: global comments + subject rows + student header."""
    with connect() as c:
        head_row = c.execute(
            "SELECT b.period_id, b.period_name, b.global_comments, "
            "       p.start_date, p.end_date, "
            "       (SELECT value FROM student_info WHERE key='name') AS student_name, "
            "       (SELECT value FROM student_info WHERE key='class_name') AS class_name, "
            "       (SELECT value FROM student_info WHERE key='establishment') AS establishment "
            "FROM bulletin_reports b "
            "LEFT JOIN periods p ON p.id = b.period_id "
            "WHERE b.period_id = ?",
            (period_id,),
        ).fetchone()
        if not head_row:
            return None
        subs = rows_to_dicts(c.execute(
            "SELECT subject_name, student_average, class_average, "
            "       min_average, max_average, coefficient, teachers, comments "
            "FROM bulletin_subjects WHERE period_id = ? ORDER BY subject_name",
            (period_id,),
        ).fetchall())
    head = dict(head_row)
    try:
        head["global_comments"] = json.loads(head["global_comments"] or "[]")
    except json.JSONDecodeError:
        head["global_comments"] = []
    for s in subs:
        try:
            s["teachers"] = json.loads(s["teachers"] or "[]")
        except json.JSONDecodeError:
            s["teachers"] = []
        try:
            s["comments"] = json.loads(s["comments"] or "[]")
        except json.JSONDecodeError:
            s["comments"] = []
    head["subjects"] = subs
    return head


def last_sync() -> dict[str, Any] | None:
    with connect() as c:
        row = c.execute(
            "SELECT started_at, finished_at, success, error, counts_json "
            "FROM sync_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    d = dict(row)
    if d.get("counts_json"):
        try:
            d["counts"] = json.loads(d["counts_json"])
        except json.JSONDecodeError:
            d["counts"] = None
    d.pop("counts_json", None)
    d["success"] = bool(d["success"])
    return d
