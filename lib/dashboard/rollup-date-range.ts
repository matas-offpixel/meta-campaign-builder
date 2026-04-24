/**
 * Pure date-range helpers for rollup sync zero-padding (no server-only).
 */

/** Calendar dates from `since` through `until` inclusive (YYYY-MM-DD). */
export function eachInclusiveYmd(since: string, until: string): string[] {
  if (since > until) return [];
  const out: string[] = [];
  let t = parseIsoDateUtcMidnight(since);
  const end = parseIsoDateUtcMidnight(until);
  if (!Number.isFinite(t) || !Number.isFinite(end)) return out;
  while (t <= end) {
    out.push(formatIsoDateUtc(t));
    t = addUtcDays(t, 1);
  }
  return out;
}

function parseIsoDateUtcMidnight(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d) ||
    y < 1000
  ) {
    return NaN;
  }
  return Date.UTC(y, m - 1, d);
}

function formatIsoDateUtc(t: number): string {
  const dt = new Date(t);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function addUtcDays(t: number, days: number): number {
  const dt = new Date(t);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.getTime();
}
