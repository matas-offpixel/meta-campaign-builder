/**
 * The Test plan panel and the share link's "What we're testing", from the
 * records' expected figures:
 *
 *   TF-A (2026-11-16-creative-testing-3.html): P26-BDAY Test 1 · Tracks,
 *        called at the 48-hour read. £20.00 spent: £13.20 / 8, £4.20 / 2,
 *        £1.80 / 1, £0.80 / 0. £10 a day, 6 % of £160 (6.25).
 *   TF-B: NX26-LOCKLEAD Test 1 · Statics at day 4, no clear winner, at Meta's
 *        minimum: £1.00 a day, 15 % of £6.50. £4.00: £1.92 / 4, £1.64 / 4, £0.44 / 1.
 *   TT-D (2026-11-16-creative-testing-2.html): a second P26-BDAY Test 1 with
 *        Track six muted on day 2 (it spent £10.66). Drawn here with TF2's
 *        running words and TF4's share sums, which replace TT3's.
 *   TF-C: TF-A on the share link.
 *
 * Show and track names from the records only; the figures are the records'
 * invented ones.
 */

import { buildPanel, buildShareCards, type ReadInput, type TestInput, type VariantInput } from "../../lib/creative-tests/panel-view.ts";

export const TEST_PLAN_FRAME_IDS = ["TFA", "TFB", "TTD", "TFC"] as const;

const START = "2026-11-17T08:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(START) + hours * 3_600_000).toISOString();

function test(id: string, n: number, extra: Partial<TestInput>): TestInput {
  return {
    id,
    n,
    kind: "tracks",
    format: "video",
    runs_in: "tests_adset",
    state: "waiting",
    result_event: "initiate_checkout",
    currency: "GBP",
    daily_budget_minor: null,
    budget_pct: null,
    at_minimum: false,
    first_delivery_at: null,
    winner_variant_id: null,
    ...extra,
  };
}

const variant = (testId: string, id: string, position: number, label: string, state = "live"): VariantInput => ({ id, test_id: testId, position, role: "variant", label, state });

// TF-A ------------------------------------------------------------------------

const TFA_TESTS: TestInput[] = [
  test("a1", 1, { state: "called", daily_budget_minor: 1000, budget_pct: 6.25, first_delivery_at: START, winner_variant_id: "a1-two" }),
  test("a2", 2, { kind: "statics", state: "making" }),
  test("a3", 3, { kind: "together", state: "waiting" }),
];
const TFA_VARIANTS: VariantInput[] = [
  variant("a1", "a1-one", 1, "Track one"),
  variant("a1", "a1-two", 2, "Track two"),
  variant("a1", "a1-three", 3, "Track three"),
  variant("a1", "a1-five", 4, "Track five"),
];
const TFA_READS: ReadInput[] = [
  {
    test_id: "a1",
    read_at: at(48),
    variants: [
      { variantId: "a1-two", spend: 13.2, results: 8 },
      { variantId: "a1-one", spend: 4.2, results: 2 },
      { variantId: "a1-five", spend: 1.8, results: 1 },
      { variantId: "a1-three", spend: 0.8, results: 0 },
    ],
  },
];

// TF-B ------------------------------------------------------------------------

const TFB_TESTS: TestInput[] = [test("b1", 1, { kind: "statics", format: "statics", state: "no_clear_winner", result_event: "complete_registration", daily_budget_minor: 100, budget_pct: 15.38, at_minimum: true, first_delivery_at: START })];
const TFB_VARIANTS: VariantInput[] = [variant("b1", "b1-a", 1, "Static A"), variant("b1", "b1-b", 2, "Static B"), variant("b1", "b1-c", 3, "Static C")];
const TFB_READS: ReadInput[] = [
  {
    test_id: "b1",
    read_at: at(96),
    variants: [
      { variantId: "b1-a", spend: 1.92, results: 4 },
      { variantId: "b1-b", spend: 1.64, results: 4 },
      { variantId: "b1-c", spend: 0.44, results: 1 },
    ],
  },
];

// TT-D ------------------------------------------------------------------------

const TTD_TESTS: TestInput[] = [test("d1", 1, { state: "running", daily_budget_minor: 1000, budget_pct: 6.25, first_delivery_at: START })];
const TTD_VARIANTS: VariantInput[] = [variant("d1", "d1-two", 1, "Track two"), variant("d1", "d1-one", 2, "Track one"), variant("d1", "d1-six", 3, "Track six", "muted")];
const TTD_READS: ReadInput[] = [
  {
    test_id: "d1",
    read_at: at(72),
    variants: [
      { variantId: "d1-two", spend: 43.44, results: 24 },
      { variantId: "d1-one", spend: 29.9, results: 13 },
      { variantId: "d1-six", spend: 10.66, results: 0, muted: true },
    ],
  },
];

export const TEST_PLAN_FIXTURES = {
  TFA: { eventCode: "P26-BDAY", tests: TFA_TESTS, variants: TFA_VARIANTS, reads: TFA_READS, now: at(50) },
  TFB: { eventCode: "NX26-LOCKLEAD", tests: TFB_TESTS, variants: TFB_VARIANTS, reads: TFB_READS, now: at(97) },
  TTD: { eventCode: "P26-BDAY", tests: TTD_TESTS, variants: TTD_VARIANTS, reads: TTD_READS, now: at(73) },
} as const;

export function testPlanFixtureView(id: "TFA" | "TFB" | "TTD") {
  const f = TEST_PLAN_FIXTURES[id];
  return buildPanel({ eventCode: f.eventCode, tests: [...f.tests], variants: [...f.variants], reads: [...f.reads], now: f.now });
}

export function testPlanShareFixture() {
  const f = TEST_PLAN_FIXTURES.TFA;
  return buildShareCards({ tests: [...f.tests], variants: [...f.variants], reads: [...f.reads], now: f.now });
}
