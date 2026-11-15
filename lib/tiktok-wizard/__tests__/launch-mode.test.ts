import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "node:test";

import { tikTokAttachCampaignDisabledReason } from "../../tiktok/attach/picker.ts";
import { createDefaultTikTokDraft, type TikTokAttachCampaignSnapshot } from "../../types/tiktok-draft.ts";
import { tikTokLaunchedLiveDescription } from "../launch-live.ts";
import {
  isSmartPlusTikTokSnapshot,
  TIKTOK_CAMPAIGN_SUB_TILES,
  TIKTOK_LAUNCH_TILES,
  tikTokAttachGoalObjective,
  tikTokInheritedStepNote,
  tikTokLaunchModeForTile,
  tikTokLaunchModePatch,
  tikTokLaunchTileForMode,
  tikTokReviewDefaultLaunchPaused,
  tikTokStatusChip,
} from "../launch-mode.ts";
import { buildTikTokWizardValidationIssues } from "../validation.ts";

const root = join(import.meta.dirname, "..", "..", "..");

function campaign(over: Partial<TikTokAttachCampaignSnapshot> = {}): TikTokAttachCampaignSnapshot {
  return {
    id: "1001",
    name: "Ironworks — On Sale",
    status: "ENABLE",
    objectiveType: "WEB_CONVERSIONS",
    budgetMode: "BUDGET_MODE_DAY",
    budgetOptimizeOn: false,
    automationType: "MANUAL",
    adGroupCount: 3,
    capturedAt: "2026-10-08T09:00:00.000Z",
    ...over,
  };
}

describe("TikTok launch-mode tiles", () => {
  it("uses Meta's copy pattern and says ad group, never ad set", () => {
    assert.deepEqual(
      TIKTOK_LAUNCH_TILES.map((t) => t.label),
      ["Create new campaign", "Add to existing campaign", "Add to existing ad group"],
    );
    assert.deepEqual(
      TIKTOK_CAMPAIGN_SUB_TILES.map((t) => [t.mode, t.label]),
      [
        ["attach_campaign", "Create new ad group"],
        ["attach_all_adgroups", "Attach ads to all existing ad groups"],
      ],
    );
    const copy = [...TIKTOK_LAUNCH_TILES, ...TIKTOK_CAMPAIGN_SUB_TILES]
      .map((t) => `${t.label} ${t.description}`)
      .join(" ");
    assert.doesNotMatch(copy, /ad set/i);
  });

  it("maps each tile to a launchMode", () => {
    assert.equal(tikTokLaunchModeForTile("new", "attach_adgroup"), "new");
    assert.equal(tikTokLaunchModeForTile("adgroup", "new"), "attach_adgroup");
    assert.equal(tikTokLaunchModeForTile("campaign", "new"), "attach_campaign");
    assert.equal(tikTokLaunchModeForTile("campaign", "attach_adgroup"), "attach_campaign");
  });

  it("keeps the campaign sub-tile when the campaign tile is clicked again", () => {
    assert.equal(tikTokLaunchModeForTile("campaign", "attach_all_adgroups"), "attach_all_adgroups");
    assert.equal(tikTokLaunchModeForTile("campaign", "attach_campaign"), "attach_campaign");
  });

  it("selects the campaign tile for both sub-tiles", () => {
    assert.equal(tikTokLaunchTileForMode("new"), "new");
    assert.equal(tikTokLaunchTileForMode("attach_campaign"), "campaign");
    assert.equal(tikTokLaunchTileForMode("attach_all_adgroups"), "campaign");
    assert.equal(tikTokLaunchTileForMode("attach_adgroup"), "adgroup");
  });

  it("switching sub-tiles sets the mode and drops what the next mode doesn't read", () => {
    const draft = {
      launchMode: "attach_campaign" as const,
      launchPaused: false,
    };
    assert.deepEqual(tikTokLaunchModePatch(draft, "attach_all_adgroups"), {
      launchMode: "attach_all_adgroups",
      attachAdGroups: [],
      attachConversionOverride: null,
    });
    assert.deepEqual(
      tikTokLaunchModePatch({ launchMode: "attach_all_adgroups" }, "attach_campaign"),
      { launchMode: "attach_campaign", attachAdGroups: [] },
    );
    assert.deepEqual(tikTokLaunchModePatch({ launchMode: "attach_campaign" }, "attach_campaign"), {});
  });

  it("going back to a new campaign clears every attach selection", () => {
    assert.deepEqual(tikTokLaunchModePatch({ launchMode: "attach_adgroup" }, "new"), {
      launchMode: "new",
      attachCampaigns: [],
      attachAdGroups: [],
      attachConversionOverride: null,
    });
  });
});

describe("Smart+ campaigns", () => {
  it("are not selectable in any attach mode", () => {
    const option = {
      ...campaign(),
      operationStatus: "ENABLE",
      secondaryStatus: null,
      salesDestination: null,
      isSmartPerformanceCampaign: false,
      automationType: "UPGRADED_SMART_PLUS",
      smartPlus: true,
      objectiveSupported: true,
    };
    for (const mode of ["attach_campaign", "attach_adgroup", "attach_all_adgroups"] as const) {
      assert.equal(tikTokAttachCampaignDisabledReason(option, mode), "Smart+ — not supported");
    }
  });

  it("are flagged on a stored selection", () => {
    assert.equal(isSmartPlusTikTokSnapshot(campaign({ automationType: "UPGRADED_SMART_PLUS" })), true);
    assert.equal(isSmartPlusTikTokSnapshot(campaign()), false);
  });
});

describe("Launch as default", () => {
  it("is paused in every attach mode when the operator hasn't chosen", () => {
    for (const mode of ["attach_campaign", "attach_adgroup", "attach_all_adgroups"] as const) {
      assert.equal(tikTokReviewDefaultLaunchPaused({ launchMode: mode }), true, mode);
    }
    assert.equal(tikTokReviewDefaultLaunchPaused({ launchMode: "new" }), false);
    assert.equal(tikTokReviewDefaultLaunchPaused({}), false);
  });

  it("keeps the operator's choice", () => {
    assert.equal(tikTokReviewDefaultLaunchPaused({ launchMode: "attach_adgroup", launchPaused: false }), false);
    assert.equal(tikTokReviewDefaultLaunchPaused({ launchMode: "new", launchPaused: true }), true);
  });

  it("is stored as paused when an attach tile is picked from a new campaign", () => {
    assert.equal(tikTokLaunchModePatch({ launchMode: "new" }, "attach_adgroup").launchPaused, true);
    assert.equal(tikTokLaunchModePatch({}, "attach_campaign").launchPaused, true);
    assert.equal(
      "launchPaused" in tikTokLaunchModePatch({ launchMode: "attach_campaign", launchPaused: false }, "attach_adgroup"),
      false,
    );
  });
});

describe("Inherited steps", () => {
  it("names the picked campaign or ad groups", () => {
    const campaignDraft = { launchMode: "attach_campaign" as const, attachCampaigns: [campaign()] };
    assert.match(tikTokInheritedStepNote(campaignDraft, "campaign") ?? "", /^Inherited from Ironworks — On Sale/);
    assert.match(tikTokInheritedStepNote(campaignDraft, "budget") ?? "", /each new ad group's budget/);
    assert.equal(tikTokInheritedStepNote(campaignDraft, "audiences"), null);

    const adGroupDraft = {
      launchMode: "attach_adgroup" as const,
      attachAdGroups: [
        { id: "a", name: "Prospecting", campaignId: "1001", campaignName: "X", status: "ENABLE", optimizationGoal: null, optimizationEvent: null, pixelId: null, automationType: null, capturedAt: "" },
      ],
    };
    for (const step of ["campaign", "audiences", "budget", "assign"] as const) {
      assert.match(tikTokInheritedStepNote(adGroupDraft, step) ?? "", /^Inherited from Prospecting/, step);
    }
    assert.equal(tikTokInheritedStepNote({ launchMode: "new" }, "budget"), null);
  });

  it("new ad groups take the picked campaign's objective", () => {
    assert.equal(
      tikTokAttachGoalObjective({ launchMode: "attach_campaign", attachCampaigns: [campaign({ objectiveType: "TRAFFIC" })] }),
      "TRAFFIC",
    );
    assert.equal(tikTokAttachGoalObjective({ launchMode: "attach_adgroup", attachCampaigns: [campaign()] }), null);
  });

  it("ads-only drafts are not blocked on audience, budget, schedule or assignment", () => {
    const draft = createDefaultTikTokDraft("d1");
    draft.campaignSetup.eventCode = "IW";
    draft.budgetSchedule.budgetAmount = null;
    const asNew = buildTikTokWizardValidationIssues(draft).map((i) => i.id);
    assert.ok(asNew.includes("budget-positive"));
    for (const mode of ["attach_adgroup", "attach_all_adgroups"] as const) {
      const ids = buildTikTokWizardValidationIssues({ ...draft, launchMode: mode }).map((i) => i.id);
      for (const id of ["budget-positive", "schedule-order", "targeting", "creative-assignments"]) {
        assert.ok(!ids.includes(id), `${mode} ${id}`);
      }
    }
    const attachCampaign = buildTikTokWizardValidationIssues({ ...draft, launchMode: "attach_campaign" }).map((i) => i.id);
    assert.ok(attachCampaign.includes("budget-positive"), "new ad groups still need a budget");
  });

  it("maps operation_status to Ads Manager's chip", () => {
    assert.equal(tikTokStatusChip("ENABLE"), "ACTIVE");
    assert.equal(tikTokStatusChip("DISABLE"), "PAUSED");
    assert.equal(tikTokStatusChip(null), "—");
  });
});

describe("Published live launch line", () => {
  it("states when it launched, not the draft's current schedule", () => {
    assert.equal(
      tikTokLaunchedLiveDescription({ launchedAt: "2026-10-08T09:05:00.000Z", timezone: "Europe/London" }),
      "Created live on TikTok 8 Oct 2026, 10:05 Europe/London.",
    );
    assert.equal(tikTokLaunchedLiveDescription({ launchedAt: null, timezone: "Europe/London" }), "Created live on TikTok.");
  });
});

describe("Launch-mode UI (rendered)", () => {
  const out = execFileSync(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "render-launch-mode.tsx")],
    { cwd: root, encoding: "utf8" },
  );
  const report = JSON.parse(out) as Record<string, boolean>;

  it("Review shows the Launching into summary, not the picker", () => {
    assert.equal(report.reviewSummary, true);
    assert.equal(report.reviewEditLink, true);
    assert.equal(report.reviewNoPicker, true);
    assert.equal(report.reviewDefaultsPaused, true);
  });

  it("the Campaign step tiles map to the draft's mode, with the sub-tiles under the selected campaign", () => {
    assert.equal(report.campaignTilePressed, true);
    assert.equal(report.subTilePressed, true);
    assert.equal(report.cardFacts, true);
  });

  it("a Smart+ selection shows a blocking badge", () => {
    assert.equal(report.smartPlusBadge, true);
  });

  it("a published draft renders the tiles read-only", () => {
    assert.equal(report.publishedTilesDisabled, true);
    assert.equal(report.publishedNote, true);
    assert.equal(report.publishedNoRemove, true);
    assert.equal(report.publishedNoSearch, true);
  });
});
