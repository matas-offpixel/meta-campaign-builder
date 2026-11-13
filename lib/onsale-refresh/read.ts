/**
 * What the Refresh panel reads: the latest proposal per campaign of an
 * event with its lines, in panel order. Reads only; the session client's
 * RLS (owner) applies.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LineKind, Proposal, WatchItem } from "./rules.ts";
import { nextCycleAfter, type CycleKind, type RunKind } from "./schedule.ts";

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
  state: "to_review" | "accepted" | "rejected" | "applied" | "failed" | "expired";
  reason: string | null;
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

type LineRow = Omit<PanelLine, "writeText" | "addsSpend" | "blockedReason" | "narrow"> & { proposal_id: string; position: number; write_text: string; narrow: PanelLine["narrow"] | null; adds_spend: boolean; blocked_reason: string | null };

/** The latest proposal of each campaign on the event (F10: by window end, then by creation), newest window first. */
export async function loadEventProposals(db: Db, eventId: string): Promise<PanelProposal[]> {
  const { data, error } = await db
    .from("onsale_refresh_proposals")
    .select("id, campaign_key, campaign_summary, run_kind, run_day, cycle_monday, cycle_kind, window_start, window_end, mode, objective, why, blockers, enough_data, not_enough_data, next_check, watch, notes, created_at")
    .eq("event_id", eventId)
    .order("window_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`onsale_refresh_proposals: ${error.message}`);
  const latest = new Map<string, ProposalRow>();
  for (const row of (data ?? []) as ProposalRow[]) if (!latest.has(row.campaign_key)) latest.set(row.campaign_key, row);
  const rows = [...latest.values()];
  if (!rows.length) return [];
  const lines = await db
    .from("onsale_refresh_lines")
    .select("id, proposal_id, position, kind, title, detail, write_text, narrow, adds_spend, blocked_reason, supply, state, reason")
    .in("proposal_id", rows.map((row) => row.id))
    .order("position", { ascending: true });
  if (lines.error) throw new Error(`onsale_refresh_lines: ${lines.error.message}`);
  const byProposal = new Map<string, PanelLine[]>();
  for (const line of (lines.data ?? []) as LineRow[]) {
    const list = byProposal.get(line.proposal_id) ?? [];
    list.push({ id: line.id, kind: line.kind, title: line.title, detail: line.detail, writeText: line.write_text, narrow: line.narrow?.detail != null ? line.narrow : { detail: line.detail, writeText: line.write_text }, addsSpend: line.adds_spend, blockedReason: line.blocked_reason, supply: line.supply, state: line.state, reason: line.reason });
    byProposal.set(line.proposal_id, list);
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
    why: row.why ?? { objective: "", purchase: "", purchaseNarrow: "", moves: "", ticketing: null, pixel: [], pixelNarrow: [] },
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
