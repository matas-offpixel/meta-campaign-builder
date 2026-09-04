import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BACKFILL_DEFAULT_ARM,
  objectiveLadderMismatch,
  planPresetBackfill,
  presetFromCampaign,
  renderBackfillTable,
  type BackfillCampaign,
  type BackfillClient,
} from "../preset-backfill.ts";
import {
  industrySeedPreset,
  materialiseStrategy,
  type ClientOptimisationPreset,
} from "../presets.ts";
import type { OptimisationStrategySettings } from "../../types.ts";

const CLIENTS: BackfillClient[] = [
  { id: "c-ironworks", name: "IRONWORKS" },
  { id: "c-nxloves", name: "NX Loves" },
];

/** A real-shaped registration strategy: £2 CPR target, five bands. */
function registrationStrategy(target: number): OptimisationStrategySettings {
  return {
    mode: "benchmarks",
    rules: [
      {
        id: "r-cpr",
        name: "Primary Rule Set — Cost per Registration",
        metric: "cpr",
        timeWindow: "7d",
        enabled: true,
        priority: "primary",
        accountBenchmarkValue: 1.6,
        campaignTargetValue: target,
        useOverride: true,
        thresholds: [
          { id: "t0", operator: "below", value: target * 0.4, action: "increase_budget", actionValue: 30, label: "" },
          { id: "t1", operator: "between", value: target * 0.4, valueTo: target * 0.65, action: "increase_budget", actionValue: 15, label: "" },
          { id: "t2", operator: "between", value: target * 0.65, valueTo: target * 1.25, action: "decrease_budget", actionValue: 0, label: "" },
          { id: "t3", operator: "between", value: target * 1.25, valueTo: target * 1.75, action: "decrease_budget", actionValue: 25, label: "" },
          { id: "t4", operator: "above", value: target * 1.75, action: "pause", label: "" },
        ],
      },
    ],
    guardrails: {
      baseCampaignBudget: 120,
      maxExpansionPercent: 50,
      hardBudgetCeiling: 180,
      ceilingBehaviour: "partial",
      maxDailyIncreasePercent: 40,
      cooldownHours: 12,
    },
  };
}

const FIXTURE: BackfillCampaign[] = [
  {
    id: "cam-1",
    name: "IRW OHD — old",
    clientId: "c-ironworks",
    objective: "registration",
    status: "published",
    updatedAt: "2026-06-01T00:00:00.000Z",
    strategy: registrationStrategy(3),
  },
  {
    id: "cam-2",
    name: "IRW OHD — latest",
    clientId: "c-ironworks",
    objective: "registration",
    status: "published",
    updatedAt: "2026-08-20T00:00:00.000Z",
    strategy: registrationStrategy(2),
  },
  {
    id: "cam-3",
    name: "IRW draft, never launched",
    clientId: "c-ironworks",
    objective: "registration",
    status: "draft",
    updatedAt: "2026-09-01T00:00:00.000Z",
    strategy: registrationStrategy(9),
  },
  {
    id: "cam-4",
    name: "IRW traffic",
    clientId: "c-ironworks",
    objective: "traffic",
    status: "published",
    updatedAt: "2026-07-01T00:00:00.000Z",
    // Mode none — nothing to learn from.
    strategy: { ...registrationStrategy(2), mode: "none" },
  },
  {
    id: "cam-5",
    name: "NX purchase",
    clientId: "c-nxloves",
    objective: "purchase",
    status: "published",
    updatedAt: "2026-08-01T00:00:00.000Z",
    strategy: null,
  },
  {
    id: "cam-6",
    name: "NX — signups copy flipped to purchase",
    clientId: "c-nxloves",
    objective: "purchase",
    status: "published",
    updatedAt: "2026-08-15T00:00:00.000Z",
    // The real prod shape: a CPR ladder wearing a purchase objective.
    strategy: registrationStrategy(2),
  },
  {
    id: "cam-7",
    name: "orphan — client deleted",
    clientId: "c-gone",
    objective: "registration",
    status: "published",
    updatedAt: "2026-08-01T00:00:00.000Z",
    strategy: registrationStrategy(2),
  },
];

describe("planPresetBackfill — dry run on a fixture", () => {
  const plan = planPresetBackfill({ clients: CLIENTS, campaigns: FIXTURE, existing: [] });

  it("produces one row per client × objective, orphans excluded", () => {
    assert.deepEqual(
      plan.rows.map((r) => `${r.clientName}/${r.objective}`).sort(),
      ["IRONWORKS/registration", "IRONWORKS/traffic", "NX Loves/purchase"],
    );
  });

  it("seeds from the most recent PUBLISHED campaign, not the newest draft", () => {
    const row = plan.rows.find((r) => r.objective === "registration");
    assert.ok(row);
    assert.equal(row.outcome, "from campaign");
    assert.equal(row.sourceCampaignId, "cam-2");
    // cam-3 is newer but is a draft; cam-2's £2 target is the denominator.
    assert.equal(row.benchmarkTarget, 2);
  });

  it("re-expresses that campaign's bands as multipliers of its own target", () => {
    const row = plan.rows.find((r) => r.objective === "registration");
    assert.ok(row);
    assert.deepEqual(
      row.rules[0].thresholds.map((t) => t.multiplier),
      [0.4, 0.4, 0.65, 1.25, 1.75],
    );
    assert.equal(row.bandCount, 5);
  });

  it("carries the campaign's guardrails minus the budget-derived two", () => {
    const row = plan.rows.find((r) => r.objective === "registration");
    assert.ok(row);
    assert.deepEqual(row.guardrails, {
      maxExpansionPercent: 50,
      ceilingBehaviour: "partial",
      maxDailyIncreasePercent: 40,
      cooldownHours: 12,
    });
  });

  it("falls back to the industry seed when the only campaign has mode none", () => {
    const row = plan.rows.find((r) => r.objective === "traffic");
    assert.ok(row);
    assert.equal(row.outcome, "industry seed");
    assert.equal(row.sourceCampaignId, null);
    assert.equal(row.metric, "lpv_cost");
  });

  it("refuses a ladder that cannot price the objective, and names the campaign", () => {
    // cam-6 is the most recent published purchase campaign, but its ladder
    // is CPR — materialising it would ignore every per-purchase target.
    const row = plan.rows.find((r) => r.objective === "purchase");
    assert.ok(row);
    assert.equal(row.outcome, "seed · mismatch");
    assert.equal(row.metric, "cpa");
    assert.equal(row.sourceCampaignId, "cam-6");
    assert.ok(row.rules.every((r) => r.metric !== "cpr"));
  });

  it("never arms anything — every row is off", () => {
    assert.equal(BACKFILL_DEFAULT_ARM, "off");
    for (const row of plan.rows) assert.equal(row.defaultArm, "off", row.objective);
  });

  it("counts every row as a write when no preset exists yet", () => {
    assert.equal(plan.writes, 3);
    assert.equal(plan.skipped, 0);
  });
});

describe("planPresetBackfill — existing presets", () => {
  const existing: ClientOptimisationPreset[] = [
    {
      id: "p1",
      clientId: "c-ironworks",
      objective: "registration",
      version: 4,
      defaultArm: "shadow",
      mode: "custom",
      rules: [],
      guardrails: { maxExpansionPercent: 25, ceilingBehaviour: "stop" },
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ];

  it("leaves a hand-tuned preset alone rather than clobbering it", () => {
    const plan = planPresetBackfill({ clients: CLIENTS, campaigns: FIXTURE, existing });
    const row = plan.rows.find((r) => r.objective === "registration");
    assert.ok(row);
    assert.equal(row.outcome, "exists");
    assert.equal(row.willWrite, false);
    assert.equal(plan.writes, 2);
    assert.equal(plan.skipped, 1);
  });

  it("matches on client AND objective, not either alone", () => {
    const plan = planPresetBackfill({
      clients: CLIENTS,
      campaigns: FIXTURE,
      existing: [{ ...existing[0], clientId: "c-nxloves" }],
    });
    // The NX preset is for registration, which NX does not run — so
    // IRONWORKS/registration is still a write and nothing is skipped.
    assert.equal(plan.writes, 3);
    assert.equal(plan.skipped, 0);
  });
});

describe("objectiveLadderMismatch", () => {
  it("flags a CPR ladder wearing a purchase objective", () => {
    const preset = presetFromCampaign("c-nxloves", "purchase", FIXTURE[5]);
    assert.ok(preset);
    assert.equal(objectiveLadderMismatch(preset), true);
  });

  it("passes a CPR ladder on a registration objective", () => {
    const preset = presetFromCampaign("c-ironworks", "registration", FIXTURE[1]);
    assert.ok(preset);
    assert.equal(objectiveLadderMismatch(preset), false);
  });

  it("passes every industry seed — the seed is coherent by construction", () => {
    for (const objective of [
      "purchase",
      "registration",
      "traffic",
      "awareness",
      "engagement",
    ] as const) {
      assert.equal(
        objectiveLadderMismatch(industrySeedPreset("c-1", objective)),
        false,
        objective,
      );
    }
  });
});

describe("presetFromCampaign", () => {
  it("returns null for a campaign with no ladder to learn from", () => {
    assert.equal(
      presetFromCampaign("c-ironworks", "purchase", FIXTURE[4]),
      null,
    );
  });

  it("round-trips: campaign ladder → preset → materialise at the same target", () => {
    // The proof that the backfill is lossless where it claims to be —
    // re-materialising at the source campaign's own target reproduces its
    // band values.
    const source = FIXTURE[1];
    const preset = presetFromCampaign("c-ironworks", "registration", source);
    assert.ok(preset);
    const strategy = materialiseStrategy(preset, {
      value: 2,
      unit: "reg",
      budgetAmount: 120,
      materialisedAt: "2026-09-04T12:00:00.000Z",
    });
    const original = source.strategy!.rules[0].thresholds;
    const rebuilt = strategy.rules[0].thresholds;
    assert.equal(rebuilt.length, original.length);
    for (let i = 0; i < original.length; i += 1) {
      assert.equal(rebuilt[i].value, original[i].value, `band ${i} value`);
      assert.equal(rebuilt[i].valueTo, original[i].valueTo, `band ${i} valueTo`);
      assert.equal(rebuilt[i].action, original[i].action, `band ${i} action`);
    }
  });
});

describe("renderBackfillTable", () => {
  it("prints a block per client with the outcome and source", () => {
    const table = renderBackfillTable(
      planPresetBackfill({ clients: CLIENTS, campaigns: FIXTURE, existing: [] }),
    );
    assert.match(table, /IRONWORKS {2}\(c-ironworks\)/);
    assert.match(table, /NX Loves {2}\(c-nxloves\)/);
    assert.match(table, /registration\s+from campaign\s+cpr/);
    assert.match(table, /traffic\s+industry seed/);
    assert.match(table, /IRW OHD — latest/);
    assert.match(table, /3 to write · 0 already present · 3 pairs/);
  });

  it("prints the mismatch footer naming what to fix, not just a marker", () => {
    const table = renderBackfillTable(
      planPresetBackfill({ clients: CLIENTS, campaigns: FIXTURE, existing: [] }),
    );
    assert.match(table, /! 1 pair\(s\) fell back to the seed/);
    assert.match(table, /NX Loves \/ purchase ← NX — signups copy flipped to purchase/);
  });

  it("says so plainly when there is nothing to do", () => {
    const table = renderBackfillTable(
      planPresetBackfill({ clients: [], campaigns: [], existing: [] }),
    );
    assert.match(table, /No client × objective pairs found/);
  });
});
