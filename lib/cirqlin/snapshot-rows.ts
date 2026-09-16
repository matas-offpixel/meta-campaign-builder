/**
 * lib/cirqlin/snapshot-rows.ts
 *
 * Pure mapping from a Cirqlin partner payload to the rows
 * `signup_source_snapshots` stores. Kept out of the server-only sync
 * module so `node --test` can load it.
 */

import type { CirqlinSignupsPayload } from "./types.ts";

export interface CirqlinSnapshotInsert {
  event_id: string;
  source: "cirqlin";
  day: string;
  signups_day: number;
  signups_total: number;
  raw_json: Record<string, unknown>;
  snapshot_at: string;
}

/**
 * `daily_timezone` is not one of the fields `isCirqlinSignupsPayload`
 * checks, and `Intl` throws on a zone it does not know. Fall back to
 * the UTC date rather than throwing out of a pure mapper.
 */
export function calendarDayIn(zone: string | undefined, at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return at.slice(0, 10);
  if (!zone) return new Date(ms).toISOString().slice(0, 10);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function buildCirqlinSnapshotRows(
  eventId: string,
  payload: CirqlinSignupsPayload,
): CirqlinSnapshotInsert[] {
  const capturedAt = payload.capturedAt || new Date().toISOString();
  // `multiple` and `daily_timezone` are persisted so a multi-page total
  // and a non-London bucketing are both readable off the row itself.
  const sharedRaw = {
    tag: payload.tag,
    pages: payload.pages,
    multiple: payload.multiple,
    totals: payload.totals,
    daily_timezone: payload.daily_timezone,
    sync: payload.sync,
    capturedAt: payload.capturedAt,
  };

  if (payload.daily.length === 0) {
    const today = calendarDayIn(payload.daily_timezone, capturedAt);
    return [
      {
        event_id: eventId,
        source: "cirqlin",
        day: today,
        signups_day: 0,
        signups_total: payload.totals.counted,
        raw_json: sharedRaw,
        snapshot_at: capturedAt,
      },
    ];
  }

  return payload.daily.map((day) => ({
    event_id: eventId,
    source: "cirqlin",
    day: day.day,
    signups_day: day.signups,
    signups_total: payload.totals.counted,
    raw_json: { ...sharedRaw, day: day.day, signups_day: day.signups },
    snapshot_at: capturedAt,
  }));
}
