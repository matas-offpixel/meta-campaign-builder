import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import {
  applyPostLaunchControls,
  assertArmedEventId,
  controlsFromStrategy,
  formatActingLine,
  lastDecisionFromRows,
  lastWriteFromRows,
  nextOptimisationTickAt,
  setCampaignTarget,
} from "../armed-read-model.ts";
import type { DecisionRowView } from "../automation-ui.ts";

/** Main at PR open (post-#936). Content pin — not a branch-diff. */
const FREEZE_SHA = "799b5927e57507f2ff3ac4edbe42492d8080703a";
const FROZEN_PATHS = [
  "lib/optimisation/evaluate.ts",
  "lib/optimisation/apply.ts",
  "lib/optimisation/gates.ts",
  "components/plan/plan-workspace.tsx",
  "lib/plan/__tests__/drawer.test.ts",
] as const;

function pinned(path: string): string {
  return execSync(`git show ${FREEZE_SHA}:${path}`, { encoding: "utf8" });
}

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

describe("surfaces and freezes", () => {
  it("evaluate/apply/gates/plan-workspace match the freeze SHA", () => {
    for (const file of FROZEN_PATHS) {
      assert.equal(readFileSync(file, "utf8"), pinned(file), file);
    }
  });

  it("the freeze goes red when evaluate.ts actually changes", () => {
    const current = readFileSync("lib/optimisation/evaluate.ts", "utf8");
    const atPin = pinned("lib/optimisation/evaluate.ts");
    assert.equal(current, atPin);
    assert.throws(() => {
      assert.equal(`${current}\n// drift\n`, atPin);
    });
  });

  it("pauseFloorBudget is not settable from the three surfaces", () => {
    for (const file of [
      "components/optimisation/armed-campaign-row.tsx",
      "components/optimisation/post-launch-controls.tsx",
      "components/library/campaign-library.tsx",
      "components/dashboard/events/event-detail.tsx",
      "components/steps/budget-guardrails-card.tsx",
    ]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /pauseFloorBudget/);
    }
  });

  it("the Armed tab and event page share ArmedCampaignList", () => {
    const library = readFileSync("components/library/campaign-library.tsx", "utf8");
    assert.match(library, /ArmedCampaignList/);
    assert.match(library, /onCount=\{setArmedCount\}/);
    assert.doesNotMatch(library, /id: \"armed\", label: \"Armed\", count: 0/);
    assert.match(
      readFileSync("components/dashboard/events/event-detail.tsx", "utf8"),
      /ArmedCampaignList[\s\S]*eventId=\{event\.id\}/,
    );
  });

  it("the row renders reasonText, not only the action enum", () => {
    const row = readFileSync("components/optimisation/armed-campaign-row.tsx", "utf8");
    assert.match(row, /lastDecision\?\.reasonText/);
    const last = lastDecisionFromRows([
      decision({ reasonText: "Event date 2026-09-04 is in the past — skip_event_passed." }),
    ]);
    assert.match(last?.reasonText ?? "", /2026-09-04/);
  });

  it("post-launch read-back uses the same primaryRuleIndex as the write", () => {
    const ui = readFileSync("components/optimisation/post-launch-controls.tsx", "utf8");
    assert.match(ui, /controlsFromStrategy/);
    assert.doesNotMatch(ui, /priority === \"primary\"/);
    assert.doesNotMatch(ui, /useOverride: true/);
  });

  it("an eventId containing a comma is a 400, not a 500", () => {
    assert.throws(() => assertArmedEventId("abc,or(1)"), /uuid/);
    const route = readFileSync("app/api/optimisation/campaigns/route.ts", "utf8");
    assert.match(route, /InvalidArmedEventIdError/);
    assert.match(route, /status: 400/);
  });

  it("arming still goes through parseAutomationFlagWrite / confirmLive", () => {
    const arm = readFileSync("components/optimisation/automation-arm-control.tsx", "utf8");
    assert.match(arm, /variant\?: \"card\" \| \"row\"/);
    assert.match(arm, /writeArm\(\"live\", true\)/);
    assert.match(arm, /confirmLive/);
    assert.equal((arm.match(/function ConfirmLiveDialog/g) ?? []).length, 1);
    assert.equal((arm.match(/<Dialog /g) ?? []).length, 1);
    assert.match(
      readFileSync("app/api/campaigns/[id]/automation/route.ts", "utf8"),
      /parseAutomationFlagWrite/,
    );
  });

  it("service-role fallback does not claim asOperator", () => {
    const src = readFileSync("app/api/campaigns/[id]/automation/route.ts", "utf8");
    assert.match(src, /asOperator: false/);
    assert.doesNotMatch(
      src,
      /catch \{\s*return \{ user, db: supabase, asOperator: true \}/,
    );
  });

  it("the fleet route is the new authenticated read", () => {
    const route = readFileSync("app/api/optimisation/campaigns/route.ts", "utf8");
    assert.match(route, /loadArmedCampaignRows/);
    assert.match(route, /isOperator/);
  });

  it("ENABLE_OPTIMISATION_WRITES is not assigned in non-tsx sources", () => {
    const files = [
      "lib/optimisation/armed-read-model.ts",
      "lib/db/armed-campaigns.ts",
      "lib/db/campaign-automation.ts",
      "lib/auth/operator-allowlist.ts",
      "app/api/optimisation/campaigns/route.ts",
      "app/api/optimisation/campaigns/[id]/controls/route.ts",
      "app/api/campaigns/[id]/automation/route.ts",
    ];
    const assign = /ENABLE_OPTIMISATION_WRITES\s*=/;
    for (const file of files) {
      assert.doesNotMatch(readFileSync(file, "utf8"), assign, file);
    }
  });
});
