/**
 * R6's track record, per rule × client, and what the generator does with it.
 *
 * - A rule's hit rate is right ÷ (right + wrong); unknown never counts.
 *   It is used from 10 judged outcomes.
 * - Under 40 %: the rule's lines sort last and carry the record's words
 *   "low track record".
 * - Under 25 % over 20 judged outcomes: the rule stops proposing for that
 *   client, and the panel says so.
 * - The same reject reason 5 times in a row for a client (that rule's last
 *   five decisions) stops it the same way.
 *
 * Pure apart from `loadTrackRecords`, which pages the outcomes and the
 * decided lines. The generator reads track records only while
 * ENABLE_ONSALE_REFRESH_SCORING is "1"; with it off, proposals are
 * exactly today's.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../db/paged-read.ts";
import { REJECT_REASONS, type RejectReason } from "./line-states.ts";

type Db = Pick<SupabaseClient, "from">;

export const MIN_JUDGED = 10;
export const LOW_RATE = 0.4;
export const STOP_JUDGED = 20;
export const STOP_RATE = 0.25;
export const REJECT_STREAK = 5;

export { LOW_TRACK_RECORD } from "./track-labels.ts";

export type TrackRecord = {
  right: number;
  wrong: number;
  judged: number;
  /** right ÷ judged, null under MIN_JUDGED. */
  rate: number | null;
  state: "ok" | "low" | "stopped";
  /** Why it stopped: the hit rate, or a rejection streak. */
  stoppedBy?: "rate" | "streak";
  streakReason?: RejectReason;
};

export type TrackRecords = ReadonlyMap<string, TrackRecord>;

export const trackKey = (clientId: string | null | undefined, ruleId: string) => `${clientId ?? ""}|${ruleId}`;

type OutcomeFact = { client_id: string | null; rule_id: string; outcome: string };
type DecisionFact = { client_id: string | null; rule_id: string; state: string; reject_reason: string | null; decided_at: string | null };

/** Hit rates and states from outcomes; streaks from the decisions (most recent first). */
export function computeTrackRecords(outcomes: readonly OutcomeFact[], decisions: readonly DecisionFact[] = []): Map<string, TrackRecord> {
  const records = new Map<string, TrackRecord>();
  const get = (key: string) => {
    let record = records.get(key);
    if (!record) {
      record = { right: 0, wrong: 0, judged: 0, rate: null, state: "ok" };
      records.set(key, record);
    }
    return record;
  };
  for (const row of outcomes) {
    if (row.outcome !== "right" && row.outcome !== "wrong") continue;
    const record = get(trackKey(row.client_id, row.rule_id));
    if (row.outcome === "right") record.right += 1;
    else record.wrong += 1;
    record.judged += 1;
  }
  for (const record of records.values()) {
    if (record.judged < MIN_JUDGED) continue;
    record.rate = record.right / record.judged;
    if (record.judged >= STOP_JUDGED && record.rate < STOP_RATE) {
      record.state = "stopped";
      record.stoppedBy = "rate";
    } else if (record.rate < LOW_RATE) {
      record.state = "low";
    }
  }
  // Rejection streaks: a rule's last REJECT_STREAK decisions for a client, all rejected for the same reason.
  const byKey = new Map<string, DecisionFact[]>();
  for (const row of decisions) {
    if (!row.decided_at || !["rejected", "accepted", "applying", "applied", "failed"].includes(row.state)) continue;
    const key = trackKey(row.client_id, row.rule_id);
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }
  for (const [key, rows] of byKey) {
    const last = [...rows].sort((a, b) => (a.decided_at! < b.decided_at! ? 1 : -1)).slice(0, REJECT_STREAK);
    if (last.length < REJECT_STREAK) continue;
    const reason = last[0]!.reject_reason;
    if (!reason || !last.every((row) => row.state === "rejected" && row.reject_reason === reason)) continue;
    const record = get(key);
    if (record.state !== "stopped") {
      record.state = "stopped";
      record.stoppedBy = "streak";
      record.streakReason = reason as RejectReason;
    }
  }
  return records;
}

/** Plain names for the rules, for the stop notice. */
export const RULE_LABEL: Record<string, string> = {
  "pause.significant_bottom_third": "Pause creative",
  "add.cycle_folder": "Add creative",
  "bring_back.stopped_ad_set": "Bring back an ad set",
  "bring_back.client_cluster": "Bring back an interest cluster",
  "drop.over_cost": "Drop an audience",
  "move.within_campaign": "Move budget",
  "missing_default.retargeting": "Retargeting default",
  "missing_default.registrations_lookalike": "Registrations lookalike default",
};

/**
 * The stop notice (proposed words — the record says only that the panel
 * tells Matas; listed in the PR body for design).
 */
export function stoppedText(ruleId: string, record: TrackRecord): string {
  const rule = RULE_LABEL[ruleId] ?? ruleId;
  if (record.stoppedBy === "streak" && record.streakReason) return `${rule} stopped for this client: rejected as “${REJECT_REASONS[record.streakReason]}” ${REJECT_STREAK} times in a row.`;
  return `${rule} stopped for this client: right ${record.right} of ${record.judged} times.`;
}

/** Every outcome and every decided line, for the track records. Paged, unique-key order, deduped. */
export async function loadTrackRecords(db: Db): Promise<Map<string, TrackRecord>> {
  const [outcomes, lines, proposals, events] = await Promise.all([
    loadAllPaged<OutcomeFact & { line_id: string }>(db as never, "onsale_refresh_outcomes", "line_id, client_id, rule_id, outcome", ["line_id"]),
    loadAllPaged<{ id: string; proposal_id: string; rule_id: string; state: string; reject_reason: string | null; decided_at: string | null }>(db as never, "onsale_refresh_lines", "id, proposal_id, rule_id, state, reject_reason, decided_at", ["id"], (q) => q.not("decided_at", "is", null)),
    loadAllPaged<{ id: string; event_id: string }>(db as never, "onsale_refresh_proposals", "id, event_id", ["id"]),
    loadAllPaged<{ id: string; client_id: string | null }>(db as never, "events", "id, client_id", ["id"], (q) => q.not("client_id", "is", null)),
  ]);
  const eventOf = new Map(proposals.map((row) => [row.id, row.event_id]));
  const clientOf = new Map(events.map((row) => [row.id, row.client_id]));
  const decisions = lines.map((row) => ({ client_id: clientOf.get(eventOf.get(row.proposal_id) ?? "") ?? null, rule_id: row.rule_id, state: row.state, reject_reason: row.reject_reason, decided_at: row.decided_at }));
  return computeTrackRecords(outcomes, decisions);
}
