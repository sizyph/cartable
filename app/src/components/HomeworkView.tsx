import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { api, Homework } from "../api";
import clsx from "clsx";

type Window = "current" | "next" | "overdue" | "later";

export function HomeworkView() {
  const [window, setWindow] = useState<Window>("current");

  // Pull a wide range once; we group/filter client-side.
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
      // later: anything beyond next week, not done
      const nextSun = format(addDays(monday, 13), "yyyy-MM-dd");
      return due > nextSun && !h.done;
    });
  }, [items, window, monday, today]);

  // dedupe — Pronote sometimes returns duplicate homework per group.
  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return filtered.filter((h) => {
      const key = `${h.due_date}|${h.subject_name}|${(h.description ?? "").trim()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filtered]);

  // group by due_date
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
          <h1 className="text-2xl font-semibold tracking-tight">Homework</h1>
          <p className="text-sm text-pap-muted">
            {windowLabel(window, monday)} ·{" "}
            <span className="text-pap-text">{stats.pending}</span> pending /{" "}
            {stats.total} total
          </p>
        </div>
        <div className="flex gap-1 bg-pap-surface rounded-md p-1">
          {(["current", "next", "later", "overdue"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={clsx(
                "px-3 py-1 text-sm rounded transition-colors capitalize",
                window === w
                  ? "bg-pap-surface-2 text-pap-text"
                  : "text-pap-muted hover:text-pap-text hover:bg-pap-surface-2/60",
              )}
            >
              {w === "current" ? "This week" : w === "next" ? "Next week" : w}
            </button>
          ))}
        </div>
      </header>

      {isLoading ? (
        <p className="text-pap-muted">Loading…</p>
      ) : grouped.length === 0 ? (
        <p className="text-pap-muted italic">Nothing in this window.</p>
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

function windowLabel(w: Window, monday: Date): string {
  if (w === "current") return `Week of ${format(monday, "EEEE d MMMM")}`;
  if (w === "next") return `Week of ${format(addDays(monday, 7), "EEEE d MMMM")}`;
  if (w === "overdue") return "Past due, still pending";
  return "Later this term";
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
          {format(d, "EEEE d MMMM")}
        </h2>
        <span className="text-xs text-pap-muted">
          {isToday ? "today" : daysFromToday(d, today)}
        </span>
        <span className="text-xs text-pap-muted ml-auto">
          {items.length} item{items.length > 1 ? "s" : ""}
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
          h.done
            ? "bg-pap-good border-pap-good"
            : "border-pap-muted bg-transparent",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className={clsx("font-medium truncate", h.done && "line-through")}>
          {h.subject_name ?? "—"}
        </div>
        <div className="text-pap-muted whitespace-pre-wrap break-words text-xs leading-relaxed mt-0.5">
          {(h.description ?? "").trim() || <em>(no description)</em>}
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

function daysFromToday(d: Date, today: Date): string {
  const ms = d.getTime() - new Date(today.toDateString()).getTime();
  const days = Math.round(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}
