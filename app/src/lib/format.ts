import { format, isToday, parseISO } from "date-fns";

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "d MMM");
  } catch {
    return iso;
  }
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return format(parseISO(iso), "HH:mm");
  } catch {
    return iso;
  }
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = parseISO(iso);
    return isToday(d) ? `today, ${format(d, "HH:mm")}` : format(d, "EEE d MMM, HH:mm");
  } catch {
    return iso;
  }
}

export function fmtGrade(g: string | null | undefined, outOf: number | null | undefined): string {
  if (g == null) return "—";
  const num = parseFloat(g.replace(",", "."));
  if (!Number.isFinite(num)) return g; // "Absent", "Disp", etc.
  if (outOf != null) return `${num.toFixed(num % 1 ? 1 : 0)} / ${outOf}`;
  return num.toString();
}

export function tone(value: number | null, max = 20): "good" | "warn" | "bad" | "neutral" {
  if (value == null) return "neutral";
  const r = value / max;
  if (r >= 0.7) return "good";
  if (r >= 0.5) return "warn";
  return "bad";
}

export const toneClass: Record<ReturnType<typeof tone>, string> = {
  good: "text-pap-good",
  warn: "text-pap-warn",
  bad: "text-pap-bad",
  neutral: "text-pap-muted",
};
