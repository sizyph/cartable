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

async function post<T>(
  path: string,
  body?: unknown,
  method: "POST" | "PUT" | "DELETE" = "POST",
): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let detail = `${r.status} ${r.statusText}`;
    try {
      const d = await r.json();
      if (d?.detail) detail = String(d.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
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
  bulletins: () =>
    get<Array<{
      period_id: string;
      period_name: string;
      start_date: string | null;
      end_date: string | null;
      global_comments: string[];
    }>>("/api/bulletins"),
  bulletinHtmlUrl: (periodId: string) =>
    `${base}/api/bulletins/${encodeURIComponent(periodId)}/html`,
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

  // ---- settings ----------------------------------------------------------
  settingsAccount: () =>
    get<{
      pronote_url: string;
      auth_mode: string;
      username: string;
      ent_provider: string;
      child_name: string;
      has_password: boolean;
      is_configured: boolean;
      stored_in?: string;
      env_path: string;
      student: { name: string; class_name: string; establishment: string };
    }>("/api/settings/account"),
  settingsLoginQr: (qrData: Record<string, any>, pin: string) =>
    post<{
      ok: boolean;
      url: string;
      username: string;
      is_parent_account: boolean;
      student: { name: string | null; class_name: string | null; establishment: string | null };
    }>("/api/settings/login-qr", { qr_data: qrData, pin }),
  settingsAccountUpdate: (body: {
    pronote_url: string;
    auth_mode: string;
    username: string;
    password?: string;
    ent_provider?: string;
    child_name?: string;
  }) => post<{ ok: boolean }>("/api/settings/account", body),
  settingsLogout: () => post<{ ok: boolean }>("/api/settings/logout"),
  settingsCliEnv: () =>
    get<{
      found: boolean;
      path: string;
      pronote_url?: string;
      username?: string;
      auth_mode?: string;
      ent_provider?: string;
      child_name?: string;
      has_password?: boolean;
    }>("/api/settings/cli-env"),
  settingsImportCli: () =>
    post<{ ok: boolean; imported_username: string }>("/api/settings/import-cli"),
  settingsConnectionTest: () =>
    post<{
      ok: boolean;
      overall_status: "ok" | "warning" | "error";
      started_at: string;
      duration_ms: number;
      checks: Array<{
        name: string;
        status: "ok" | "warning" | "error";
        duration_ms: number;
        message?: string;
      }>;
    }>("/api/settings/connection-test"),
  settingsVersion: () =>
    get<{
      version: string;
      backend_started_at: number;
      data_dir: string;
      cartable_dir: string;
      student_name: string;
    }>("/api/settings/version"),
  settingsUpdateCheck: () =>
    get<{
      ok: boolean;
      error?: string;
      note?: string;
      current?: string;
      latest?: string | null;
      is_newer?: boolean;
      html_url?: string;
      dmg_url?: string | null;
      dmg_name?: string | null;
      dmg_size_bytes?: number | null;
      name?: string;
      published_at?: string;
    }>("/api/settings/update-check"),
  settingsAutoSyncStatus: () =>
    get<{
      installed: boolean;
      loaded: boolean;
      interval_seconds: number | null;
      plist_target: string;
      template_exists: boolean;
    }>("/api/settings/auto-sync"),
  settingsAutoSyncSet: (enabled: boolean, intervalSeconds = 1800) =>
    post<{
      installed: boolean;
      loaded: boolean;
      interval_seconds: number | null;
    }>("/api/settings/auto-sync", { enabled, interval_seconds: intervalSeconds }),
  settingsBackupUrl: () => `${base}/api/settings/backup`,
  settingsRestore: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(`${base}/api/settings/restore`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return (await r.json()) as { ok: boolean; manifest: any; restored_to: string };
  },

  // ---- library -----------------------------------------------------------
  libraryItems: () => get<LibraryItem[]>("/api/library/items"),
  libraryItemCreate: (body: LibraryItemInput) =>
    post<{ id: string; ok: boolean }>("/api/library/items", body),
  libraryItemUpdate: (numericId: number, body: LibraryItemInput) =>
    post<{ ok: boolean }>(`/api/library/items/${numericId}`, body, "PUT"),
  libraryItemDelete: (numericId: number) =>
    post<{ ok: boolean }>(`/api/library/items/${numericId}`, undefined, "DELETE"),
  libraryFiles: () => get<{ dir: string; items: LibraryItem[] }>("/api/library/files"),
  libraryFileUrl: (relativePath: string) =>
    `${base}/api/library/file?path=${encodeURIComponent(relativePath)}`,

  // ---- drive -------------------------------------------------------------
  driveStatus: () =>
    get<{
      has_credentials: boolean;
      has_token: boolean;
      scopes_ok: boolean;
      credentials_path: string;
      root_folder_id: string | null;
      root_folder_name: string | null;
    }>("/api/drive/status"),
  driveAuthorize: () => post<{ ok: boolean; scopes: string[] }>("/api/drive/authorize"),
  driveSetRoot: (folderId: string) =>
    post<{ ok: boolean; id: string; name: string }>("/api/drive/root", { folder_id: folderId }),
  driveList: (folderId?: string) =>
    get<{ items: DriveFile[] }>(`/api/drive/list${folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ""}`),
  driveSearch: (q: string) =>
    get<{ items: DriveFile[] }>(`/api/drive/search?q=${encodeURIComponent(q)}`),
  driveUploadBackup: () =>
    post<{
      ok: boolean;
      id: string;
      name: string;
      size: string;
      web_view_link: string;
      uploaded_at: string;
    }>("/api/drive/upload-backup"),
};

export type LibraryItem = {
  id: string;
  title: string;
  author: string | null;
  subject: string | null;
  kind: "textbook" | "companion" | "reference";
  url: string | null;
  file_path: string | null;
  notes: string | null;
  cover_url: string | null;
  added_at: string;
  updated_at: string;
  source: "manual" | "file";
  size_bytes?: number;
};

export type LibraryItemInput = {
  title: string;
  author?: string;
  subject?: string;
  kind?: "textbook" | "companion" | "reference";
  url?: string;
  file_path?: string;
  notes?: string;
  cover_url?: string;
};

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  is_folder: boolean;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  iconLink?: string;
  parents?: string[];
};
