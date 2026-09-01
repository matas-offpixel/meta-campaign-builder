/**
 * Tests for lib/optimisation/apply.ts — PR B executor.
 *
 * Run: node --test lib/optimisation/__tests__/apply.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyOptimisationDecision,
  MAX_WRITES_PER_RUN,
  type ApplyOptimisationDeps,
  type ApplyOptimisationInput,
} from "../apply.ts";
import type { DecisionToInsert } from "../tick-runner.ts";
import type { NotifyOptions } from "../../notify/slack.ts";

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

function makeDeps(overrides: Partial<ApplyOptimisationDeps> = {}): {
  deps: ApplyOptimisationDeps;
  inserted: DecisionToInsert[];
  updates: Array<{ id: string; pence: number }>;
  reads: string[];
  notifies: NotifyOptions[];
} {
  const inserted: DecisionToInsert[] = [];
  const updates: Array<{ id: string; pence: number }> = [];
  const reads: string[] = [];
  const notifies: NotifyOptions[] = [];
  const deps: ApplyOptimisationDeps = {
    readAdSetDailyBudget: async (id) => {
      reads.push(id);
      return 10000;
    },
    updateAdSetDailyBudget: async (id, pence) => {
      updates.push({ id, pence });
      return { id, daily_budget: String(pence) };
    },
    readCampaignDailyBudget: async () => {
      throw new Error("readCampaignDailyBudget must not be called for ABO");
    },
    updateCampaignDailyBudget: async () => {
      throw new Error("updateCampaignDailyBudget must not be called for ABO");
    },
    insertDecision: async (row) => {
      inserted.push(row);
    },
    notify: async (opts) => {
      notifies.push(opts);
      return { sent: true };
    },
    now: new Date("2026-08-20T12:00:00Z"),
    log: () => {},
    ...overrides,
  };
  return { deps, inserted, updates, reads, notifies };
}

const liveGates = { dryRun: false, reason: null } as const;
const shadowGates = { dryRun: true, reason: "not_live" as const };

function input(overrides: Partial<ApplyOptimisationInput> = {}): ApplyOptimisationInput {
  return {
    decision: decision(),
    campaignName: "[20261003CS] Colyn —Purchase",
    adsetName: "Purchase — Broad",
    gates: liveGates,
    writesRemaining: MAX_WRITES_PER_RUN,
    ...overrides,
  };
}

describe("applyOptimisationDecision — shadow / pause / underfoot", () => {
  it("dry-run gates → inserts shadow, never reads or writes Meta", async () => {
    const { deps, inserted, updates, reads } = makeDeps();
    const outcome = await applyOptimisationDecision(input({ gates: shadowGates }), deps);
    assert.equal(outcome.kind, "shadow");
    assert.equal(outcome.wrote, false);
    assert.equal(inserted[0]!.dryRun, true);
    assert.equal(inserted[0]!.applied, false);
    assert.equal(reads.length, 0);
    assert.equal(updates.length, 0);
  });

  it("pause never writes Meta even when all three gates are open", async () => {
    const { deps, inserted, updates, reads, notifies } = makeDeps();
    const outcome = await applyOptimisationDecision(
      input({
        decision: decision({
          actionRecommended: "pause",
          actionDelta: null,
          budgetAfterPence: 10000,
          reasonText: "cpa=40 matched pause → pause.",
        }),
      }),
      deps,
    );
    assert.equal(outcome.kind, "pause_recommended");
    assert.equal(outcome.wrote, false);
    assert.equal(updates.length, 0);
    assert.equal(reads.length, 0);
    assert.equal(inserted[0]!.applied, false);
    assert.equal(notifies.length, 1);
    assert.equal(notifies[0]!.channel, "ads_urgent");
    assert.match(notifies[0]!.text, /PAUSE/);
    assert.match(notifies[0]!.text, /Colyn/);
    assert.equal(notifies[0]!.dedupeKey, "optimisation_pause:adset_1");
  });

  it("budget_changed_underfoot aborts when live daily_budget !== evaluated before", async () => {
    const { deps, inserted, updates } = makeDeps({
      readAdSetDailyBudget: async () => 14000,
    });
    const outcome = await applyOptimisationDecision(input(), deps);
    assert.equal(outcome.kind, "aborted_underfoot");
    assert.equal(outcome.wrote, false);
    assert.equal(updates.length, 0);
    assert.equal(inserted[0]!.applied, false);
    assert.equal(inserted[0]!.guardrailNote, "budget_changed_underfoot");
  });

  it("successful write stamps applied=true dry_run=false", async () => {
    const { deps, inserted, updates } = makeDeps();
    const outcome = await applyOptimisationDecision(input(), deps);
    assert.equal(outcome.kind, "applied");
    assert.equal(outcome.wrote, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]!.pence, 13000);
    assert.equal(inserted[0]!.applied, true);
    assert.equal(inserted[0]!.dryRun, false);
    assert.equal(inserted[0]!.appliedAt, "2026-08-20T12:00:00.000Z");
  });

  it("write failure is isolated — applied=false, Slack ads_urgent, no throw", async () => {
    const { deps, inserted, notifies } = makeDeps({
      updateAdSetDailyBudget: async () => {
        throw Object.assign(new Error("Service temporarily unavailable"), {
          name: "MetaApiError",
          code: 2,
        });
      },
    });
    const outcome = await applyOptimisationDecision(input(), deps);
    assert.equal(outcome.kind, "write_failed");
    assert.equal(outcome.wrote, false);
    assert.equal(inserted[0]!.applied, false);
    assert.equal((inserted[0]!.metaResponseJson as { code?: number }).code, 2);
    assert.equal(notifies[0]!.channel, "ads_urgent");
    assert.equal(notifies[0]!.dedupeKey, "optimisation_write_error:adset_1");
    assert.match(notifies[0]!.text, /meta_code=2/);
  });

  it("CBO scope writes campaign daily_budget, not the ad set", async () => {
    const campaignReads: string[] = [];
    const campaignUpdates: Array<{ id: string; pence: number }> = [];
    const { deps, inserted, updates, reads } = makeDeps({
      readCampaignDailyBudget: async (id) => {
        campaignReads.push(id);
        return 15000;
      },
      updateCampaignDailyBudget: async (id, pence) => {
        campaignUpdates.push({ id, pence });
        return { id, daily_budget: String(pence) };
      },
    });
    const outcome = await applyOptimisationDecision(
      input({
        decision: decision({
          scope: "campaign",
          adsetId: "camp_1",
          budgetBeforePence: 15000,
          budgetAfterPence: 17250,
        }),
      }),
      deps,
    );
    assert.equal(outcome.kind, "applied");
    assert.equal(reads.length, 0);
    assert.equal(updates.length, 0);
    assert.deepEqual(campaignReads, ["camp_1"]);
    assert.deepEqual(campaignUpdates, [{ id: "camp_1", pence: 17250 }]);
    assert.equal(inserted[0]!.scope, "campaign");
    assert.equal(inserted[0]!.dryRun, false);
    assert.equal(inserted[0]!.applied, true);
  });

  it("CBO scope stays dry_run when the three gates are not open", async () => {
    const { deps, inserted, updates } = makeDeps({
      updateCampaignDailyBudget: async () => {
        throw new Error("must not write");
      },
    });
    const outcome = await applyOptimisationDecision(
      input({
        gates: shadowGates,
        decision: decision({
          scope: "campaign",
          adsetId: "camp_1",
          budgetBeforePence: 15000,
          budgetAfterPence: 17250,
        }),
      }),
      deps,
    );
    assert.equal(outcome.kind, "shadow");
    assert.equal(outcome.wrote, false);
    assert.equal(inserted[0]!.dryRun, true);
    assert.equal(inserted[0]!.applied, false);
    assert.equal(updates.length, 0);
  });

  it("writesRemaining=0 records a shadow decision and does not write", async () => {
    const { deps, updates, reads } = makeDeps();
    const outcome = await applyOptimisationDecision(input({ writesRemaining: 0 }), deps);
    assert.equal(outcome.kind, "cap_reached");
    assert.equal(updates.length, 0);
    assert.equal(reads.length, 0);
  });
});
