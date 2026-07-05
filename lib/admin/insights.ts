/**
 * lib/admin/insights.ts — pure aggregation for the client analytics page
 * (OP909 Phase 6). Server components fetch lightweight non-PII rows and
 * feed them through these functions; everything here is deterministic
 * (now injected) and node:test-able with fixture rows.
 *
 * Day bucketing uses EUROPE/LONDON days — a signup at 23:30 UK lands on
 * the UK day the client thinks it happened, not the UTC day.
 */

export interface InsightSignupRow {
  /** ISO timestamptz. */
  createdAt: string;
  country: string | null;
  igHandle: string | null;
  ttHandle: string | null;
  waOptInAt: string | null;
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in Europe/London for an instant. */
export function londonDay(instant: Date): string {
  return LONDON_DAY.format(instant);
}

// ─── Metric cards ────────────────────────────────────────────────────────────

export interface InsightMetrics {
  total: number;
  today: number;
  /** Rolling last 7 days including today. */
  last7Days: number;
  /** 0–100, rounded to one decimal; null when there are no signups. */
  waOptInRatePct: number | null;
}

export function computeMetrics(
  rows: InsightSignupRow[],
  now: Date,
): InsightMetrics {
  const todayKey = londonDay(now);
  const weekCutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;

  let today = 0;
  let last7Days = 0;
  let optedIn = 0;
  for (const row of rows) {
    const at = new Date(row.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    if (londonDay(at) === todayKey) today += 1;
    if (at.getTime() >= weekCutoff) last7Days += 1;
    if (row.waOptInAt !== null) optedIn += 1;
  }
  return {
    total: rows.length,
    today,
    last7Days,
    waOptInRatePct:
      rows.length === 0
        ? null
        : Math.round((optedIn / rows.length) * 1000) / 10,
  };
}

// ─── Daily series (last N days, zero-filled) ─────────────────────────────────

export interface DailyPoint {
  /** YYYY-MM-DD (London). */
  day: string;
  /** Short label for the axis, e.g. "5 Jul". */
  label: string;
  count: number;
}

const LONDON_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
});

export function buildDailySeries(
  rows: InsightSignupRow[],
  now: Date,
  days = 30,
): DailyPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const at = new Date(row.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = londonDay(at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const series: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    // Noon-anchored stepping so a DST shift can't skip/repeat a day.
    const instant = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const day = londonDay(instant);
    if (series.length > 0 && series[series.length - 1].day === day) continue;
    series.push({
      day,
      label: LONDON_LABEL.format(instant),
      count: counts.get(day) ?? 0,
    });
  }
  return series;
}

// ─── Country breakdown ───────────────────────────────────────────────────────

export interface CountrySlice {
  /** ISO-2 code, "Other" bucket, or "Unknown" for null geo. */
  country: string;
  count: number;
  /** 0–100 share, one decimal. */
  pct: number;
}

export function buildCountryBreakdown(
  rows: InsightSignupRow[],
  top = 10,
): CountrySlice[] {
  if (rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.country ?? "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const pct = (count: number) =>
    Math.round((count / rows.length) * 1000) / 10;

  const head = sorted.slice(0, top).map(([country, count]) => ({
    country,
    count,
    pct: pct(count),
  }));
  const rest = sorted.slice(top);
  if (rest.length > 0) {
    const count = rest.reduce((sum, [, c]) => sum + c, 0);
    head.push({ country: "Other", count, pct: pct(count) });
  }
  return head;
}

// ─── Social split ────────────────────────────────────────────────────────────

export interface SocialSplit {
  ig: number;
  tt: number;
  /** Rows with either handle populated. */
  total: number;
  igPct: number | null;
}

export function buildSocialSplit(rows: InsightSignupRow[]): SocialSplit {
  let ig = 0;
  let tt = 0;
  for (const row of rows) {
    // Write path enforces the PR-6 mutex (at most one), so no double-count.
    if (row.igHandle !== null) ig += 1;
    else if (row.ttHandle !== null) tt += 1;
  }
  const total = ig + tt;
  return {
    ig,
    tt,
    total,
    igPct: total === 0 ? null : Math.round((ig / total) * 1000) / 10,
  };
}
