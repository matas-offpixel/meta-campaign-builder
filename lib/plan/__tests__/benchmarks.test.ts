import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  BENCHMARK_ON_READ_REMOVAL,
  BENCHMARK_VIEW,
  percentileCont,
  planBenchmark,
  type BenchmarkRow,
  type BenchmarkRun,
} from "../benchmarks.ts";
import {
  PLAN_BENCHMARK_WINDOW,
  PLAN_BENCHMARK_WINDOW_FOR_UNIT,
  windowedBenchmarkRead,
  type PlanBenchmarkWindowUnit,
} from "../benchmark-window.ts";

/** Audit two §1 — lifetime / unwindowed NX signup costs. Labelled lifetime. */
const NX_SIGNUP_LIFETIME = {
  label: "lifetime" as const,
  costs: [0.9, 1.46, 2.03, 2.12, 5.63],
  median: 2.03,
  iqr: [1.46, 2.12] as const,
};

/**
 * Production-shaped view rows: Electric Brixton × NX Newcastle × signup,
 * days strictly before general sale (G34). Costs £2.75 · £1.32 · £0.87 ·
 * £1.67 · £0.54 → median £1.32, IQR £0.87–£1.67.
 */
const NX_WINDOWED_ROWS: BenchmarkRow[] = [
  row("eb", "nx newcastle", "djez", "NX26-DJEZ", "2026-10-02", "signup", 2.75),
  row("eb", "nx newcastle", "mf", "NX26-MF", "2026-10-16", "signup", 1.32),
  row("eb", "nx newcastle", "folamour", "NX26-FOLAMOUR", "2026-10-23", "signup", 0.87),
  row("eb", "nx newcastle", "eed", "NX26-EED", "2026-11-13", "signup", 1.67),
  row("eb", "nx newcastle", "ipc", "NX26-IPC", "2026-11-21", "signup", 0.54),
];

const J2_OTHERS: BenchmarkRun[] = [
  { eventId: "fabric", eventCode: "UTB0042-New", eventDate: "2026-04-20", cost: 0.63 },
  { eventId: "melodic", eventCode: "UTB0043-New", eventDate: "2026-04-20", cost: 6.46 },
  { eventId: "fragrance", eventCode: "UTB0044-New", eventDate: "2026-04-20", cost: 2.38 },
  { eventId: "innervisions", eventCode: "UTB0045-New", eventDate: "2026-04-20", cost: 3.31 },
];

function row(
  client_id: string,
  venue_key: string,
  event_id: string,
  event_code: string,
  event_date: string,
  unit: string,
  cost: number,
  channel = unit === "ticket" ? "all" : "meta",
): BenchmarkRow {
  return { client_id, venue_key, event_id, event_code, event_date, unit, channel, cost };
}

describe("percentile_cont matches the audit numbers", () => {
  it("Electric Brixton × NX × signup lifetime is n = 5, median £2.03, IQR £1.46–£2.12", () => {
    const sorted = [...NX_SIGNUP_LIFETIME.costs].sort((a, b) => a - b);
    assert.equal(NX_SIGNUP_LIFETIME.label, "lifetime");
    assert.equal(sorted.length, 5);
    assert.equal(percentileCont(sorted, 0.5), NX_SIGNUP_LIFETIME.median);
    assert.equal(percentileCont(sorted, 0.25), NX_SIGNUP_LIFETIME.iqr[0]);
    assert.equal(percentileCont(sorted, 0.75), NX_SIGNUP_LIFETIME.iqr[1]);
  });

  it("NX × signup from the view's window is n = 5, median £1.32, IQR £0.87–£1.67", () => {
    const chip = planBenchmark({
      rows: NX_WINDOWED_ROWS,
      clientId: "eb",
      venueKey: "nx newcastle",
      venueLabel: "NX",
      unit: "signup",
      excludeEventId: "dod",
    });
    assert.ok(chip);
    assert.equal(chip.n, 5);
    assert.equal(chip.value, 1.32);
    assert.deepEqual(chip.band, [0.87, 1.67]);
    assert.equal(chip.sentence, "from 5 other shows at NX");
    assert.equal(chip.lineKind, "measured");
  });

  it("Junction 2 × Boston Manor Park × ticket: Hard Techno is £4.68; usual £2.85 from the other four", () => {
    const rows: BenchmarkRow[] = [
      ...J2_OTHERS.map((run) =>
        row("j2", "boston manor park", run.eventId, run.eventCode, run.eventDate!, "ticket", run.cost),
      ),
      row("j2", "boston manor park", "hard-techno", "UTB0046-New", "2026-08-02", "ticket", 4.68),
    ];
    const chip = planBenchmark({
      rows,
      clientId: "j2",
      venueKey: "boston manor park",
      venueLabel: "Boston Manor Park",
      unit: "ticket",
      excludeEventId: "hard-techno",
    });
    assert.ok(chip);
    assert.equal(chip.n, 4);
    assert.equal(chip.value, 2.85);
    assert.deepEqual(chip.band, [1.94, 4.1]);
    assert.equal(chip.sentence, "from 4 other shows at Boston Manor Park");
    const hardTechno = rows.find((item) => item.event_id === "hard-techno");
    assert.equal(hardTechno?.cost, 4.68);
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
    const chip = planBenchmark({
      rows: [NX_WINDOWED_ROWS[1]!],
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
});

describe("PLAN_BENCHMARK_WINDOW — one window per unit", () => {
  const days = [
    { day: "2026-08-20", spend: 100, signups: 10, purchases: 0, clicks: 40, lpv: 20, leads: 4, tickets: 0, reach: 8000 },
    { day: "2026-09-03", spend: 80, signups: 8, purchases: 0, clicks: 30, lpv: 16, leads: 2, tickets: 0, reach: 6000 },
    { day: "2026-09-04", spend: 50, signups: 2, purchases: 10, clicks: 10, lpv: 4, leads: 1, tickets: 5, reach: 2000 },
    { day: "2026-09-05", spend: 50, signups: 1, purchases: 10, clicks: 8, lpv: 3, leads: 0, tickets: 5, reach: 2000 },
    { day: "2026-09-06", spend: 20, signups: 0, purchases: 4, clicks: 2, lpv: 1, leads: 0, tickets: 0, reach: 500 },
  ];
  const gen = "2026-09-04";

  const expected: Record<PlanBenchmarkWindowUnit, (typeof PLAN_BENCHMARK_WINDOW)[keyof typeof PLAN_BENCHMARK_WINDOW]> = {
    signup: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
    click: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
    lpv: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
    lead: PLAN_BENCHMARK_WINDOW.beforeGeneralSale,
    purchase: PLAN_BENCHMARK_WINDOW.onOrAfterGeneralSale,
    ticket: PLAN_BENCHMARK_WINDOW.toLastTicketEntry,
    view: PLAN_BENCHMARK_WINDOW.wholeRun,
  };

  for (const unit of Object.keys(expected) as PlanBenchmarkWindowUnit[]) {
    it(`${unit} uses ${expected[unit]}`, () => {
      assert.equal(PLAN_BENCHMARK_WINDOW_FOR_UNIT[unit], expected[unit]);
      const read = windowedBenchmarkRead(unit, days, gen);
      assert.equal(read.window, expected[unit]);
      if (unit === "signup" || unit === "click" || unit === "lpv" || unit === "lead") {
        assert.equal(read.spend, 180);
      }
      if (unit === "purchase") {
        assert.equal(read.spend, 120);
        assert.equal(read.results, 24);
        assert.equal(read.cost, 5);
      }
      if (unit === "ticket") {
        assert.equal(read.spend, 280);
        assert.equal(read.results, 10);
      }
      if (unit === "view") {
        assert.equal(read.spend, 300);
        assert.equal(read.results, 18.5);
      }
    });
  }

  it("purchase ignores pre-sale days", () => {
    const read = windowedBenchmarkRead("purchase", days, gen);
    assert.equal(read.spend, 120);
    assert.ok(read.spend < 300, "pre-sale spend must not divide purchases");
    assert.equal(read.results, 24);
  });
});

describe("§1.5 removal — the view is the only median", () => {
  it("names the view and the window constants", () => {
    assert.equal(BENCHMARK_VIEW, "campaign_plan_benchmarks_v");
    assert.equal(PLAN_BENCHMARK_WINDOW.perSignup, "before-general-sale");
    assert.equal(PLAN_BENCHMARK_WINDOW.perTicket, "to-last-ticket-entry");
    assert.match(BENCHMARK_ON_READ_REMOVAL, /campaign_plan_benchmarks_v/);
  });

  it("168 mirrors PLAN_BENCHMARK_WINDOW and TikTok click → tiktok_clicks only", () => {
    const sql = readFileSync("supabase/migrations/168_campaign_plan_benchmarks_v.sql", "utf8");
    assert.match(sql, /create or replace view campaign_plan_benchmarks_v/i);
    assert.match(sql, /before-general-sale/);
    assert.match(sql, /on-or-after-general-sale/);
    assert.match(sql, /to-last-ticket-entry/);
    assert.match(sql, /whole-run/);
    assert.match(sql, /u\.unit = 'purchase'/);
    assert.match(sql, /r\.date >= \(w\.general_sale_at/);
    assert.match(sql, /u\.unit = 'view'/);
    assert.match(sql, /meta_reach \/ 1000/);
    assert.match(sql, /tiktok_clicks/);
    const body = sql.slice(sql.indexOf("create or replace view"));
    assert.doesNotMatch(body, /tiktok_results/);
    assert.match(sql, /not-yet/);
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
