import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CampaignDraft } from "../../types.ts";
import { planLaunchedAdBackfill, type AdBackfillDraftInput } from "../backfill.ts";

const RUN = "11111111-1111-4111-8111-111111111111";
const DRAFT_A = "22222222-2222-4222-8222-222222222222";
const DRAFT_B = "66666666-6666-4666-8666-666666666666";
const USER = "33333333-3333-4333-8333-333333333333";
const EVENT = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";

function fixtureDraft(): CampaignDraft {
  return {
    id: DRAFT_A,
    createdAt: "2026-09-01T09:00:00Z",
    updatedAt: "2026-09-02T09:00:00Z",
    settings: { eventId: EVENT, metaAdAccountId: "act_424242", adAccountId: "act_424242" },
    creatives: [
      {
        id: "c1",
        name: "Hero video",
        sourceType: "new",
        mediaType: "video",
        assetMode: "full",
        assetVariations: [{ id: "v1", name: "V1", assets: [{ registryAssetId: "r1" }] }],
        cta: "BOOK_NOW",
        destinationUrl: "https://tickets.example.com/e",
      },
    ],
    adSetSuggestions: [{ id: "s1", name: "Lookalikes" }],
    launchSummary: {
      launchRunId: RUN,
      metaCampaignId: "700",
      adSetLaunchResults: { s1: { launchStatus: "created", metaAdSetId: "801" } },
      adSetsCreated: [{ name: "Interests", metaAdSetId: "802", ageMode: "strict" }],
      adSetsFailed: [],
      creativesCreated: [
        {
          name: "Hero video",
          metaCreativeId: "900",
          ads: [
            { adSetName: "Lookalikes", metaAdId: "ad-1" },
            { adSetName: "Interests", metaAdId: "ad-2" },
            { adSetName: "attached:803", metaAdId: "ad-3" },
            { adSetName: "Live set someone renamed", metaAdId: "ad-4" },
          ],
          adsFailed: [],
        },
        { name: "Deleted creative", metaCreativeId: "901", ads: [{ adSetName: "Lookalikes", metaAdId: "ad-5" }], adsFailed: [] },
      ],
      creativesFailed: [],
      adsCreated: 5,
      adsFailed: 0,
    },
  } as unknown as CampaignDraft;
}

function row(id: string, draft: CampaignDraft): AdBackfillDraftInput {
  return { id, user_id: USER, event_id: null, draft_json: { ...draft, id } };
}

describe("launched_ads backfill (dry-run plan, no Meta)", () => {
  it("writes one row per ad from launchSummary, marked backfill_from_launch_summary", () => {
    const plan = planLaunchedAdBackfill(
      [row(DRAFT_A, fixtureDraft())],
      new Map([[EVENT, CLIENT]]),
      new Map([["r1", "hash-1"]]),
    );
    assert.equal(plan.draftsWithAds, 1);
    assert.equal(plan.adsFound, 5);
    assert.equal(plan.writes.length, 5);
    const byAd = new Map(plan.writes.map((w) => [w.meta_ad_id, w]));
    assert.equal(byAd.get("ad-1")!.meta_adset_id, "801", "suggestion → adSetLaunchResults");
    assert.equal(byAd.get("ad-2")!.meta_adset_id, "802", "adSetsCreated name");
    assert.equal(byAd.get("ad-3")!.meta_adset_id, "803", "attach-all synthetic key");
    assert.equal(byAd.get("ad-4")!.meta_adset_id, null, "unknown name is not guessed");
    assert.equal(plan.unresolvedAdSet, 1);
    assert.equal(plan.missingCreative, 1);

    const first = byAd.get("ad-1")!;
    assert.equal(first.descriptor_source, "backfill_from_launch_summary");
    assert.equal(first.launch_run_id, RUN);
    assert.equal(first.launched_at, "2026-09-02T09:00:00.000Z");
    assert.equal(first.meta_campaign_id, "700");
    assert.equal(first.ad_account_id, "act_424242");
    assert.equal(first.client_id, CLIENT);
    assert.equal(first.event_id, EVENT);
    assert.equal(first.creative_name, "Hero video");
    assert.equal(first.placement_mode, "full");
    assert.equal(first.url_tags_applied, null, "most backfilled ads predate url_tags");
    assert.deepEqual(first.asset_content_hashes, ["hash-1"]);
    assert.equal(byAd.get("ad-5")!.creative_name, "Deleted creative");
    assert.equal(byAd.get("ad-5")!.media_type, null);
  });

  it("is idempotent on meta_ad_id and reports ads claimed by several drafts", () => {
    const plan = planLaunchedAdBackfill(
      [row(DRAFT_A, fixtureDraft()), row(DRAFT_B, fixtureDraft())],
      new Map(),
      new Map(),
      new Set(),
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.multiClaim.length, 5);
    assert.deepEqual(plan.multiClaim[0].draftIds, [DRAFT_A, DRAFT_B]);

    const again = planLaunchedAdBackfill([row(DRAFT_A, fixtureDraft())], new Map(), new Map(), new Set(["ad-1", "ad-2"]));
    assert.equal(again.alreadyRecorded, 2);
    assert.deepEqual(again.writes.map((w) => w.meta_ad_id).sort(), ["ad-3", "ad-4", "ad-5"]);
  });

  it("skips drafts with no launched ads", () => {
    const draft = fixtureDraft();
    draft.launchSummary = undefined;
    const plan = planLaunchedAdBackfill([row(DRAFT_A, draft)], new Map());
    assert.equal(plan.draftsWithAds, 0);
    assert.equal(plan.writes.length, 0);
  });
});
