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

export function buildCirqlinSnapshotRows(
  eventId: string,
  payload: CirqlinSignupsPayload,
): CirqlinSnapshotInsert[] {
  const capturedAt = payload.capturedAt || new Date().toISOString();
  const sharedRaw = {
    tag: payload.tag,
    page: payload.page,
    totals: payload.totals,
    sync: payload.sync,
    capturedAt: payload.capturedAt,
  };

  if (payload.daily.length === 0) {
    const today = capturedAt.slice(0, 10);
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
