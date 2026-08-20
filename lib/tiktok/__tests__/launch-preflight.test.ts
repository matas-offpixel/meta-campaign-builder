import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { SMART_PLUS_BLOCK_MESSAGE } from "../write/mapping.ts";
import { collectTikTokLaunchPreflight } from "../write/preflight.ts";

function launchableDraft() {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.eventId = "00000000-0000-0000-0000-000000000002";
  draft.accountSetup.advertiserId = "advertiser_1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.campaignSetup.campaignName = "Campaign";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2026-05-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2026-05-08T09:00:00Z";
  draft.budgetSchedule.adGroups = [
    { id: "ag-1", name: "Prospecting", budget: 50, startAt: null, endAt: null },
  ];
  draft.creatives.items = [
    {
      id: "creative-1",
      name: "Hero",
      mode: "VIDEO_REFERENCE",
      baseName: "Hero",
      videoId: "video_1",
      videoUrl: null,
      thumbnailUrl: null,
      durationSeconds: null,
      title: null,
      sparkPostId: null,
      caption: "",
      adText: "Ad text",
      displayName: "Off/Pixel",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
      musicId: null,
    },
  ];
  draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };
  return draft;
}

describe("collectTikTokLaunchPreflight", () => {
  it("passes a complete launchable draft", () => {
    const result = collectTikTokLaunchPreflight(launchableDraft());
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  });

  it("returns every blocker at once", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.audiences.locationCodes = [];
    draft.budgetSchedule.budgetAmount = 5;
    draft.budgetSchedule.scheduleStartAt = "2026-05-08T09:00:00Z";
    draft.budgetSchedule.scheduleEndAt = "2026-05-01T09:00:00Z";
    draft.optimisation.smartPlusEnabled = true;
    draft.creatives.items = [
      {
        id: "creative-1",
        name: "Hero",
        mode: "VIDEO_REFERENCE",
        baseName: "Hero",
        videoId: null,
        videoUrl: null,
        thumbnailUrl: null,
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "",
        adText: "Ad text",
        displayName: "Off/Pixel",
        landingPageUrl: "not-a-url",
        cta: null,
        musicId: null,
      },
    ];
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "Prospecting", budget: 5, startAt: null, endAt: null },
    ];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };

    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    const fields = result.issues.map((issue) => issue.field);
    assert.ok(fields.includes("event_id"));
    assert.ok(fields.includes("advertiser_id"));
    assert.ok(fields.includes("identity_id"));
    assert.ok(fields.includes("smartPlusEnabled"));
    assert.ok(fields.includes("schedule"));
    assert.ok(fields.includes("budget"));
    assert.ok(fields.includes("creativeAssignments") || fields.includes("video_id"));
    assert.ok(fields.includes("landing_page_url") || fields.includes("location_ids"));
    assert.ok(result.issues.length >= 6);
  });

  it("blocks Smart+ with the operator-facing message", () => {
    const draft = launchableDraft();
    draft.optimisation.smartPlusEnabled = true;
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((issue) => issue.message === SMART_PLUS_BLOCK_MESSAGE),
    );
  });

  it("blocks a missing advertiser, identity, video, URL, budget, and schedule", () => {
    const cases = [
      {
        mutate: (draft: ReturnType<typeof launchableDraft>) => {
          draft.accountSetup.advertiserId = null;
        },
        field: "advertiser_id",
      },
      {
        mutate: (draft: ReturnType<typeof launchableDraft>) => {
          draft.accountSetup.identityId = null;
        },
        field: "identity_id",
      },
      {
        mutate: (draft: ReturnType<typeof launchableDraft>) => {
          draft.creatives.items[0].videoId = null;
        },
        field: "creativeAssignments",
      },
      {
        mutate: (draft: ReturnType<typeof launchableDraft>) => {
          draft.creatives.items[0].landingPageUrl = "/relative";
        },
        field: "landing_page_url",
      },
      {
        mutate: (draft: ReturnType<typeof launchableDraft>) => {
          draft.budgetSchedule.budgetAmount = 10;
          draft.budgetSchedule.adGroups[0].budget = 10;
        },
        field: "budget",
      },
      {
        mutate: (draft: ReturnType<typeof launchableDraft>) => {
          draft.budgetSchedule.scheduleEndAt = "2026-04-01T09:00:00Z";
        },
        field: "schedule",
      },
    ];

    for (const testCase of cases) {
      const draft = launchableDraft();
      testCase.mutate(draft);
      const result = collectTikTokLaunchPreflight(draft);
      assert.equal(result.ok, false, testCase.field);
      assert.ok(
        result.issues.some((issue) => issue.field === testCase.field),
        `expected ${testCase.field} among ${result.issues.map((issue) => issue.field).join(",")}`,
      );
    }
  });
});
