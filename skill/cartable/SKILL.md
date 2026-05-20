---
name: cartable
description: Coach a student using their live Pronote data plus a local library of textbooks/references — grades, homework, lessons, teachers, absences, published bulletins, reading list. Use whenever the user asks about a student's school work, upcoming devoirs, recent marks, who their teachers are, scheduling study time, looking up a chapter in a textbook, or whether to contact a teacher. Reads a local SQLite database synced from Pronote; can trigger a fresh sync; can open the textbooks the user has registered.
---

# Cartable — local school data

## What this skill is for

You have read-only access to a local SQLite database synced from Pronote (a student's school account) plus a small filesystem-backed library of textbooks and references the user has registered. Use them to:

- Summarise recent marks, spot a downward trend, compute weighted averages by subject/period.
- List upcoming homework and tests; help plan study sessions.
- Look up a teacher's name when the user considers reaching out.
- Flag absences or punishments that might warrant a parent–teacher conversation.
- Quote teacher comments and class averages from published bulletins.
- Point the user at the right textbook chapter or reference for a topic that came up in a grade or homework.

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

`cartable status` shows the last sync; if it's older than ~1 hour or failed, run `cartable sync` before answering "what's new" questions.

Many of the same query endpoints are also exposed over HTTP on `127.0.0.1:7531` while the Cartable.app is running — discoverable via `curl -s http://127.0.0.1:7531/openapi.json | jq .paths`. Prefer direct SQL though; the HTTP API matches what the Mac app shows but is less flexible.

## Schema

Pronote-synced tables (refreshed each sync — **do not write to these**):

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

Bulletins (published trimesters/semesters with teacher comments and per-subject averages):

- **bulletin_reports**(period_id, period_name, global_comments, updated_at) — `global_comments` is a JSON array of strings (general teacher / head-of-class appreciation).
- **bulletin_subjects**(period_id, subject_name, student_average, class_average, min_average, max_average, coefficient, teachers, comments, updated_at) — averages are TEXT ("11,05"), `teachers` and `comments` are JSON arrays.

User-managed library (preserved across syncs):

- **library_items**(id, title, author, subject, kind, url, file_path, notes, cover_url, added_at, updated_at) — `kind` is one of `textbook`, `companion`, `reference`. `url` opens in the system browser; `file_path` is relative to `~/Documents/Claude/cartable/data/library/` and opens as a local PDF/EPUB.

Plumbing tables:

- **sync_log**(id, started_at, finished_at, success, error, counts_json) — last sync history.
- **schema_meta**(key, value) — schema version.

Dates are ISO strings (`2026-05-19` / `2026-05-19T08:00:00`). `is_*` / `done` / `success` / `canceled` columns are 0/1 integers.

## Other places Cartable stores data

- `~/Documents/Claude/cartable/data/pronote.db` — the SQLite above.
- `~/Documents/Claude/cartable/data/library/` — drop-zone for PDFs/EPUBs. Anything in there shows up in the Mac app's Library tab even without an entry in `library_items`. Read files freely; never delete user content here.
- `~/Documents/Claude/cartable/data/launchd.log` — auto-sync log; tail it when investigating why a scheduled sync failed.
- `~/Library/Application Support/Cartable/google_credentials.json` — OAuth client secrets for Google Calendar + Drive. **Sensitive — never read or echo.**
- `~/Library/Application Support/Cartable/google_token.json` — OAuth refresh token. **Sensitive — never read or echo.**
- `~/Library/Application Support/Cartable/drive_config.json` — `{root_folder_id, root_folder_name}` for the Drive integration.
- `~/Library/Logs/Cartable/backend.log` — Mac app's Python backend log; useful when an app feature breaks.
- `~/Documents/Claude/cartable/.env` — Pronote credentials. **Sensitive — never read or echo.**

## Useful query recipes

```sql
-- Subject averages this period, weakest first
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
WHERE subject_name = 'MATHÉMATIQUES' AND grade GLOB '[0-9]*'
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

-- Pull a published bulletin (global appreciation + subject comments)
SELECT br.period_name, br.global_comments,
       bs.subject_name, bs.student_average, bs.class_average, bs.comments
FROM bulletin_reports br
LEFT JOIN bulletin_subjects bs ON bs.period_id = br.period_id
WHERE br.period_name = 'Trimestre 2'
ORDER BY bs.subject_name;

-- Library: every textbook the user has registered for maths
SELECT title, author, kind, url, file_path
FROM library_items
WHERE subject = 'MATHEMATIQUES' OR title LIKE '%math%'
ORDER BY kind, title;
```

## How to answer well

1. **Be specific and quantitative.** Quote exact grades, dates, and weights. Don't say "you're doing OK in maths" — say "the maths average is 14.2/20 (class 12.8), up from 13.1 last trimestre, with coefficient-2 grades on 2026-04-12 (16) and 2026-05-03 (12)."
2. **Surface what changed.** When summarising, prioritise (a) grades from the last 14 days, (b) tests in the next 14 days, (c) overdue homework, (d) new bulletins.
3. **Bridge to the library.** When a topic comes up (e.g. a grade in physics, or a tough chapter in maths), check `library_items` for a relevant textbook or companion and surface it — "your Bordas Maths 1ère, page X" — rather than just analysing the number.
4. **Recommend, don't dictate.** When proposing to contact a teacher, draft a short message the user can review, and explain *why* (which grade, which date, what the comment in the bulletin said).
5. **Trigger thresholds for parent action** (guidance, not strict rules):
   - A subject average drops by ≥ 2 points across two consecutive periods.
   - A single grade ≤ 8/20 in a coefficient-≥ 2 evaluation.
   - ≥ 2 unjustified absences in a 30-day window.
   - A "punishments" row that mentions exclusion.
   - A bulletin global comment containing language like "fragile", "en difficulté", "préoccupant".
   When any of these fire, surface the issue and propose a concrete next step (e.g. "draft a message to the maths teacher — here's the bulletin comment that prompted this").
6. **Don't fabricate.** If a question can't be answered from the DB (e.g. teacher email — Pronote rarely exposes it via the parent account), say so and suggest a path (Pronote messaging, school directory).
7. **Treat secrets as off-limits.** Never read or echo `.env`, `google_credentials.json`, `google_token.json`, or the rotating `data/token.json`. They contain credentials.

## Sync staleness

Before any answer that depends on "what's new", run:

```bash
sqlite3 ~/Documents/Claude/cartable/data/pronote.db \
  "SELECT started_at, success FROM sync_log ORDER BY id DESC LIMIT 1"
```

If `started_at` is older than ~1 hour or `success` is 0, run `uv run cartable sync` first.
