import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import {
  applyPostLaunchControls,
  formatActingLine,
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

  it("rejects pauseFloorBudget", () => {
    const draft = createDefaultDraft();
    assert.throws(
      () =>
        applyPostLaunchControls(draft.optimisationStrategy, {
          guardrails: { pauseFloorBudget: 5 } as never,
        }),
      /pauseFloorBudget/,
    );
  });
});

describe("surfaces and freezes", () => {
  it("this branch does not touch evaluate/apply/gates/plan-workspace", () => {
    const changed = execSync("git diff --name-only origin/main...HEAD", {
      encoding: "utf8",
    });
    for (const file of [
      "lib/optimisation/evaluate.ts",
      "lib/optimisation/apply.ts",
      "lib/optimisation/gates.ts",
      "components/plan/plan-workspace.tsx",
      "lib/plan/__tests__/drawer.test.ts",
    ]) {
      assert.ok(!changed.split("\n").includes(file), file);
    }
  });

  it("pauseFloorBudget is not settable from the three surfaces", () => {
    for (const file of [
      "components/optimisation/armed-campaign-row.tsx",
      "components/optimisation/post-launch-controls.tsx",
      "components/library/campaign-library.tsx",
      "components/dashboard/events/event-detail.tsx",
    ]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /pauseFloorBudget/);
    }
  });

  it("the Armed tab and event page share ArmedCampaignList", () => {
    assert.match(
      readFileSync("components/library/campaign-library.tsx", "utf8"),
      /ArmedCampaignList/,
    );
    assert.match(
      readFileSync("components/dashboard/events/event-detail.tsx", "utf8"),
      /ArmedCampaignList[\s\S]*eventId=\{event\.id\}/,
    );
  });

  it("arming still goes through parseAutomationFlagWrite / confirmLive", () => {
    const arm = readFileSync("components/optimisation/automation-arm-control.tsx", "utf8");
    assert.match(arm, /variant\?: \"card\" \| \"row\"/);
    assert.match(arm, /writeArm\(\"live\", true\)/);
    assert.match(arm, /confirmLive/);
    assert.match(
      readFileSync("app/api/campaigns/[id]/automation/route.ts", "utf8"),
      /parseAutomationFlagWrite/,
    );
  });

  it("the fleet route is the new authenticated read", () => {
    const route = readFileSync("app/api/optimisation/campaigns/route.ts", "utf8");
    assert.match(route, /loadArmedCampaignRows/);
    assert.match(route, /isOperator/);
  });

  it("ENABLE_OPTIMISATION_WRITES is not assigned", () => {
    const diff = execSync("git diff origin/main...HEAD", { encoding: "utf8" });
    assert.doesNotMatch(diff, /ENABLE_OPTIMISATION_WRITES\s*=/);
  });
});
