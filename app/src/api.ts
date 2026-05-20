// Thin fetch wrapper for the local Python backend.
// We always hit the backend directly so the same code works in dev (Vite at
// http://localhost:1420) and in the bundled Tauri app (webview at
// tauri://localhost). The backend's CORS config allows both origins.

const base = "http://127.0.0.1:7531";

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${path}`);
  return (await r.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} on ${path}`);
  return (await r.json()) as T;
}

// ---------- types ----------------------------------------------------------

export type SyncCounts = {
  periods: number;
  teachers: number;
  grades: number;
  averages: number;
  homework: number;
  lessons: number;
  absences: number;
  punishments: number;
  evaluations: number;
  information: number;
};

export type LastSync = {
  started_at: string;
  finished_at: string | null;
  success: boolean;
  error: string | null;
  counts: SyncCounts | null;
};

export type Health = {
  status: string;
  last_sync: LastSync | null;
  student: Record<string, string | null>;
  db_path: string;
};

export type Period = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  is_current: 0 | 1;
};

export type Lesson = {
  id: string;
  start_dt: string;
  end_dt: string | null;
  subject_name: string | null;
  teacher_names: string | null;
  classroom: string | null;
  status: string | null;
  canceled: 0 | 1;
  is_test: 0 | 1;
  memo: string | null;
};

export type Grade = {
  date: string | null;
  subject_name: string | null;
  grade: string | null;
  out_of: number | null;
  coefficient: number | null;
  class_average: number | null;
  min_grade: number | null;
  max_grade: number | null;
  comment: string | null;
  period_name?: string | null;
};

export type Average = {
  period_id: string;
  subject_name: string;
  student: number | null;
  class_average: number | null;
  min_average: number | null;
  max_average: number | null;
  out_of: number | null;
};

export type TrendPoint = {
  subject_name: string;
  period_name: string;
  start_date: string;
  student: number;
  class_average: number | null;
  out_of: number;
};

export type Homework = {
  id: string;
  subject_name: string | null;
  description: string | null;
  due_date: string | null;
  done: 0 | 1;
  files?: { name: string; url: string }[];
};

// ---------- endpoints ------------------------------------------------------

export const api = {
  health: () => get<Health>("/api/health"),
  periods: () => get<Period[]>("/api/periods"),
  lessonsRange: (from: string, to: string) =>
    get<Lesson[]>(`/api/lessons?date_from=${from}&date_to=${to}`),
  lessonsToday: () => get<Lesson[]>("/api/lessons/today"),
  lessonsWeek: (weeksAhead = 0) =>
    get<Lesson[]>(`/api/lessons/week?weeks_ahead=${weeksAhead}`),
  gradesRecent: (limit = 20) =>
    get<Grade[]>(`/api/grades/recent?limit=${limit}`),
  averages: (periodId?: string) =>
    get<Average[]>(
      periodId ? `/api/averages?period_id=${encodeURIComponent(periodId)}` : "/api/averages",
    ),
  trend: () => get<TrendPoint[]>("/api/averages/trend"),
  homework: (opts: { from?: string; to?: string; onlyPending?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (opts.from) p.set("date_from", opts.from);
    if (opts.to) p.set("date_to", opts.to);
    if (opts.onlyPending) p.set("only_pending", "true");
    return get<Homework[]>(`/api/homework${p.toString() ? `?${p}` : ""}`);
  },
  triggerSync: () => post<{ started: boolean; detail: string }>("/api/sync"),
  calendarStatus: () =>
    get<{
      has_credentials: boolean;
      has_token: boolean;
      credentials_path: string;
      calendar_name: string;
    }>("/api/calendar/status"),
  calendarAuthorize: () => post<{ ok: boolean; scopes: string[] }>("/api/calendar/authorize"),
  calendarSync: (days = 14) =>
    post<{
      calendar: string;
      window_days: number;
      inserted: number;
      updated: number;
      errors: number;
      lessons_seen: number;
      deduplicated: number;
    }>(`/api/calendar/sync?days=${days}`),
};
