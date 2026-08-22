import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import { extractIdentityBcId } from "../identity.ts";
import { SMART_PLUS_BLOCK_MESSAGE } from "../write/mapping.ts";
import {
  canonicalTikTokPreflightField,
  collapseTikTokLaunchPreflightIssues,
  collectTikTokLaunchPreflight,
} from "../write/preflight.ts";

function launchableDraft() {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.eventId = "00000000-0000-0000-0000-000000000002";
  draft.accountSetup.advertiserId = "advertiser_1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.campaignSetup.campaignName = "Campaign";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "America/New_York";
  draft.campaignSetup.objective = "TRAFFIC";
  draft.campaignSetup.optimisationGoal = "CLICK";
  draft.campaignSetup.bidStrategy = "LOWEST_COST";
  draft.optimisation.bidStrategy = "LOWEST_COST";
  draft.budgetSchedule.budgetMode = "DAILY";
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.scheduleStartAt = "2027-09-01T09:00:00Z";
  draft.budgetSchedule.scheduleEndAt = "2027-09-08T09:00:00Z";
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
      coverImageId: "img_hero_1",
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
  it("blocks a named creative that has no resolvable cover image", () => {
    const draft = launchableDraft();
    delete (draft.creatives.items[0] as { coverImageId?: string | null }).coverImageId;
    draft.creatives.items[0].thumbnailUrl = null;
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    const cover = result.issues.find((issue) => issue.field === "image_ids");
    assert.ok(cover);
    assert.match(cover.message, /Hero/);
    assert.match(cover.message, /image_ids/);
  });

  it("blocks an empty ad group name and names the ad group by id", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.adGroups[0].name = "";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    const issue = result.issues.find((entry) => entry.field === "adgroup_name");
    assert.ok(issue);
    assert.equal(issue.id, "adgroup-name-ag-1");
    assert.match(issue.message, /Ad group "ag-1"/);
    assert.match(issue.message, /empty or whitespace-only/);
    assert.match(issue.message, /Set a name/);
  });

  it("blocks a whitespace-only ad group name and names the ad group by id", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.adGroups[0].name = "   ";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    const issue = result.issues.find((entry) => entry.field === "adgroup_name");
    assert.ok(issue);
    assert.equal(issue.id, "adgroup-name-ag-1");
    assert.match(issue.message, /Ad group "ag-1"/);
    assert.match(issue.message, /empty or whitespace-only/);
  });

  it("passes a complete launchable draft", () => {
    const result = collectTikTokLaunchPreflight(launchableDraft());
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.warnings, []);
  });

  it("blocks when the campaign name is already used on the advertiser", () => {
    const draft = launchableDraft();
    draft.campaignSetup.campaignName = "[IRW0001] Jamie Jones -sig";
    const result = collectTikTokLaunchPreflight(draft, {
      existingCampaignNames: ["[IRW0001] Jamie Jones -sig"],
    });
    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.id === "campaign-name-taken" && issue.message.includes("Step 2"),
      ),
    );
  });

  it("does not block BC_AUTH_TT once identity_authorized_bc_id is resolved", () => {
    const draft = launchableDraft();
    draft.accountSetup.identityType = "BC_AUTH_TT";
    draft.accountSetup.identityDisplayName = "Ironworks";
    draft.accountSetup.identityBcId = extractIdentityBcId({
      ads_only_mode: false,
      available_status: true,
      can_manage_message: true,
      can_pull_video: true,
      can_push_video: true,
      can_use_live_ads: true,
      display_name: "Ironworks",
      identity_authorized_bc_id: "7078123456789012345",
      identity_id: "ironworks-id",
      identity_type: "BC_AUTH_TT",
      is_gpppa: false,
      profile_image: "https://example.com/ironworks.jpg",
      username: "ironworks",
    }).value;
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, true);
    assert.equal(
      result.issues.some((issue) => issue.id === "identity-bc-id"),
      false,
    );
  });

  it("returns every blocker at once", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.accountSetup.currency = "GBP";
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

  it("blocks the derived per-ad-group split when it falls under the floor", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.adGroups = [];
    draft.budgetSchedule.budgetAmount = 30;
    draft.creativeAssignments.byAdGroupId = {
      "adgroup-1": ["creative-1"],
    };
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    const budgetIssues = result.issues.filter((issue) => issue.field === "budget");
    assert.ok(budgetIssues.some((issue) => issue.message.includes("Ad group 1")));
    assert.ok(budgetIssues.every((issue) => issue.message.includes("50")));
  });

  it("passes a CONVERSIONS draft with pixel, CONVERT, and a pixel event", () => {
    const draft = launchableDraft();
    draft.campaignSetup.objective = "CONVERSIONS";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    draft.accountSetup.pixelId = "px-1";
    draft.accountSetup.optimisationEvent = "FORM";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  });

  it("blocks CONVERSIONS with ON_WEB_REGISTER or CONTACT as unsupported", () => {
    for (const event of ["ON_WEB_REGISTER", "CONTACT"] as const) {
      const draft = launchableDraft();
      draft.campaignSetup.objective = "CONVERSIONS";
      draft.campaignSetup.optimisationGoal = "CONVERSION";
      draft.accountSetup.pixelId = "px-1";
      draft.accountSetup.optimisationEvent = event;
      const result = collectTikTokLaunchPreflight(draft);
      assert.equal(result.ok, false, event);
      const issue = result.issues.find(
        (entry) => entry.field === "optimization_event",
      );
      assert.ok(issue, event);
      assert.match(issue.message, new RegExp(event));
      assert.match(issue.message, /Ads Manager/);
      assert.match(issue.message, /no longer supported/);
    }
  });

  it("does not fire the CONVERSIONS deny-list for LEAD_GENERATION + ON_WEB_REGISTER", () => {
    const draft = launchableDraft();
    draft.campaignSetup.objective = "LEAD_GENERATION";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    draft.accountSetup.pixelId = "px-1";
    draft.accountSetup.optimisationEvent = "ON_WEB_REGISTER";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, true);
    assert.equal(
      result.issues.some((issue) => issue.field === "optimization_event"),
      false,
    );
  });

  it("blocks LEAD_GENERATION without a pixel or optimisation event", () => {
    const draft = launchableDraft();
    draft.campaignSetup.objective = "LEAD_GENERATION";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.field === "pixel_id"));
    assert.ok(result.issues.some((issue) => issue.field === "optimization_event"));
  });

  it("blocks CONVERSIONS without a pixel or optimisation event", () => {
    const draft = launchableDraft();
    draft.campaignSetup.objective = "CONVERSIONS";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.field === "pixel_id"));
    assert.ok(result.issues.some((issue) => issue.field === "optimization_event"));
  });

  it("blocks VIDEO_VIEWS, REACH, AWARENESS, and ENGAGEMENT as unsupported", () => {
    for (const objective of ["VIDEO_VIEWS", "REACH", "AWARENESS", "ENGAGEMENT"] as const) {
      const draft = launchableDraft();
      draft.campaignSetup.objective = objective;
      const result = collectTikTokLaunchPreflight(draft);
      assert.equal(result.ok, false, objective);
      assert.ok(
        result.issues.some((issue) =>
          issue.message.includes("not supported by the launcher yet"),
        ),
        objective,
      );
    }
  });

  it("blocks an incompatible objective and optimisation goal pair", () => {
    const draft = launchableDraft();
    draft.campaignSetup.objective = "TRAFFIC";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.field === "optimisationGoal"));
  });

  it("blocks a draft with non-empty hashtagIds because the id namespace is unverified", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [
      {
        id: "g-1",
        name: "House",
        interestIds: [],
        hashtagIds: [{ id: "h1", name: "house", kind: "keyword" }],
        behaviourIds: [],
      },
    ];
    const blocked = collectTikTokLaunchPreflight(draft);
    assert.equal(blocked.ok, false);
    assert.ok(
      blocked.issues.some(
        (issue) =>
          issue.id === "hashtag-unverified" &&
          issue.message.includes("namespace"),
      ),
    );
    assert.equal(
      blocked.warnings.some((warning) => warning.id === "hashtag-unverified"),
      false,
    );

    draft.audiences.interestGroups[0].hashtagIds = [];
    const broad = suggestTikTokAdGroups(draft);
    draft.budgetSchedule.adGroups = broad;
    draft.creativeAssignments.byAdGroupId = {
      [broad[0].id]: ["creative-1"],
    };
    const empty = collectTikTokLaunchPreflight(draft);
    assert.equal(empty.ok, true);
    assert.equal(
      empty.issues.some((issue) => issue.id === "hashtag-unverified"),
      false,
    );
  });

  it("warns when the advertiser currency is not GBP", () => {
    const draft = launchableDraft();
    draft.accountSetup.currency = "EUR";
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, true);
    assert.ok(
      result.warnings.some((warning) =>
        warning.message.includes("not blocking on amount"),
      ),
    );
  });

  it("rejects the sent start when leftover ad-group startAt disagrees", () => {
    const draft = launchableDraft();
    draft.accountSetup.timezone = "Etc/GMT";
    // The two fields disagree, as in production. Read-through sends the
    // draft schedule, so a past scheduleStartAt must fail even if leftover
    // ad-group startAt is later.
    draft.budgetSchedule.scheduleStartAt = "2026-08-20T21:42";
    draft.budgetSchedule.scheduleEndAt = "2026-08-27T21:42";
    draft.budgetSchedule.adGroups[0] = {
      ...draft.budgetSchedule.adGroups[0],
      startAt: "2026-08-21T14:00",
      endAt: "2026-08-28T14:00",
    };
    const result = collectTikTokLaunchPreflight(draft, {
      now: new Date("2026-08-21T13:00:00.000Z"),
    });
    assert.equal(result.ok, false);
    const issue = result.issues.find(
      (entry) => entry.id === "schedule-start-soon",
    );
    assert.ok(issue);
    assert.match(issue.message, /2026-08-20 21:42:00/);
  });

  it("does not treat a stale past ad-group startAt as the sent start", () => {
    const draft = launchableDraft();
    draft.accountSetup.timezone = "Etc/GMT";
    draft.budgetSchedule.scheduleStartAt = "2026-08-21T14:00";
    draft.budgetSchedule.scheduleEndAt = "2026-08-28T14:00";
    draft.budgetSchedule.adGroups[0] = {
      ...draft.budgetSchedule.adGroups[0],
      startAt: "2026-08-20T21:42",
      endAt: "2026-08-27T21:42",
    };
    const result = collectTikTokLaunchPreflight(draft, {
      now: new Date("2026-08-21T13:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    assert.equal(
      result.issues.some((entry) => entry.id === "schedule-start-soon"),
      false,
    );
  });

  it("blocks a start already past in the advertiser timezone", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.scheduleStartAt = "2026-08-21T11:00";
    draft.budgetSchedule.scheduleEndAt = "2026-08-28T12:00";
    const result = collectTikTokLaunchPreflight(draft, {
      now: new Date("2026-08-21T16:00:00.000Z"),
    });
    assert.equal(result.ok, false);
    const issue = result.issues.find(
      (entry) => entry.id === "schedule-start-soon",
    );
    assert.ok(issue);
    assert.match(issue.message, /2026-08-21 11:00:00/);
    assert.match(issue.message, /America\/New_York/);
  });

  it("blocks a start inside the 15-minute advertiser-timezone margin", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.scheduleStartAt = "2026-08-21T12:10";
    draft.budgetSchedule.scheduleEndAt = "2026-08-28T12:00";
    const result = collectTikTokLaunchPreflight(draft, {
      now: new Date("2026-08-21T16:00:00.000Z"),
    });
    assert.equal(result.ok, false);
    const issue = result.issues.find(
      (entry) => entry.id === "schedule-start-soon",
    );
    assert.ok(issue);
    assert.match(issue.message, /2026-08-21 12:10:00/);
    assert.match(issue.message, /America\/New_York/);
  });

  it("fails lifetime launches that cannot compute scheduled days", () => {
    const draft = launchableDraft();
    draft.budgetSchedule.budgetMode = "LIFETIME";
    draft.budgetSchedule.scheduleEndAt = null;
    const result = collectTikTokLaunchPreflight(draft);
    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((issue) =>
        issue.message.includes("50 × scheduled days"),
      ),
    );
  });

  it("keeps one campaign-level issue when ad groups repeat the same field and root message", () => {
    const draft = launchableDraft();
    draft.campaignSetup.objective = "LEAD_GENERATION";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    draft.accountSetup.pixelId = "pixel_1";
    draft.accountSetup.optimisationEvent = null;
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "London - Wide", budget: 50, startAt: null, endAt: null },
      { id: "ag-2", name: "Retargeting", budget: 50, startAt: null, endAt: null },
    ];
    draft.creativeAssignments.byAdGroupId = {
      "ag-1": ["creative-1"],
      "ag-2": ["creative-1"],
    };
    const result = collectTikTokLaunchPreflight(draft);
    const eventIssues = result.issues.filter(
      (issue) => issue.field === "optimization_event",
    );
    assert.equal(eventIssues.length, 1);
    assert.equal(eventIssues[0]?.id, "optimisation-event");
    assert.match(eventIssues[0]!.message, /LEAD_GENERATION requires/);
    assert.equal(
      result.issues.some((issue) => issue.message.startsWith("London - Wide:")),
      false,
    );
  });

  it("collapses per-creative issues that share a field and reason", () => {
    const collapsed = collapseTikTokLaunchPreflightIssues(
      Array.from({ length: 9 }, (_, index) => ({
        id: `ad-creative-${index}-identity_type`,
        field: "identity_type",
        message: `Creative ${index + 1}: Identity type is required`,
        scope: "creative" as const,
        reason: "Identity type is required",
        creativeIds: [`creative-${index}`],
      })),
    );
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0]?.field, "identity_type");
    assert.equal(collapsed[0]?.message, "Identity type is required (9 creatives)");
    assert.deepEqual(collapsed[0]?.creativeIds, [
      "creative-0",
      "creative-1",
      "creative-2",
      "creative-3",
      "creative-4",
      "creative-5",
      "creative-6",
      "creative-7",
      "creative-8",
    ]);

    const draft = launchableDraft();
    draft.accountSetup.identityType = null;
    draft.creatives.items = Array.from({ length: 3 }, (_, index) => ({
      ...draft.creatives.items[0]!,
      id: `creative-${index + 1}`,
      name: `Hero ${index + 1}`,
    }));
    draft.creativeAssignments.byAdGroupId = {
      "ag-1": draft.creatives.items.map((item) => item.id),
    };
    const result = collectTikTokLaunchPreflight(draft);
    const identityIssues = result.issues.filter(
      (issue) => issue.field === "identity_type",
    );
    assert.equal(identityIssues.length, 1);
    assert.equal(identityIssues[0]?.id, "identity-type");
    assert.equal(identityIssues[0]?.message, "Identity type is required");
  });

  it("collapses campaign and ad-group issues that disagree on field aliases", () => {
    const bid = collapseTikTokLaunchPreflightIssues([
      {
        id: "bid-strategy",
        field: "bidStrategy",
        message:
          "Choose a bid strategy before launch. A missing strategy publishes the ad group with no bid.",
        scope: "campaign",
        reason:
          "Choose a bid strategy before launch. A missing strategy publishes the ad group with no bid.",
      },
      {
        id: "adgroup-ag-1-bid_type",
        field: "bid_type",
        message:
          "London - Wide: Choose a bid strategy before launch. A missing strategy publishes the ad group with no bid.",
        scope: "adgroup",
        reason:
          "Choose a bid strategy before launch. A missing strategy publishes the ad group with no bid.",
        adGroupIds: ["ag-1"],
      },
    ]);
    assert.equal(bid.length, 1);
    assert.equal(bid[0]?.id, "bid-strategy");
    assert.equal(canonicalTikTokPreflightField("bid_type"), "bidStrategy");

    const goal = collapseTikTokLaunchPreflightIssues([
      {
        id: "objective-goal",
        field: "optimisationGoal",
        message: "Objective and optimisation goal are not a compatible pair",
        scope: "campaign",
        reason: "Objective and optimisation goal are not a compatible pair",
      },
      {
        id: "adgroup-ag-1-optimization_goal",
        field: "optimization_goal",
        message:
          "Retargeting: Objective and optimisation goal are not a compatible pair",
        scope: "adgroup",
        reason: "Objective and optimisation goal are not a compatible pair",
        adGroupIds: ["ag-1"],
      },
    ]);
    assert.equal(goal.length, 1);
    assert.equal(goal[0]?.field, "optimisationGoal");
    assert.equal(
      canonicalTikTokPreflightField("optimization_goal"),
      "optimisationGoal",
    );

    const draft = launchableDraft();
    draft.campaignSetup.bidStrategy = null;
    draft.optimisation.bidStrategy = null;
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "London - Wide", budget: 50, startAt: null, endAt: null },
      { id: "ag-2", name: "Retargeting", budget: 50, startAt: null, endAt: null },
    ];
    draft.creativeAssignments.byAdGroupId = {
      "ag-1": ["creative-1"],
      "ag-2": ["creative-1"],
    };
    const live = collectTikTokLaunchPreflight(draft);
    const bidIssues = live.issues.filter(
      (issue) => canonicalTikTokPreflightField(issue.field) === "bidStrategy",
    );
    assert.equal(bidIssues.length, 1);
    assert.equal(bidIssues[0]?.field, "bidStrategy");
  });

  it("collapses ad-group issues against each other when there is no campaign twin", () => {
    const collapsed = collapseTikTokLaunchPreflightIssues(
      Array.from({ length: 6 }, (_, index) => ({
        id: `adgroup-ag-${index}-location_ids`,
        field: "location_ids",
        message: `Group ${index}: At least one location is required`,
        scope: "adgroup" as const,
        reason: "At least one location is required",
        adGroupIds: [`ag-${index}`],
      })),
    );
    assert.equal(collapsed.length, 1);
    assert.equal(
      collapsed[0]?.message,
      "At least one location is required (6 ad groups)",
    );
    assert.deepEqual(collapsed[0]?.adGroupIds, [
      "ag-0",
      "ag-1",
      "ag-2",
      "ag-3",
      "ag-4",
      "ag-5",
    ]);

    const draft = launchableDraft();
    draft.audiences.locationCodes = [];
    draft.budgetSchedule.adGroups = Array.from({ length: 6 }, (_, index) => ({
      id: `ag-${index}`,
      name: `Group ${index}`,
      budget: 50,
      startAt: null,
      endAt: null,
    }));
    draft.creativeAssignments.byAdGroupId = Object.fromEntries(
      draft.budgetSchedule.adGroups.map((group) => [group.id, ["creative-1"]]),
    );
    const live = collectTikTokLaunchPreflight(draft);
    const locationIssues = live.issues.filter(
      (issue) => issue.field === "location_ids",
    );
    assert.equal(locationIssues.length, 1);
    assert.match(locationIssues[0]!.message, /6 ad groups/);
    assert.equal(locationIssues[0]?.adGroupIds?.length, 6);
  });

  it("blocks retired keyword ids and names the group plus chips", () => {
    const draft = launchableDraft();
    draft.audiences.interestGroups = [
      {
        id: "g-house",
        name: "House",
        interestIds: [
          { id: "kw-live", name: "house music", kind: "keyword" },
          { id: "kw-dead", name: "warehouse rave", kind: "keyword" },
        ],
        hashtagIds: [],
        behaviourIds: [],
      },
    ];
    const blocked = collectTikTokLaunchPreflight(draft, {
      retiredInterestKeywords: [
        {
          groupId: "g-house",
          groupName: "House",
          adGroupId: "ag-house",
          items: [{ id: "kw-dead", name: "warehouse rave" }],
        },
      ],
    });
    assert.equal(blocked.ok, false);
    const retired = blocked.issues.find(
      (issue) => issue.id === "interest-keyword-retired-g-house",
    );
    assert.ok(retired);
    assert.equal(retired.field, "interest_keyword_ids");
    assert.equal(retired.scope, "adgroup");
    assert.deepEqual(retired.adGroupIds, ["ag-house"]);
    assert.match(retired.message, /House/);
    assert.match(retired.message, /warehouse rave/);
    assert.doesNotMatch(retired.message, /house music/);

    const clean = collectTikTokLaunchPreflight(draft, {
      retiredInterestKeywords: [],
    });
    assert.equal(
      clean.issues.some((issue) => issue.id.startsWith("interest-keyword-retired")),
      false,
    );
  });
});
