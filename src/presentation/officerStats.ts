// Officer Monthly Statistics (pure). Only what the data records: enforcement
// outcomes decided by this officer and when. No response times, distances,
// money collected or performance scores.
//
// BACKEND: numbers come from the server (get_officer_monthly_stats), never from
// the loaded Cases pages. LOCAL_DEMO: derived from the complete local store.

import type { EnforcementOutcomeCode, OfficerCase } from "../domain";

export type DayStats = { day: string; completed: number; issued: number; rejected: number; noCharge: number };

export type MonthlyStats = {
  completed: number;
  issued: number;
  rejected: number;
  /** Closed without a charge: vehicle moved, valid permit, duplicate, other. */
  noCharge: number;
  /** Only days with at least one decision, ascending (YYYY-MM-DD, officer's local date). */
  days: DayStats[];
};

export type MonthRange = { from: Date; to: Date; label: string };

const NO_CHARGE: readonly EnforcementOutcomeCode[] = ["VEHICLE_MOVED", "VALID_PERMIT", "DUPLICATE", "OTHER"];

const pad = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The local calendar month containing `now` (offset months back with `monthsBack`). */
export function monthRange(now: Date, monthsBack = 0): MonthRange {
  const from = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return { from, to, label: from.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) };
}

/** Device time zone name for the server's day buckets ("UTC" if unknown). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function emptyDay(day: string): DayStats {
  return { day, completed: 0, issued: 0, rejected: 0, noCharge: 0 };
}

function count(day: DayStats, code: EnforcementOutcomeCode) {
  day.completed += 1;
  if (code === "CHARGE_ISSUED") day.issued += 1;
  else if (code === "REPORT_REJECTED") day.rejected += 1;
  else if (NO_CHARGE.includes(code)) day.noCharge += 1;
}

/** LOCAL_DEMO: from every case in the local store decided by this officer in the range. */
export function localMonthlyStats(cases: readonly OfficerCase[], officerId: string, range: { from: Date; to: Date }): MonthlyStats {
  const byDay = new Map<string, DayStats>();
  for (const c of cases) {
    const o = c.outcome;
    if (!o || o.officerId !== officerId) continue;
    const t = new Date(o.decidedAt);
    if (!(t >= range.from && t < range.to)) continue;
    const key = localDayKey(t);
    const d = byDay.get(key) ?? emptyDay(key);
    count(d, o.code);
    byDay.set(key, d);
  }
  return totals([...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)));
}

function totals(days: DayStats[]): MonthlyStats {
  return {
    completed: days.reduce((s, d) => s + d.completed, 0),
    issued: days.reduce((s, d) => s + d.issued, 0),
    rejected: days.reduce((s, d) => s + d.rejected, 0),
    noCharge: days.reduce((s, d) => s + d.noCharge, 0),
    days,
  };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/** BACKEND: the server's JSON -> MonthlyStats (defensive: bad values become 0, bad days are dropped). */
export function monthlyStatsFromServer(json: unknown): MonthlyStats | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const days = Array.isArray(j.days)
    ? (j.days as Record<string, unknown>[])
        .filter((d) => d && typeof d.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.day as string))
        .map((d) => ({ day: d.day as string, completed: num(d.completed), issued: num(d.issued), rejected: num(d.rejected), noCharge: num(d.no_charge) }))
    : [];
  return { completed: num(j.completed), issued: num(j.issued), rejected: num(j.rejected), noCharge: num(j.no_charge), days };
}

export type WeekStats = { label: string; completed: number; issued: number; rejected: number; noCharge: number };

/**
 * Weeks of the month (Monday-Sunday, cut to the month): "1–5 Oct", "6–12 Oct", ...
 * Every week of the month is listed, also weeks without activity (zeros).
 */
export function weeklyBreakdown(stats: MonthlyStats, range: { from: Date; to: Date }): WeekStats[] {
  const byDay = new Map(stats.days.map((d) => [d.day, d]));
  const weeks: WeekStats[] = [];
  const month = range.from.toLocaleDateString("en-GB", { month: "short" });
  let cur = new Date(range.from);
  while (cur < range.to) {
    const start = new Date(cur);
    const w: WeekStats = { label: "", completed: 0, issued: 0, rejected: 0, noCharge: 0 };
    let last = start;
    do {
      const d = byDay.get(localDayKey(cur));
      if (d) {
        w.completed += d.completed;
        w.issued += d.issued;
        w.rejected += d.rejected;
        w.noCharge += d.noCharge;
      }
      last = new Date(cur);
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
    } while (cur < range.to && cur.getDay() !== 1); // a new week starts on Monday
    w.label = start.getDate() === last.getDate() ? `${start.getDate()} ${month}` : `${start.getDate()}–${last.getDate()} ${month}`;
    weeks.push(w);
  }
  return weeks;
}
