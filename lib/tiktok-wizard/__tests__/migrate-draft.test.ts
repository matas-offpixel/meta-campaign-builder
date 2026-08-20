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

  it("is idempotent for a draft written by createDefaultTikTokDraft", () => {
    const draft = createDefaultTikTokDraft("draft-default");
    assert.deepEqual(migrateTikTokDraft(draft), draft);
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
