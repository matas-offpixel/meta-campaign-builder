/**
 * Creative testing issue 6 (docs/design-record/2026-11-18-creative-testing-6.html,
 * TF5–TF8): a winner has to beat the show.
 *
 * - TF5: a variant wins only when it meets TF2's read and its cost per result is
 *   at or under the show's main-campaign cost per result over the test's days
 *   (benchmark.ts reads it). With no benchmark, TF2 decides alone.
 * - TF6: at day 4, with every variant above the benchmark, there's no winner: the
 *   test is extended once by 4 days (its extra hold checked against R5's cap
 *   first). At day 8 it stops unless a variant improved 20 % on day 4 and is
 *   within 30 % of the benchmark, which earns one more 4 days. It stops at day 12
 *   at the most.
 * - TF7: every variant figure carries " · show £{benchmark}", and the result,
 *   extension and stop lines are the record's.
 *
 * This decides; it never writes. Extending an ad set's end and pausing it at a
 * stop are the daily read job's writes (PR E/F, held): until it ships, the panel
 * shows the decision and nothing changes on Meta by itself.
 *
 * Pure: no database, no Meta. The panel, the share link and the future read job
 * all call it, so they never disagree.
 */

import { TF2, readTest, type FastCallRead, type VariantFigures, type VariantRead } from "./fast-call.ts";
import { londonDayLabel, testAdSetEndTime } from "./tests-campaign.ts";
import { RESULT_WORD, money, pct, runningText, type ResultEvent, type TestKind } from "./words.ts";

export const TF6 = {
  /** Each extension's days. */
  extensionDays: 4,
  /** The most a test is extended: 12 days at the most. */
  maxExtensions: 2,
  /** A second extension needs the variant's cost at least this much lower than at day 4 … */
  secondImproveShare: 0.2,
  /** … and at or under the benchmark × this. */
  secondWithin: 1.3,
} as const;

/**
 * Which tests TF5–TF8 apply to in this build: variant pairs (TF8). The record
 * applies it to every test TF2 calls; CT6's tests (tracks, statics, together)
 * take it in the follow-up build.
 */
export function benchmarkApplies(kind: TestKind): boolean {
  return kind === "pair";
}

/** One variant's figures at a read, kept for the day-4 / day-8 comparison. */
export type VariantMark = { variantId: string; cost: number | null; results: number };

/**
 * What the read job keeps on the test (creative_tests.extension_evidence,
 * migration 261): each variant's figures at the read that extended it, and
 * whether the cap stopped an extension.
 */
export type ExtensionEvidence = {
  day4?: VariantMark[];
  day8?: VariantMark[];
  /** The variant that earned the second extension, and its cost over 8 days. */
  second?: { variantId: string; cost: number };
  /** The day an extension didn't fit the cap, so the test stopped there. */
  capStoppedAt?: 4 | 8;
};

export type BenchmarkAction =
  | { kind: "none" }
  | { kind: "extend"; extension: 1 | 2; endTime: string; endDay: string; extraHoldMinor: number }
  | { kind: "stop"; line: string };

export type BenchmarkRead = FastCallRead & {
  /** The show's cost per result over the test's days; null with no benchmark (TF5). */
  benchmark: number | null;
  /** What the read job does at this read (TF6). */
  action: BenchmarkAction;
  /** "Extended", "Stopped" or TF2's own state. */
  stage: "tf2" | "extended" | "stopped";
};

// ── TF7's words ─────────────────────────────────────────────────────────────

export const NO_SHOW_BENCHMARK = "no show benchmark for these days";

/** "£{cost} per {result} · show £{benchmark}", "— per {result} · show £{benchmark}"; without a benchmark "£{cost} per {result}". */
export function benchmarkFigure(cost: number | null, benchmark: number | null, result: ResultEvent, currency?: string | null): string {
  const base = `${cost != null ? money(cost, currency) : "—"} per ${RESULT_WORD[result].one}`;
  return benchmark != null ? `${base} · show ${money(benchmark, currency)}` : base;
}

/** The table and share cell: "£0.84 · show £3.00", "— · show £3.00"; without a benchmark the cost alone. */
export function benchmarkCell(cost: number | null, benchmark: number | null, currency?: string | null): string {
  const base = cost != null ? money(cost, currency) : "—";
  return benchmark != null ? `${base} · show ${money(benchmark, currency)}` : base;
}

/** The result line's tail: " · show £{benchmark}", or " · no show benchmark for these days". */
export function benchmarkTail(benchmark: number | null, currency?: string | null): string {
  return benchmark != null ? ` · show ${money(benchmark, currency)}` : ` · ${NO_SHOW_BENCHMARK}`;
}

/** "both", or "all {n}" with more than two variants. */
export function bothWord(n: number): string {
  return n > 2 ? `all ${n}` : "both";
}

export function extendedText(endDay: string, n: number, benchmark: number, result: ResultEvent, currency?: string | null): string {
  return `Extended to ${dayLabel(endDay)}: ${bothWord(n)} above the show's ${money(benchmark, currency)} per ${RESULT_WORD[result].one}`;
}

export function extendedAgainText(endDay: string, label: string, cost: number, benchmark: number, result: ResultEvent, currency?: string | null): string {
  return `Extended again to ${dayLabel(endDay)}: ${label} came down to ${money(cost, currency)}, within 30 % of the show's ${money(benchmark, currency)} per ${RESULT_WORD[result].one}`;
}

/** Matas's line: "Stopped: both above the show's £{benchmark} per {result}". */
export function stoppedBothText(n: number, benchmark: number, result: ResultEvent, currency?: string | null): string {
  return `Stopped: ${bothWord(n)} above the show's ${money(benchmark, currency)} per ${RESULT_WORD[result].one}`;
}

export function stoppedCameDownText(label: string, cost: number, benchmark: number, result: ResultEvent, currency?: string | null): string {
  return `Stopped: ${label} came down to ${money(cost, currency)}, still above the show's ${money(benchmark, currency)} per ${RESULT_WORD[result].one}`;
}

function dayLabel(day: string): string {
  return londonDayLabel(`${day}T12:00:00Z`);
}

// ── TF5 / TF6: the call ─────────────────────────────────────────────────────

export type BenchmarkInput = {
  firstDeliveryAt: string | null;
  /** The ad set's start (its London day counts the test's days); first delivery when not known. */
  startedAt?: string | null;
  readAt: string;
  variants: VariantFigures[];
  result: ResultEvent;
  benchmark: number | null;
  /** Extensions already made: 0, 1 or 2. */
  extensions: number;
  evidence?: ExtensionEvidence | null;
  /** The test's daily budget, minor units: each extension holds it × 4 more (VP8). */
  dailyMinor: number;
  /** What R5's 20 % cap has left for this test's extra hold, minor units; null when not known (the panel), read as room. */
  capLeftMinor?: number | null;
  currency?: string | null;
};

/** Above the show: no cost yet, or dearer. A variant TF2 doesn't judge (under 10 % of spend) can't win, so it counts as above. */
const above = (v: Pick<VariantRead, "cost" | "judged">, benchmark: number) => !v.judged || v.cost == null || v.cost > benchmark;

export function marks(variants: readonly VariantRead[]): VariantMark[] {
  return variants.filter((v) => !v.muted).map((v) => ({ variantId: v.id, cost: v.cost, results: v.results }));
}

/** TF6: improved toward the benchmark — lower cost than at day 4, or results where it had none. */
function improved(now: VariantRead, day4: VariantMark | undefined): boolean {
  if (now.cost == null) return false;
  if (!day4 || day4.cost == null) return now.results > 0;
  return now.cost < day4.cost;
}

/** TF6's second-extension test: 20 % lower than at day 4 (or no results at day 4), and within 30 % of the benchmark. */
function earnsSecond(now: VariantRead, day4: VariantMark | undefined, benchmark: number): boolean {
  if (now.cost == null) return false;
  const lowerEnough = !day4 || day4.cost == null ? true : now.cost <= day4.cost * (1 - TF6.secondImproveShare) + 1e-9;
  return lowerEnough && now.cost <= benchmark * TF6.secondWithin + 1e-9;
}

/**
 * The read with the benchmark: TF2's read over all the test's days, then TF5's
 * second test for a winner, then TF6's extension or stop at each boundary.
 */
export function readWithBenchmark(input: BenchmarkInput): BenchmarkRead {
  const ext = Math.max(0, Math.min(TF6.maxExtensions, Math.floor(input.extensions || 0)));
  const boundary = TF2.lastReadHours * (ext + 1);
  const read = readTest({ firstDeliveryAt: input.firstDeliveryAt, readAt: input.readAt, variants: input.variants, result: input.result, lastReadHours: boundary });
  const { benchmark, result, currency } = input;
  const base: BenchmarkRead = { ...read, benchmark, action: { kind: "none" }, stage: "tf2" };
  if (benchmark == null) return base;

  const inTest = read.variants.filter((v) => !v.muted);
  const n = inTest.length;
  const start = input.startedAt || input.firstDeliveryAt || input.readAt;
  const endDay = (days: number) => testAdSetEndTime(start, days).slice(0, 10);

  // TF5: TF2's winner wins only at or under the benchmark.
  if (read.state === "ready_to_call") {
    const winner = inTest.find((v) => v.id === read.winnerId);
    if (winner && !above(winner, benchmark)) return base;
  }
  const pastBoundary = read.hours != null && read.hours >= boundary;
  const allAbove = inTest.length > 0 && inTest.every((v) => above(v, benchmark));
  const extraHoldMinor = input.dailyMinor * TF6.extensionDays;
  const fits = input.capLeftMinor == null || extraHoldMinor <= input.capLeftMinor;
  const evidence = input.evidence ?? {};

  if (!pastBoundary) {
    // During an extension the line says so; before day 4, TF2's running line (a winner above the show just isn't one yet).
    const notWinner = read.state === "ready_to_call" ? { state: "running" as const, text: runningLine(read), winnerId: null } : {};
    if (ext === 1) return { ...base, ...notWinner, stage: "extended", text: extendedText(endDay(8), n, benchmark, result, currency) };
    if (ext === 2 && evidence.second) {
      const v = inTest.find((x) => x.id === evidence.second!.variantId);
      return { ...base, ...notWinner, stage: "extended", text: extendedAgainText(endDay(12), v?.label ?? "", evidence.second.cost, benchmark, result, currency) };
    }
    return { ...base, ...notWinner };
  }

  // Past the boundary with no winner at or under the benchmark.
  const stop = (line: string): BenchmarkRead => ({ ...base, state: "no_clear_winner", winnerId: null, ends: true, stage: "stopped", text: line, action: { kind: "stop", line } });
  const both = () => stop(stoppedBothText(n, benchmark, result, currency));
  if (!allAbove) return { ...base, winnerId: read.state === "ready_to_call" ? null : read.winnerId };

  if (ext === 0) {
    if (evidence.capStoppedAt === 4 || !fits) return both();
    const line = extendedText(endDay(8), n, benchmark, result, currency);
    return { ...base, state: "running", winnerId: null, ends: false, stage: "extended", text: line, action: { kind: "extend", extension: 1, endTime: testAdSetEndTime(start, 8), endDay: endDay(8), extraHoldMinor } };
  }

  const day4 = new Map((evidence.day4 ?? []).map((m) => [m.variantId, m]));
  const cheapest = (rows: VariantRead[]) => [...rows].sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity))[0] ?? null;
  const better = inTest.filter((v) => improved(v, day4.get(v.id)));

  if (ext === 1) {
    if (!better.length) return both();
    const second = cheapest(better.filter((v) => earnsSecond(v, day4.get(v.id), benchmark)));
    const cameDown = cheapest(better)!;
    if (!second || evidence.capStoppedAt === 8 || !fits) return stop(stoppedCameDownText(cameDown.label, cameDown.cost!, benchmark, result, currency));
    const line = extendedAgainText(endDay(12), second.label, second.cost!, benchmark, result, currency);
    return { ...base, state: "running", winnerId: null, ends: false, stage: "extended", text: line, action: { kind: "extend", extension: 2, endTime: testAdSetEndTime(start, 12), endDay: endDay(12), extraHoldMinor } };
  }

  // Day 12, the most a test runs: "came down to" while its cost is still lower than at day 4 (any cost, with none at day 4).
  const lower = cheapest(inTest.filter((v) => v.cost != null && (day4.get(v.id)?.cost == null || v.cost < day4.get(v.id)!.cost!)));
  return lower ? stop(stoppedCameDownText(lower.label, lower.cost!, benchmark, result, currency)) : both();
}

/** TF2's running line, for a read whose TF2 winner is above the show. */
function runningLine(read: FastCallRead): string {
  const leader = read.variants.find((v) => v.id === read.leaderId);
  return leader ? runningText(read.hours ?? 0, pct(leader.share ?? 0), leader.label) : read.text;
}
