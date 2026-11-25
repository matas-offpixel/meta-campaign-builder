/**
 * M3a step 1: files already in Storage go to Meta at Launch.
 *   - validateStep: a pending slot WITH a Storage copy (and its registry
 *     row) is no longer a blocker; without one it still is.
 *   - sendStoredDraftAssets: the MML path (creative_asset_channel_ids, then
 *     the upload handler on a service-role copy), the slot stamped; a file
 *     already on the ad account is never sent again, so two drafts sharing
 *     a file upload it once; a failed upload marks the slot with today's
 *     "Upload failed — retry or remove".
 * The upload handler and Storage are spies; no Meta, no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { applyStoredSlotResults, sendsAtLaunch, storedSlotsToSend } from "../../creatives/stored-at-launch.ts";
import type { CampaignDraft } from "../../types.ts";
import { validateStep } from "../../validation.ts";
import { validateCreativeAssetCompleteness } from "../../validation/asset-completeness.ts";
import { fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { failVideos, sendStoredDraftAssets, sentVideoIds, waitForStoredVideos } from "../stored-assets-meta.ts";

const USER = "b3ee4e5c-44e6-4684-acf6-efefbecd5858";
const ACCOUNT = "act_606252931141334";
const REG = "a0000000-0000-4000-8000-0000000000a1";
const REG_FEED = "a0000000-0000-4000-8000-0000000000a2";

function draftWith(over: { storagePath?: string | null; registryAssetId?: string | null; id?: string } = {}): CampaignDraft {
  const d = createDefaultDraft();
  d.id = over.id ?? "d0000000-0000-4000-8000-0000000000d1";
  d.settings = { ...d.settings, adAccountId: ACCOUNT, metaAdAccountId: ACCOUNT };
  const c = createDefaultCreative("registration");
  c.id = "cr-1";
  c.name = "ugc-caption-2";
  c.mediaType = "video";
  const slot = c.assetVariations[0]!.assets[0]!;
  slot.id = "slot-1";
  slot.uploadStatus = "pending";
  if (over.storagePath !== null) slot.storagePath = over.storagePath ?? "videos/drive-send/one.mp4";
  if (over.registryAssetId !== null) slot.registryAssetId = over.registryAssetId ?? REG;
  slot.storageBucket = "campaign-assets";
  d.creatives = [c];
  return d;
}

function tables() {
  return {
    creative_assets: [
      { id: REG, user_id: USER, content_hash: "h-one", byte_size: 8_400_000, filename: "ugc-caption-2_9x16.mp4", media_kind: "video", aspect_ratio: "9:16", storage_bucket: "campaign-assets", storage_path: "videos/drive/h-one.mp4" },
      { id: REG_FEED, user_id: USER, content_hash: "h-feed", byte_size: 300_000, filename: "meta-date_4x5.jpg", media_kind: "image", aspect_ratio: "4:5", storage_bucket: "campaign-assets", storage_path: "images/drive/h-feed.jpg" },
    ],
    creative_asset_channel_ids: [] as Array<Record<string, unknown>>,
  };
}

/** The upload handler as a spy: registers the channel id as the real handler does (creative_asset_channel_ids). */
function spies(db: ReturnType<typeof fakeDb>, fail = false) {
  const calls: Array<Record<string, unknown>> = [];
  const copies: Array<[string, string]> = [];
  const removed: string[] = [];
  return {
    calls,
    copies,
    removed,
    storage: {
      copy: async (from: string, to: string) => {
        copies.push([from, to]);
        return { error: null };
      },
      remove: async (paths: string[]) => {
        removed.push(...paths);
      },
    },
    upload: async (req: Request) => {
      const body = (await req.json()) as Record<string, unknown>;
      calls.push(body);
      if (fail) return Response.json({ error: "Meta didn't take this file" }, { status: 500 });
      const rows = (await db.from("creative_assets").select("*")).data as Array<Record<string, unknown>>;
      const reg = rows.find((r) => r.content_hash === body.contentHash)!;
      const id = body.type === "video" ? `vid-${String(body.contentHash)}` : `hash-${String(body.contentHash)}`;
      await db.from("creative_asset_channel_ids").insert({ asset_id: reg.id, channel: "meta", scope: body.adAccountId, platform_id: id, user_id: USER });
      return Response.json(body.type === "video" ? { videoId: id } : { hash: id });
    },
  };
}

test("validateStep: a pending slot with its file in Storage goes at launch; without a Storage copy it still blocks", () => {
  const stored = draftWith();
  assert.equal(sendsAtLaunch(stored.creatives[0]!.assetVariations[0]!.assets[0]!), true);
  assert.ok(!validateStep(7, stored).errors.some((e) => /Asset not yet uploaded/.test(e)));
  // FC4: Review says it goes at launch, where the blocker was.
  assert.ok(validateStep(7, stored).warnings?.includes("1 file goes to Meta when you launch."));

  const noCopy = draftWith({ storagePath: null });
  assert.ok(validateStep(7, noCopy).errors.includes('"ugc-caption-2" › "Variation 1" › 9:16: Asset not yet uploaded'));
  // A Storage path with no registry row has nothing the server can send: still a blocker.
  const noRegistry = draftWith({ registryAssetId: null });
  assert.ok(validateStep(7, noRegistry).errors.some((e) => /Asset not yet uploaded/.test(e)));
});

test("dual completeness counts a stored slot as filled, and a 1:1 feed slot as the dual's feed", () => {
  const d = draftWith();
  const c = d.creatives[0]!;
  c.assetMode = "dual";
  c.assetVariations[0]!.assets = [
    { id: "feed", aspectRatio: "1:1", uploadStatus: "pending", storagePath: "images/x.jpg", registryAssetId: REG_FEED },
    { ...c.assetVariations[0]!.assets[0]!, id: "vert", aspectRatio: "9:16" },
  ];
  assert.deepEqual(validateCreativeAssetCompleteness(c, { sendsAtLaunch: true }), []);
  // Without the launch-time rule (bulk attach) the ids are still required.
  assert.equal(validateCreativeAssetCompleteness(c).length, 1);
});

test("sendStoredDraftAssets: the MML path sends the stored file, stamps its video id, and copies from the registry's own path", async () => {
  const db = fakeDb(tables());
  const s = spies(db);
  const out = await sendStoredDraftAssets({ supabase: db, draft: draftWith(), userId: USER, storage: s.storage, upload: s.upload });
  assert.equal(out.calls, 1);
  assert.equal(out.failed.length, 0);
  const slot = out.draft.creatives[0]!.assetVariations[0]!.assets[0]!;
  assert.deepEqual([slot.uploadStatus, slot.videoId, slot.error], ["uploaded", "vid-h-one", undefined]);
  // The handler gets a throwaway copy of the registry object, never the slot's or the registry's own path.
  assert.equal(s.copies[0]![0], "videos/drive/h-one.mp4");
  assert.equal(s.calls[0]!.storagePath, s.copies[0]![1]);
  assert.deepEqual([s.calls[0]!.adAccountId, s.calls[0]!.type, s.calls[0]!.contentHash], [ACCOUNT, "video", "h-one"]);
  assert.deepEqual(s.removed, [s.copies[0]![1]], "the copy is removed after the call");
  assert.ok(validateStep(7, out.draft).errors.every((e) => !/Asset not yet uploaded|Upload failed/.test(e)));
  // The browser lays the same results onto the draft it holds.
  const laid = applyStoredSlotResults(draftWith(), out.results);
  assert.equal(laid.creatives[0]!.assetVariations[0]!.assets[0]!.videoId, "vid-h-one");
});

test("two drafts sharing a file on one ad account upload it once", async () => {
  const db = fakeDb(tables());
  const s = spies(db);
  const a = await sendStoredDraftAssets({ supabase: db, draft: draftWith({ id: "d-a" }), userId: USER, storage: s.storage, upload: s.upload });
  const b = await sendStoredDraftAssets({ supabase: db, draft: draftWith({ id: "d-b", storagePath: "videos/drive-send/two.mp4" }), userId: USER, storage: s.storage, upload: s.upload });
  assert.equal(s.calls.length, 1, "the second draft finds the file on the account");
  assert.deepEqual([a.calls, b.calls], [1, 0]);
  assert.equal(b.draft.creatives[0]!.assetVariations[0]!.assets[0]!.videoId, "vid-h-one");
  assert.equal(b.uploaded, 1);
});

test("a failed upload marks the slot with today's \"Upload failed — retry or remove\" and is retried on the next send", async () => {
  const db = fakeDb(tables());
  const bad = spies(db, true);
  const out = await sendStoredDraftAssets({ supabase: db, draft: draftWith(), userId: USER, storage: bad.storage, upload: bad.upload });
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0]!.error, "Meta didn't take this file");
  const slot = out.draft.creatives[0]!.assetVariations[0]!.assets[0]!;
  assert.equal(slot.uploadStatus, "error");
  assert.ok(validateStep(7, out.draft).errors.includes('"ugc-caption-2" › "Variation 1" › 9:16: Upload failed — retry or remove'));
  // Still holding its Storage copy, the failed slot is taken again (upload_draft_assets' retry).
  assert.equal(storedSlotsToSend(out.draft).length, 1);
  const good = spies(db);
  const again = await sendStoredDraftAssets({ supabase: db, draft: out.draft, userId: USER, storage: good.storage, upload: good.upload });
  assert.equal(again.failed.length, 0);
  assert.equal(again.draft.creatives[0]!.assetVariations[0]!.assets[0]!.uploadStatus, "uploaded");
});

test("no ad account: nothing is sent and the slot fails with the MML path's reason", async () => {
  const db = fakeDb(tables());
  const s = spies(db);
  const d = draftWith();
  d.settings = { ...d.settings, adAccountId: "", metaAdAccountId: "" };
  const out = await sendStoredDraftAssets({ supabase: db, draft: d, userId: USER, storage: s.storage, upload: s.upload });
  assert.equal(s.calls.length, 0);
  assert.equal(out.failed[0]!.error, "No Meta ad account on this draft");
});

test("someone else's registry row is never read: the slot fails and nothing is sent", async () => {
  const t = tables();
  t.creative_assets[0]!.user_id = "00000000-0000-4000-8000-000000000001";
  const db = fakeDb(t);
  const s = spies(db);
  const out = await sendStoredDraftAssets({ supabase: db, draft: draftWith(), userId: USER, storage: s.storage, upload: s.upload });
  assert.equal(s.calls.length, 0);
  assert.equal(s.copies.length, 0);
  assert.equal(out.failed.length, 1);
});

test("FC4's video step: each sent video is read until ready; an error fails its slot, still processing goes on", async () => {
  const db = fakeDb(tables());
  const s = spies(db);
  const out = await sendStoredDraftAssets({ supabase: db, draft: draftWith(), userId: USER, storage: s.storage, upload: s.upload });
  assert.deepEqual(sentVideoIds(out), ["vid-h-one"]);
  const reads: string[] = [];
  const status = (answers: Record<string, unknown[]>) => async (id: string) => {
    reads.push(id);
    return answers[id]!.shift();
  };
  const ok = await waitForStoredVideos({ videoIds: ["v1", "v2", "v3"], delaysMs: [0, 0, 0], getStatus: status({ v1: [{ status: { video_status: "processing" } }, { status: { video_status: "ready" } }], v2: [{ status: { video_status: "error" } }], v3: [{}, {}, {}] }) });
  assert.deepEqual([ok.ready, ok.errored, ok.timedOut], [["v1"], ["v2"], ["v3"]]);
  const failed = failVideos(out.draft, ["vid-h-one"]);
  const slot = failed.draft.creatives[0]!.assetVariations[0]!.assets[0]!;
  assert.deepEqual([slot.uploadStatus, slot.videoId, failed.failed], ["error", undefined, ["slot-1"]]);
  assert.ok(validateStep(7, failed.draft).errors.includes('"ugc-caption-2" › "Variation 1" › 9:16: Upload failed — retry or remove'));
});
