/**
 * RT17's call, applied (docs/design-record/2026-11-17-retargeting-campaign-2.html):
 * one line for Matas, on the Retargeting panel of every show in the test.
 * Accepting it once applies to all:
 *   - the losing arm's campaign pauses on every show;
 *   - each show's Meta A/B test ends;
 *   - each winning arm takes its show's whole total, split by its tiers'
 *     budgets (RT11's split by room needs each tier's room, which the read
 *     gives once the daily figures land; without it the split is by budget
 *     alone and nothing is held back);
 *   - new shows start on the winner (the runner reads the applied line).
 * "No clear winner after 28 days" keeps A: B pauses, A takes the total.
 *
 * Every write goes through meta_write_idempotency on that show's draft:
 * refresh_campaign_status_update, retargeting_study_end (migration 259),
 * refresh_adset_budget_update. Behind the gates the line needs (the
 * deployment's apply gate, campaign create and budget writes).
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { callApplied, type Arm, type Tier } from "./words.ts";

export type CallShow = {
  eventId: string;
  code: string;
  /** The show's draft (the ledger's key); a show without one isn't in the call's write. */
  draftId: string;
  studyId: string | null;
  campaigns: Record<Arm, string | null>;
  /** Each arm's tier ad sets and their budgets now (pence). */
  adSets: Record<Arm, Partial<Record<Tier, { id: string; dailyMinor: number }>>>;
  /** The show's whole total a day (both arms), pence. */
  totalMinor: number;
};

export type CallWrite = { kind: "retargeting_test_call"; callKey: string; winner: Arm; shows: CallShow[] };

export type CallMeta = {
  updateCampaign(campaignId: string, params: Record<string, unknown>): Promise<void>;
  /** POST /{study_id} { end_time: now }. */
  endAdStudy(studyId: string): Promise<void>;
  updateAdSetDailyBudget(adsetId: string, dailyMinor: number): Promise<void>;
};

/** The winning arm's tiers scaled to the show's whole total, in proportion to their budgets, to the penny (any remainder to the hottest tier). */
export function takeWholeTotal(tiers: Partial<Record<Tier, { id: string; dailyMinor: number }>>, totalMinor: number): { id: string; tier: Tier; before: number; after: number }[] {
  const order: Tier[] = ["bottom", "mid_bottom", "mid"];
  const rows = order.flatMap((tier) => (tiers[tier] ? [{ tier, ...tiers[tier]! }] : []));
  const sum = rows.reduce((total, row) => total + row.dailyMinor, 0);
  if (!rows.length || sum <= 0) return [];
  const out = rows.map((row) => ({ id: row.id, tier: row.tier, before: row.dailyMinor, after: Math.floor((row.dailyMinor * totalMinor) / sum) }));
  out[0]!.after += totalMinor - out.reduce((total, row) => total + row.after, 0);
  return out;
}

export async function applyTestCall(
  deps: { db: MetaWriteContext["supabase"]; meta: CallMeta; userId: string },
  line: { id: string; write: Record<string, unknown> | null },
  ctx: { plainMetaReason: (err: unknown) => string },
): Promise<{ state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> }> {
  const write = (line.write ?? {}) as unknown as CallWrite;
  if (write.kind !== "retargeting_test_call" || !write.shows?.length) return { state: "failed", reason: "The line has no shows to apply the call to.", result: {} };
  const loser: Arm = write.winner === "A" ? "B" : "A";
  const done: { eventId: string; paused: boolean; ended: boolean; budgets: number }[] = [];
  for (const show of write.shows) {
    const ledger: MetaWriteContext = { supabase: deps.db, userId: deps.userId, draftId: show.draftId, eventId: show.eventId };
    const keyBase = { line_id: line.id, event_id: show.eventId };
    const row = { eventId: show.eventId, paused: false, ended: false, budgets: 0 };
    try {
      const loserCampaign = show.campaigns[loser];
      if (loserCampaign) {
        await withMetaWriteIdempotency(ledger, "refresh_campaign_status_update", { ...keyBase, campaign_id: loserCampaign, status: "PAUSED" }, async () => {
          await deps.meta.updateCampaign(loserCampaign, { status: "PAUSED" });
          return loserCampaign;
        }, { required: true });
        row.paused = true;
      }
      if (show.studyId) {
        await withMetaWriteIdempotency(ledger, "retargeting_study_end", { ...keyBase, study_id: show.studyId }, async () => {
          await deps.meta.endAdStudy(show.studyId!);
          return show.studyId!;
        }, { required: true });
        row.ended = true;
      }
      for (const step of takeWholeTotal(show.adSets[write.winner], show.totalMinor)) {
        if (step.after === step.before) continue;
        await withMetaWriteIdempotency(ledger, "refresh_adset_budget_update", { ...keyBase, adset_id: step.id, daily_budget: step.after }, async () => {
          await deps.meta.updateAdSetDailyBudget(step.id, step.after);
          return step.id;
        }, { required: true });
        row.budgets += 1;
      }
    } catch (err) {
      done.push(row);
      return { state: "failed", reason: `${show.code}: ${ctx.plainMetaReason(err)}. Retry carries on from there.`, result: { call: { winner: write.winner, done } } };
    }
    done.push(row);
  }
  // Accepting once applies to all: the same call on every other show's panel is applied too.
  const open = await deps.db.from("onsale_refresh_lines").select("id, write").eq("kind", "retargeting_test_call").in("state", ["to_review", "accepted"]);
  const ids = ((open.data ?? []) as { id: string; write: { callKey?: string } | null }[]).filter((row) => row.id !== line.id && row.write?.callKey === write.callKey).map((row) => row.id);
  if (ids.length) {
    const others = await deps.db.from("onsale_refresh_lines").update({ state: "applied", reason: `Applied on ${write.shows.length} shows`, applied_result: { call: { winner: write.winner, done } } }).in("id", ids);
    if (others.error) console.error("[retargeting] call lines on other shows", others.error.message);
  }
  return { state: "applied", reason: callApplied(write.winner, write.shows.length), result: { call: { winner: write.winner, done } } };
}
