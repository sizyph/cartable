import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import clsx from "clsx";

type View = "schedule" | "homework" | "grades" | "chat" | "settings";

export function Layout({ active, onChange, children }: {
  active: View;
  onChange: (v: View) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: api.health });
  const sync = useMutation({
    mutationFn: api.triggerSync,
    onSuccess: () => {
      setTimeout(() => qc.invalidateQueries(), 10_000);
    },
  });

  const tabs: { id: View; label: string; hint: string }[] = [
    { id: "schedule", label: t("nav.schedule"), hint: t("nav.schedule_hint") },
    { id: "homework", label: t("nav.homework"), hint: t("nav.homework_hint") },
    { id: "grades", label: t("nav.grades"), hint: t("nav.grades_hint") },
    { id: "chat", label: t("nav.chat"), hint: t("nav.chat_hint") },
    { id: "settings", label: t("nav.settings"), hint: t("nav.settings_hint") },
  ];

  const student = health?.student ?? {};
  const last = health?.last_sync;

  return (
    <div className="flex h-screen bg-pap-bg text-pap-text">
      <aside className="w-56 shrink-0 border-r border-pap-border bg-pap-surface flex flex-col">
        <div className="px-4 py-4 border-b border-pap-border">
          <div className="text-sm font-semibold tracking-tight">Cartable</div>
          <div className="text-xs text-pap-muted truncate" title={student.name ?? undefined}>
            {student.name ?? "—"}
          </div>
          <div className="text-xs text-pap-muted truncate">
            {student.class_name ? `${student.class_name}` : ""}
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={clsx(
                "w-full text-left px-3 py-2 rounded-md transition-colors",
                active === tab.id
                  ? "bg-pap-surface-2 text-pap-text"
                  : "text-pap-muted hover:bg-pap-surface-2/60 hover:text-pap-text",
              )}
            >
              <div className="text-sm font-medium">{tab.label}</div>
              <div className="text-xs text-pap-muted">{tab.hint}</div>
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-pap-border text-xs text-pap-muted">
          <SyncIndicator last={last} pending={sync.isPending} onSync={() => sync.mutate()} />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

function SyncIndicator({
  last,
  pending,
  onSync,
}: {
  last: any;
  pending: boolean;
  onSync: () => void;
}) {
  const { t } = useTranslation();
  const success = last?.success;
  const ts = last?.started_at;
  const ago = ts ? timeAgo(new Date(ts), t) : t("sidebar.never");

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            "inline-block w-2 h-2 rounded-full",
            success === false ? "bg-pap-bad" : success ? "bg-pap-good" : "bg-pap-muted",
          )}
        />
        <span>{t("sidebar.last_sync_label")} {ago}</span>
      </div>
      <button
        onClick={onSync}
        disabled={pending}
        className="mt-2 w-full px-2 py-1.5 rounded-md bg-pap-surface-2 hover:bg-pap-border text-pap-text text-xs disabled:opacity-50"
      >
        {pending ? t("sidebar.syncing") : t("sidebar.sync_now")}
      </button>
    </div>
  );
}

function timeAgo(d: Date, t: (k: string, opts?: any) => string): string {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return t("sidebar.ago_seconds", { n: Math.floor(s) });
  if (s < 3600) return t("sidebar.ago_minutes", { n: Math.floor(s / 60) });
  if (s < 86400) return t("sidebar.ago_hours", { n: Math.floor(s / 3600) });
  return t("sidebar.ago_days", { n: Math.floor(s / 86400) });
}
