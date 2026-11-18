/**
 * A test plan's order and what may run (CT6, TT1, TT4, CT12), with Matas's
 * rulings of 16 Nov:
 *
 * - The default plan, for Puzzle and any client: Test 1 · Tracks, Test 2 ·
 *   Statics (carrying Test 1's winning track), Test 3 · Together (Test 2's
 *   winner against a copy of the main campaign's best ad). Every audio
 *   snippet static is video, so all three run in the Video ad set (TT1).
 * - One test at a time per test ad set: a test of the same format waits
 *   ("Waiting for Test {n−1}"). A statics test and a video test can run at
 *   once.
 * - Test 3's control: the main campaign's ad with the lowest cost per result
 *   over the last 14 days, among ads with at least 10 results (TT1).
 * - The CT12 copy test runs in place in the main ad sets: no Tests campaign,
 *   called by TF2 (Matas, 16 Nov).
 * - Going live is two clicks (Matas, 16 Nov): "Approve variants" creates
 *   the test on Meta, paused; "Start Test {n}" turns it live.
 *
 * Pure: no database, no Meta.
 */

import type { TestFormat, TestKind } from "./words.ts";
import { waitingText } from "./words.ts";

export type TestState = "waiting" | "making" | "approved" | "running" | "called" | "no_clear_winner" | "not_enough_variants" | "ended";

export type TestRow = {
  id: string;
  n: number;
  kind: TestKind;
  format: TestFormat;
  runsIn: "tests_adset" | "main_adsets";
  state: TestState;
};

export type PlannedTest = Pick<TestRow, "n" | "kind" | "format" | "runsIn">;

/** CT6's default plan (TT1: snippets are video). */
export const DEFAULT_PLAN: readonly PlannedTest[] = [
  { n: 1, kind: "tracks", format: "video", runsIn: "tests_adset" },
  { n: 2, kind: "statics", format: "video", runsIn: "tests_adset" },
  { n: 3, kind: "together", format: "video", runsIn: "tests_adset" },
];

/** CT12: the copy A/B test, a one-test plan measured in place. */
export const COPY_PLAN: readonly PlannedTest[] = [{ n: 1, kind: "copy", format: "statics", runsIn: "main_adsets" }];

/** CT3 / CT6: how many variants a test takes. Test 3 is the winner and the control. */
export const VARIANTS: Record<TestKind, { min: number; max: number }> = {
  tracks: { min: 2, max: 5 },
  statics: { min: 2, max: 5 },
  together: { min: 2, max: 2 },
  copy: { min: 2, max: 5 },
  clip: { min: 2, max: 5 },
  /** TK11: round 1 has four ads, round 2 three, round 3 two. */
  top_tracks: { min: 2, max: 4 },
};

export function variantCountOk(kind: TestKind, count: number): boolean {
  const { min, max } = VARIANTS[kind];
  return count >= min && count <= max;
}

/** States that hold a test ad set: created on Meta and not yet ended. */
export const HOLDS_AD_SET: readonly TestState[] = ["approved", "running"];

export const ENDED: readonly TestState[] = ["called", "no_clear_winner", "not_enough_variants", "ended"];

/**
 * Whether test `n` may be approved now, and the words when it can't:
 * the test before it must have ended, and no other test of its format may
 * hold its ad set (TT1). A test measured in place (CT12) holds no ad set.
 */
export function canApprove(tests: TestRow[], n: number): { ok: true } | { ok: false; text: string } {
  const test = tests.find((t) => t.n === n);
  if (!test) return { ok: false, text: waitingText(Math.max(1, n - 1)) };
  const previous = tests.filter((t) => t.n < n && !ENDED.includes(t.state)).sort((a, b) => b.n - a.n)[0];
  if (previous) return { ok: false, text: waitingText(previous.n) };
  if (test.runsIn === "tests_adset") {
    const busy = tests.find((t) => t.id !== test.id && t.runsIn === "tests_adset" && t.format === test.format && HOLDS_AD_SET.includes(t.state));
    if (busy) return { ok: false, text: waitingText(busy.n) };
  }
  return { ok: true };
}

/** The test the panel opens: the running one, else the first not ended (CT9). */
export function openTest(tests: TestRow[]): TestRow | null {
  const sorted = [...tests].sort((a, b) => a.n - b.n);
  return sorted.find((t) => t.state === "running" || t.state === "approved") ?? sorted.find((t) => !ENDED.includes(t.state)) ?? null;
}

/** CT9's canvas chip, or null. */
export function canvasChip(tests: TestRow[], readyIds: ReadonlySet<string>): string | null {
  const running = [...tests].sort((a, b) => a.n - b.n).find((t) => t.state === "running");
  if (!running) return null;
  return readyIds.has(running.id) ? `Test ${running.n} ready to call` : `Test ${running.n} running`;
}

export type ControlCandidate = { adId: string; name: string; spend: number; results: number };

export const CONTROL = {
  /** TT1: the window the control is chosen on. */
  days: 14,
  /** TT1: the least results an ad needs to be the control. */
  minResults: 10,
} as const;

/** TT1: Test 3's control, the lowest cost per result over 14 days among ads with 10 results or more. Ties go to the higher-results ad. */
export function chooseControl(ads: ControlCandidate[]): ControlCandidate | null {
  const eligible = ads.filter((ad) => ad.results >= CONTROL.minResults && ad.spend > 0);
  eligible.sort((a, b) => a.spend / a.results - b.spend / b.results || b.results - a.results || a.adId.localeCompare(b.adId));
  return eligible[0] ?? null;
}
