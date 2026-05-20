---
name: pronote
description: Coach a student using their live Pronote data — grades, homework, lessons, teachers, absences. Use whenever the user asks about a student's school work, upcoming devoirs, recent marks, who their teachers are, scheduling study time, or whether to contact a teacher. Reads a local SQLite database synced from Pronote; can also trigger a fresh sync.
---

# Pronote — local school data

## What this skill is for

You have read-only access to a local SQLite database synced from Pronote (a student's school account). Use it to:

- Summarise recent marks, spot a downward trend, compute weighted averages by subject/period.
- List upcoming homework and tests; help plan study sessions.
- Look up a teacher's name when the user considers reaching out.
- Flag absences or punishments that might warrant a parent–teacher conversation.

The database lives at `~/Documents/Claude/cartable/data/pronote.db` by default. A launchd job refreshes it on a schedule; you can also force a refresh.

## Tools at your disposal

```bash
# Force a refresh of the database from Pronote (5–15 s).
cd ~/Documents/Claude/cartable && uv run cartable sync

# Check when the last sync ran and whether it succeeded.
cd ~/Documents/Claude/cartable && uv run cartable status

# Direct SQL queries (preferred for ad-hoc analysis).
sqlite3 ~/Documents/Claude/cartable/data/pronote.db "SELECT …"
```

Always run a fresh `cartable sync` *before* answering if `cartable status` shows the last successful sync is older than ~1 hour, or if the user explicitly asks for the latest data.

## Schema (the only tables that exist)

- **student_info**(key, value) — name, class_name, establishment, email, phone, address, ine_number, delegue.
- **periods**(id, name, start_date, end_date, overall_average, class_overall_average, is_current).
- **teachers**(id, name, type, num, subjects) — `subjects` is a JSON array of subject names.
- **grades**(id, period_id, period_name, subject_name, grade, out_of, coefficient, class_average, min_grade, max_grade, date, comment, is_bonus, is_optional, is_out_of_20). `grade` is TEXT — it may be "14", "14,5", or "Abs"/"Disp" etc., so cast carefully.
- **averages**(period_id, subject_name, student, class_average, min_average, max_average, out_of) — PK is (period_id, subject_name).
- **homework**(id, subject_name, description, due_date, done, files_json).
- **lessons**(id, start_dt, end_dt, subject_name, teacher_names, classroom, status, canceled, is_test, memo).
- **absences**(id, period_id, from_date, to_date, days, hours, justified, reasons).
- **punishments**(id, period_id, nature, reasons, giver, given_at, duration, exclusion, during_lesson).
- **evaluations**(id, period_id, name, description, subject_name, domain, teacher, coefficient, date, acquisitions_json).
- **information**(id, title, author, category, content, creation_date, start_date, end_date, read).
- **sync_log**(id, started_at, finished_at, success, error, counts_json).

Dates are ISO strings ("2026-05-19" / "2026-05-19T08:00:00"). `is_*` / `done` / `success` / `canceled` columns are 0/1 integers.

## Useful query recipes

```sql
-- Subject averages this period, sorted from weakest to strongest
SELECT subject_name, student, class_average, out_of
FROM averages
WHERE period_id = (SELECT id FROM periods WHERE is_current = 1)
ORDER BY (student * 1.0 / out_of) ASC;

-- Last 10 grades, newest first
SELECT date, subject_name, grade, out_of, coefficient, comment
FROM grades
ORDER BY date DESC LIMIT 10;

-- Trend in a subject across periods (e.g. MATHÉMATIQUES)
SELECT period_name, AVG(CAST(REPLACE(grade, ',', '.') AS REAL) * 20.0 / out_of) AS normalised_avg
FROM grades
WHERE subject_name = 'MATHÉMATIQUES'
  AND grade GLOB '[0-9]*'
GROUP BY period_id, period_name
ORDER BY MIN(date);

-- Homework due in the next 7 days, not yet marked done
SELECT due_date, subject_name, description
FROM homework
WHERE done = 0 AND due_date BETWEEN date('now') AND date('now', '+7 days')
ORDER BY due_date;

-- Upcoming tests (lessons flagged as test) in the next 14 days
SELECT date(start_dt) AS day, subject_name, teacher_names, memo
FROM lessons
WHERE is_test = 1 AND start_dt BETWEEN datetime('now') AND datetime('now', '+14 days')
ORDER BY start_dt;

-- Today's schedule
SELECT time(start_dt) AS t, subject_name, classroom, teacher_names, canceled
FROM lessons
WHERE date(start_dt) = date('now')
ORDER BY start_dt;

-- Who teaches a given subject
SELECT name, type FROM teachers
WHERE subjects LIKE '%MATHÉMATIQUES%';

-- Unjustified absences this period
SELECT from_date, to_date, hours, reasons
FROM absences
WHERE justified = 0
  AND period_id = (SELECT id FROM periods WHERE is_current = 1);
```

## How to answer well

1. **Be specific and quantitative.** Quote exact grades, dates, and weights. Don't say "you're doing OK in maths" — say "the maths average is 14.2/20 (class 12.8), up from 13.1 last trimestre, with coefficient-2 grades on 2025-04-12 (16) and 2025-05-03 (12)."
2. **Surface what changed.** When summarising, prioritise (a) grades from the last 14 days, (b) tests in the next 14 days, (c) overdue homework.
3. **Recommend, don't dictate.** When proposing to contact a teacher, draft a short message the user can review, and explain *why* (which grade, which date, what the comment said).
4. **Trigger thresholds for parent action** (use as guidance, not strict rules):
   - A subject average drops by ≥ 2 points across two consecutive periods.
   - A single grade ≤ 8/20 in a coefficient-≥ 2 evaluation.
   - ≥ 2 unjustified absences in a 30-day window.
   - A "punishments" row that mentions exclusion.
   When any of these triggers fire, surface the issue and propose a concrete next step (e.g. "draft a message to the maths teacher — here's the relevant grade").
5. **Don't fabricate.** If a question can't be answered from the DB (e.g. teacher email — Pronote rarely exposes it via the parent account), say so and suggest a path (Pronote messaging, school directory).

## Sync staleness

Before any answer that depends on "what's new", run:

```bash
sqlite3 ~/Documents/Claude/cartable/data/pronote.db \
  "SELECT started_at, success FROM sync_log ORDER BY id DESC LIMIT 1"
```

If `started_at` is older than ~1 hour or `success` is 0, run `uv run cartable sync` first.
