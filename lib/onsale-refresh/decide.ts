/**
 * Accept and Reject (R4, HR5): a toggle pair per line.
 *
 * Accept on a To review or Rejected line accepts it; Accept on an Accepted
 * line takes it back to To review. Reject needs one of the four reasons
 * (Too early · Wrong creative · Claim not right · Other, with optional
 * text); Reject on a Rejected line with no reason takes it back. Nothing
 * here writes to Meta: Apply accepted (n) is the only write.
 *
 * Decisions are only taken while the event is Live (the global gate and
 * the arm): in Shadow the panel draws Accept and Reject disabled, and the
 * route refuses them too. Accept is refused (`acceptBlock`, the same check
 * the panel draws) for:
 *  - a line Apply can't write yet (a new ad set);
 *  - a campaign that isn't one of this event's drafts, or an add with no copy;
 *  - a spend line without a budget, or whose spend before the show is
 *    more than the plan has left (R5);
 *  - a drop of retargeting, or of the last ad set delivering;
 *  - a move past the refresh's 20 % cap, counting the moves already applied.
 *
 * The caller has checked the event's owner. `db` is the service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApplyGates } from "./apply-gates.ts";
import { REJECT_REASONS, heldText, isRejectReason, type RejectReason } from "./line-states.ts";
import { NO_BUDGET_TO_START, decideFunding, type Giver } from "./new-adset.ts";
import { MOVE_NEEDS_BUDGET, SPEND_NEEDS_BUDGET, appliedMovesGbp, moveGuard, spendLineBlock, spendToDate } from "./plan-guard.ts";
import { RETARGETING, type LineKind } from "./rules.ts";
import { todayLondon } from "./schedule.ts";

export { SPEND_NEEDS_BUDGET };

/** Never retargeting (R2, R5). */
export const RETARGETING_STAYS = "Retargeting stays on: it's never dropped.";
/** Never the last ad set (R2, R5). */
export const LAST_ADSET_STAYS = "It's the last ad set delivering in this campaign, so it stays on.";

export type BlockCtx = {
  budget: number | null;
  spend: number;
  today: string;
  eventDate: string | null;
  /** Moves already applied for the event in this refresh (other lines). */
  appliedMovesGbp: number;
  /** Other drops on this proposal, accepted, applying or applied. */
  otherDrops: number;
};

type BlockLine = {
  kind: string;
  title: string;
  supply?: boolean;
  adds_spend: boolean;
  blocked_reason: string | null;
  evidence?: Record<string, unknown> | null;
  write?: Record<string, unknown> | null;
};

/** Why Accept is held on a line now, or null. The panel draws it; decideLine enforces it. */
export function acceptBlock(line: BlockLine, ctx: BlockCtx): string | null {
  const writeKind = typeof line.write?.kind === "string" ? line.write.kind : null;
  const held = heldText({ kind: line.kind as LineKind, writeKind, supply: line.supply });
  if (held) return held;
  // Blocks the proposal stored that aren't about the budget (not this event's draft, no copy, seed too small) stand.
  if (line.blocked_reason && line.blocked_reason !== SPEND_NEEDS_BUDGET && line.blocked_reason !== MOVE_NEEDS_BUDGET && line.blocked_reason !== NO_BUDGET_TO_START) return line.blocked_reason;
  // P3: a new ad set's money, read live (design's ruling): CBO shares the campaign budget; ABO needs headroom or a move inside the cap.
  if (writeKind === "new_adset") {
    const copy = line.write?.copyFrom as { dailyGbp?: number } | null | undefined;
    const level = line.write?.budgetLevel === "campaign" ? "campaign" : line.write?.budgetLevel === "ad_set" ? "ad_set" : null;
    const funding = decideFunding({ budgetLevel: level, dailyGbp: Number(copy?.dailyGbp) || 0, budget: ctx.budget, spend: ctx.spend, today: ctx.today, eventDate: ctx.eventDate, appliedMovesGbp: ctx.appliedMovesGbp, giver: (line.write?.giver as Giver | null | undefined) ?? null });
    return funding.mode === "none" ? NO_BUDGET_TO_START : null;
  }
  if (line.adds_spend) return spendLineBlock({ kind: line.kind, evidence: line.evidence }, ctx);
  if (line.kind === "drop_audience") {
    if (RETARGETING.test(line.title)) return RETARGETING_STAYS;
    const delivering = Number(line.evidence?.deliveringAdSets);
    if (Number.isFinite(delivering) && delivering - ctx.otherDrops <= 1) return LAST_ADSET_STAYS;
    return null;
  }
  if (line.kind === "move_budget") return moveGuard(Number(line.write?.amountGbp) || 0, ctx.budget, ctx.spend, ctx.appliedMovesGbp);
  return null;
}

type Db = Pick<SupabaseClient, "from">;

export type Decision = { decision: "accept" } | { decision: "reject"; reason?: RejectReason | null; note?: string | null };

export type DecideResult =
  | { ok: true; line: { id: string; state: "to_review" | "accepted" | "rejected"; reason: string | null } }
  | { ok: false; status: number; error: string };

export const SHADOW_REFUSAL = "Shadow: nothing here can be applied yet.";

type LineRow = {
  id: string;
  kind: string;
  title: string;
  state: string;
  supply: boolean;
  adds_spend: boolean;
  blocked_reason: string | null;
  evidence: Record<string, unknown> | null;
  write: Record<string, unknown> | null;
  proposal_id: string;
  onsale_refresh_proposals: { event_id: string; window_end?: string | null } | null;
};

/** The words a Rejected line shows: the reason, and the note after "Other". */
export function rejectText(reason: RejectReason, note: string | null | undefined): string {
  const trimmed = note?.trim().slice(0, 200) ?? "";
  return reason === "other" && trimmed ? `Other — ${trimmed}` : REJECT_REASONS[reason];
}

/**
 * R5 at read and decide time: the stored budget sentence is the
 * proposal's; once the event has a budget, a spend line is no longer
 * blocked by it. Other blocks (not this event's draft, no copy) stand.
 */
export function liveBlockedReason(line: { adds_spend: boolean; blocked_reason: string | null }, budgetSet: boolean): string | null {
  if (line.adds_spend) return budgetSet ? (line.blocked_reason === SPEND_NEEDS_BUDGET ? null : line.blocked_reason) : SPEND_NEEDS_BUDGET;
  return line.blocked_reason;
}

/** The live context Accept checks a line against: the plan, the refresh's applied moves, the proposal's other drops. */
export async function blockCtx(db: Db, line: Pick<LineRow, "id" | "kind" | "adds_spend" | "proposal_id" | "write"> & { window_end?: string | null }, args: { eventId: string; budget: number | null; eventDate: string | null; today: string }): Promise<BlockCtx> {
  const newSet = line.kind === "missing_default" || (line as { write?: Record<string, unknown> | null }).write?.kind === "new_adset";
  const needsSpend = line.adds_spend || line.kind === "move_budget" || newSet;
  const spend = needsSpend && args.budget != null ? await spendToDate(db, args.eventId) : 0;
  const moved = (line.kind === "move_budget" || newSet) && line.window_end ? await appliedMovesGbp(db, args.eventId, line.window_end, line.id) : 0;
  let otherDrops = 0;
  if (line.kind === "drop_audience") {
    const drops = await db.from("onsale_refresh_lines").select("id").eq("proposal_id", line.proposal_id).eq("kind", "drop_audience").in("state", ["accepted", "applying", "applied"]).neq("id", line.id);
    if (drops.error) throw new Error(`onsale_refresh_lines drops: ${drops.error.message}`);
    otherDrops = ((drops.data ?? []) as unknown[]).length;
  }
  return { budget: args.budget, spend, today: args.today, eventDate: args.eventDate, appliedMovesGbp: moved, otherDrops };
}

export async function decideLine(args: { db: Db; eventId: string; userId: string; lineId: string; decision: Decision; gates: ApplyGates; budget: number | null; eventDate: string | null; now?: Date }): Promise<DecideResult> {
  if (args.gates.mode !== "live") return { ok: false, status: 409, error: SHADOW_REFUSAL };
  const found = await args.db
    .from("onsale_refresh_lines")
    .select("id, kind, title, state, supply, adds_spend, blocked_reason, evidence, write, proposal_id, onsale_refresh_proposals!inner(event_id, window_end)")
    .eq("id", args.lineId)
    .maybeSingle();
  if (found.error) return { ok: false, status: 500, error: found.error.message };
  const line = found.data as LineRow | null;
  if (!line || line.onsale_refresh_proposals?.event_id !== args.eventId) return { ok: false, status: 404, error: "No such line on this event." };
  if (line.supply) return { ok: false, status: 400, error: "A claim line is made in the Lab, not accepted here." };
  if (!["to_review", "accepted", "rejected"].includes(line.state)) return { ok: false, status: 409, error: "This line has already been applied or has expired." };

  let next: { state: "to_review" | "accepted" | "rejected"; reason: string | null; reject_reason: RejectReason | null; reject_note: string | null };
  if (args.decision.decision === "accept") {
    if (line.state === "accepted") {
      next = { state: "to_review", reason: null, reject_reason: null, reject_note: null };
    } else {
      const ctx = await blockCtx(args.db, { ...line, window_end: line.onsale_refresh_proposals?.window_end ?? null }, { eventId: args.eventId, budget: args.budget, eventDate: args.eventDate, today: todayLondon(args.now ?? new Date()) });
      const blocked = acceptBlock(line, ctx);
      if (blocked) return { ok: false, status: 409, error: blocked };
      next = { state: "accepted", reason: null, reject_reason: null, reject_note: null };
    }
  } else {
    const reason = args.decision.reason ?? null;
    if (line.state === "rejected" && !reason) {
      next = { state: "to_review", reason: null, reject_reason: null, reject_note: null };
    } else {
      if (!isRejectReason(reason)) return { ok: false, status: 400, error: "Pick a reason: Too early, Wrong creative, Claim not right or Other." };
      const note = args.decision.note?.trim().slice(0, 200) || null;
      next = { state: "rejected", reason: rejectText(reason, note), reject_reason: reason, reject_note: note };
    }
  }
  const decidedAt = (args.now ?? new Date()).toISOString();
  // Only from the state read above: a click racing an Apply finds the line gone from under it and changes nothing.
  const updated = await args.db
    .from("onsale_refresh_lines")
    .update({ ...next, decided_by: next.state === "to_review" ? null : args.userId, decided_at: next.state === "to_review" ? null : decidedAt })
    .eq("id", line.id)
    .eq("state", line.state)
    .select("id");
  if (updated.error) return { ok: false, status: 500, error: updated.error.message };
  if (!((updated.data ?? []) as unknown[]).length) return { ok: false, status: 409, error: "The line changed while you clicked. Reload to see it." };
  return { ok: true, line: { id: line.id, state: next.state, reason: next.reason } };
}
