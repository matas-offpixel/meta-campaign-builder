import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTikTokPreflightChecks,
  everyAdGroupHasCreative,
  everyCreativeAssigned,
  suggestTikTokAdGroups,
} from "../review.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";

describe("TikTok review helpers", () => {
  it("suggests 2 Smart+ ad groups and 3 manual ad groups", () => {
    const manual = createDefaultTikTokDraft("draft-1");
    manual.budgetSchedule.budgetAmount = 300;
    assert.equal(suggestTikTokAdGroups(manual).length, 3);
    assert.equal(suggestTikTokAdGroups(manual)[0].budget, 100);

    const smart = createDefaultTikTokDraft("draft-2");
    smart.optimisation.smartPlusEnabled = true;
    smart.budgetSchedule.budgetAmount = 300;
    assert.equal(suggestTikTokAdGroups(smart).length, 2);
    assert.equal(suggestTikTokAdGroups(smart)[0].budget, 150);
  });

  it("checks creative assignment completeness", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.creatives.items = [
      {
        id: "creative-1",
        name: "Creative 1",
        baseName: "Creative",
        mode: "VIDEO_REFERENCE",
        videoId: "v1",
        videoUrl: null,
        thumbnailUrl: null,
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "Copy",
        adText: "Copy",
        displayName: "Identity",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    draft.budgetSchedule.adGroups = [{ id: "ag-1", name: "AG 1", budget: null, startAt: null, endAt: null }];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };

    assert.equal(everyCreativeAssigned(draft), true);
    assert.equal(everyAdGroupHasCreative(draft), true);
  });

  it("returns red/green pre-flight checks", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    const checks = buildTikTokPreflightChecks(draft);
    assert.ok(checks.some((check) => check.severity === "red"));

    draft.accountSetup.advertiserId = "advertiser-1";
    draft.accountSetup.identityManualName = "Identity";
    draft.campaignSetup.eventCode = "EVT";
    draft.campaignSetup.campaignName = "[EVT] Campaign";
    draft.campaignSetup.objective = "TRAFFIC";
    draft.campaignSetup.optimisationGoal = "CLICK";
    draft.budgetSchedule.budgetAmount = 100;
    draft.budgetSchedule.scheduleStartAt = "2026-05-01T10:00";
    draft.budgetSchedule.scheduleEndAt = "2026-05-02T10:00";
    draft.creatives.items = [
      {
        id: "creative-1",
        name: "Creative 1",
        baseName: "Creative",
        mode: "VIDEO_REFERENCE",
        videoId: "v1",
        videoUrl: null,
        thumbnailUrl: null,
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "Copy",
        adText: "Copy",
        displayName: "Identity",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    draft.budgetSchedule.adGroups = [{ id: "ag-1", name: "AG 1", budget: null, startAt: null, endAt: null }];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };

    assert.deepEqual(
      buildTikTokPreflightChecks(draft).map((check) => check.severity),
      [
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
        "green",
      ],
    );
  });
});
