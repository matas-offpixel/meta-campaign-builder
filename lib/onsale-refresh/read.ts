/**
 * What the Refresh panel reads: the latest proposal per campaign of an
 * event with its lines, in panel order, plus (P2) the lines of earlier
 * proposals a decision or a write is still waiting on (Accepted,
 * Applying, Failed), and the event's arm. Reads only; the session
 * client's RLS (owner) applies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { applyGates, type ArmMode } from "./apply-gates.ts";
import { liveBlockedReason } from "./decide.ts";
import type { LineState } from "./line-states.ts";
import type { AddCopy, LineKind, Proposal, WatchItem } from "./rules.ts";
import { nextCycleAfter, weekLabel, type CycleKind, type RunKind } from "./schedule.ts";

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
};

/** The panel's gates (R4): live only with the deployment gate and the event's arm. */
export type PanelApply = {
  mode: ArmMode;
  arm: ArmMode;
  globalEnabled: boolean;
  pauseWritesEnabled: boolean;
  budgetSet: boolean;
};

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

type LineRow = Omit<PanelLine, "writeText" | "addsSpend" | "blockedReason" | "narrow" | "copy" | "carried" | "appliedAt"> & { proposal_id: string; position: number; write_text: string; narrow: PanelLine["narrow"] | null; adds_spend: boolean; blocked_reason: string | null; target?: { copy?: AddCopy | null } | null; applied_at?: string | null };

const CARRIED: readonly LineState[] = ["accepted", "applying", "failed"];

function panelLine(line: LineRow, budgetSet: boolean | null, carried: string | null): PanelLine {
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
    blockedReason: budgetSet == null ? line.blocked_reason : liveBlockedReason(line, budgetSet),
    supply: line.supply,
    state: line.state,
    reason: line.reason,
    ...(copy ? { copy } : {}),
    ...(carried ? { carried } : {}),
    ...(line.applied_at ? { appliedAt: line.applied_at } : {}),
  };
}

/**
 * The latest proposal of each campaign on the event (F10: by window end,
 * then by creation), newest window first. With `budgetSet` (P2), a spend
 * line's block follows the event's budget now, and the earlier
 * proposals' Accepted, Applying and Failed lines are carried under the
 * latest one, marked with their week.
 */
export async function loadEventProposals(db: Db, eventId: string, opts: { budgetSet?: boolean } = {}): Promise<PanelProposal[]> {
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
    .select(`id, proposal_id, position, kind, title, detail, write_text, narrow, adds_spend, blocked_reason, supply, state, reason${p2 ? ", target, applied_at" : ""}`)
    .in("proposal_id", ids)
    .order("position", { ascending: true });
  if (lines.error) throw new Error(`onsale_refresh_lines: ${lines.error.message}`);
  const owner = new Map(all.map((row) => [row.id, row]));
  const byProposal = new Map<string, PanelLine[]>();
  const budgetSet = p2 ? Boolean(opts.budgetSet) : null;
  for (const line of (lines.data ?? []) as unknown as LineRow[]) {
    const from = owner.get(line.proposal_id);
    if (!from) continue;
    const head = latest.get(from.campaign_key)!;
    const isCarried = head.id !== from.id;
    if (isCarried && !CARRIED.includes(line.state)) continue;
    const list = byProposal.get(head.id) ?? [];
    list.push(panelLine(line, budgetSet, isCarried ? weekLabel(from.cycle_monday) : null));
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
  const [event, arm] = await Promise.all([db.from("events").select("budget_marketing").eq("id", eventId).maybeSingle(), loadArm(db, eventId)]);
  if (event.error) throw new Error(`events: ${event.error.message}`);
  const budget = (event.data as { budget_marketing?: number | string | null } | null)?.budget_marketing;
  const budgetSet = budget != null && Number.isFinite(Number(budget));
  const gates = applyGates(env, arm);
  // R5: the "no marketing budget" blocker was the proposal's; once a budget is set it is gone.
  const proposals = (await loadEventProposals(db, eventId, { budgetSet })).map((proposal) => (budgetSet ? { ...proposal, blockers: proposal.blockers.filter((blocker) => blocker.kind !== "budget") } : proposal));
  return { proposals, apply: { mode: gates.mode, arm: gates.arm, globalEnabled: gates.globalEnabled, pauseWritesEnabled: gates.pauseWritesEnabled, budgetSet } };
}

/** The canvas chip (R4): lines still To review on the event's latest proposals. */
export async function countToReview(db: Db, eventId: string): Promise<number> {
  const proposals = await loadEventProposals(db, eventId);
  return proposals.flatMap((proposal) => proposal.lines).filter((line) => line.state === "to_review").length;
}
