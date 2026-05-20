"""SQLite schema + connection helpers."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_info (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS periods (
    id                    TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    start_date            TEXT NOT NULL,
    end_date              TEXT NOT NULL,
    overall_average       REAL,
    class_overall_average REAL,
    is_current            INTEGER NOT NULL DEFAULT 0,
    updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teachers (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    type       TEXT,
    num        TEXT,
    subjects   TEXT,  -- JSON array of subject names
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grades (
    id            TEXT PRIMARY KEY,
    period_id     TEXT,
    period_name   TEXT,
    subject_name  TEXT,
    grade         TEXT,
    out_of        REAL,
    coefficient   REAL,
    class_average REAL,
    min_grade     REAL,
    max_grade     REAL,
    date          TEXT,
    comment       TEXT,
    is_bonus      INTEGER NOT NULL DEFAULT 0,
    is_optional   INTEGER NOT NULL DEFAULT 0,
    is_out_of_20  INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_grades_period ON grades(period_id);
CREATE INDEX IF NOT EXISTS idx_grades_date   ON grades(date);

CREATE TABLE IF NOT EXISTS averages (
    period_id     TEXT NOT NULL,
    subject_name  TEXT NOT NULL,
    student       REAL,
    class_average REAL,
    min_average   REAL,
    max_average   REAL,
    out_of        REAL,
    updated_at    TEXT NOT NULL,
    PRIMARY KEY (period_id, subject_name)
);

CREATE TABLE IF NOT EXISTS homework (
    id           TEXT PRIMARY KEY,
    subject_name TEXT,
    description  TEXT,
    due_date     TEXT,
    done         INTEGER NOT NULL DEFAULT 0,
    files_json   TEXT,  -- JSON list of {name, url}
    updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_homework_due  ON homework(due_date);
CREATE INDEX IF NOT EXISTS idx_homework_done ON homework(done);

CREATE TABLE IF NOT EXISTS lessons (
    id            TEXT PRIMARY KEY,
    start_dt      TEXT NOT NULL,
    end_dt        TEXT,
    subject_name  TEXT,
    teacher_names TEXT,
    classroom     TEXT,
    status        TEXT,
    canceled      INTEGER NOT NULL DEFAULT 0,
    is_test       INTEGER NOT NULL DEFAULT 0,
    memo          TEXT,
    updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lessons_start ON lessons(start_dt);

CREATE TABLE IF NOT EXISTS absences (
    id         TEXT PRIMARY KEY,
    period_id  TEXT,
    from_date  TEXT,
    to_date    TEXT,
    days       INTEGER,
    hours      TEXT,
    justified  INTEGER NOT NULL DEFAULT 0,
    reasons    TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS punishments (
    id            TEXT PRIMARY KEY,
    period_id     TEXT,
    nature        TEXT,
    reasons       TEXT,
    giver         TEXT,
    given_at      TEXT,
    duration      TEXT,
    exclusion     INTEGER NOT NULL DEFAULT 0,
    during_lesson INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
    id              TEXT PRIMARY KEY,
    period_id       TEXT,
    name            TEXT,
    description     TEXT,
    subject_name    TEXT,
    domain          TEXT,
    teacher         TEXT,
    coefficient     REAL,
    date            TEXT,
    acquisitions_json TEXT,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS information (
    id            TEXT PRIMARY KEY,
    title         TEXT,
    author        TEXT,
    category      TEXT,
    content       TEXT,
    creation_date TEXT,
    start_date    TEXT,
    end_date      TEXT,
    read          INTEGER NOT NULL DEFAULT 0,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    success     INTEGER NOT NULL DEFAULT 0,
    error       TEXT,
    counts_json TEXT
);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('version', '1')"
    )
