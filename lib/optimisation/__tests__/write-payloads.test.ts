/**
 * What the optimisation write path sends to Meta, pinned to a committed
 * golden. `apply.ts` decides the arguments; the cron route turns them into
 * `graphPostWithToken(path, body)`. The seams below build that request the
 * same way, and the last test holds the route to it.
 *
 * A deliberate change updates `fixtures/optimisation-write-payloads.json`
 * in the same commit, so review shows what moves on the wire.
 *
 * Run: node --test lib/optimisation/__tests__/write-payloads.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyOptimisationOrPause,
  MAX_WRITES_PER_RUN,
  type ApplyOptimisationDeps,
  type ApplyOptimisationInput,
  type ApplyOutcome,
} from "../apply.ts";
import type { DecisionToInsert } from "../tick-runner.ts";

type WireCall = { method: "POST"; path: string; body: Record<string, unknown> };

const GOLDEN = JSON.parse(
  readFileSync(new URL("./fixtures/optimisation-write-payloads.json", import.meta.url), "utf8"),
) as Record<string, { wire: WireCall[]; outcome: Record<string, unknown> }>;

const LIVE = { dryRun: false, reason: null } as const;

function decision(overrides: Partial<DecisionToInsert> = {}): DecisionToInsert {
  return {
    campaignId: "camp_1",
    adsetId: "adset_1",
    adAccountId: "act_123",
    draftId: "draft-1",
    metric: "cpa",
    metricValue: 8,
    metricWindow: "3d",
    ruleMatched: "Below target CPA → scale (+30%)",
    actionRecommended: "scale_up",
    actionDelta: 30,
    budgetBeforePence: 10000,
    budgetAfterPence: 13000,
    guardrailNote: null,
    reasonText: "cpa=8 matched scale → scale_up +30%.",
    ...overrides,
  };
}

async function run(
  input: Partial<ApplyOptimisationInput>,
  liveBudgetPence: number,
): Promise<{ wire: WireCall[]; outcome: Record<string, unknown> }> {
  const wire: WireCall[] = [];
  const post = async (path: string, body: Record<string, unknown>) => {
    wire.push({ method: "POST", path, body });
    return { success: true };
  };
  const deps: ApplyOptimisationDeps = {
    readAdSetDailyBudget: async () => liveBudgetPence,
    readCampaignDailyBudget: async () => liveBudgetPence,
    updateAdSetDailyBudget: (adsetId, dailyBudgetPence) =>
      post(`/${adsetId}`, { daily_budget: dailyBudgetPence }),
    updateCampaignDailyBudget: (campaignId, dailyBudgetPence) =>
      post(`/${campaignId}`, { daily_budget: dailyBudgetPence }),
    pauseAdSet: (adsetId) => post(`/${adsetId}`, { status: "PAUSED" }),
    insertDecision: async () => {},
    notify: async () => ({ sent: true }),
    now: new Date("2026-08-20T12:00:00Z"),
    log: () => {},
  };
  const result: ApplyOutcome = await applyOptimisationOrPause(
    {
      decision: decision(),
      campaignName: "[20261003CS] Colyn — Purchase",
      adsetName: "Purchase — Broad",
      gates: LIVE,
      writesRemaining: MAX_WRITES_PER_RUN,
      ...input,
    },
    deps,
  );
  const row = result.decision;
  return {
    wire,
    outcome: {
      kind: result.kind,
      wrote: result.wrote,
      dryRun: row.dryRun ?? null,
      applied: row.applied ?? null,
      appliedAt: row.appliedAt ?? null,
      budgetBeforePence: row.budgetBeforePence,
      budgetAfterPence: row.budgetAfterPence,
      guardrailNote: row.guardrailNote,
      metaResponseJson: row.metaResponseJson ?? null,
    },
  };
}

const PAUSE_ARMED: Partial<ApplyOptimisationInput> = {
  pauseWritesEnabled: true,
  pauseFloorBudgetPence: 5000,
  activeAdSetCount: 3,
  pauseCandidatesInCampaign: 1,
  campaignWideBreach: false,
};

function pauseDecision(budgetBeforePence: number): DecisionToInsert {
  return decision({
    actionRecommended: "pause",
    actionDelta: null,
    resultCount: 20,
    budgetBeforePence,
    budgetAfterPence: budgetBeforePence,
    reasonText: "cpa=40 above pause threshold.",
  });
}

const CASES: Record<string, () => ReturnType<typeof run>> = {
  abo_scale_up: () => run({}, 10000),
  cbo_scale_down: () =>
    run(
      {
        decision: decision({
          scope: "campaign",
          actionRecommended: "scale_down",
          actionDelta: -20,
          budgetAfterPence: 8000,
        }),
      },
      10000,
    ),
  pause_reduced_to_floor: () => run({ ...PAUSE_ARMED, decision: pauseDecision(10000) }, 10000),
  paused_at_floor: () => run({ ...PAUSE_ARMED, decision: pauseDecision(5000) }, 5000),
  pause_fourth_gate_closed: () =>
    run({ ...PAUSE_ARMED, pauseWritesEnabled: false, decision: pauseDecision(10000) }, 10000),
  scale_up_shadow: () => run({ gates: { dryRun: true, reason: "not_live" } }, 10000),
};

describe("optimisation write payloads match the committed golden", () => {
  it("the golden has exactly the cases this file runs", () => {
    assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(CASES).sort());
  });

  for (const [name, runCase] of Object.entries(CASES)) {
    it(`${name}: wire request and ledger row are byte-identical to the golden`, async () => {
      const got = await runCase();
      assert.equal(JSON.stringify(got.wire), JSON.stringify(GOLDEN[name]!.wire), `${name} wire`);
      assert.equal(JSON.stringify(got.outcome), JSON.stringify(GOLDEN[name]!.outcome), `${name} outcome`);
    });
  }

  it("the cron route builds the Meta request the way these seams do", () => {
    const route = readFileSync("app/api/cron/optimisation-tick/route.ts", "utf8");
    assert.match(
      route,
      /updateAdSetDailyBudget: \(adsetId, dailyBudgetPence\) =>\s*graphPostWithToken\(`\/\$\{adsetId\}`, \{ daily_budget: dailyBudgetPence \}, token as string\)/,
    );
    assert.match(
      route,
      /updateCampaignDailyBudget: \(campaignId, dailyBudgetPence\) =>\s*graphPostWithToken\(`\/\$\{campaignId\}`, \{ daily_budget: dailyBudgetPence \}, token as string\)/,
    );
    assert.match(
      route,
      /pauseAdSet: \(adsetId\) => graphPostWithToken\(`\/\$\{adsetId\}`, \{ status: "PAUSED" \}, token as string\)/,
    );
    assert.equal((route.match(/graphPostWithToken\(/g) ?? []).length, 3, "no other Meta write in the route");
  });
});
