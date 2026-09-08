import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { scheduledDayCount } from "../budget-split.ts";
import {
  phaseWindowTotal,
  reconcileCampaignPlanPhases,
} from "../phase-reconcile.ts";
import {
  CAMPAIGN_PLAN_PHASES,
  deriveCampaignPlanPhase,
  isCampaignPlanPhase,
} from "../phase.ts";

describe("inclusive day counts — Folamour and D.O.D fixtures", () => {
  it("counts both ends: Folamour 59 / 47, D.O.D 100 / 1", () => {
    assert.equal(scheduledDayCount("2026-08-26", "2026-10-23"), 59);
    assert.equal(scheduledDayCount("2026-09-07", "2026-10-23"), 47);
    assert.equal(scheduledDayCount("2026-08-27", "2026-12-04"), 100);
    assert.equal(scheduledDayCount("2026-08-27", "2026-08-27"), 1);
  });
});

describe("phaseWindowTotal", () => {
  it("multiplies the daily figure by inclusive days — D.O.D is 35 × 1, not 35 as a lifetime", () => {
    assert.equal(phaseWindowTotal(35, "2026-08-27", "2026-08-27"), 35);
    assert.equal(phaseWindowTotal(0, "2026-09-07", "2026-10-23"), 0);
    assert.equal(phaseWindowTotal(10, "2026-09-07", "2026-10-23"), 470);
    assert.equal(phaseWindowTotal(35, null, "2026-08-27"), null);
  });
});

describe("reconcileCampaignPlanPhases", () => {
  it("leaves Folamour's £3,000 unallocated when the three £0 phases sum to 0", () => {
    const result = reconcileCampaignPlanPhases({
      campaignTotal: 3000,
      phases: [
        { totalDailyBudget: 0, startDate: "2026-09-07", endDate: "2026-10-23" },
        { totalDailyBudget: 0, startDate: "2026-09-07", endDate: "2026-10-23" },
        { totalDailyBudget: 0, startDate: "2026-09-07", endDate: "2026-10-23" },
      ],
    });
    assert.deepEqual(result.phaseTotals, [0, 0, 0]);
    assert.equal(result.allocated, 0);
    assert.equal(result.unallocated, 3000);
  });

  it("treats D.O.D's one-day phase as daily × 1 against the £3,000 ad plan", () => {
    const result = reconcileCampaignPlanPhases({
      campaignTotal: 3000,
      phases: [
        { totalDailyBudget: 35, startDate: "2026-08-27", endDate: "2026-08-27" },
      ],
    });
    assert.deepEqual(result.phaseTotals, [35]);
    assert.equal(result.allocated, 35);
    assert.equal(result.unallocated, 2965);
  });

  it("returns a signed over-commit without clamping", () => {
    const result = reconcileCampaignPlanPhases({
      campaignTotal: 100,
      phases: [
        { totalDailyBudget: 80, startDate: "2026-09-01", endDate: "2026-09-02" },
        { totalDailyBudget: 50, startDate: "2026-09-01", endDate: "2026-09-02" },
      ],
    });
    assert.deepEqual(result.phaseTotals, [160, 100]);
    assert.equal(result.allocated, 260);
    assert.equal(result.unallocated, -160);
    assert.ok(result.unallocated < 0);
  });
});

describe("deriveCampaignPlanPhase — the eight prod rows", () => {
  it("leaves D.O.D null: start is before general sale and there is no presale span", () => {
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-08-27",
        presaleAt: null,
        generalSaleAt: "2026-09-04T13:00:00+00:00",
        soldOutAt: null,
      }),
      null,
    );
  });

  it("leaves both Jamie Jones rows null: the event has no sale dates", () => {
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-08-26",
        presaleAt: null,
        generalSaleAt: null,
        soldOutAt: null,
      }),
      null,
    );
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: null,
        presaleAt: null,
        generalSaleAt: null,
        soldOutAt: null,
      }),
      null,
    );
  });

  it("maps Mall Grab, DJ EZ, and all three Folamour rows to on_sale", () => {
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-08-27",
        presaleAt: "2026-08-06T09:00:00+00:00",
        generalSaleAt: "2026-08-07T09:00:00+00:00",
        soldOutAt: null,
      }),
      "on_sale",
    );
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-09-07",
        presaleAt: "2026-08-21T11:00:00+00:00",
        generalSaleAt: "2026-08-21T13:00:00+00:00",
        soldOutAt: null,
      }),
      "on_sale",
    );
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-09-07",
        presaleAt: null,
        generalSaleAt: "2026-09-03T13:00:00+00:00",
        soldOutAt: null,
      }),
      "on_sale",
    );
  });

  it("does not default a missing-dates event to on_sale", () => {
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-09-01",
        presaleAt: null,
        generalSaleAt: null,
        soldOutAt: null,
      }),
      null,
    );
  });

  it("returns presale only inside the presale span, and waiting_list only after a hand-set sell-out", () => {
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-08-06",
        presaleAt: "2026-08-06T09:00:00+00:00",
        generalSaleAt: "2026-08-07T09:00:00+00:00",
        soldOutAt: null,
      }),
      "presale",
    );
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-09-20",
        presaleAt: null,
        generalSaleAt: "2026-09-03T13:00:00+00:00",
        soldOutAt: "2026-09-15T00:00:00+00:00",
      }),
      "waiting_list",
    );
    assert.equal(
      deriveCampaignPlanPhase({
        startDate: "2026-09-10",
        presaleAt: null,
        generalSaleAt: "2026-09-03T13:00:00+00:00",
        soldOutAt: "2026-09-15T00:00:00+00:00",
      }),
      "on_sale",
    );
  });

  it("accepts exactly the three phase values", () => {
    assert.deepEqual(CAMPAIGN_PLAN_PHASES, [
      "presale",
      "on_sale",
      "waiting_list",
    ]);
    assert.equal(isCampaignPlanPhase("on_sale"), true);
    assert.equal(isCampaignPlanPhase("Event day"), false);
    assert.equal(isCampaignPlanPhase("Announce"), false);
  });
});

describe("migration 173 — phase column, sold_out_at, backfill", () => {
  const sql = readFileSync(
    "supabase/migrations/173_campaign_plans_phase.sql",
    "utf8",
  );

  it("adds campaign_plans.phase constrained to the three values, nullable", () => {
    assert.match(sql, /alter table campaign_plans/);
    assert.match(sql, /add column if not exists phase text/);
    assert.match(sql, /'presale',\s*'on_sale',\s*'waiting_list'/);
    assert.match(sql, /phase is null or phase in/);
    assert.match(sql, /Do not apply in this run/);
  });

  it("adds events.sold_out_at and forbids inferring it from capacity", () => {
    assert.match(sql, /alter table events/);
    assert.match(sql, /add column if not exists sold_out_at timestamptz/);
    assert.match(sql, /Do not infer from ticket counts or capacity/);
  });

  it("does not touch ad_plan_days.phase_marker", () => {
    assert.doesNotMatch(sql, /alter table ad_plan_days/);
    assert.match(sql, /phase_marker/);
    assert.match(sql, /Do not reuse/);
  });

  it("names the eight rows and does not default anyone to on_sale", () => {
    assert.match(sql, /299dd4e5-cc76-4419-a5a0-eec5896c95ef/);
    assert.match(sql, /abf386e4-c234-4a41-927a-682188eed0e1/);
    assert.match(sql, /49803b0d-e352-4115-aeb9-88de31d8b3d3/);
    assert.match(sql, /fb059252-b3a0-47f0-970c-6e7028a69018/);
    assert.match(sql, /cbd199a5-f30c-4457-ae33-43d5615c7e13/);
    assert.match(sql, /20a94559-b03b-4c14-abf1-c0a6ac0be9a0/);
    assert.match(sql, /c565fdde-1dda-4f6b-ab88-4345c0067c59/);
    assert.match(sql, /18dab888-1aef-492c-8145-2f9c12550f9f/);
    assert.match(sql, /does not default anyone\s+to on_sale/i);
    assert.match(sql, /update campaign_plans p/);
  });
});

describe("migration 174 — unique (event_id, phase), not applied", () => {
  const sql = readFileSync(
    "supabase/migrations/174_campaign_plans_event_phase_unique.sql",
    "utf8",
  );

  it("declares unique (event_id, phase) and names the three Folamour ids", () => {
    assert.match(sql, /unique \(event_id, phase\)/);
    assert.match(sql, /DO NOT APPLY/);
    assert.match(sql, /Do not apply in this run/);
    assert.match(sql, /20a94559-b03b-4c14-abf1-c0a6ac0be9a0/);
    assert.match(sql, /c565fdde-1dda-4f6b-ab88-4345c0067c59/);
    assert.match(sql, /18dab888-1aef-492c-8145-2f9c12550f9f/);
  });
});
