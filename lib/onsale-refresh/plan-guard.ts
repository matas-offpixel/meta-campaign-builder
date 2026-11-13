/**
 * R5's guardrails, shared by the panel's read, Accept and Apply (P3):
 *
 * - The plan is the event's marketing budget minus its spend to date.
 * - Only lines that turn delivery on or raise a budget add spend (the
 *   design ruling on #1220): a bring-back, a new ad set, a budget raise.
 *   They need a budget, and the spend they'd add must fit in the plan. A
 *   bring-back's spend is its own recent daily spend (its last 7 days of
 *   delivery, from the proposal's evidence) for each day left to the show.
 *   An add, a pause and a drop add none.
 * - A move is zero-sum inside its campaign but is capped: at most 20 % of
 *   the remaining budget moves in one refresh, counting the moves already
 *   applied for the event in that refresh (every campaign's proposal for
 *   the same window) — a new ad set funded by a move counts a week of it.
 *
 * Pure apart from `spendToDate`, which pages the event's rollups.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { addsSpend } from "./line-states.ts";
import { loadAll } from "./load.ts";

type Db = Pick<SupabaseClient, "from">;

export const MOVE_CAP_SHARE = 0.2;

export const SPEND_NEEDS_BUDGET = "Adds spend: set this event's budget to accept this.";
export const MOVE_NEEDS_BUDGET = "Moves need the event's budget to size the cap: set this event's budget to accept this.";

const gbp = (value: number) => `£${value.toFixed(2)}`;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** The event's spend to date, Meta, from its daily rollups (paged, unique-key order, deduped). */
export async function spendToDate(db: Db, eventId: string): Promise<number> {
  const rows = await loadAll<{ event_id: string; date: string; ad_spend: number | string | null }>(db, "event_daily_rollups", "event_id, date, ad_spend", ["event_id", "date"], (q) => q.eq("event_id", eventId));
  return rows.reduce((sum, row) => sum + num(row.ad_spend), 0);
}

export function remainingPlan(budget: number | null, spend: number): number | null {
  return budget == null ? null : Math.max(0, budget - spend);
}

/** Days of delivery left before the show: from `today` to the day before the event, at least 0. */
export function daysToShow(today: string, eventDate: string | null | undefined): number {
  const show = eventDate?.slice(0, 10);
  if (!show) return 0;
  return Math.max(0, Math.round((Date.parse(`${show}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000));
}

/**
 * The plan guard for a line that adds spend. `projected` is what it would
 * spend before the show (null when the line can't say). A line that adds
 * no spend always passes.
 */
export function planGuard(kind: string, budget: number | null, spend: number, projected: number | null = null): string | null {
  if (!addsSpend(kind)) return null;
  if (budget == null) return "Set this event's budget to apply this.";
  if (spend >= budget) return `This event has spent its budget (${gbp(spend)} of ${gbp(budget)}), so nothing new goes live.`;
  const left = budget - spend;
  if (projected != null && projected > left) return `Turning it on would spend about ${gbp(projected)} before the show, more than the ${gbp(left)} left in the plan.`;
  return null;
}

/** A bring-back's spend before the show: its recent daily spend × the days left. Null when the evidence has no daily figure. */
export function projectedSpend(evidence: Record<string, unknown> | null | undefined, today: string, eventDate: string | null | undefined): number | null {
  const daily = Number(evidence?.dailySpend);
  if (!Number.isFinite(daily) || daily <= 0) return null;
  return Math.round(daily * daysToShow(today, eventDate) * 100) / 100;
}

/** The 20 % cap (R5): the amount still movable this refresh, after the moves already applied for the event in it. */
export function moveCapLeft(budget: number | null, spend: number, appliedMovesGbp: number): { cap: number; left: number } | null {
  const remaining = remainingPlan(budget, spend);
  if (remaining == null) return null;
  const cap = Math.round(remaining * MOVE_CAP_SHARE * 100) / 100;
  return { cap, left: Math.max(0, Math.round((cap - appliedMovesGbp) * 100) / 100) };
}

export function moveCapText(amount: number, cap: { cap: number; left: number }, remaining: number): string {
  return `Moving ${gbp(amount)} would pass this refresh's 20 % cap: ${gbp(cap.cap)} of the ${gbp(remaining)} left, ${gbp(cap.left)} still free.`;
}

/** The block a move line shows and Accept / Apply enforce. */
export function moveGuard(amount: number, budget: number | null, spend: number, appliedMovesGbp: number): string | null {
  const cap = moveCapLeft(budget, spend, appliedMovesGbp);
  if (!cap) return MOVE_NEEDS_BUDGET;
  if (amount > cap.left + 0.005) return moveCapText(amount, cap, remainingPlan(budget, spend)!);
  return null;
}

/**
 * The block a spend line shows before Accept: the budget sentence when
 * there is none, else the plan guard on its projected spend.
 */
export function spendLineBlock(line: { kind: string; evidence?: Record<string, unknown> | null }, ctx: { budget: number | null; spend: number; today: string; eventDate: string | null }): string | null {
  if (!addsSpend(line.kind)) return null;
  if (ctx.budget == null) return SPEND_NEEDS_BUDGET;
  return planGuard(line.kind, ctx.budget, ctx.spend, projectedSpend(line.evidence, ctx.today, ctx.eventDate));
}

/**
 * The moves already applied for the event in this refresh: every move line
 * applied (or being applied) on a proposal for the same window. `except`
 * leaves the line being decided out.
 */
export async function appliedMovesGbp(db: Db, eventId: string, windowEnd: string, except?: string): Promise<number> {
  const proposals = await db.from("onsale_refresh_proposals").select("id").eq("event_id", eventId).eq("window_end", windowEnd);
  if (proposals.error) throw new Error(`onsale_refresh_proposals: ${proposals.error.message}`);
  const ids = ((proposals.data ?? []) as { id: string }[]).map((row) => row.id);
  if (!ids.length) return 0;
  const lines = await db.from("onsale_refresh_lines").select("id, kind, write, applied_result").in("proposal_id", ids).in("kind", ["move_budget", "bring_back_audience", "missing_default"]).in("state", ["applying", "applied"]);
  if (lines.error) throw new Error(`onsale_refresh_lines moves: ${lines.error.message}`);
  return ((lines.data ?? []) as { id: string; kind: string; write: { amountGbp?: number } | null; applied_result: { movedWeeklyGbp?: number } | null }[])
    .filter((row) => row.id !== except)
    .reduce((sum, row) => sum + (row.kind === "move_budget" ? num(row.write?.amountGbp) : num(row.applied_result?.movedWeeklyGbp)), 0);
}
