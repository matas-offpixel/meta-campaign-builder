/**
 * Top tracks TK11 (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * the test plan. Three rounds, one at a time (TT9), each its own ad set in
 * the show's {code} · Tests campaign (TT8), named
 * "{code} · Tests · Top tracks · {d Mon}" with " · 2" for a same-day repeat
 * (TT10), one ad per variant, 4 days to 23:59 London, TF1's budget, created
 * ACTIVE with Approve as the approval (TT9).
 *
 *   Round 1 · Headlines: the four framings on Spotify's top 3 (so Ranked
 *     and Level hold), the same background, rows and end. Four ads.
 *   Round 2 · Track count: round 1's winner on Spotify's top 3, 4 and 5.
 *     Three ads.
 *   Round 3 · Row timing (optional): round 2's winner, rows at track start
 *     against on the drop. Two ads.
 *
 * Called on cost per result on day 4: a variant needs 3 results and 10 % of
 * the round's spend to be judged (TF2's floors); the judged variant with the
 * lowest cost per result wins, " · narrow" when within 15 % of the next
 * (CT7's word). No judged variant: "No clear winner by day 4". Calling is
 * Matas's click; the winner's settings become the show's Top tracks
 * defaults. Pure.
 */

import { TF2 } from "../fast-call.ts";
import { TEST_AD_SET_DAYS, testAdSetEndTime, testsAdSetName } from "../tests-campaign.ts";
import { CALL_THE_WINNER, NO_CLEAR_WINNER, READY_TO_CALL } from "../words.ts";
import { DEFAULT_OPTIONS, FRAMINGS, headline, type ReelOptions, type TrackCount } from "./reel.ts";

export const TK11 = {
  days: TEST_AD_SET_DAYS,
  callHours: TF2.lastReadHours,
  minResults: TF2.minResults,
  judgedShare: TF2.judgedShare,
  /** CT7: clear means at least 15 % cheaper than the next. */
  narrow: 0.15,
  status: "ACTIVE" as const,
} as const;

export type RoundNo = 1 | 2 | 3;

export const ROUND_NAME: Record<RoundNo, string> = { 1: "Headlines", 2: "Track count", 3: "Row timing" };

export function roundTitle(n: RoundNo): string {
  return `Round ${n} · ${ROUND_NAME[n]}`;
}

export type RoundVariant = { label: string; options: ReelOptions };

/**
 * Each round's ads. `base` is what's held: the show's Top tracks defaults
 * (round 1) or the previous round's winner. Round 1 always runs 3 tracks.
 */
export function roundVariants(n: RoundNo, base: ReelOptions, artist: string): RoundVariant[] {
  if (n === 1) {
    return FRAMINGS.map((framing) => {
      const options: ReelOptions = { ...base, framing, tracks: 3 };
      return { label: headline(framing, artist, 3), options };
    });
  }
  if (n === 2) {
    return ([3, 4, 5] as TrackCount[]).map((tracks) => ({ label: `Spotify's top ${tracks}`, options: { ...base, tracks } }));
  }
  return [
    { label: "Rows at track start", options: { ...base, rowsAppear: "start" } },
    { label: "Rows on the drop", options: { ...base, rowsAppear: "drop" } },
  ];
}

/** Round 1's base for P26-BDAY's first use (TK11): the defaults, three tracks. */
export function round1Base(overrides: Partial<ReelOptions> = {}): ReelOptions {
  return { ...DEFAULT_OPTIONS, tracks: 3, ...overrides };
}

/** TT10's name with TK11's kind. */
export function topTracksAdSetName(eventCode: string, createdAt: Date | string, existingNames: readonly string[] = []): string {
  return testsAdSetName(eventCode, "Top tracks", createdAt, existingNames);
}

/** TT9: 23:59 London on the fourth day. */
export function topTracksEndTime(start: Date | string): string {
  return testAdSetEndTime(start, TK11.days);
}

export type RoundFigures = { id: string; label: string; spend: number; results: number };

export type RoundCall =
  | { state: "running"; text: string }
  | { state: "ready_to_call"; text: string; winnerId: string; narrow: boolean; winnerLine: string; action: string }
  | { state: "no_clear_winner"; text: string };

/** TK11's day-4 call. Before 96 h it's still running. */
export function callRound(variants: readonly RoundFigures[], hoursSinceFirstDelivery: number | null): RoundCall {
  if (hoursSinceFirstDelivery == null || hoursSinceFirstDelivery < TK11.callHours) return { state: "running", text: "Running · called on day 4" };
  const total = variants.reduce((s, v) => s + v.spend, 0);
  const judged = variants
    .filter((v) => total > 0 && v.spend / total >= TK11.judgedShare - 1e-9 && v.results >= TK11.minResults)
    .map((v) => ({ ...v, cost: v.spend / v.results }))
    .sort((a, b) => a.cost - b.cost);
  if (!judged.length) return { state: "no_clear_winner", text: NO_CLEAR_WINNER };
  const win = judged[0]!;
  const next = judged[1];
  const narrow = next ? (next.cost - win.cost) / next.cost < TK11.narrow - 1e-9 : false;
  return { state: "ready_to_call", text: READY_TO_CALL, winnerId: win.id, narrow, winnerLine: `${win.label}${narrow ? " · narrow" : ""}`, action: CALL_THE_WINNER };
}

/** After a call, the winner's settings become the show's Top tracks defaults, and the next round starts from it. */
export function defaultsAfterCall(current: ReelOptions, winner: ReelOptions): ReelOptions {
  return { ...current, ...winner };
}

/** The next round, or null after round 3 (round 3 is optional: the operator may stop after 2). */
export function nextRound(n: RoundNo): RoundNo | null {
  return n === 1 ? 2 : n === 2 ? 3 : null;
}
