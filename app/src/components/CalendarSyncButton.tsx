import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import clsx from "clsx";

export function CalendarSyncButton() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ["calendar", "status"], queryFn: api.calendarStatus });
  const [lastResult, setLastResult] = useState<string | null>(null);

  const authorize = useMutation({
    mutationFn: api.calendarAuthorize,
    onSuccess: () => {
      status.refetch();
      setLastResult(null);
    },
    onError: (e: any) => setLastResult(`${e.message ?? e}`),
  });

  const sync = useMutation({
    mutationFn: () => api.calendarSync(14),
    onSuccess: (r) =>
      setLastResult(
        `${r.calendar}: +${r.inserted} / ~${r.updated} / ${r.errors} errors (${r.deduplicated}/${r.lessons_seen})`,
      ),
    onError: (e: any) => setLastResult(`${e.message ?? e}`),
  });

  const s = status.data;

  if (!s) {
    return <div className="text-xs text-pap-muted">{t("schedule.loading_status")}</div>;
  }

  if (!s.has_credentials) {
    return (
      <details className="text-xs text-pap-muted bg-pap-surface rounded-md px-3 py-2 border border-pap-border">
        <summary className="cursor-pointer">{t("schedule.google_calendar_setup_needed")}</summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <p>{t("schedule.google_calendar_setup_intro")}</p>
          <code className="block bg-pap-surface-2 px-2 py-1 rounded text-pap-text break-all">
            {s.credentials_path}
          </code>
          <p>{t("schedule.google_calendar_setup_outro")}</p>
        </div>
      </details>
    );
  }

  if (!s.has_token) {
    return (
      <Cluster
        primary={
          <Btn onClick={() => authorize.mutate()} disabled={authorize.isPending}>
            {authorize.isPending ? t("schedule.opening_browser") : t("schedule.connect_google_calendar")}
          </Btn>
        }
        msg={lastResult}
      />
    );
  }

  return (
    <Cluster
      primary={
        <Btn onClick={() => sync.mutate()} disabled={sync.isPending} variant="accent">
          {sync.isPending ? t("schedule.syncing_calendar") : t("schedule.sync_2_weeks")}
        </Btn>
      }
      msg={lastResult}
    />
  );
}

function Cluster({ primary, msg }: { primary: React.ReactNode; msg: string | null }) {
  return (
    <div className="flex items-center gap-3">
      {primary}
      {msg && <span className="text-xs text-pap-muted">{msg}</span>}
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  variant = "default",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "accent";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50",
        variant === "accent"
          ? "bg-pap-accent text-pap-bg font-medium hover:bg-pap-accent/85"
          : "bg-pap-surface border border-pap-border text-pap-text hover:bg-pap-surface-2",
      )}
    >
      {children}
    </button>
  );
}
