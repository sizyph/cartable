import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, Average, Grade, TrendPoint } from "../api";
import { fmtDate, fmtGrade, tone, toneClass } from "../lib/format";
import clsx from "clsx";

export function GradesDashboard() {
  const periods = useQuery({ queryKey: ["periods"], queryFn: api.periods });
  const averages = useQuery({ queryKey: ["averages"], queryFn: () => api.averages() });
  const recent = useQuery({ queryKey: ["grades", "recent"], queryFn: () => api.gradesRecent(30) });
  const trend = useQuery({ queryKey: ["trend"], queryFn: api.trend });

  const current = periods.data?.find((p) => p.is_current === 1);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Grades</h1>
        <p className="text-sm text-pap-muted">
          {current ? `Current period: ${current.name}` : "—"}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-6">
        <Card title="Subject averages (current period)" subtitle="Student vs class">
          {averages.data ? <AveragesChart data={averages.data} /> : <Skel />}
        </Card>
        <Card title="Trend across periods" subtitle="Student average per subject, /20 normalised">
          {trend.data ? <TrendChart data={trend.data} /> : <Skel />}
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-6">
        <Card title="Subject leaderboard" subtitle="Sorted by gap to class">
          {averages.data ? <AveragesTable data={averages.data} /> : <Skel />}
        </Card>
        <Card title="Recent grades" subtitle="Newest first, deduplicated">
          {recent.data ? <RecentGrades data={recent.data} /> : <Skel />}
        </Card>
      </section>
    </div>
  );
}

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
    <div className="rounded-lg border border-pap-border bg-pap-surface p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-pap-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Skel() {
  return <div className="h-48 rounded bg-pap-surface-2/40 animate-pulse" />;
}

function AveragesChart({ data }: { data: Average[] }) {
  const rows = data
    .filter((a) => a.student != null)
    .map((a) => ({
      subject: shorten(a.subject_name),
      student: a.student,
      class: a.class_average,
      out_of: a.out_of ?? 20,
    }))
    .sort((a, b) => (a.student ?? 0) - (b.student ?? 0));

  return (
    <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 24)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid stroke="#2a2f40" strokeDasharray="3 3" />
        <XAxis type="number" domain={[0, 20]} tick={tickStyle} stroke="#8e94a7" />
        <YAxis dataKey="subject" type="category" width={130} tick={tickStyle} stroke="#8e94a7" />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#1f2330" }} />
        <Legend wrapperStyle={{ color: "#8e94a7", fontSize: 12 }} />
        <Bar dataKey="class" name="Class" fill="#3a4055" radius={[3, 3, 3, 3]} />
        <Bar dataKey="student" name="Student" fill="#7c9cff" radius={[3, 3, 3, 3]}>
          {rows.map((r, i) => (
            <Cell key={i} fill={barColor(r.student, r.out_of)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  // Group: one line per subject, x = period_name (in chronological order via start_date)
  const subjects = useMemo(() => {
    const m: Record<string, { period: string; date: string; v: number }[]> = {};
    for (const p of data) {
      if (!p.student) continue;
      const v = (p.student / (p.out_of || 20)) * 20;
      (m[p.subject_name] ||= []).push({ period: p.period_name, date: p.start_date, v });
    }
    return Object.entries(m)
      .map(([subject, pts]) => ({
        subject,
        pts: pts.sort((a, b) => a.date.localeCompare(b.date)),
      }))
      .filter((s) => s.pts.length >= 2);
  }, [data]);

  if (subjects.length === 0) {
    return <p className="text-sm text-pap-muted">Need at least 2 periods of data to plot a trend.</p>;
  }

  // build a wide table: { period: "T1", MATH: 14, ENG: 15, ... }
  const allPeriods = Array.from(
    new Set(subjects.flatMap((s) => s.pts.map((p) => p.period))),
  );
  const wide = allPeriods.map((period) => {
    const row: Record<string, number | string> = { period };
    for (const s of subjects) {
      const pt = s.pts.find((p) => p.period === period);
      if (pt) row[s.subject] = +pt.v.toFixed(2);
    }
    return row;
  });

  const palette = ["#7c9cff", "#6bd09c", "#f0b86e", "#ef6f6c", "#c084fc", "#22d3ee", "#fbbf24", "#f472b6"];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={wide} margin={{ left: 8, right: 8 }}>
        <CartesianGrid stroke="#2a2f40" strokeDasharray="3 3" />
        <XAxis dataKey="period" tick={tickStyle} stroke="#8e94a7" />
        <YAxis domain={[0, 20]} tick={tickStyle} stroke="#8e94a7" width={28} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ color: "#8e94a7", fontSize: 11 }} />
        {subjects.map((s, i) => (
          <Line
            key={s.subject}
            type="monotone"
            dataKey={s.subject}
            stroke={palette[i % palette.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            name={shorten(s.subject)}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function AveragesTable({ data }: { data: Average[] }) {
  const rows = data
    .filter((a) => a.student != null && a.class_average != null)
    .map((a) => ({
      ...a,
      gap: (a.student ?? 0) - (a.class_average ?? 0),
    }))
    .sort((a, b) => b.gap - a.gap);

  return (
    <div className="text-sm">
      <div className="grid grid-cols-[1fr,auto,auto,auto] gap-x-4 px-2 py-1 text-xs uppercase tracking-wide text-pap-muted border-b border-pap-border">
        <span>Subject</span>
        <span className="text-right">Student</span>
        <span className="text-right">Class</span>
        <span className="text-right">Gap</span>
      </div>
      <ul className="divide-y divide-pap-border">
        {rows.map((r) => (
          <li
            key={r.subject_name}
            className="grid grid-cols-[1fr,auto,auto,auto] gap-x-4 px-2 py-1.5"
          >
            <span className="truncate">{r.subject_name}</span>
            <span className={clsx("tabular-nums", toneClass[tone(r.student, r.out_of ?? 20)])}>
              {r.student?.toFixed(1)}
            </span>
            <span className="tabular-nums text-pap-muted">{r.class_average?.toFixed(1)}</span>
            <span
              className={clsx(
                "tabular-nums",
                r.gap >= 0 ? "text-pap-good" : "text-pap-bad",
              )}
            >
              {r.gap >= 0 ? "+" : ""}
              {r.gap.toFixed(1)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentGrades({ data }: { data: Grade[] }) {
  // dedupe by (date, subject, grade, coefficient)
  const seen = new Set<string>();
  const rows = data.filter((g) => {
    const k = `${g.date}|${g.subject_name}|${g.grade}|${g.coefficient}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <ul className="divide-y divide-pap-border text-sm max-h-[340px] overflow-y-auto">
      {rows.map((g, i) => {
        const num = parseFloat((g.grade ?? "").replace(",", "."));
        const isNumeric = Number.isFinite(num);
        return (
          <li key={i} className="px-2 py-2 grid grid-cols-[auto,1fr,auto] gap-3 items-center">
            <span className="text-xs text-pap-muted w-14">{fmtDate(g.date)}</span>
            <div className="min-w-0">
              <div className="truncate">{g.subject_name}</div>
              {g.comment && (
                <div className="text-xs text-pap-muted truncate">{g.comment}</div>
              )}
            </div>
            <span
              className={clsx(
                "tabular-nums text-right whitespace-nowrap",
                isNumeric ? toneClass[tone(num, g.out_of ?? 20)] : "text-pap-muted",
              )}
            >
              {fmtGrade(g.grade, g.out_of)}
              {g.coefficient != null && g.coefficient !== 1 && (
                <span className="text-xs text-pap-muted"> ×{g.coefficient}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function shorten(name: string | null): string {
  if (!name) return "—";
  return name.length > 22 ? name.slice(0, 20).trimEnd() + "…" : name;
}

function barColor(v: number | null, max: number): string {
  if (v == null) return "#8e94a7";
  const r = v / (max || 20);
  if (r >= 0.7) return "#6bd09c";
  if (r >= 0.5) return "#f0b86e";
  return "#ef6f6c";
}

const tickStyle = { fill: "#8e94a7", fontSize: 11 } as const;
const tooltipStyle = {
  background: "#161922",
  border: "1px solid #2a2f40",
  borderRadius: 6,
  color: "#e6e8ee",
  fontSize: 12,
} as const;
