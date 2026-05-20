import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addDays, format, startOfWeek } from "date-fns";
import { useTranslation } from "react-i18next";
import { api, Lesson } from "../api";
import { fmtTime } from "../lib/format";
import { dateFnsLocale } from "../i18n";
import { CalendarSyncButton } from "./CalendarSyncButton";
import clsx from "clsx";

export function ScheduleView() {
  const { t } = useTranslation();
  const locale = dateFnsLocale();
  const [offset, setOffset] = useState(0); // 0 = this week, 1 = next, -1 = previous
  const { data: lessons = [], isLoading } = useQuery({
    queryKey: ["lessons", "week", offset],
    queryFn: () => api.lessonsWeek(offset),
  });

  const monday = startOfWeek(addDays(new Date(), offset * 7), { weekStartsOn: 1 });
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    [monday],
  );

  const byDay = useMemo(() => {
    const m: Record<string, Lesson[]> = {};
    for (const l of lessons) {
      const key = l.start_dt.slice(0, 10);
      (m[key] ||= []).push(l);
    }
    // dedupe each day by (start, subject, teacher) — Pronote returns per-group duplicates
    for (const k of Object.keys(m)) {
      const seen = new Map<string, Lesson>();
      for (const l of m[k]) {
        const key = `${l.start_dt}|${l.subject_name}|${l.teacher_names}`;
        const cur = seen.get(key);
        // prefer the one with a classroom set
        if (!cur || (!cur.classroom && l.classroom)) seen.set(key, l);
      }
      m[k] = [...seen.values()].sort((a, b) => a.start_dt.localeCompare(b.start_dt));
    }
    return m;
  }, [lessons]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("schedule.title")}</h1>
          <p className="text-sm text-pap-muted">
            {t("schedule.week_of", { date: format(monday, "EEEE d MMMM", { locale }) })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <CalendarSyncButton />
          <div className="flex gap-1 bg-pap-surface rounded-md p-1">
            <NavBtn onClick={() => setOffset((o) => o - 1)}>←</NavBtn>
            <NavBtn onClick={() => setOffset(0)} active={offset === 0}>{t("common.today")}</NavBtn>
            <NavBtn onClick={() => setOffset((o) => o + 1)}>→</NavBtn>
          </div>
        </div>
      </header>

      {isLoading ? (
        <p className="text-pap-muted">{t("common.loading")}</p>
      ) : (
        <div className="grid grid-cols-7 gap-3">
          {days.map((d) => {
            const key = format(d, "yyyy-MM-dd");
            const dayLessons = byDay[key] ?? [];
            const isToday = key === format(new Date(), "yyyy-MM-dd");
            return (
              <div
                key={key}
                className={clsx(
                  "rounded-lg border border-pap-border bg-pap-surface p-3 flex flex-col gap-2 min-h-[260px]",
                  isToday && "ring-1 ring-pap-accent/50",
                )}
              >
                <div>
                  <div className="text-xs uppercase tracking-wide text-pap-muted">
                    {format(d, "EEE", { locale })}
                  </div>
                  <div className={clsx("text-lg font-semibold", isToday && "text-pap-accent")}>
                    {format(d, "d MMM", { locale })}
                  </div>
                </div>
                {dayLessons.length === 0 ? (
                  <div className="text-xs text-pap-muted/60 italic mt-3">{t("schedule.no_lessons")}</div>
                ) : (
                  <ul className="space-y-1.5">
                    {dayLessons.map((l) => (
                      <LessonChip key={l.id} l={l} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NavBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 py-1 text-sm rounded transition-colors",
        active
          ? "bg-pap-surface-2 text-pap-text"
          : "text-pap-muted hover:text-pap-text hover:bg-pap-surface-2/60",
      )}
    >
      {children}
    </button>
  );
}

function LessonChip({ l }: { l: Lesson }) {
  const { t } = useTranslation();
  const test = !!l.is_test;
  const cancelled = !!l.canceled;
  return (
    <li
      className={clsx(
        "rounded-md px-2 py-1.5 text-xs",
        cancelled
          ? "bg-pap-bad/15 text-pap-muted line-through"
          : test
          ? "bg-pap-warn/20 text-pap-text"
          : "bg-pap-surface-2 text-pap-text",
      )}
      title={[l.status, l.memo].filter(Boolean).join(" — ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium tabular-nums">{fmtTime(l.start_dt)}</span>
        {test && <span className="text-[10px] uppercase tracking-wide text-pap-warn">{t("schedule.test_tag")}</span>}
      </div>
      <div className="truncate font-medium">{l.subject_name ?? "—"}</div>
      <div className="text-pap-muted truncate">
        {[l.classroom, l.teacher_names].filter(Boolean).join(" · ")}
      </div>
    </li>
  );
}
