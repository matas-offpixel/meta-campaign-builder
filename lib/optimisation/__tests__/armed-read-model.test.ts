import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import {
  applyPostLaunchControls,
  armedLoadErrorStatus,
  assertArmedEventId,
  controlsFromStrategy,
  definedPauseFloorBudget,
  formatActingLine,
  InvalidArmedEventIdError,
  lastDecisionFromRows,
  lastWriteFromRows,
  nextOptimisationTickAt,
  setCampaignTarget,
} from "../armed-read-model.ts";
import type { DecisionRowView } from "../automation-ui.ts";

function decision(partial: Partial<DecisionRowView>): DecisionRowView {
  return {
    decidedAt: "2026-09-13T12:00:00.000Z",
    metric: "cpa",
    metricValue: 18,
    resultCount: 4,
    metricWindow: "24h",
    ruleMatched: "",
    action: "skip_event_passed",
    budgetBeforePence: 4000,
    budgetAfterPence: 4000,
    applied: false,
    dryRun: true,
    reasonText: "Event date 2026-09-04 is in the past — skip_event_passed.",
    kind: "dry_run",
    channel: "meta",
    scope: "ad_set",
    adsetId: "adset-1",
    adsetName: "Prospecting",
    ...partial,
  };
}

describe("acting line — not a green dot", () => {
  it("a Live row with skip_event_passed names the skip, not a bare Live", () => {
    const last = lastDecisionFromRows([
      decision({ action: "skip_event_passed", decidedAt: "2026-09-13T16:00:00.000Z" }),
    ]);
    const write = lastWriteFromRows([
      decision({ action: "skip_event_passed" }),
      decision({
        action: "scale_up",
        applied: true,
        dryRun: false,
        kind: "applied",
        decidedAt: "2026-09-10T12:00:00.000Z",
        budgetBeforePence: 4000,
        budgetAfterPence: 5200,
      }),
    ]);
    const line = formatActingLine("live", last, write, new Date("2026-09-13T20:00:00.000Z"));
    assert.match(line, /^Live ·/);
    assert.match(line, /skip_event_passed/);
    assert.match(line, /last write 10 Sep/);
    assert.doesNotMatch(line, /●/);
    assert.match(last?.reasonText ?? "", /2026-09-04 is in the past/);
  });

  it("no decision yet says so", () => {
    assert.equal(formatActingLine("shadow", null, null), "Shadow · no tick yet");
  });
});

describe("nextOptimisationTickAt", () => {
  it("from 18:26 UTC the next tick is 20:00 UTC", () => {
    const next = nextOptimisationTickAt(new Date("2026-09-13T18:26:00.000Z"));
    assert.equal(next.toISOString(), "2026-09-13T20:00:00.000Z");
  });

  it("on the hour of a tick, the next one is four hours later", () => {
    const next = nextOptimisationTickAt(new Date("2026-09-13T20:00:00.000Z"));
    assert.equal(next.toISOString(), "2026-09-14T00:00:00.000Z");
  });
});

describe("setCampaignTarget does not rewrite the ladder", () => {
  it("keeps every threshold band until regenerate is clicked", () => {
    const draft = createDefaultDraft();
    const before = structuredClone(draft.optimisationStrategy);
    const idx = before.rules.findIndex((rule) => rule.enabled) >= 0
      ? before.rules.findIndex((rule) => rule.enabled)
      : 0;
    if (!before.rules[idx]) {
      before.rules = [
        {
          id: "rule-1",
          name: "CPA",
          metric: "cpa",
          timeWindow: "24h",
          enabled: true,
          priority: "primary",
          campaignTargetValue: 18,
          useOverride: true,
          thresholds: [
            {
              id: "t1",
              operator: "below",
              value: 10,
              action: "increase_budget",
              actionValue: 20,
              label: "keep",
            },
          ],
        },
      ];
    }
    const bands = structuredClone(before.rules[0]?.thresholds ?? []);
    const next = setCampaignTarget(before, 22);
    assert.equal(next.rules[0]?.campaignTargetValue, 22);
    assert.deepEqual(next.rules[0]?.thresholds, bands);

    const regenerated = applyPostLaunchControls(next, { regenerateFromTarget: true });
    assert.notDeepEqual(regenerated.rules[0]?.thresholds, bands);
  });

  it("rejects a defined pauseFloorBudget and ignores an empty key", () => {
    const draft = createDefaultDraft();
    assert.equal(definedPauseFloorBudget({ pauseFloorBudget: 5 } as never), true);
    assert.equal(definedPauseFloorBudget({ pauseFloorBudget: undefined } as never), false);
    assert.equal(definedPauseFloorBudget({}), false);
    assert.throws(
      () =>
        applyPostLaunchControls(draft.optimisationStrategy, {
          guardrails: { pauseFloorBudget: 5 } as never,
        }),
      /pauseFloorBudget/,
    );
    const next = applyPostLaunchControls(draft.optimisationStrategy, {
      guardrails: {
        ...draft.optimisationStrategy.guardrails,
        pauseFloorBudget: undefined,
      } as never,
    });
    assert.equal(
      (next.guardrails as { pauseFloorBudget?: unknown }).pauseFloorBudget,
      undefined,
    );
  });

  it("a draft with no priority:primary still reads the saved target", () => {
    const draft = createDefaultDraft();
    const strategy = {
      ...draft.optimisationStrategy,
      rules: [
        {
          id: "r1",
          name: "CPA",
          metric: "cpa" as const,
          timeWindow: "24h" as const,
          enabled: true,
          campaignTargetValue: 18,
          useOverride: false,
          thresholds: [],
        },
      ],
    };
    const next = setCampaignTarget(strategy, 22);
    const controls = controlsFromStrategy(next, "purchase", "GBP");
    assert.equal(controls.campaignTargetValue, 22);
    assert.equal(controls.useOverride, true);
  });
});

describe("armed eventId", () => {
  it("a comma is rejected before the PostgREST filter, as 400", () => {
    assert.throws(() => assertArmedEventId("abc,or(1)"), /uuid/);
    assert.equal(
      armedLoadErrorStatus(new InvalidArmedEventIdError("abc,or(1)")),
      400,
    );
    assert.equal(armedLoadErrorStatus(new Error("loadArmedCampaignRows: boom")), 500);
  });
});
