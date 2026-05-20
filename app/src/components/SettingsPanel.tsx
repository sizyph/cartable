import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../api";
import clsx from "clsx";

const INTERVAL_PRESETS: { label: string; value: number }[] = [
  { label: "15 min", value: 900 },
  { label: "30 min", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "2 hours", value: 7200 },
  { label: "6 hours", value: 21600 },
];

export function SettingsPanel() {
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-pap-muted">Account, sync, backup, app version.</p>
      </header>

      <AccountSection />
      <AutoSyncSection />
      <BackupSection />
      <AboutSection />
    </div>
  );
}

// ---------- Account ----------------------------------------------------------

function AccountSection() {
  const qc = useQueryClient();
  const acc = useQuery({ queryKey: ["settings", "account"], queryFn: api.settingsAccount });
  const [editing, setEditing] = useState(false);

  const save = useMutation({
    mutationFn: api.settingsAccountUpdate,
    onSuccess: () => {
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    },
  });

  const logout = useMutation({
    mutationFn: api.settingsLogout,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (!acc.data) return <Card title="Account"><Skel /></Card>;
  const a = acc.data;

  return (
    <Card title="Account">
      {!editing ? (
        <div className="space-y-3 text-sm">
          {a.student.name && (
            <div className="flex gap-4 items-baseline">
              <span className="text-pap-muted w-32">Student</span>
              <span>
                {a.student.name}
                {a.student.class_name && (
                  <span className="text-pap-muted"> · {a.student.class_name}</span>
                )}
                {a.student.establishment && (
                  <span className="text-pap-muted"> · {a.student.establishment}</span>
                )}
              </span>
            </div>
          )}
          <KV label="Pronote URL" value={a.pronote_url || "—"} mono />
          <KV label="Username" value={a.username || "—"} mono />
          <KV label="Auth mode" value={a.auth_mode} />
          {a.ent_provider && <KV label="ENT provider" value={a.ent_provider} />}
          {a.child_name && <KV label="Child" value={a.child_name} />}
          <KV
            label="Password"
            value={a.has_password ? "•••••••••• (stored locally)" : "(not set)"}
          />
          <div className="pt-2 flex gap-2">
            <Btn onClick={() => setEditing(true)}>Edit credentials</Btn>
            {a.username && (
              <Btn
                variant="danger"
                onClick={() => {
                  if (confirm("Wipe Pronote credentials and the auth token? The synced database stays intact.")) {
                    logout.mutate();
                  }
                }}
                disabled={logout.isPending}
              >
                {logout.isPending ? "Logging out…" : "Log out"}
              </Btn>
            )}
          </div>
        </div>
      ) : (
        <AccountForm
          initial={a}
          onCancel={() => setEditing(false)}
          onSave={(v) => save.mutate(v)}
          pending={save.isPending}
          error={save.error?.message}
        />
      )}
    </Card>
  );
}

type AccountData = {
  pronote_url: string;
  auth_mode: string;
  username: string;
  ent_provider: string;
  child_name: string;
  has_password: boolean;
};

function AccountForm({
  initial,
  onCancel,
  onSave,
  pending,
  error,
}: {
  initial: AccountData;
  onCancel: () => void;
  onSave: (v: {
    pronote_url: string;
    auth_mode: string;
    username: string;
    password?: string;
    ent_provider?: string;
    child_name?: string;
  }) => void;
  pending: boolean;
  error?: string;
}) {
  const [url, setUrl] = useState(initial.pronote_url);
  const [mode, setMode] = useState(initial.auth_mode || "password");
  const [user, setUser] = useState(initial.username);
  const [pwd, setPwd] = useState("");
  const [ent, setEnt] = useState(initial.ent_provider);
  const [child, setChild] = useState(initial.child_name);

  return (
    <form
      className="space-y-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          pronote_url: url,
          auth_mode: mode,
          username: user,
          password: pwd, // blank = keep existing
          ent_provider: ent,
          child_name: child,
        });
      }}
    >
      <Field label="Pronote URL">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://0123456a.index-education.net/pronote/parent.html"
          className={inputCls}
        />
      </Field>
      <Field label="Auth mode">
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
          <option value="password">password</option>
          <option value="ent">ent</option>
        </select>
      </Field>
      {mode === "ent" && (
        <Field label="ENT provider">
          <input
            value={ent}
            onChange={(e) => setEnt(e.target.value)}
            placeholder="ac_rennes, ent_hdf, ile_de_france, …"
            className={inputCls}
          />
        </Field>
      )}
      <Field label="Username">
        <input value={user} onChange={(e) => setUser(e.target.value)} required className={inputCls} />
      </Field>
      <Field label="Password">
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder={initial.has_password ? "•••••• (leave blank to keep current)" : "Enter password"}
          className={inputCls}
        />
      </Field>
      <Field label="Child (parent accounts only, optional)">
        <input
          value={child}
          onChange={(e) => setChild(e.target.value)}
          placeholder="exact name as Pronote displays it"
          className={inputCls}
        />
      </Field>
      {error && <p className="text-pap-bad text-xs">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Btn variant="accent" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Btn>
        <Btn type="button" onClick={onCancel} disabled={pending}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}

// ---------- Auto-sync --------------------------------------------------------

function AutoSyncSection() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["settings", "auto-sync"],
    queryFn: api.settingsAutoSyncStatus,
  });

  const set = useMutation({
    mutationFn: ({ enabled, interval }: { enabled: boolean; interval: number }) =>
      api.settingsAutoSyncSet(enabled, interval),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings", "auto-sync"] }),
  });

  if (!status.data) return <Card title="Auto-sync"><Skel /></Card>;
  const s = status.data;
  const current = s.interval_seconds ?? 1800;

  return (
    <Card
      title="Auto-sync"
      subtitle="A launchd job refreshes the local database in the background."
    >
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <Toggle
            checked={s.loaded}
            onChange={(v) => set.mutate({ enabled: v, interval: current })}
            disabled={set.isPending || !s.template_exists}
            label={s.loaded ? "Running" : "Stopped"}
          />
          <span className="text-xs text-pap-muted">
            {s.template_exists
              ? `Plist target: ${s.plist_target}`
              : "Template missing — reinstall the project."}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-pap-muted w-32">Interval</span>
          <div className="flex gap-1 bg-pap-surface-2 rounded p-1">
            {INTERVAL_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                disabled={set.isPending}
                onClick={() => set.mutate({ enabled: true, interval: p.value })}
                className={clsx(
                  "px-3 py-1 text-xs rounded transition-colors",
                  current === p.value
                    ? "bg-pap-accent text-pap-bg font-medium"
                    : "text-pap-muted hover:text-pap-text hover:bg-pap-border/50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {set.error && <p className="text-pap-bad text-xs">{(set.error as Error).message}</p>}
      </div>
    </Card>
  );
}

// ---------- Backup -----------------------------------------------------------

function BackupSection() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const restore = useMutation({
    mutationFn: (file: File) => api.settingsRestore(file),
    onSuccess: (r) => {
      setMsg(
        `Restored. ${r.manifest?.last_sync?.counts?.grades ?? "?"} grades, ${r.manifest?.last_sync?.counts?.lessons ?? "?"} lessons. Reloading…`,
      );
      qc.invalidateQueries();
      // Hard reload — restored DB might have completely different content.
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (e: any) => setMsg(`Restore failed: ${e.message ?? e}`),
  });

  return (
    <Card
      title="Backup & restore"
      subtitle="Pack the local database into a portable .cartable archive. Credentials are NOT included."
    >
      <div className="flex flex-wrap gap-2 items-center">
        <a
          href={api.settingsBackupUrl()}
          download
          className="px-3 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85"
        >
          Download .cartable
        </a>
        <Btn onClick={() => fileRef.current?.click()} disabled={restore.isPending}>
          {restore.isPending ? "Restoring…" : "Restore from .cartable…"}
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept=".cartable,.zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) restore.mutate(f);
            e.target.value = "";
          }}
        />
        {msg && <span className="text-xs text-pap-muted">{msg}</span>}
      </div>
    </Card>
  );
}

// ---------- About ------------------------------------------------------------

function AboutSection() {
  const version = useQuery({ queryKey: ["settings", "version"], queryFn: api.settingsVersion });
  const check = useMutation({ mutationFn: api.settingsUpdateCheck });

  return (
    <Card title="About">
      <div className="space-y-3 text-sm">
        <KV label="Version" value={version.data?.version ?? "—"} mono />
        <KV label="Data dir" value={version.data?.data_dir ?? "—"} mono />
        <KV label="Cartable dir" value={version.data?.cartable_dir ?? "—"} mono />
        <div className="flex items-center gap-3 pt-1">
          <Btn onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? "Checking…" : "Check for updates"}
          </Btn>
          {check.data?.ok && (
            <span className="text-xs">
              {check.data.is_newer ? (
                <>
                  <span className="text-pap-good font-medium">
                    Update available: v{check.data.latest}
                  </span>
                  {check.data.html_url && (
                    <a
                      href={check.data.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-pap-accent underline"
                    >
                      Release notes ↗
                    </a>
                  )}
                </>
              ) : check.data.latest ? (
                <span className="text-pap-muted">
                  Up to date (latest: v{check.data.latest})
                </span>
              ) : (
                <span className="text-pap-muted">{check.data.note ?? "No releases yet."}</span>
              )}
            </span>
          )}
          {check.data && check.data.ok === false && (
            <span className="text-xs text-pap-bad">{check.data.error}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- shared primitives ------------------------------------------------

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-pap-border bg-pap-surface p-5">
      <header className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-pap-muted">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Skel() {
  return <div className="h-20 rounded bg-pap-surface-2/40 animate-pulse" />;
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-4 items-baseline">
      <span className="text-pap-muted w-32 shrink-0">{label}</span>
      <span className={clsx("break-all", mono && "font-mono text-xs")}>{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex gap-4 items-baseline">
      <span className="text-pap-muted w-48 shrink-0 text-sm">{label}</span>
      <div className="flex-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full bg-pap-bg border border-pap-border rounded px-2 py-1 text-sm focus:outline-none focus:border-pap-accent";

function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "accent" | "danger";
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50",
        variant === "accent" && "bg-pap-accent text-pap-bg font-medium hover:bg-pap-accent/85",
        variant === "danger" && "bg-pap-bad/20 text-pap-bad border border-pap-bad/40 hover:bg-pap-bad/30",
        variant === "default" && "bg-pap-surface-2 text-pap-text hover:bg-pap-border",
      )}
    >
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className="flex items-center gap-2 text-sm disabled:opacity-50"
    >
      <span
        className={clsx(
          "w-9 h-5 rounded-full relative transition-colors",
          checked ? "bg-pap-good" : "bg-pap-border",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-4 left-0.5" : "left-0.5",
          )}
        />
      </span>
      {label && <span className="text-pap-text">{label}</span>}
    </button>
  );
}
