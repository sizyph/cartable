import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import { LANGUAGES, LangCode } from "../i18n";
import clsx from "clsx";

const INTERVAL_PRESETS: { key: string; value: number }[] = [
  { key: "15min", value: 900 },
  { key: "30min", value: 1800 },
  { key: "1hour", value: 3600 },
  { key: "2hours", value: 7200 },
  { key: "6hours", value: 21600 },
];

export function SettingsPanel() {
  const { t } = useTranslation();
  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="text-sm text-pap-muted">{t("settings.subtitle")}</p>
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
  const { t } = useTranslation();
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

  if (!acc.data) return <Card title={t("settings.account.title")}><Skel /></Card>;
  const a = acc.data;

  return (
    <Card title={t("settings.account.title")}>
      {!editing ? (
        <div className="space-y-3 text-sm">
          {a.student.name && (
            <div className="flex gap-4 items-baseline">
              <span className="text-pap-muted w-32">{t("settings.account.student")}</span>
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
          <KV label={t("settings.account.pronote_url")} value={a.pronote_url || "—"} mono />
          <KV label={t("settings.account.username")} value={a.username || "—"} mono />
          <KV label={t("settings.account.auth_mode")} value={a.auth_mode} />
          {a.ent_provider && <KV label={t("settings.account.ent_provider")} value={a.ent_provider} />}
          {a.child_name && <KV label={t("settings.account.child")} value={a.child_name} />}
          <KV
            label={t("settings.account.password")}
            value={a.has_password ? t("settings.account.password_stored") : t("settings.account.password_not_set")}
          />
          <div className="pt-2 flex gap-2">
            <Btn onClick={() => setEditing(true)}>{t("settings.account.edit")}</Btn>
            {a.username && (
              <Btn
                variant="danger"
                onClick={() => {
                  if (confirm(t("settings.account.logout_confirm"))) {
                    logout.mutate();
                  }
                }}
                disabled={logout.isPending}
              >
                {logout.isPending ? t("settings.account.logging_out") : t("settings.account.logout")}
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
  const { t } = useTranslation();
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
          password: pwd,
          ent_provider: ent,
          child_name: child,
        });
      }}
    >
      <Field label={t("settings.account.pronote_url")}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          placeholder="https://0123456a.index-education.net/pronote/parent.html"
          className={inputCls}
        />
      </Field>
      <Field label={t("settings.account.auth_mode")}>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputCls}>
          <option value="password">{t("settings.account.form.auth_password")}</option>
          <option value="ent">{t("settings.account.form.auth_ent")}</option>
        </select>
      </Field>
      {mode === "ent" && (
        <Field label={t("settings.account.ent_provider")}>
          <input
            value={ent}
            onChange={(e) => setEnt(e.target.value)}
            placeholder={t("settings.account.form.ent_placeholder")}
            className={inputCls}
          />
        </Field>
      )}
      <Field label={t("settings.account.username")}>
        <input value={user} onChange={(e) => setUser(e.target.value)} required className={inputCls} />
      </Field>
      <Field label={t("settings.account.password")}>
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          placeholder={initial.has_password ? t("settings.account.form.password_placeholder_keep") : t("settings.account.form.password_placeholder_new")}
          className={inputCls}
        />
      </Field>
      <Field label={t("settings.account.child")}>
        <input
          value={child}
          onChange={(e) => setChild(e.target.value)}
          placeholder={t("settings.account.form.child_placeholder")}
          className={inputCls}
        />
      </Field>
      {error && <p className="text-pap-bad text-xs">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Btn variant="accent" type="submit" disabled={pending}>
          {pending ? t("common.saving") : t("common.save")}
        </Btn>
        <Btn type="button" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Btn>
      </div>
    </form>
  );
}

// ---------- Auto-sync --------------------------------------------------------

function AutoSyncSection() {
  const { t } = useTranslation();
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

  if (!status.data) return <Card title={t("settings.autosync.title")}><Skel /></Card>;
  const s = status.data;
  const current = s.interval_seconds ?? 1800;

  return (
    <Card title={t("settings.autosync.title")} subtitle={t("settings.autosync.subtitle")}>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <Toggle
            checked={s.loaded}
            onChange={(v) => set.mutate({ enabled: v, interval: current })}
            disabled={set.isPending || !s.template_exists}
            label={s.loaded ? t("settings.autosync.running") : t("settings.autosync.stopped")}
          />
          <span className="text-xs text-pap-muted">
            {s.template_exists
              ? t("settings.autosync.plist_target", { path: s.plist_target })
              : t("settings.autosync.template_missing")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-pap-muted w-32">{t("settings.autosync.interval")}</span>
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
                {t(`settings.autosync.presets.${p.key}`)}
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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const restore = useMutation({
    mutationFn: (file: File) => api.settingsRestore(file),
    onSuccess: (r) => {
      setMsg(
        t("settings.backup.restored", {
          grades: r.manifest?.last_sync?.counts?.grades ?? "?",
          lessons: r.manifest?.last_sync?.counts?.lessons ?? "?",
        }),
      );
      qc.invalidateQueries();
      setTimeout(() => window.location.reload(), 1500);
    },
    onError: (e: any) => setMsg(t("settings.backup.restore_failed", { error: e.message ?? e })),
  });

  return (
    <Card title={t("settings.backup.title")} subtitle={t("settings.backup.subtitle")}>
      <div className="flex flex-wrap gap-2 items-center">
        <a
          href={api.settingsBackupUrl()}
          download
          className="px-3 py-1.5 rounded-md bg-pap-accent text-pap-bg text-sm font-medium hover:bg-pap-accent/85"
        >
          {t("settings.backup.download")}
        </a>
        <Btn onClick={() => fileRef.current?.click()} disabled={restore.isPending}>
          {restore.isPending ? t("settings.backup.restoring") : t("settings.backup.restore")}
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
  const { t } = useTranslation();
  const version = useQuery({ queryKey: ["settings", "version"], queryFn: api.settingsVersion });
  const check = useMutation({ mutationFn: api.settingsUpdateCheck });

  return (
    <Card title={t("settings.about.title")}>
      <div className="space-y-3 text-sm">
        <KV label={t("settings.about.version")} value={version.data?.version ?? "—"} mono />
        <KV label={t("settings.about.data_dir")} value={version.data?.data_dir ?? "—"} mono />
        <KV label={t("settings.about.cartable_dir")} value={version.data?.cartable_dir ?? "—"} mono />
        <LanguageSelector />
        <div className="flex items-center gap-3 pt-1">
          <Btn onClick={() => check.mutate()} disabled={check.isPending}>
            {check.isPending ? t("settings.about.checking") : t("settings.about.check_updates")}
          </Btn>
          {check.data?.ok && (
            <span className="text-xs">
              {check.data.is_newer ? (
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-pap-good font-medium">
                    {t("settings.about.update_available", { version: check.data.latest })}
                  </span>
                  {check.data.dmg_url && (
                    <a
                      href={check.data.dmg_url}
                      className="px-3 py-1 rounded-md bg-pap-accent text-pap-bg text-xs font-medium hover:bg-pap-accent/85"
                      download
                    >
                      {t("settings.about.download_dmg")}
                    </a>
                  )}
                  {check.data.html_url && (
                    <a
                      href={check.data.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pap-accent underline"
                    >
                      {t("settings.about.release_notes")}
                    </a>
                  )}
                </span>
              ) : check.data.latest ? (
                <span className="text-pap-muted">
                  {t("settings.about.up_to_date", { version: check.data.latest })}
                </span>
              ) : (
                <span className="text-pap-muted">
                  {check.data.note ?? t("settings.about.no_releases")}
                </span>
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

function LanguageSelector() {
  const { t, i18n: i18nInst } = useTranslation();
  const current = (i18nInst.language?.slice(0, 2) ?? "en") as LangCode;
  return (
    <div className="flex gap-4 items-baseline">
      <span className="text-pap-muted w-32 shrink-0">{t("settings.about.language")}</span>
      <div className="flex gap-1 bg-pap-surface-2 rounded p-1">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => {
              i18nInst.changeLanguage(l.code);
              // Also stash explicitly — i18next-browser-languagedetector caches automatically,
              // but doing this defensively lets a refresh pick the choice up reliably.
              try {
                localStorage.setItem("cartable-language", l.code);
              } catch {
                // ignore — privacy modes etc.
              }
            }}
            className={clsx(
              "px-3 py-1 text-xs rounded transition-colors",
              current === l.code
                ? "bg-pap-accent text-pap-bg font-medium"
                : "text-pap-muted hover:text-pap-text hover:bg-pap-border/50",
            )}
          >
            {l.name}
          </button>
        ))}
      </div>
    </div>
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
