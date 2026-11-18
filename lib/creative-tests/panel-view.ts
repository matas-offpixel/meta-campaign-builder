/**
 * The Test plan panel (CT9, TT6, TF3) and the share link's "What we're
 * testing" (CT11, TT6, TF3), built from creative_tests, creative_test_variants
 * and the latest creative_test_reads row of each test (migration 255). Pure,
 * no server imports: the event-page panel, the share section and the frames
 * all draw from it.
 *
 * The state is worked out here from the stored figures with TF2's rule
 * (fast-call.ts), so the panel, the share link and the 08:00 read never
 * disagree.
 *
 * Internal (CT9 / TF3): one card per test in order; the running test is open,
 * finished and waiting tests fold to one line. The open card shows the budget
 * line, the state, and the table: variant, spend share (first, with the 60 %
 * and 10 % marks), spend, results, cost per result, sorted by share.
 *
 * Share (CT11 / TT6 / TF3): figures only. Each test's name and state, and a
 * table of results and cost per result. Never spend share, spend, budgets,
 * refresh lines, calling or internal notes. Barely served rows read "Not
 * enough spend to judge"; muted rows "Audio muted by Meta".
 */

import { readTest, sortByShare, type FastCallRead, type VariantFigures } from "./fast-call.ts";
import { approvalLines, pairAdSetKind, pairTestName, readPairHeld, spanLine } from "./pair.ts";
import { ENDED, canvasChip, type TestRow, type TestState } from "./plan.ts";
import {
  CONTROL_HELD,
  FIRST_READ_PENDING,
  KIND_NAME,
  NOT_ENOUGH_SPEND,
  NOT_ENOUGH_VARIANTS,
  NO_CLEAR_WINNER,
  RESULT_WORD,
  RIGHTS_MUTED,
  RIGHTS_MUTED_SHARE,
  budgetLine,
  cardBudgetLine,
  money,
  pct,
  phoneRow,
  shareWinnerText,
  testAdSetName,
  testName,
  waitingForStaticsText,
  waitingText,
  winnerText,
  type ResultEvent,
  type TestFormat,
  type TestKind,
} from "./words.ts";

export type TestInput = {
  id: string;
  n: number;
  kind: TestKind;
  format: TestFormat;
  runs_in: "tests_adset" | "main_adsets";
  state: TestState;
  result_event: ResultEvent | null;
  currency: string | null;
  daily_budget_minor: number | null;
  budget_pct: number | null;
  at_minimum: boolean;
  first_delivery_at: string | null;
  winner_variant_id: string | null;
  /** The test's ad set as made, "{code} · Tests · {Video | Statics} · {d Mon}" (TT8; panel-read takes it from launched_ad_sets). */
  adset_name?: string | null;
  /** What the test holds; a variant pair's asset, windows, static and sign-offs (VP1, VP7). */
  held?: unknown;
};

export type VariantInput = { id: string; test_id: string; position: number; role: "variant" | "control"; label: string; state: string };

/** One variant's figures in a read (creative_test_reads.variants). */
export type ReadFigures = { variantId: string; spend: number; results: number; muted?: boolean };

export type ReadInput = { test_id: string; read_at: string; variants: ReadFigures[] };

export const PANEL_TITLE = "Test plan";
export const SHARE_TITLE = "What we're testing";

/** CT9's table headers ("Checkouts", "Cost per checkout"). */
export function headers(result: ResultEvent): { results: string; cost: string } {
  const word = RESULT_WORD[result];
  return { results: word.many[0]!.toUpperCase() + word.many.slice(1), cost: `Cost per ${word.one}` };
}

/** CT-D / TF-C's share columns: Track for a tracks test, Static for statics, else Variant; and "Per {result}". */
export function shareHeaders(kind: TestKind, result: ResultEvent): { variant: string; results: string; cost: string } {
  const h = headers(result);
  return { variant: kind === "tracks" ? "Track" : kind === "statics" ? "Static" : "Variant", results: h.results, cost: `Per ${RESULT_WORD[result].one}` };
}

/** CT-D: a copy test is named by what it compares, "Copy · Artist voice vs venue voice"; a variant pair by its asset, "Test 1 · Track pair · Can't Decide" (VP6). */
export function cardName(test: Pick<TestInput, "n" | "kind" | "runs_in" | "held">, labels: string[]): string {
  if (test.kind === "copy" && test.runs_in === "main_adsets") return `${KIND_NAME.copy} · ${labels.join(" vs ")}`;
  const pair = test.kind === "pair" ? readPairHeld(test.held) : null;
  if (pair) return pairTestName(test.n, pair.pair, pair.asset);
  return testName(test.n, test.kind);
}

export type PanelRow = {
  id: string;
  label: string;
  share: number | null;
  sharePct: string | null;
  spend: string;
  results: number;
  cost: string;
  judged: boolean;
  muted: boolean;
  leader: boolean;
  phone: string;
};

export type PanelCard = {
  id: string;
  n: number;
  name: string;
  open: boolean;
  /** "Test 2 · Statics · Waiting for Test 1's statics" for a folded card. */
  folded: string;
  state: string;
  /** TF-A 1280: "In P26-BDAY · Tests · Video · £10 a day · … · read at 48 h, £20.00 spent". Null for a test measured in place. */
  budgetLine: string | null;
  /** TF-A 393: the budget line alone. */
  budgetLineShort: string | null;
  headers: { results: string; cost: string };
  rows: PanelRow[];
  /** TF-B: the pause line a test with no clear winner offers (Accept and Apply arrive with the refresh lines). */
  pause: { title: string; detail: string } | null;
  /** VP6, a variant pair at 1280 only: "{span 1} vs {span 2} · Static: {name}". Internal, never on the share link. */
  spanLine: string | null;
  /** VP7, a variant pair at 1280 only: "Signed off by Matas · {d Mon}" and the artist-page line. Internal. */
  approvalLines: string[];
};

export type ShareRow = { id: string; label: string; results: number | null; cost: string };
export type ShareCard = { id: string; name: string; state: string; headers: { variant: string; results: string; cost: string }; rows: ShareRow[] };

export type PanelView = { cards: PanelCard[]; chip: string | null };

type Built = { test: TestInput; variants: VariantInput[]; read: FastCallRead; readAt: string | null; result: ResultEvent };

function latestRead(reads: ReadInput[], testId: string): ReadInput | null {
  return reads.filter((r) => r.test_id === testId).sort((a, b) => b.read_at.localeCompare(a.read_at))[0] ?? null;
}

function build(test: TestInput, variants: VariantInput[], reads: ReadInput[], now: string): Built {
  const own = variants.filter((v) => v.test_id === test.id).sort((a, b) => a.position - b.position);
  const latest = latestRead(reads, test.id);
  const figures = new Map((latest?.variants ?? []).map((f) => [f.variantId, f]));
  const input: VariantFigures[] = own.map((v) => {
    const f = figures.get(v.id);
    return { id: v.id, label: v.label, spend: Number(f?.spend ?? 0), results: Number(f?.results ?? 0), muted: Boolean(f?.muted) || v.state === "muted" };
  });
  const result = test.result_event ?? "initiate_checkout";
  const read = readTest({ firstDeliveryAt: test.first_delivery_at, readAt: latest?.read_at ?? now, variants: input, result });
  return { test, variants: own, read, readAt: latest?.read_at ?? null, result };
}

/** The words for a test that isn't running (CT9's folded line, TT1, TF2, TT5). */
function restingState(b: Built, all: TestInput[], surface: "internal" | "share"): string {
  const { test, read } = b;
  if (test.state === "called") {
    const control = b.variants.find((v) => v.id === test.winner_variant_id)?.role === "control";
    if (control) return CONTROL_HELD;
    const winner = read.variants.find((v) => v.id === test.winner_variant_id);
    if (!winner || winner.cost == null) return "";
    return surface === "share" ? shareWinnerText(winner.label, winner.cost, b.result, test.currency) : winnerText(winner.label, pct(winner.share ?? 0), winner.cost, b.result, test.currency);
  }
  if (test.state === "no_clear_winner") return NO_CLEAR_WINNER;
  if (test.state === "not_enough_variants") return NOT_ENOUGH_VARIANTS;
  if (test.state === "waiting" || test.state === "making") {
    // VP4: a pair waits on nothing, and CT6's tests never wait on a pair.
    if (test.kind === "pair") return "";
    const previous = all.filter((t) => t.n < test.n && t.kind !== "pair").sort((a, z) => z.n - a.n)[0];
    if (!previous) return "";
    if (ENDED.includes(previous.state) && test.kind === "statics") return waitingForStaticsText(previous.n);
    return waitingText(previous.n);
  }
  return "";
}

/** TF2's running words. The share link never shows spend share (TT6, TF3), so its running line is new words, listed for design. */
function runningState(b: Built, surface: "internal" | "share"): string {
  if (surface === "internal") return b.read.text;
  if (b.read.state === "first_read_pending" || b.read.state === "not_delivering") return FIRST_READ_PENDING;
  if (b.read.state === "no_clear_winner") return NO_CLEAR_WINNER;
  if (b.read.state === "not_enough_variants") return NOT_ENOUGH_VARIANTS;
  return shareRunningText(b.read.hours ?? 0);
}

/** New words (not in the records): the share link's running line, without the spend share. */
export function shareRunningText(hours: number): string {
  return `Running · ${Math.floor(hours)} h`;
}

export function buildPanel(input: { eventCode: string | null; tests: TestInput[]; variants: VariantInput[]; reads: ReadInput[]; now: string }): PanelView {
  const tests = [...input.tests].sort((a, b) => a.n - b.n);
  const built = tests.map((t) => build(t, input.variants, input.reads, input.now));
  const ready = new Set(built.filter((b) => b.test.state === "running" && b.read.state === "ready_to_call").map((b) => b.test.id));
  const rows: TestRow[] = tests.map((t) => ({ id: t.id, n: t.n, kind: t.kind, format: t.format, runsIn: t.runs_in, state: t.state }));
  const cards = built.map((b): PanelCard => {
    const { test, read } = b;
    const running = test.state === "running";
    const state = running ? runningState(b, "internal") : restingState(b, tests, "internal");
    const name = cardName(test, b.variants.map((v) => v.label));
    const daily = test.daily_budget_minor != null ? test.daily_budget_minor / 100 : null;
    const line = daily != null && test.budget_pct != null && test.runs_in === "tests_adset" ? budgetLine({ daily, sharePct: Number(test.budget_pct), cap: 10, atMinimum: test.at_minimum, currency: test.currency }) : null;
    // TT8: the full ad set name as made; before it's made, the format's name without a date (a pair's "{kind} pair", VP4).
    const pair = test.kind === "pair" ? readPairHeld(test.held) : null;
    const adSet = test.adset_name?.trim() || (pair ? `${input.eventCode ?? ""} · Tests · ${pairAdSetKind(pair.pair)}` : testAdSetName(input.eventCode ?? "", test.format));
    const out: PanelRow[] = sortByShare(read.variants).map((v) => {
      const cost = v.muted ? RIGHTS_MUTED : !v.judged || v.cost == null ? NOT_ENOUGH_SPEND : money(v.cost, test.currency);
      const sharePct = v.share == null ? null : pct(v.share);
      return {
        id: v.id,
        label: v.label,
        share: v.share,
        sharePct,
        spend: money(v.spend, test.currency),
        results: v.results,
        cost,
        judged: v.judged,
        muted: Boolean(v.muted),
        leader: v.id === read.leaderId && !v.muted,
        phone: phoneRow({ label: v.label, sharePct, judged: v.judged, muted: Boolean(v.muted), cost: v.cost, results: v.results }, b.result, test.currency),
      };
    });
    return {
      id: test.id,
      n: test.n,
      name,
      open: running,
      folded: state ? `${name} · ${state}` : name,
      state,
      budgetLine: line ? cardBudgetLine({ adSetName: adSet, budgetLine: line, readHours: b.readAt ? read.hours : null, spent: b.readAt ? read.spendTotal : null, currency: test.currency }) : null,
      budgetLineShort: line,
      headers: headers(b.result),
      rows: out,
      pause: test.state === "no_clear_winner" && test.runs_in === "tests_adset" ? { title: `Pause ${adSet}`, detail: `Test ${test.n} had no clear winner` } : null,
      spanLine: pair ? spanLine(pair) : null,
      approvalLines: pair ? approvalLines(pair) : [],
    };
  });
  // TF-A / TF-B: with nothing running, the latest finished test stays open so its result and table can be read.
  if (!cards.some((c) => c.open)) {
    const finished = [...built].reverse().find((b) => ENDED.includes(b.test.state));
    const card = finished ? cards.find((c) => c.id === finished.test.id) : null;
    if (card) card.open = true;
  }
  return { cards, chip: canvasChip(rows, ready) };
}

/** CT11 / TT6 / TF3: the share link's cards, figures only. Tests not started yet are left out. */
export function buildShareCards(input: { tests: TestInput[]; variants: VariantInput[]; reads: ReadInput[]; now: string }): ShareCard[] {
  const tests = [...input.tests].sort((a, b) => a.n - b.n);
  return tests
    .filter((t) => t.state === "running" || ENDED.includes(t.state))
    .map((test) => {
      const b = build(test, input.variants, input.reads, input.now);
      const state = test.state === "running" ? runningState(b, "share") : restingState(b, tests, "share");
      const rows: ShareRow[] = sortByShare(b.read.variants).map((v) => {
        if (v.muted) return { id: v.id, label: v.label, results: null, cost: RIGHTS_MUTED_SHARE };
        if (!v.judged || v.cost == null) return { id: v.id, label: v.label, results: null, cost: NOT_ENOUGH_SPEND };
        return { id: v.id, label: v.label, results: v.results, cost: money(v.cost, test.currency) };
      });
      return { id: test.id, name: cardName(test, b.variants.map((v) => v.label)), state, headers: shareHeaders(test.kind, b.result), rows };
    });
}
