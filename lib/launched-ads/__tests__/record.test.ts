import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdCreativeDraft, CampaignDraft } from "../../types.ts";
import {
  launchedAdPayload,
  recordLaunchedAd,
  snapshotCreativeDescriptor,
  type LaunchedAdWrite,
} from "../record.ts";
import { bindLaunchAdRecorder } from "../launch-recorder.ts";
import { fakeDb, op } from "./fake-db.ts";

const RUN = "11111111-1111-4111-8111-111111111111";
const DRAFT = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const EVENT = "44444444-4444-4444-8444-444444444444";
const CLIENT = "55555555-5555-4555-8555-555555555555";

function creative(over: Partial<AdCreativeDraft> = {}): AdCreativeDraft {
  return {
    id: "c1",
    name: "Hero video",
    sourceType: "new",
    mediaType: "video",
    assetMode: "dual",
    assetVariations: [
      { id: "v1", name: "V1", assets: [{ registryAssetId: "r1" }, { registryAssetId: "r2" }] },
      { id: "v2", name: "V2", assets: [{ registryAssetId: "r1" }] },
    ],
    cta: "LEARN_MORE",
    destinationUrl: "https://tickets.example.com/e",
    ...over,
  } as unknown as AdCreativeDraft;
}

function write(over: Partial<LaunchedAdWrite> = {}): LaunchedAdWrite {
  return {
    metaAdId: " 120001 ",
    metaCreativeId: "900",
    metaAdsetId: "800",
    metaCampaignId: "700",
    adAccountId: "1234567",
    draftId: DRAFT,
    userId: USER,
    clientId: CLIENT,
    eventId: EVENT,
    launchedAt: new Date("2026-10-07T10:00:00Z"),
    launchRunId: RUN,
    descriptorSource: "launch",
    adName: "Hero video",
    descriptor: snapshotCreativeDescriptor(creative(), new Map([["r1", "h1"], ["r2", "h2"]])),
    ...over,
  };
}

describe("launched_ads payload", () => {
  it("maps every column, normalises the account and snapshots the descriptor", () => {
    assert.deepEqual(launchedAdPayload(write()), {
      meta_ad_id: "120001",
      meta_creative_id: "900",
      meta_adset_id: "800",
      meta_campaign_id: "700",
      ad_account_id: "act_1234567",
      draft_id: DRAFT,
      user_id: USER,
      client_id: CLIENT,
      event_id: EVENT,
      launched_at: "2026-10-07T10:00:00.000Z",
      launch_run_id: RUN,
      channel: "meta",
      descriptor_source: "launch",
      creative_name: "Hero video",
      ad_name: "Hero video",
      media_type: "video",
      source_type: "uploaded",
      placement_mode: "dual",
      variation_count: 2,
      cta: "LEARN_MORE",
      destination_url: "https://tickets.example.com/e",
      url_tags_applied: true,
      asset_content_hashes: ["h1", "h2"],
    });
  });

  it("existing_post keeps its name; operator utm means url_tags not applied; unknown hashes are []", () => {
    const d = snapshotCreativeDescriptor(
      creative({ sourceType: "existing_post", destinationUrl: "https://x.com/?utm_source=ig" }),
    );
    assert.equal(d.sourceType, "existing_post");
    assert.equal(d.urlTagsApplied, false);
    assert.deepEqual(d.assetContentHashes, []);
  });

  it("non-uuid draft / user / client / event ids become null", () => {
    const row = launchedAdPayload(write({ draftId: "draft_local", userId: "", clientId: null, eventId: "nope" }));
    assert.equal(row.draft_id, null);
    assert.equal(row.user_id, null);
    assert.equal(row.client_id, null);
    assert.equal(row.event_id, null);
  });
});

describe("recordLaunchedAd never throws", () => {
  it("upserts on meta_ad_id", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    await recordLaunchedAd(db, write());
    assert.equal(calls[0].table, "launched_ads");
    assert.deepEqual(op(calls[0], "upsert")?.[1], { onConflict: "meta_ad_id" });
  });

  it("swallows a rejected upsert, an error result and a hung connection", async () => {
    const rejecting = fakeDb(() => Promise.reject(new Error("socket closed")));
    await recordLaunchedAd(rejecting.db, write());
    const erroring = fakeDb(() => ({ error: { message: "relation does not exist" } }));
    await recordLaunchedAd(erroring.db, write());
    const hanging = fakeDb(() => new Promise(() => {}));
    const started = Date.now();
    await recordLaunchedAd(hanging.db, write(), 20);
    assert.ok(Date.now() - started < 1000);
  });

  it("skips without a Meta ad id or launch run id", async () => {
    const { db, calls } = fakeDb(() => ({ error: null }));
    await recordLaunchedAd(db, write({ metaAdId: "  " }));
    await recordLaunchedAd(db, write({ launchRunId: "" }));
    assert.equal(calls.length, 0);
  });
});

describe("bindLaunchAdRecorder", () => {
  const draft = {
    id: DRAFT,
    settings: { eventId: EVENT, clientId: CLIENT },
  } as unknown as CampaignDraft;

  it("never throws into the launch path, even when every query throws", async () => {
    const { db } = fakeDb(() => {
      throw new Error("db down");
    });
    const record = await bindLaunchAdRecorder({
      session: db,
      serviceRole: () => {
        throw new Error("no service key");
      },
      draft,
      creatives: [creative()],
      userId: USER,
      adAccountId: "act_1",
      launchRunId: RUN,
      fillFromLaunchedAdSets: true,
    });
    await record({ creative: creative(), adName: "x", metaAdId: "1", metaCreativeId: "2", metaAdSetId: "3" });
  });

  it("draft path: client from the event, hashes from creative_assets, campaign per call", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "events") return { data: { client_id: CLIENT } };
      if (call.table === "creative_assets") return { data: [{ id: "r1", content_hash: "h1" }], error: null };
      return { error: null };
    });
    const record = await bindLaunchAdRecorder({
      session: db,
      draft,
      creatives: [creative()],
      userId: USER,
      adAccountId: "act_1",
      launchRunId: RUN,
    });
    await record({ creative: creative(), adName: "Hero video", metaAdId: "10", metaCreativeId: "20", metaAdSetId: "30", metaCampaignId: "40" });
    const upsert = calls.find((c) => c.table === "launched_ads");
    const row = op(upsert!, "upsert")?.[0] as Record<string, unknown>;
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.event_id, EVENT);
    assert.equal(row.draft_id, DRAFT);
    assert.equal(row.meta_campaign_id, "40");
    assert.deepEqual(row.asset_content_hashes, ["h1"]);
    assert.equal(calls.filter((c) => c.table === "launched_ad_sets").length, 0);
  });

  it("no-draft path fills campaign / draft / client / event from launched_ad_sets once per ad set", async () => {
    const { db, calls } = fakeDb((call) => {
      if (call.table === "launched_ad_sets") {
        return { data: { meta_campaign_id: "700", draft_id: DRAFT, client_id: CLIENT, event_id: EVENT } };
      }
      return { data: [], error: null };
    });
    const record = await bindLaunchAdRecorder({
      session: db,
      creatives: [creative()],
      userId: USER,
      adAccountId: "act_1",
      launchRunId: RUN,
      fillFromLaunchedAdSets: true,
    });
    await record({ creative: creative(), adName: "a", metaAdId: "1", metaCreativeId: "2", metaAdSetId: "800" });
    await record({ creative: creative(), adName: "b", metaAdId: "2", metaCreativeId: "2", metaAdSetId: "800" });
    assert.equal(calls.filter((c) => c.table === "launched_ad_sets").length, 1);
    const row = op(calls.filter((c) => c.table === "launched_ads")[0], "upsert")?.[0] as Record<string, unknown>;
    assert.equal(row.meta_campaign_id, "700");
    assert.equal(row.draft_id, DRAFT);
    assert.equal(row.event_id, EVENT);
  });
});
