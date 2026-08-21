import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import { collectTikTokLaunchPreflight } from "../../tiktok/write/preflight.ts";
import {
  applyIdentityBcIdFromIdentities,
  filterClientResolvableTikTokPreflightIssues,
  migrateTikTokDraft,
  resolveTikTokDraftIdentityBcIdOnLoad,
  tikTokIdentityBcIdIsServerResolvable,
} from "../migrate-draft.ts";

const PRODUCTION_PRE_802_ACCOUNT_SETUP = {
  tiktokAccountId: "account-1",
  advertiserId: "7639802149165301776",
  identityId: "ironworks-id",
  identityDisplayName: "Ironworks",
  identityManualName: null,
  identityType: "BC_AUTH_TT",
  pixelId: null,
  pixelName: null,
  optimisationEvent: null,
  currency: "GBP",
};

function launchableDraft() {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.eventId = "00000000-0000-0000-0000-000000000002";
  draft.accountSetup.advertiserId = "advertiser_1";
  draft.accountSetup.identityId = "identity_1";
  draft.accountSetup.identityType = "TT_USER";
  draft.accountSetup.currency = "GBP";
  draft.accountSetup.timezone = "America/New_York";
  draft.campaignSetup.campaignName = "Campaign";
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

describe("migrateTikTokDraft", () => {
  it("adds an omitted identityBcId key from defaults without blocking", () => {
    const stored = launchableDraft();
    const accountSetup = { ...stored.accountSetup };
    delete (accountSetup as { identityBcId?: string | null }).identityBcId;
    assert.equal("identityBcId" in accountSetup, false);

    const migrated = migrateTikTokDraft({
      ...stored,
      accountSetup,
    });
    assert.equal("identityBcId" in migrated.accountSetup, true);
    assert.equal(migrated.accountSetup.identityBcId, null);
    const preflight = collectTikTokLaunchPreflight(migrated);
    assert.equal(preflight.ok, true);
    assert.equal(
      preflight.issues.some((issue) => issue.id === "identity-bc-id"),
      false,
    );
  });

  it("adds an omitted coverImageId key on a pre-cover draft without wiping the item", () => {
    const stored = launchableDraft();
    const item = { ...stored.creatives.items[0] };
    delete (item as { coverImageId?: string | null }).coverImageId;
    assert.equal("coverImageId" in item, false);

    const migrated = migrateTikTokDraft({
      ...stored,
      creatives: { items: [item] },
    });
    assert.equal("coverImageId" in migrated.creatives.items[0], true);
    assert.equal(migrated.creatives.items[0].coverImageId, null);
    assert.equal(migrated.creatives.items[0].id, item.id);
    assert.equal(migrated.creatives.items[0].videoId, "video_1");
  });

  it("loads an older ad group that still carries startAt and endAt", () => {
    const stored = launchableDraft();
    stored.budgetSchedule.scheduleStartAt = "2026-08-21T14:00";
    stored.budgetSchedule.scheduleEndAt = "2026-08-28T14:00";
    stored.budgetSchedule.adGroups = [
      {
        id: "ag-1",
        name: "Prospecting",
        budget: 50,
        startAt: "2026-08-20T21:42",
        endAt: "2026-08-27T21:42",
      },
    ];
    const migrated = migrateTikTokDraft(stored);
    assert.equal(migrated.budgetSchedule.adGroups[0].startAt, "2026-08-20T21:42");
    assert.equal(migrated.budgetSchedule.adGroups[0].endAt, "2026-08-27T21:42");
    assert.equal(migrated.budgetSchedule.adGroups[0].name, "Prospecting");
    assert.equal(migrated.budgetSchedule.adGroups[0].budget, 50);
    assert.equal(migrated.budgetSchedule.scheduleStartAt, "2026-08-21T14:00");
  });

  it("adds an omitted ad group name key as an empty string", () => {
    const stored = launchableDraft();
    const group = { ...stored.budgetSchedule.adGroups[0] };
    delete (group as { name?: string }).name;
    assert.equal("name" in group, false);

    const migrated = migrateTikTokDraft({
      ...stored,
      budgetSchedule: {
        ...stored.budgetSchedule,
        adGroups: [group],
      },
    });
    assert.equal("name" in migrated.budgetSchedule.adGroups[0], true);
    assert.equal(migrated.budgetSchedule.adGroups[0].name, "");
    assert.equal(migrated.budgetSchedule.adGroups[0].id, group.id);
  });

  it("is idempotent for a draft written by createDefaultTikTokDraft", () => {
    const draft = createDefaultTikTokDraft("draft-default");
    assert.deepEqual(migrateTikTokDraft(draft), draft);
  });

  it("adds omitted targetCostPerResult as null", () => {
    const stored = launchableDraft();
    const optimisation = { ...stored.optimisation };
    delete (optimisation as { targetCostPerResult?: number | null })
      .targetCostPerResult;
    assert.equal("targetCostPerResult" in optimisation, false);

    const migrated = migrateTikTokDraft({
      ...stored,
      optimisation,
    });
    assert.equal(migrated.optimisation.targetCostPerResult, null);
  });

  it("loads an existing CONVERSIONS draft unchanged", () => {
    const stored = launchableDraft();
    stored.campaignSetup.objective = "CONVERSIONS";
    stored.campaignSetup.optimisationGoal = "CONVERSION";
    stored.accountSetup.pixelId = "px-1";
    stored.accountSetup.optimisationEvent = "FORM";
    const migrated = migrateTikTokDraft(stored);
    assert.equal(migrated.campaignSetup.objective, "CONVERSIONS");
    assert.equal(migrated.campaignSetup.optimisationGoal, "CONVERSION");
    const preflight = collectTikTokLaunchPreflight(migrated);
    assert.equal(preflight.ok, true);
  });

  it("keeps launch ids when launchedAt is omitted from a pre-existing publishedIds", () => {
    const stored = launchableDraft();
    const publishedIds = {
      campaignId: "campaign_legacy",
      adgroupIds: ["ag_1", "ag_2"],
      adIds: ["ad_1", "ad_2", "ad_3"],
    };
    assert.equal("launchedAt" in publishedIds, false);

    const withoutPublished = { ...stored } as Record<string, unknown>;
    delete withoutPublished.publishedIds;
    assert.equal("publishedIds" in withoutPublished, false);
    assert.equal(migrateTikTokDraft(withoutPublished).publishedIds, null);

    const migrated = migrateTikTokDraft({
      ...stored,
      publishedIds,
    });
    assert.deepEqual(migrated.publishedIds, {
      campaignId: "campaign_legacy",
      adgroupIds: ["ag_1", "ag_2"],
      adIds: ["ad_1", "ad_2", "ad_3"],
      launchedAt: null,
    });
  });
});

describe("resolveTikTokDraftIdentityBcIdOnLoad", () => {
  it("resolves and persists BC_AUTH_TT + identityId with a missing bc id", async () => {
    const stored = {
      id: "draft-old",
      accountSetup: { ...PRODUCTION_PRE_802_ACCOUNT_SETUP },
    };
    assert.equal("identityBcId" in stored.accountSetup, false);
    const draft = migrateTikTokDraft(stored);
    assert.equal(draft.accountSetup.identityBcId, null);

    const persisted: string[] = [];
    const status = await resolveTikTokDraftIdentityBcIdOnLoad({
      draft,
      fetchIdentities: async () => [
        {
          identity_id: "ironworks-id",
          display_name: "Ironworks",
          identity_type: "BC_AUTH_TT",
          avatar_url: null,
          identity_bc_id: "7629750024332378128",
        },
      ],
      persist: async (next) => {
        persisted.push(next.accountSetup.identityBcId ?? "");
      },
    });

    assert.equal(status, "resolved");
    assert.equal(draft.accountSetup.identityBcId, "7629750024332378128");
    assert.deepEqual(persisted, ["7629750024332378128"]);
    assert.equal(tikTokIdentityBcIdIsServerResolvable(draft), false);

    const healed = launchableDraft();
    healed.accountSetup.identityType = "BC_AUTH_TT";
    healed.accountSetup.identityDisplayName = "Ironworks";
    healed.accountSetup.identityBcId = draft.accountSetup.identityBcId;
    const preflight = collectTikTokLaunchPreflight(healed);
    assert.equal(
      preflight.issues.some(
        (issue) =>
          issue.id === "identity-bc-id" || issue.field === "identity_bc_id",
      ),
      false,
    );
  });

  it("leaves an unresolvable BC_AUTH_TT identity blocked", async () => {
    const draft = migrateTikTokDraft({
      id: "draft-old",
      accountSetup: { ...PRODUCTION_PRE_802_ACCOUNT_SETUP },
    });
    const persisted: string[] = [];
    const status = await resolveTikTokDraftIdentityBcIdOnLoad({
      draft,
      fetchIdentities: async () => [
        {
          identity_id: "other-id",
          display_name: "Other",
          identity_type: "BC_AUTH_TT",
          avatar_url: null,
          identity_bc_id: "bc-other",
        },
      ],
      persist: async (next) => {
        persisted.push(next.accountSetup.identityBcId ?? "");
      },
    });
    assert.equal(status, "unresolved");
    assert.equal(draft.accountSetup.identityBcId, null);
    assert.deepEqual(persisted, []);

    const blocked = launchableDraft();
    blocked.accountSetup.identityType = "BC_AUTH_TT";
    blocked.accountSetup.identityId = "ironworks-id";
    blocked.accountSetup.identityDisplayName = "Ironworks";
    blocked.accountSetup.identityBcId = draft.accountSetup.identityBcId;
    const server = collectTikTokLaunchPreflight(blocked);
    assert.equal(server.ok, false);
    assert.ok(
      server.issues.some(
        (issue) =>
          issue.id === "identity-bc-id" || issue.field === "identity_bc_id",
      ),
    );
    const client = filterClientResolvableTikTokPreflightIssues(
      server.issues,
      blocked,
      "unresolved",
    );
    assert.ok(
      client.some(
        (issue) =>
          issue.id === "identity-bc-id" || issue.field === "identity_bc_id",
      ),
    );
  });

  it("does not treat a server-resolvable missing bc id as a client blocker", () => {
    const draft = launchableDraft();
    draft.accountSetup.identityType = "BC_AUTH_TT";
    draft.accountSetup.identityDisplayName = "Ironworks";
    draft.accountSetup.identityBcId = null;
    const server = collectTikTokLaunchPreflight(draft);
    assert.equal(server.ok, false);
    const pending = filterClientResolvableTikTokPreflightIssues(
      server.issues,
      draft,
      "pending",
    );
    assert.equal(
      pending.some(
        (issue) =>
          issue.id === "identity-bc-id" || issue.field === "identity_bc_id",
      ),
      false,
    );
  });
});

describe("applyIdentityBcIdFromIdentities", () => {
  it("is the same write Step 1 performs on selection", () => {
    const draft = migrateTikTokDraft({
      id: "draft-1",
      accountSetup: { ...PRODUCTION_PRE_802_ACCOUNT_SETUP },
    });
    assert.equal(
      applyIdentityBcIdFromIdentities(draft, [
        {
          identity_id: "ironworks-id",
          display_name: "Ironworks",
          identity_type: "BC_AUTH_TT",
          avatar_url: null,
          identity_bc_id: "7629750024332378128",
        },
      ]),
      true,
    );
    assert.equal(draft.accountSetup.identityBcId, "7629750024332378128");
  });
});
