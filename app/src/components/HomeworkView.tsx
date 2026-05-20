import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { useTranslation } from "react-i18next";
import { api, Homework } from "../api";
import { dateFnsLocale } from "../i18n";
import clsx from "clsx";

type Window = "current" | "next" | "overdue" | "later";

export function HomeworkView() {
  const { t } = useTranslation();
  const locale = dateFnsLocale();
  const [window, setWindow] = useState<Window>("current");

  const { from, to } = useMemo(() => {
    const today = new Date();
    const start = addDays(today, -30);
    const end = addDays(today, 60);
    return { from: format(start, "yyyy-MM-dd"), to: format(end, "yyyy-MM-dd") };
  }, []);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["homework", from, to],
    queryFn: () => api.homework({ from, to }),
  });

  const today = useMemo(() => new Date(), []);
  const monday = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today]);

  const filtered = useMemo(() => {
    const todayStr = format(today, "yyyy-MM-dd");
    return items.filter((h) => {
      if (!h.due_date) return false;
      const due = h.due_date.slice(0, 10);
      if (window === "overdue") return due < todayStr && !h.done;
      if (window === "current") {
        const sunday = format(addDays(monday, 6), "yyyy-MM-dd");
        return due >= format(monday, "yyyy-MM-dd") && due <= sunday;
      }
      if (window === "next") {
        const nextMon = format(addDays(monday, 7), "yyyy-MM-dd");
        const nextSun = format(addDays(monday, 13), "yyyy-MM-dd");
        return due >= nextMon && due <= nextSun;
      }
      const nextSun = format(addDays(monday, 13), "yyyy-MM-dd");
      return due > nextSun && !h.done;
    });
  }, [items, window, monday, today]);

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return filtered.filter((h) => {
      const key = `${h.due_date}|${h.subject_name}|${(h.description ?? "").trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filtered]);

  const grouped = useMemo(() => {
    const m = new Map<string, Homework[]>();
    for (const h of deduped) {
      const k = (h.due_date ?? "").slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(h);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [deduped]);

  const stats = useMemo(() => {
    const done = deduped.filter((h) => h.done).length;
    return { total: deduped.length, done, pending: deduped.length - done };
  }, [deduped]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("homework.title")}</h1>
          <p className="text-sm text-pap-muted">
            {windowLabel(window, monday, t, locale)} ·{" "}
            <span className="text-pap-text">
              {t("homework.pending_of_total", {
                pending: stats.pending,
                total: stats.total,
              })}
            </span>
          </p>
        </div>
        <div className="flex gap-1 bg-pap-surface rounded-md p-1">
          {(["current", "next", "later", "overdue"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={clsx(
                "px-3 py-1 text-sm rounded transition-colors",
                window === w
                  ? "bg-pap-surface-2 text-pap-text"
                  : "text-pap-muted hover:text-pap-text hover:bg-pap-surface-2/60",
              )}
            >
              {t(`homework.window.${w}`)}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <p className="text-pap-muted">{t("common.loading")}</p>
      ) : grouped.length === 0 ? (
        <p className="text-pap-muted italic">{t("homework.empty")}</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, list]) => (
            <DayGroup key={day} day={day} items={list} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

function windowLabel(
  w: Window,
  monday: Date,
  t: (k: string, opts?: any) => string,
  locale: any,
): string {
  if (w === "current")
    return t("homework.window.current_label", {
      date: format(monday, "EEEE d MMMM", { locale }),
    });
  if (w === "next")
    return t("homework.window.next_label", {
      date: format(addDays(monday, 7), "EEEE d MMMM", { locale }),
    });
  if (w === "overdue") return t("homework.window.overdue_label");
  return t("homework.window.later_label");
}

function DayGroup({
  day,
  items,
  today,
}: {
  day: string;
  items: Homework[];
  today: Date;
}) {
  const { t } = useTranslation();
  const locale = dateFnsLocale();
  if (!day) return null;
  const d = parseISO(day);
  const isToday = format(today, "yyyy-MM-dd") === day;
  const isPast = day < format(today, "yyyy-MM-dd");

  return (
    <section>
      <header className="flex items-baseline gap-3 mb-2">
        <h2
          className={clsx(
            "text-sm font-semibold",
            isToday ? "text-pap-accent" : isPast ? "text-pap-bad" : "text-pap-text",
          )}
        >
          {format(d, "EEEE d MMMM", { locale })}
        </h2>
        <span className="text-xs text-pap-muted">
          {isToday ? t("common.today") : daysFromToday(d, today, t)}
        </span>
        <span className="text-xs text-pap-muted ml-auto">
          {t("homework.items", { count: items.length })}
        </span>
      </header>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map((h) => (
          <HomeworkCard key={h.id} h={h} />
        ))}
      </ul>
    </section>
  );
}

function HomeworkCard({ h }: { h: Homework }) {
  const { t } = useTranslation();
  return (
    <li
      className={clsx(
        "rounded-md border p-3 text-sm flex gap-3 items-start",
        h.done
          ? "border-pap-border bg-pap-surface/40 opacity-60"
          : "border-pap-border bg-pap-surface",
      )}
    >
      <span
        aria-hidden
        className={clsx(
          "shrink-0 w-4 h-4 rounded-sm border mt-0.5",
          h.done ? "bg-pap-good border-pap-good" : "border-pap-muted bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className={clsx("font-medium truncate", h.done && "line-through")}>
          {h.subject_name ?? "—"}
        </div>
        <div className="text-pap-muted whitespace-pre-wrap break-words text-xs leading-relaxed mt-0.5">
          {(h.description ?? "").trim() || <em>{t("homework.no_description")}</em>}
        </div>
        {h.files && h.files.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {h.files.map((f, i) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-1.5 py-0.5 rounded bg-pap-surface-2 text-pap-accent hover:underline"
              >
                {f.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function daysFromToday(d: Date, today: Date, t: (k: string, opts?: any) => string): string {
  const ms = d.getTime() - new Date(today.toDateString()).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return t("common.today");
  if (days === 1) return t("common.tomorrow");
  if (days === -1) return t("common.yesterday");
  if (days > 0) return t("common.in_days", { count: days });
  return t("common.days_ago", { count: Math.abs(days) });
}
