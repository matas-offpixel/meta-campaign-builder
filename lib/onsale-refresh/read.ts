/**
 * What the Refresh panel reads: the latest proposal per campaign of an
 * event with its lines, in panel order, plus (P2) the lines of earlier
 * proposals a decision or a write is still waiting on (Accepted,
 * Applying, Failed), and the event's arm. Reads only; the session
 * client's RLS (owner) applies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyGates, type ArmMode } from "./apply-gates.ts";
import { acceptBlock, liveBlockedReason, type BlockCtx } from "./decide.ts";
import { displayState, type LineState } from "./line-states.ts";
import { spendToDate } from "./plan-guard.ts";
import type { AddCopy, LineKind, Proposal, WatchItem } from "./rules.ts";
import { nextCycleAfter, todayLondon, weekLabel, type CycleKind, type RunKind } from "./schedule.ts";

type Db = Pick<SupabaseClient, "from">;

export type PanelLine = {
  id: string;
  kind: LineKind;
  title: string;
  detail: string;
  writeText: string;
  /** F2's wording at 393. */
  narrow: { detail: string; writeText: string | null };
  addsSpend: boolean;
  blockedReason: string | null;
  supply: boolean;
  state: LineState;
  reason: string | null;
  /** P2: an add line's copy, shown before Accept. Absent on other kinds and on P1 lines. */
  copy?: Pick<AddCopy, "primaryText" | "headline" | "cta" | "destinationUrl"> | null;
  /** P2: a line carried from an earlier proposal: its week ("w/c 9 Nov"). */
  carried?: string | null;
  /** P2: when Apply wrote it (ISO). */
  appliedAt?: string | null;
  /** P2: who clicked Apply: a first name or an email's local part, never a full email. */
  appliedBy?: string | null;
  /** P3: the write it would make (`write.kind`). */
  writeKind?: string | null;
  /** P3: a new ad set's second evidence line (a cluster's interests, a default's sources or seed). */
  extra?: string | null;
};

/** The panel's gates (R4): live only with the deployment gate and the event's arm. */
export type PanelApply = {
  mode: ArmMode;
  arm: ArmMode;
  globalEnabled: boolean;
  pauseWritesEnabled: boolean;
  /** P3: Bring back and Drop's own gate. */
  adsetStatusWritesEnabled?: boolean;
  /** P3: a move's own gate (the optimisation budget write). */
  budgetWritesEnabled?: boolean;
  /** P3: a standing default's audience gate. */
  audienceWritesEnabled?: boolean;
  budgetSet: boolean;
};

/** P3: the plan the panel checks each line against (R5), read live. */
export type PanelPlan = { budget: number | null; spend: number; today: string; eventDate: string | null };

export type PanelProposal = {
  id: string;
  campaignKey: string;
  campaignSummary: string | null;
  runKind: RunKind;
  runDay: string;
  cycleMonday: string;
  cycleKind: CycleKind;
  windowStart: string;
  windowEnd: string;
  mode: "shadow" | "live";
  objective: string;
  why: Proposal["why"];
  blockers: Proposal["blockers"];
  enoughData: boolean;
  notEnoughData: string | null;
  nextCheck: string | null;
  nextCycle: string | null;
  nextCycleKind: CycleKind | null;
  watch: { creatives: WatchItem[]; audiences: WatchItem[] };
  notes: Proposal["notes"];
  lines: PanelLine[];
  createdAt: string;
};

type ProposalRow = {
  id: string;
  campaign_key: string;
  campaign_summary: string | null;
  run_kind: RunKind;
  run_day: string;
  cycle_monday: string;
  cycle_kind: CycleKind;
  window_start: string;
  window_end: string;
  mode: "shadow" | "live";
  objective: string;
  why: Proposal["why"] | null;
  blockers: Proposal["blockers"] | null;
  enough_data: boolean;
  not_enough_data: string | null;
  next_check: string | null;
  watch: PanelProposal["watch"] | null;
  notes: PanelProposal["notes"] | null;
  created_at: string;
};

type LineRow = Omit<PanelLine, "writeText" | "addsSpend" | "blockedReason" | "narrow" | "copy" | "carried" | "appliedAt"> & { proposal_id: string; position: number; write_text: string; narrow: PanelLine["narrow"] | null; adds_spend: boolean; blocked_reason: string | null; target?: { copy?: AddCopy | null; extra?: string | null } | null; applied_at?: string | null; applied_result?: { appliedBy?: string | null; movedWeeklyGbp?: number } | null; evidence?: Record<string, unknown> | null; write?: Record<string, unknown> | null };

const CARRIED: readonly LineState[] = ["accepted", "applying", "failed"];

function panelLine(line: LineRow, budgetSet: boolean | null, carried: string | null, ctx: BlockCtx | null = null): PanelLine {
  const writeKind = typeof line.write?.kind === "string" ? line.write.kind : null;
  const copy = line.kind === "add_creative" && line.target?.copy ? { primaryText: line.target.copy.primaryText, headline: line.target.copy.headline, cta: line.target.copy.cta, destinationUrl: line.target.copy.destinationUrl } : null;
  return {
    id: line.id,
    kind: line.kind,
    title: line.title,
    detail: line.detail,
    writeText: line.write_text,
    narrow: line.narrow?.detail != null ? line.narrow : { detail: line.detail, writeText: line.write_text },
    addsSpend: line.adds_spend,
    // R5: the stored budget sentence was the proposal's; the event's budget now decides it.
    // P3: with the plan, the same check Accept enforces (held, plan guard, last ad set, retargeting, the 20 % cap).
    blockedReason: ctx ? acceptBlock(line, ctx) : budgetSet == null ? line.blocked_reason : liveBlockedReason(line, budgetSet),
    supply: line.supply,
    // P2: an audience or budget line stored as Accepted reads To review until P3 can apply it.
    state: budgetSet == null ? line.state : displayState({ kind: line.kind, state: line.state, writeKind }),
    reason: line.reason,
    ...(copy ? { copy } : {}),
    ...(carried ? { carried } : {}),
    ...(line.applied_at ? { appliedAt: line.applied_at } : {}),
    ...(line.applied_result?.appliedBy && !line.applied_result.appliedBy.includes("@") ? { appliedBy: line.applied_result.appliedBy } : {}),
    ...(writeKind ? { writeKind } : {}),
    ...(line.target?.extra ? { extra: line.target.extra } : {}),
  };
}

/**
 * The latest proposal of each campaign on the event (F10: by window end,
 * then by creation), newest window first. With `budgetSet` (P2), a spend
 * line's block follows the event's budget now, and the earlier
 * proposals' Accepted, Applying and Failed lines are carried under the
 * latest one, marked with their week.
 */
export async function loadEventProposals(db: Db, eventId: string, opts: { budgetSet?: boolean; plan?: PanelPlan } = {}): Promise<PanelProposal[]> {
  const { data, error } = await db
    .from("onsale_refresh_proposals")
    .select("id, campaign_key, campaign_summary, run_kind, run_day, cycle_monday, cycle_kind, window_start, window_end, mode, objective, why, blockers, enough_data, not_enough_data, next_check, watch, notes, created_at")
    .eq("event_id", eventId)
    .order("window_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`onsale_refresh_proposals: ${error.message}`);
  const all = (data ?? []) as ProposalRow[];
  const latest = new Map<string, ProposalRow>();
  for (const row of all) if (!latest.has(row.campaign_key)) latest.set(row.campaign_key, row);
  const rows = [...latest.values()];
  if (!rows.length) return [];
  const p2 = opts.budgetSet != null;
  // P2: earlier proposals of the same campaign, for the lines still waiting on a decision's write.
  const earlier = p2 ? all.filter((row) => latest.get(row.campaign_key)?.id !== row.id) : [];
  const ids = [...rows, ...earlier].map((row) => row.id);
  const lines = await db
    .from("onsale_refresh_lines")
    .select(`id, proposal_id, position, kind, title, detail, write_text, narrow, adds_spend, blocked_reason, supply, state, reason${p2 ? ", target, applied_at, applied_result, evidence, write" : ""}`)
    .in("proposal_id", ids)
    .order("position", { ascending: true });
  if (lines.error) throw new Error(`onsale_refresh_lines: ${lines.error.message}`);
  const owner = new Map(all.map((row) => [row.id, row]));
  const byProposal = new Map<string, PanelLine[]>();
  const budgetSet = p2 ? Boolean(opts.budgetSet) : null;
  const loaded = (lines.data ?? []) as unknown as LineRow[];
  // P3: the moves already applied in each refresh (by window), and each proposal's drops, for the live blocks.
  const movedByWindow = new Map<string, { id: string; amount: number }[]>();
  const dropsByProposal = new Map<string, string[]>();
  for (const line of loaded) {
    const from = owner.get(line.proposal_id);
    if (!from) continue;
    const moved = line.kind === "move_budget" ? Number(line.write?.amountGbp) || 0 : Number((line.applied_result as { movedWeeklyGbp?: number } | null)?.movedWeeklyGbp) || 0;
    if (moved > 0 && (line.state === "applied" || line.state === "applying")) {
      const list = movedByWindow.get(from.window_end) ?? [];
      list.push({ id: line.id, amount: moved });
      movedByWindow.set(from.window_end, list);
    }
    if (line.kind === "drop_audience" && ["accepted", "applying", "applied"].includes(line.state)) dropsByProposal.set(line.proposal_id, [...(dropsByProposal.get(line.proposal_id) ?? []), line.id]);
  }
  const ctxFor = (line: LineRow): BlockCtx | null => {
    if (!opts.plan) return null;
    const window = owner.get(line.proposal_id)?.window_end ?? "";
    return {
      ...opts.plan,
      appliedMovesGbp: (movedByWindow.get(window) ?? []).filter((row) => row.id !== line.id).reduce((sum, row) => sum + row.amount, 0),
      otherDrops: (dropsByProposal.get(line.proposal_id) ?? []).filter((id) => id !== line.id).length,
    };
  };
  for (const line of loaded) {
    const from = owner.get(line.proposal_id);
    if (!from) continue;
    const head = latest.get(from.campaign_key)!;
    const isCarried = head.id !== from.id;
    if (isCarried && !CARRIED.includes(line.state)) continue;
    const list = byProposal.get(head.id) ?? [];
    list.push(panelLine(line, budgetSet, isCarried ? weekLabel(from.cycle_monday) : null, ctxFor(line)));
    byProposal.set(head.id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    campaignKey: row.campaign_key,
    campaignSummary: row.campaign_summary,
    runKind: row.run_kind,
    runDay: row.run_day,
    cycleMonday: row.cycle_monday,
    cycleKind: row.cycle_kind,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    mode: row.mode,
    objective: row.objective,
    why: row.why ?? { objective: "", purchase: "", purchaseNarrow: "", moves: "", ticketing: null, pixel: [], pixelNarrow: [], attributed: null, attributedNarrow: null, context: null, contextNarrow: null },
    blockers: row.blockers ?? [],
    enoughData: row.enough_data,
    notEnoughData: row.not_enough_data,
    nextCheck: row.next_check,
    nextCycle: nextCycleAfter(row.cycle_monday)?.monday ?? null,
    nextCycleKind: nextCycleAfter(row.cycle_monday)?.kind ?? null,
    watch: row.watch ?? { creatives: [], audiences: [] },
    notes: row.notes ?? { pauses: "", drops: "", adds: "" },
    lines: byProposal.get(row.id) ?? [],
    createdAt: row.created_at,
  }));
}

/** The event's arm (migration 236). Before 236 is applied, or with no row, the event is in Shadow. */
export async function loadArm(db: Db, eventId: string): Promise<ArmMode> {
  const { data, error } = await db.from("onsale_refresh_arms").select("mode").eq("event_id", eventId).maybeSingle();
  if (error) return "shadow";
  return (data as { mode?: string } | null)?.mode === "live" ? "live" : "shadow";
}

/** Everything the panel needs (P2): the proposals, and the gates that decide whether anything can be clicked. */
export async function loadPanel(db: Db, eventId: string, env: Record<string, string | undefined>): Promise<{ proposals: PanelProposal[]; apply: PanelApply }> {
  const [event, arm] = await Promise.all([db.from("events").select("budget_marketing, event_date").eq("id", eventId).maybeSingle(), loadArm(db, eventId)]);
  if (event.error) throw new Error(`events: ${event.error.message}`);
  const row = event.data as { budget_marketing?: number | string | null; event_date?: string | null } | null;
  const budgetSet = row?.budget_marketing != null && Number.isFinite(Number(row.budget_marketing));
  const budget = budgetSet ? Number(row!.budget_marketing) : null;
  const gates = applyGates(env, arm);
  // P3: the plan (R5), read live: budget minus spend to date from the rollups.
  const plan: PanelPlan = { budget, spend: budgetSet ? await spendToDate(db, eventId) : 0, today: todayLondon(new Date()), eventDate: row?.event_date ?? null };
  // R5: the "no marketing budget" blocker was the proposal's; once a budget is set it is gone.
  const proposals = (await loadEventProposals(db, eventId, { budgetSet, plan })).map((proposal) => (budgetSet ? { ...proposal, blockers: proposal.blockers.filter((blocker) => blocker.kind !== "budget") } : proposal));
  return { proposals, apply: { mode: gates.mode, arm: gates.arm, globalEnabled: gates.globalEnabled, pauseWritesEnabled: gates.pauseWritesEnabled, adsetStatusWritesEnabled: gates.adsetStatusWritesEnabled, budgetWritesEnabled: gates.budgetWritesEnabled, audienceWritesEnabled: gates.audienceWritesEnabled, budgetSet } };
}

/** The canvas chip (R4): lines still To review on the event's latest proposals. */
export async function countToReview(db: Db, eventId: string): Promise<number> {
  const proposals = await loadEventProposals(db, eventId);
  return proposals.flatMap((proposal) => proposal.lines).filter((line) => line.state === "to_review").length;
}
