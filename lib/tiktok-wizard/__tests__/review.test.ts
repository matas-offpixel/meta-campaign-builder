import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTikTokPreflightChecks,
  everyAdGroupHasCreative,
  everyCreativeAssigned,
  hasAnyTargeting,
  suggestTikTokAdGroups,
  tikTokLaunchReviewSummary,
} from "../review.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";

describe("TikTok review helpers", () => {
  it("suggests one positional ad group when there are no interest groups", () => {
    const manual = createDefaultTikTokDraft("draft-1");
    manual.budgetSchedule.budgetAmount = 300;
    assert.equal(suggestTikTokAdGroups(manual).length, 1);
    assert.equal(suggestTikTokAdGroups(manual)[0].budget, 300);
    assert.equal(suggestTikTokAdGroups(manual)[0].name, "Ad group 1");

    const smart = createDefaultTikTokDraft("draft-2");
    smart.optimisation.smartPlusEnabled = true;
    smart.budgetSchedule.budgetAmount = 300;
    assert.equal(suggestTikTokAdGroups(smart).length, 1);
    assert.equal(suggestTikTokAdGroups(smart)[0].budget, 300);
  });

  it("generates one ad group per named interest group, including empty broad ones", () => {
    const draft = createDefaultTikTokDraft("draft-ig");
    draft.budgetSchedule.budgetAmount = 300;
    draft.audiences.interestGroups = [
      {
        id: "g-empty",
        name: "Empty",
        interestIds: [],
        hashtagIds: [],
        behaviourIds: [],
      },
      {
        id: "g-house",
        name: "House",
        interestIds: [{ id: "i1", name: "House", kind: "category" }],
        hashtagIds: [],
        behaviourIds: [],
      },
      {
        id: "g-techno",
        name: "Techno",
        interestIds: [],
        hashtagIds: [{ id: "h1", name: "techno", kind: "keyword" }],
        behaviourIds: [],
      },
    ];
    const groups = suggestTikTokAdGroups(draft);
    assert.equal(groups.length, 3);
    assert.deepEqual(
      groups.map((group) => group.interestGroupId),
      ["g-empty", "g-house", "g-techno"],
    );
    assert.equal(groups[0].name, "Empty");
    assert.equal(groups[0].budget, 100);
    assert.equal(groups[1].name, "House");
    assert.equal(groups[2].name, "Techno");
  });

  it("counts languages and a moved age range as targeting", () => {
    const bare = createDefaultTikTokDraft("draft-targeting");
    bare.audiences.locationCodes = [];
    bare.audiences.languages = [];
    assert.equal(hasAnyTargeting(bare), false);

    const withLanguages = createDefaultTikTokDraft("draft-lang");
    withLanguages.audiences.locationCodes = [];
    assert.deepEqual(withLanguages.audiences.languages, ["en"]);
    assert.equal(hasAnyTargeting(withLanguages), true);

    const withAge = createDefaultTikTokDraft("draft-age");
    withAge.audiences.locationCodes = [];
    withAge.audiences.languages = [];
    withAge.audiences.ageMax = 34;
    assert.equal(hasAnyTargeting(withAge), true);
  });

  it("does not treat the implicit 18-65 default as chosen age targeting", () => {
    const draft = createDefaultTikTokDraft("draft-default-age");
    draft.audiences.locationCodes = [];
    draft.audiences.languages = [];
    assert.equal(draft.audiences.ageMin, 18);
    assert.equal(draft.audiences.ageMax, 65);
    assert.equal(hasAnyTargeting(draft), false);
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
    draft.campaignSetup.bidStrategy = "LOWEST_COST";
    draft.optimisation.bidStrategy = "LOWEST_COST";
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
        "green",
      ],
    );
  });
});

describe("tikTokLaunchReviewSummary", () => {
  it("is not ok whenever any blocking issue exists", () => {
    const empty = tikTokLaunchReviewSummary([]);
    assert.equal(empty.ok, true);
    assert.equal(empty.blockerCount, 0);

    const issues = [{ id: "missing-identity" }, { id: "missing-schedule" }];
    const summary = tikTokLaunchReviewSummary(issues);
    assert.equal(summary.ok, false);
    assert.equal(summary.blockerCount, issues.length);
    assert.equal(summary.ok === false && issues.length > 0, true);
  });
});
