import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import clsx from "clsx";

export function CalendarSyncButton() {
  const status = useQuery({ queryKey: ["calendar", "status"], queryFn: api.calendarStatus });
  const [lastResult, setLastResult] = useState<string | null>(null);

  const authorize = useMutation({
    mutationFn: api.calendarAuthorize,
    onSuccess: () => {
      status.refetch();
      setLastResult("Connected — try syncing now");
    },
    onError: (e: any) => setLastResult(`Auth failed: ${e.message ?? e}`),
  });

  const sync = useMutation({
    mutationFn: () => api.calendarSync(14),
    onSuccess: (r) =>
      setLastResult(
        `${r.calendar}: +${r.inserted} new, ~${r.updated} updated, ${r.errors} errors  (${r.deduplicated}/${r.lessons_seen} lessons after dedupe)`,
      ),
    onError: (e: any) => setLastResult(`Sync failed: ${e.message ?? e}`),
  });

  const s = status.data;

  if (!s) {
    return <div className="text-xs text-pap-muted">Loading calendar status…</div>;
  }

  if (!s.has_credentials) {
    return (
      <details className="text-xs text-pap-muted bg-pap-surface rounded-md px-3 py-2 border border-pap-border">
        <summary className="cursor-pointer">Google Calendar — needs one-time setup</summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <p>To enable the 2-week calendar sync, drop your Google OAuth Desktop credentials at:</p>
          <code className="block bg-pap-surface-2 px-2 py-1 rounded text-pap-text break-all">
            {s.credentials_path}
          </code>
          <p>
            (Create a project at console.cloud.google.com, enable the Calendar API,
            create an OAuth 2.0 Client of type "Desktop", download the JSON.)
          </p>
        </div>
      </details>
    );
  }

  if (!s.has_token) {
    return (
      <Cluster
        primary={
          <Btn onClick={() => authorize.mutate()} disabled={authorize.isPending}>
            {authorize.isPending ? "Opening browser…" : "Connect Google Calendar"}
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
          {sync.isPending ? "Pushing 2 weeks…" : "Sync 2 weeks to Google Calendar"}
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
