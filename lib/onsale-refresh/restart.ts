/**
 * Propose again (#1229 verdict, item 1): after a stop notice, restart that
 * rule for the event's client. Its track record counts again from that
 * day (earlier outcomes stay stored, and stop counting) and its rejection
 * streak clears (track-record.ts computeTrackRecords). Who and when are
 * stored on onsale_refresh_rule_restarts (migration 241). No Meta write.
 *
 * The caller has checked the event's owner (the refresh routes'
 * ownedRefreshEvent). `db` is the service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { RULE_LABEL, trackKey } from "./track-record.ts";

type Db = Pick<SupabaseClient, "from">;

export type RestartResult = { ok: true; restartedAt: string } | { ok: false; status: number; error: string };

export function isKnownRule(ruleId: unknown): ruleId is string {
  return typeof ruleId === "string" && Object.hasOwn(RULE_LABEL, ruleId);
}

export async function proposeAgain(args: { db: Db; userId: string; eventId: string; clientId: string | null; ruleId: unknown; now: Date }): Promise<RestartResult> {
  if (!isKnownRule(args.ruleId)) return { ok: false, status: 400, error: "Unknown rule." };
  const restartedAt = args.now.toISOString();
  const { error } = await args.db
    .from("onsale_refresh_rule_restarts")
    .insert({ user_id: args.userId, client_id: args.clientId, rule_id: args.ruleId, event_id: args.eventId, restarted_by: args.userId, restarted_at: restartedAt });
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, restartedAt };
}

/**
 * A stored proposal's stop notices, less those whose rule was restarted
 * for the client after the proposal was made: the next run proposes it
 * again, so the notice no longer stands.
 */
export function standingStops<T extends { ruleId: string }>(stopped: readonly T[] | undefined, clientId: string | null, createdAt: string, restarts: ReadonlyMap<string, string>): T[] {
  return (stopped ?? []).filter((row) => {
    const at = restarts.get(trackKey(clientId, row.ruleId));
    return !at || at <= createdAt;
  });
}
