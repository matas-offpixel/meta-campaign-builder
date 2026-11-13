/**
 * Accept and Reject (R4, HR5): a toggle pair per line.
 *
 * Accept on a To review or Rejected line accepts it; Accept on an Accepted
 * line takes it back to To review. Reject needs one of the four reasons
 * (Too early · Wrong creative · Claim not right · Other, with optional
 * text); Reject on a Rejected line with no reason takes it back. Nothing
 * here writes to Meta: Apply accepted (n) is the only write, and only for
 * creative lines (P2).
 *
 * Decisions are only taken while the event is Live (the global gate and
 * the arm): in Shadow the panel draws Accept and Reject disabled, and the
 * route refuses them too. A line that adds spend can't be accepted until
 * the event has a budget (R5); a line on a campaign that isn't one of
 * this event's drafts can't be accepted at all.
 *
 * The caller has checked the event's owner. `db` is the service role.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ApplyGates } from "./apply-gates.ts";
import { NOT_APPLIED_YET, REJECT_REASONS, acceptable, isRejectReason, type RejectReason } from "./line-states.ts";
import type { LineKind } from "./rules.ts";

type Db = Pick<SupabaseClient, "from">;

export type Decision = { decision: "accept" } | { decision: "reject"; reason?: RejectReason | null; note?: string | null };

export type DecideResult =
  | { ok: true; line: { id: string; state: "to_review" | "accepted" | "rejected"; reason: string | null } }
  | { ok: false; status: number; error: string };

export const SHADOW_REFUSAL = "Shadow: nothing here can be applied yet.";
export const SPEND_NEEDS_BUDGET = "Adds spend: set this event's budget to accept this.";

type LineRow = {
  id: string;
  kind: string;
  state: string;
  supply: boolean;
  adds_spend: boolean;
  blocked_reason: string | null;
  proposal_id: string;
  onsale_refresh_proposals: { event_id: string } | null;
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

export async function decideLine(args: { db: Db; eventId: string; userId: string; lineId: string; decision: Decision; gates: ApplyGates; budgetSet: boolean; now?: Date }): Promise<DecideResult> {
  if (args.gates.mode !== "live") return { ok: false, status: 409, error: SHADOW_REFUSAL };
  const found = await args.db
    .from("onsale_refresh_lines")
    .select("id, kind, state, supply, adds_spend, blocked_reason, proposal_id, onsale_refresh_proposals!inner(event_id)")
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
      // P2 writes creatives only: an audience or budget line can be rejected, not accepted, until P3.
      if (!acceptable(line.kind as LineKind)) return { ok: false, status: 409, error: NOT_APPLIED_YET };
      const blocked = liveBlockedReason(line, args.budgetSet);
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
