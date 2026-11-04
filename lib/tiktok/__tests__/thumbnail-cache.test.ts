import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  cacheTikTokThumbnails,
  resolveSnapshotThumbnailUrls,
  thumbnailIdsForRows,
  tiktokThumbnailPath,
  tiktokThumbnailStem,
  unexpiredTikTokSignedUrl,
  type TikTokThumbnailCacheClient,
} from "../thumbnail-cache.ts";
import { readActiveTikTokCreativesSnapshot } from "../snapshots.ts";

const ADV = "7639802149165301776";
const PUBLIC = "https://cdn.example/storage/v1/object/public/creative-thumbnails";
const NOW = new Date("2026-11-04T12:00:00Z");
const FUTURE = Math.floor(NOW.getTime() / 1000) + 3600;
const PAST = Math.floor(NOW.getTime() / 1000) - 60;
const signed = (exp: number) =>
  `https://p16-common-sign.tiktokcdn.com/obj/cover.image?x-expires=${exp}&x-signature=abc`;

/** In-memory `creative-thumbnails` bucket. */
function fakeStorage(initial: string[] = []) {
  const objects = new Map<string, string>(initial.map((p) => [p, "image/jpeg"]));
  const uploads: string[] = [];
  const client: TikTokThumbnailCacheClient = {
    storage: {
      from: () => ({
        async list(path) {
          const prefix = `${path}/`;
          const names = [...objects.keys()]
            .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"))
            .map((k) => ({ name: k.slice(prefix.length) }));
          return { data: names, error: null };
        },
        async upload(path, _body, opts) {
          objects.set(path, opts?.contentType ?? "");
          uploads.push(path);
          return { data: {}, error: null };
        },
        getPublicUrl(path) {
          return { data: { publicUrl: `${PUBLIC}/${path}` } };
        },
      }),
    },
  };
  return { client, objects, uploads };
}

/** Fake `tiktokGet` that records every call and returns a cover per id. */
function fakeTikTok() {
  const calls: Array<{ path: string; ids: string[] }> = [];
  const request = (async (path: string, params: Record<string, unknown>) => {
    const ids = (params.video_ids ?? params.image_ids) as string[];
    calls.push({ path, ids });
    await new Promise((r) => setTimeout(r, 5));
    if (path === "/file/video/ad/info/") {
      return { list: ids.map((id) => ({ video_id: id, video_cover_url: signed(FUTURE) })) };
    }
    return { list: ids.map((id) => ({ image_id: id, image_url: signed(FUTURE) })) };
  }) as never;
  return { calls, request };
}

const imageFetch = (async () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as typeof fetch;

afterEach(() => {
  delete process.env.ENABLE_TIKTOK_THUMBNAIL_FETCH;
});

describe("tiktokThumbnailPath", () => {
  it("keys videos by video_id and images by image_id under the advertiser", () => {
    assert.equal(
      tiktokThumbnailPath("video", ADV, "v10033g50000d8bjeifog65i4993bbug"),
      `tiktok/video/${ADV}/v10033g50000d8bjeifog65i4993bbug.jpg`,
    );
    assert.equal(
      tiktokThumbnailPath("image", ADV, "tos-alisg-p-0051c001-sg/oEiu1EP1"),
      `tiktok/image/${ADV}/tos-alisg-p-0051c001-sg__oEiu1EP1.jpg`,
    );
  });

  it("refuses ids and advertisers that can't be keyed safely", () => {
    assert.equal(tiktokThumbnailStem("../etc"), "..__etc");
    assert.equal(tiktokThumbnailStem("a b"), null);
    assert.equal(tiktokThumbnailPath("video", "../x", "v1"), null);
  });
});

describe("cacheTikTokThumbnails", () => {
  it("makes no TikTok call on a cache hit", async () => {
    const { client, uploads } = fakeStorage([`tiktok/video/${ADV}/v1.jpg`]);
    const tt = fakeTikTok();
    const res = await cacheTikTokThumbnails({
      admin: client,
      advertiserId: ADV,
      token: "t",
      videoIds: ["v1"],
      imageIds: [],
      request: tt.request,
      fetchImage: imageFetch,
    });
    assert.equal(tt.calls.length, 0);
    assert.deepEqual(uploads, []);
    assert.equal(res.cached, 1);
    assert.equal(res.urls.get("video:v1"), `${PUBLIC}/tiktok/video/${ADV}/v1.jpg`);
  });

  it("asks TikTok once per video_id when misses are requested concurrently", async () => {
    const { client, uploads } = fakeStorage();
    const tt = fakeTikTok();
    const input = {
      admin: client,
      advertiserId: ADV,
      token: "t",
      imageIds: [],
      request: tt.request,
      fetchImage: imageFetch,
    };
    const [a, b] = await Promise.all([
      cacheTikTokThumbnails({ ...input, videoIds: ["v1", "v2"] }),
      cacheTikTokThumbnails({ ...input, videoIds: ["v2", "v1", "v3"] }),
    ]);
    const asked = tt.calls.flatMap((c) => c.ids).sort();
    assert.deepEqual(asked, ["v1", "v2", "v3"]);
    assert.deepEqual([...uploads].sort(), [
      `tiktok/video/${ADV}/v1.jpg`,
      `tiktok/video/${ADV}/v2.jpg`,
      `tiktok/video/${ADV}/v3.jpg`,
    ]);
    assert.equal(a.stored + b.stored, 5);
    assert.equal(b.urls.get("video:v1"), `${PUBLIC}/tiktok/video/${ADV}/v1.jpg`);
  });

  it("batches by the endpoint limit and stops at the call cap", async () => {
    const { client } = fakeStorage();
    const tt = fakeTikTok();
    const videoIds = Array.from({ length: 130 }, (_, i) => `v${i}`);
    const res = await cacheTikTokThumbnails({
      admin: client,
      advertiserId: ADV,
      token: "t",
      videoIds,
      imageIds: [],
      budget: { callsLeft: 2 },
      request: tt.request,
      fetchImage: imageFetch,
    });
    assert.deepEqual(tt.calls.map((c) => c.ids.length), [60, 60]);
    assert.equal(res.stored, 120);
    assert.equal(res.missing, 10);
  });

  it("makes zero TikTok calls with ENABLE_TIKTOK_THUMBNAIL_FETCH=0; hits still serve", async () => {
    process.env.ENABLE_TIKTOK_THUMBNAIL_FETCH = "0";
    const { client, uploads } = fakeStorage([`tiktok/video/${ADV}/v1.jpg`]);
    const tt = fakeTikTok();
    let downloads = 0;
    const res = await cacheTikTokThumbnails({
      admin: client,
      advertiserId: ADV,
      token: "t",
      videoIds: ["v1", "v2"],
      imageIds: ["tos-x/img"],
      request: tt.request,
      fetchImage: (async () => {
        downloads += 1;
        return imageFetch("");
      }) as typeof fetch,
    });
    assert.equal(tt.calls.length, 0);
    assert.equal(downloads, 0);
    assert.deepEqual(uploads, []);
    assert.equal(res.cached, 1);
    assert.equal(res.missing, 2);
  });

  it("does not store a source that is not an image", async () => {
    const { client, uploads } = fakeStorage();
    const tt = fakeTikTok();
    const res = await cacheTikTokThumbnails({
      admin: client,
      advertiserId: ADV,
      token: "t",
      videoIds: ["v1"],
      imageIds: [],
      request: tt.request,
      fetchImage: (async () =>
        new Response("x", { headers: { "content-type": "video/mp4" } })) as typeof fetch,
    });
    assert.deepEqual(uploads, []);
    assert.equal(res.missing, 1);
  });

  it("dry run reads TikTok but downloads and writes nothing", async () => {
    const { client, uploads } = fakeStorage();
    const tt = fakeTikTok();
    let downloads = 0;
    const res = await cacheTikTokThumbnails({
      admin: client,
      advertiserId: ADV,
      token: "t",
      videoIds: ["v1"],
      imageIds: ["tos-x/img"],
      dryRun: true,
      request: tt.request,
      fetchImage: (async () => {
        downloads += 1;
        return imageFetch("");
      }) as typeof fetch,
    });
    assert.equal(tt.calls.length, 2);
    assert.equal(downloads, 0);
    assert.deepEqual(uploads, []);
    assert.equal(res.stored, 2);
  });
});

describe("thumbnailIdsForRows", () => {
  it("uses the video for video ads, image ids otherwise, nothing for item-only Spark ads", () => {
    assert.deepEqual(
      thumbnailIdsForRows([
        { video_id: "v1", image_ids: ["tos-a/1"] },
        { video_id: null, image_ids: ["tos-b/2"] },
        { video_id: null, image_ids: [] },
        { video_id: "v1", image_ids: null },
      ]),
      { videoIds: ["v1"], imageIds: ["tos-b/2"] },
    );
  });
});

describe("unexpiredTikTokSignedUrl", () => {
  it("keeps an unexpired or unsigned URL and drops an expired one", () => {
    assert.equal(unexpiredTikTokSignedUrl(signed(FUTURE), NOW), signed(FUTURE));
    assert.equal(unexpiredTikTokSignedUrl(signed(PAST), NOW), null);
    assert.equal(unexpiredTikTokSignedUrl("https://x.example/a.jpg", NOW), "https://x.example/a.jpg");
    assert.equal(unexpiredTikTokSignedUrl(null, NOW), null);
  });
});

describe("resolveSnapshotThumbnailUrls", () => {
  it("returns the Storage URL, else the unexpired signed URL, else null", async () => {
    const { client } = fakeStorage([
      `tiktok/video/${ADV}/v1.jpg`,
      `tiktok/image/${ADV}/tos-x__img.jpg`,
    ]);
    const out = await resolveSnapshotThumbnailUrls(
      client,
      ADV,
      [
        { video_id: "v1", image_ids: null, thumbnail_url: signed(PAST) },
        { video_id: null, image_ids: ["tos-x/img"], thumbnail_url: null },
        { video_id: "v2", image_ids: null, thumbnail_url: signed(FUTURE) },
        { video_id: "v3", image_ids: null, thumbnail_url: signed(PAST) },
      ],
      NOW,
    );
    assert.deepEqual(
      out.map((r) => r.thumbnail_url),
      [
        `${PUBLIC}/tiktok/video/${ADV}/v1.jpg`,
        `${PUBLIC}/tiktok/image/${ADV}/tos-x__img.jpg`,
        signed(FUTURE),
        null,
      ],
    );
  });
});

describe("readActiveTikTokCreativesSnapshot thumbnails", () => {
  function fakeSupabase(thumbs: string[]) {
    const { client } = fakeStorage(thumbs);
    const rows = [
      { ad_id: "a1", video_id: "v1", image_ids: null, thumbnail_url: signed(PAST) },
      { ad_id: "a2", video_id: "v2", image_ids: null, thumbnail_url: signed(FUTURE) },
      { ad_id: "a3", video_id: "v3", image_ids: null, thumbnail_url: signed(PAST) },
    ].map((r) => ({
      ...r,
      kind: "ok",
      fetched_at: "2026-11-04T06:00:00Z",
      ad_name: r.ad_id,
      campaign_id: "c",
      campaign_name: "C",
      status: null,
      spend: 1,
      impressions: 1,
      reach: null,
      clicks: null,
      ctr: null,
      video_views_2s: null,
      video_views_6s: null,
      video_views_100p: null,
      deeplink_url: null,
      tiktok_item_id: null,
      identity_type: null,
      payload: null,
    }));
    const tables: Record<string, unknown[]> = {
      tiktok_active_creatives_snapshots: rows,
      events: [{ id: "e1", tiktok_account_id: "acc", client: null }],
      tiktok_accounts: [{ id: "acc", tiktok_advertiser_id: ADV }],
    };
    const query = (table: string) => {
      const result = { data: tables[table] ?? [], error: null };
      const single = { data: (tables[table] ?? [])[0] ?? null, error: null };
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "gte", "lte", "limit", "in", "is"]) {
        q[m] = () => q;
      }
      q.maybeSingle = async () => single;
      q.single = async () => single;
      q.then = (resolve: (v: unknown) => unknown) => resolve(result);
      return q;
    };
    return { from: query, storage: client.storage } as never;
  }

  it("serves the durable URL, the unexpired signed URL, and null when expired", async () => {
    const snapshot = await readActiveTikTokCreativesSnapshot(
      fakeSupabase([`tiktok/video/${ADV}/v1.jpg`]),
      "e1",
      { since: "2026-10-01", until: "2026-11-03" },
      { now: NOW },
    );
    assert.ok(snapshot);
    const byAd = new Map(snapshot.rows.map((r) => [r.ad_id, r.thumbnail_url]));
    assert.equal(byAd.get("a1"), `${PUBLIC}/tiktok/video/${ADV}/v1.jpg`);
    assert.equal(byAd.get("a2"), signed(FUTURE));
    assert.equal(byAd.get("a3"), null);
  });
});
