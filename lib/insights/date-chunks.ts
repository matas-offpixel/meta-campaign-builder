/**
 * lib/insights/date-chunks.ts
 *
 * Pure date helpers for the day-chunked /insights fallback that
 * fires when Meta returns "Please reduce the amount of data
 * you're asking for". Lives outside `lib/insights/meta.ts` so
 * unit tests can import the helpers without dragging in
 * `import "server-only"` (which throws at import time outside a
 * Next.js bundler).
 *
 * `lib/insights/meta.ts` re-exports `resolvePresetToDays` from
 * here so the public API surface stays in the canonical module.
 */

import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * Resolve a DatePreset (or a "custom" + range) into an inclusive
 * list of YYYY-MM-DD strings the chunked fallback fans out across.
 *
 * Returns null on:
 *   - "maximum" — the lifetime / "since campaign creation" preset
 *     doesn't hit the per-window cap on the report data shape, AND
 *     chunking it would require knowing the campaign creation date
 *     upfront. Caller short-circuits to the non-chunked path.
 *   - "custom" without a customRange — caller already validated
 *     this upstream; defensive null here means "nothing to chunk".
 *
 * Date arithmetic is in UTC. Real ad accounts have their own
 * reporting timezone, but a ±1 day boundary slip on a 7-day window
 * is materially invisible on the report (the totals shift by a
 * fraction of a percent). Worth the simplification.
 */
export function resolvePresetToDays(
  datePreset: DatePreset,
  customRange: CustomDateRange | undefined,
  todayUtc: Date = startOfTodayUtc(),
): string[] | null {
  if (datePreset === "maximum") return null;

  if (datePreset === "custom") {
    if (!customRange) return null;
    return enumerateDays(customRange.since, customRange.until);
  }

  const yesterday = new Date(todayUtc);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const today = todayUtc;
  switch (datePreset) {
    case "today":
      return [isoDate(today)];
    case "yesterday":
      return [isoDate(yesterday)];
    case "last_3d":
      return enumerateDaysFromOffsets(today, 3);
    case "last_7d":
      return enumerateDaysFromOffsets(today, 7);
    case "last_14d":
      return enumerateDaysFromOffsets(today, 14);
    case "last_30d":
      return enumerateDaysFromOffsets(today, 30);
    case "this_month": {
      const start = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
      );
      return enumerateDays(isoDate(start), isoDate(today));
    }
  }
}

/**
 * Build `last_Nd` window: today - (N - 1)…today inclusive. Matches
 * Meta's interpretation of `last_7d` (7 calendar days ending
 * today, NOT 7 days ending yesterday).
 */
function enumerateDaysFromOffsets(today: Date, days: number): string[] {
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  return enumerateDays(isoDate(since), isoDate(today));
}

function enumerateDays(since: string, until: string): string[] {
  const start = parseIsoDate(since);
  const end = parseIsoDate(until);
  if (!start || !end || start > end) return [];
  const out: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    out.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseIsoDate(raw: string): Date | null {
  if (typeof raw !== "string") return null;
  const m = ISO_DATE_RE.exec(raw);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() !== Number(mo) - 1 ||
    dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return dt;
}

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
