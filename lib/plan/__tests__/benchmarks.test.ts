import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BENCHMARK_ON_READ_REMOVAL,
  BENCHMARK_VIEW,
  metricChipBenchmarkFromRuns,
  percentileCont,
  planBenchmark,
  type BenchmarkRow,
  type BenchmarkRun,
} from "../benchmarks.ts";
import { PLAN_BENCHMARK_WINDOW } from "../benchmark-window.ts";

/** Audit two §1 — lifetime / unwindowed NX signup costs. */
const NX_LIFETIME_COSTS = [0.9, 1.46, 2.03, 2.12, 5.63];

/** Brief §4 — same five NX runs, days before general sale (G34). */
const NX_WINDOWED_COSTS = [0.54, 0.87, 1.32, 1.67, 2.75];

const NX_RUNS: BenchmarkRun[] = [
  { eventId: "djez", eventCode: "NX26-DJEZ", eventDate: "2026-10-02", cost: 2.03 },
  { eventId: "mf", eventCode: "NX26-MF", eventDate: "2026-10-16", cost: 5.63 },
  { eventId: "folamour", eventCode: "NX26-FOLAMOUR", eventDate: "2026-10-23", cost: 0.9 },
  { eventId: "eed", eventCode: "NX26-EED", eventDate: "2026-11-13", cost: 2.12 },
  { eventId: "ipc", eventCode: "NX26-IPC", eventDate: "2026-11-21", cost: 1.46 },
];

const J2_OTHERS: BenchmarkRun[] = [
  { eventId: "fabric", eventCode: "UTB0042-New", eventDate: "2026-04-20", cost: 0.63 },
  { eventId: "melodic", eventCode: "UTB0043-New", eventDate: "2026-04-20", cost: 6.46 },
  { eventId: "fragrance", eventCode: "UTB0044-New", eventDate: "2026-04-20", cost: 2.38 },
  { eventId: "innervisions", eventCode: "UTB0045-New", eventDate: "2026-04-20", cost: 3.31 },
];

describe("percentile_cont matches the audit numbers", () => {
  it("Electric Brixton × NX × signup lifetime is n = 5, median £2.03, IQR £1.46–£2.12", () => {
    const sorted = [...NX_LIFETIME_COSTS].sort((a, b) => a - b);
    assert.equal(sorted.length, 5);
    assert.equal(percentileCont(sorted, 0.5), 2.03);
    assert.equal(percentileCont(sorted, 0.25), 1.46);
    assert.equal(percentileCont(sorted, 0.75), 2.12);
  });

  it("G34 windowed NX signup is a different set — recorded, not silently swapped", () => {
    const sorted = [...NX_WINDOWED_COSTS].sort((a, b) => a - b);
    assert.notDeepEqual(sorted, [...NX_LIFETIME_COSTS].sort((a, b) => a - b));
    assert.equal(percentileCont(sorted, 0.5), 1.32);
  });

  it("Junction 2 × Boston Manor Park × ticket usual is £2.85 from 4 other shows, band £1.94–£4.10", () => {
    const chip = metricChipBenchmarkFromRuns({
      runs: J2_OTHERS,
      venueLabel: "Boston Manor Park",
    });
    assert.ok(chip);
    assert.equal(chip.n, 4);
    assert.equal(chip.value, 2.85);
    assert.deepEqual(chip.band, [1.94, 4.1]);
    assert.equal(chip.sentence, "from 4 other shows at Boston Manor Park");
    assert.equal(chip.lineKind, "measured");
  });

  it("Hard Techno itself is £4.68 and is excluded from its own usual", () => {
    const chip = metricChipBenchmarkFromRuns({
      runs: [
        ...J2_OTHERS,
        { eventId: "hard-techno", eventCode: "UTB0046-New", eventDate: "2026-08-02", cost: 4.68 },
      ],
      excludeEventId: "hard-techno",
      venueLabel: "Boston Manor Park",
    });
    assert.ok(chip);
    assert.equal(chip.value, 2.85);
    assert.equal(chip.n, 4);
  });
});

describe("planBenchmark ladder", () => {
  it("n = 0 is undefined — the face draws not-yet, this function does not invent", () => {
    assert.equal(
      planBenchmark({
        rows: [],
        clientId: "eb",
        venueKey: "nx newcastle",
        venueLabel: "NX",
        unit: "signup",
      }),
      undefined,
    );
  });

  it("n = 1 is a line, no band, from 1 other show", () => {
    const rows: BenchmarkRow[] = [
      {
        client_id: "eb",
        venue_key: "nx newcastle",
        event_id: "mf",
        event_code: "NX26-MF",
        event_date: "2026-10-16",
        unit: "signup",
        channel: "meta",
        cost: 2.75,
      },
    ];
    const chip = planBenchmark({
      rows,
      clientId: "eb",
      venueKey: "nx newcastle",
      venueLabel: "NX",
      unit: "signup",
      excludeEventId: "eed",
    });
    assert.ok(chip);
    assert.equal(chip.n, 1);
    assert.equal(chip.band, undefined);
    assert.equal(chip.lineKind, "estimated");
    assert.equal(chip.sentence, "from 1 other show at NX");
  });

  it("n ≥ 3 is the venue median + band from the lifetime NX fixture", () => {
    const rows: BenchmarkRow[] = NX_RUNS.map((run) => ({
      client_id: "eb",
      venue_key: "nx newcastle",
      event_id: run.eventId,
      event_code: run.eventCode,
      event_date: run.eventDate,
      unit: "signup",
      channel: "meta",
      cost: run.cost,
    }));
    const chip = planBenchmark({
      rows,
      clientId: "eb",
      venueKey: "nx newcastle",
      venueLabel: "NX",
      unit: "signup",
      excludeEventId: "dod",
    });
    assert.ok(chip);
    assert.equal(chip.n, 5);
    assert.equal(chip.value, 2.03);
    assert.deepEqual(chip.band, [1.46, 2.12]);
    assert.equal(chip.sentence, "from 5 other shows at NX");
    assert.equal(chip.lineKind, "measured");
  });
});

describe("§1.5 removal — the view is the only median", () => {
  it("names the view and the window constants", () => {
    assert.equal(BENCHMARK_VIEW, "campaign_plan_benchmarks_v");
    assert.equal(PLAN_BENCHMARK_WINDOW.perSignup, "before-general-sale");
    assert.equal(PLAN_BENCHMARK_WINDOW.perTicket, "to-last-ticket-entry");
    assert.match(BENCHMARK_ON_READ_REMOVAL, /campaign_plan_benchmarks_v/);
  });

  it("168 is the view and applies the two windows", () => {
    const sql = readFileSync("supabase/migrations/168_campaign_plan_benchmarks_v.sql", "utf8");
    assert.match(sql, /create or replace view campaign_plan_benchmarks_v/i);
    assert.match(sql, /general_sale_at/);
    assert.match(sql, /last_ticket_day/);
    assert.match(sql, /venue_key/);
    assert.match(sql, /days only/i);
  });

  it("no other plan file computes a median of cost-per-result", () => {
    const files = [
      "lib/plan/canvas.ts",
      "lib/plan/canvas-inputs.ts",
      "lib/optimisation-rules.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /percentileCont|percentile_cont/);
    }
  });
});
