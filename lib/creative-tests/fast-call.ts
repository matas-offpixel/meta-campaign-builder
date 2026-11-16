/**
 * TF2: the fast call (docs/design-record/2026-11-16-creative-testing-3.html,
 * replacing TT3), with TF4's rights-mute rule and TT5's end.
 *
 * A running test is read every morning at 08:00 London, on its spend and
 * results since the test ad set first delivered. The first read is 48 hours
 * after first delivery.
 *
 * Spend share is the signal: each variant's share of the spend of the
 * variants still in the test. A muted variant (TT5) leaves the share sums
 * from the moment it's paused (TF4).
 *
 *   barely served: under 10 % of the spend. "Not enough spend to judge";
 *                  never a loser, never compared on cost.
 *   judged:        10 % or more.
 *
 * A variant wins when all three hold:
 *   1. it has 60 % or more of the spend;
 *   2. it has at least 3 results;
 *   3. its cost per result isn't worse than any other judged variant's.
 *      A judged variant with no results counts as worse than the leader
 *      once its spend passes the leader's cost per result. Before that its
 *      cost is unknown: it isn't cheaper, but it isn't beaten either, so
 *      nothing wins yet.
 *
 * Meta's favourite costing more (1 and 2 hold, another judged variant is
 * cheaper per result) reads "Running · Meta favours …". With no winner by
 * the first read at or after 96 hours, the call is "No clear winner by day
 * 4". Fewer than 2 variants left in the test ends it (TT5).
 *
 * Calling stays Matas's click: "ready" here only means the read found a
 * winner. Pure: no database, no Meta.
 */

import {
  FIRST_READ_PENDING,
  NO_CLEAR_WINNER,
  NOT_ENOUGH_VARIANTS,
  READY_TO_CALL,
  metaFavoursText,
  pct,
  runningText,
  type ResultEvent,
} from "./words.ts";

export const TF2 = {
  /** The first read, hours after first delivery. */
  firstReadHours: 48,
  /** Day 4: no winner by the first read at or after this, and the call is "No clear winner". */
  lastReadHours: 96,
  /** A clear majority of the spend. */
  winShare: 0.6,
  /** A winner's results, so its cost per result is a number and not one lucky sale. */
  minResults: 3,
  /** Under this share a variant is barely served. */
  judgedShare: 0.1,
  /** TT5: a test needs this many variants left in it. */
  minVariants: 2,
  /** The daily read, London time. */
  readHourLondon: 8,
} as const;

export type VariantFigures = {
  id: string;
  label: string;
  /** Since first delivery, account units. */
  spend: number;
  results: number;
  /** TT5: muted or rejected for rights, so paused and out of the test. */
  muted?: boolean;
};

export type VariantRead = VariantFigures & {
  /** Share of the spend of the variants still in the test; null when muted. */
  share: number | null;
  judged: boolean;
  /** Spend ÷ results; null with no results. */
  cost: number | null;
};

export type CallState =
  | "not_delivering"
  | "first_read_pending"
  | "running"
  | "meta_favours"
  | "ready_to_call"
  | "no_clear_winner"
  | "not_enough_variants";

export type FastCallRead = {
  state: CallState;
  /** The state's words (TF2). "Ready to call" for a winner; the panel writes the winner line after Matas calls it. */
  text: string;
  hours: number | null;
  spendTotal: number;
  variants: VariantRead[];
  leaderId: string | null;
  winnerId: string | null;
  /** The cheaper judged variant Meta isn't favouring, when the state is meta_favours. */
  cheaperId: string | null;
  /** Whether this read ends the test (day 4, or too few variants). */
  ends: boolean;
};

export function hoursSince(fromIso: string | null | undefined, atIso: string): number | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const at = Date.parse(atIso);
  if (!Number.isFinite(from) || !Number.isFinite(at)) return null;
  return Math.max(0, (at - from) / 3_600_000);
}

/** Shares, judged flags and costs, with muted variants out of the sums (TF4). */
export function shareRows(variants: VariantFigures[]): { rows: VariantRead[]; total: number } {
  const inTest = variants.filter((v) => !v.muted);
  const total = Math.round(inTest.reduce((sum, v) => sum + Math.max(0, v.spend), 0) * 100) / 100;
  const rows = variants.map((v) => {
    const share = v.muted ? null : total > 0 ? Math.max(0, v.spend) / total : 0;
    const judged = share != null && share >= TF2.judgedShare;
    const cost = v.results > 0 ? v.spend / v.results : null;
    return { ...v, share, judged, cost };
  });
  return { rows, total };
}

/** TF3: rows by spend share, muted last. */
export function sortByShare(rows: VariantRead[]): VariantRead[] {
  return [...rows].sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
}

/**
 * How a judged rival compares with the leader on cost: "cheaper", "worse"
 * (or equal), or "unknown" (no results yet, and its spend hasn't passed the
 * leader's cost per result).
 */
export function compareWithLeader(leaderCost: number, rival: VariantRead): "cheaper" | "worse" | "unknown" {
  if (rival.cost == null) return rival.spend > leaderCost ? "worse" : "unknown";
  return rival.cost < leaderCost ? "cheaper" : "worse";
}

export function readTest(input: { firstDeliveryAt: string | null; readAt: string; variants: VariantFigures[]; result: ResultEvent }): FastCallRead {
  const { rows, total } = shareRows(input.variants);
  const hours = hoursSince(input.firstDeliveryAt, input.readAt);
  const base = { hours, spendTotal: total, variants: rows, leaderId: null, winnerId: null, cheaperId: null, ends: false };

  const inTest = rows.filter((r) => !r.muted);
  if (inTest.length < TF2.minVariants) return { ...base, state: "not_enough_variants", text: NOT_ENOUGH_VARIANTS, ends: true };
  if (hours == null || total <= 0) return { ...base, state: "not_delivering", text: FIRST_READ_PENDING };
  if (hours < TF2.firstReadHours) return { ...base, state: "first_read_pending", text: FIRST_READ_PENDING };

  const leader = sortByShare(inTest)[0]!;
  const leaderShare = leader.share ?? 0;
  const withLeader = { ...base, leaderId: leader.id };
  const pastDay4 = hours >= TF2.lastReadHours;
  const noWinner = (fallback: Pick<FastCallRead, "state" | "text" | "winnerId" | "cheaperId" | "ends">): FastCallRead =>
    pastDay4 ? { ...withLeader, state: "no_clear_winner", text: NO_CLEAR_WINNER, ends: true } : { ...withLeader, ...fallback };
  const running = { state: "running" as const, text: runningText(hours, pct(leaderShare), leader.label), winnerId: null, cheaperId: null, ends: false };

  if (leaderShare < TF2.winShare || leader.results < TF2.minResults || leader.cost == null) return noWinner(running);

  const rivals = inTest.filter((r) => r.id !== leader.id && r.judged);
  const verdicts = rivals.map((r) => ({ rival: r, verdict: compareWithLeader(leader.cost!, r) }));
  const cheaper = verdicts.filter((v) => v.verdict === "cheaper").map((v) => v.rival).sort((a, b) => a.cost! - b.cost!);
  if (cheaper.length) {
    const cheapest = cheaper[0]!;
    return noWinner({ state: "meta_favours", text: metaFavoursText(leader.label, pct(leaderShare), cheapest.label, input.result), winnerId: null, cheaperId: cheapest.id, ends: false });
  }
  if (verdicts.some((v) => v.verdict === "unknown")) return noWinner(running);

  return { ...withLeader, state: "ready_to_call", text: READY_TO_CALL, winnerId: leader.id };
}

/**
 * TF2's read time: 08:00 London. Vercel crons run on UTC, so the cron fires
 * at 07:00 and 08:00 UTC and acts only when London is at 08 (Matas, 16 Nov).
 */
export function isLondonReadHour(atIso: string): boolean {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(atIso));
  return Number(hour) === TF2.readHourLondon;
}

/** The London date of a read, for creative_test_reads.read_day. */
export function londonDay(atIso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(atIso));
}
