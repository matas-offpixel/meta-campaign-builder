import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nameCreativeVariations } from "../../tiktok/creative.ts";
import {
  appendSparkTikTokCreatives,
  appendUploadedTikTokCreatives,
  clampTikTokVariationCount,
  nextTikTokCreativeNames,
} from "../creative-items.ts";
import type { TikTokSparkPost } from "../../tiktok/spark-posts.ts";

const SHARED = {
  baseName: "Hero",
  adText: "Book now",
  displayName: "Brand",
  landingPageUrl: "https://example.com",
  cta: "LEARN_MORE",
} as const;

describe("appendUploadedTikTokCreatives", () => {
  it("persists all three uploaded files, not only the last", () => {
    let n = 0;
    const items = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "v1", thumbnailUrl: "t1", durationSeconds: 1, fileName: "a.mp4" },
        { videoId: "v2", thumbnailUrl: "t2", durationSeconds: 2, fileName: "b.mp4" },
        { videoId: "v3", thumbnailUrl: "t3", durationSeconds: 3, fileName: "c.mp4" },
      ],
      ...SHARED,
      newId: () => `id-${++n}`,
    });
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => item.videoId),
      ["v1", "v2", "v3"],
    );
    assert.deepEqual(
      items.map((item) => item.title),
      ["a.mp4", "b.mp4", "c.mp4"],
    );
    assert.deepEqual(
      items.map((item) => item.name),
      ["Hero · v1", "Hero · v2", "Hero · v3"],
    );
    assert.equal(new Set(items.map((item) => item.name)).size, items.length);
  });

  it("fans one uploaded video into three items that share the video id", () => {
    let n = 0;
    const items = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "vid-1", thumbnailUrl: "t1", durationSeconds: 8, fileName: "promo.mp4" },
      ],
      ...SHARED,
      variationCount: 3,
      newId: () => `id-${++n}`,
    });
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((item) => item.videoId),
      ["vid-1", "vid-1", "vid-1"],
    );
    assert.deepEqual(
      items.map((item) => item.name),
      nameCreativeVariations("Hero", 3),
    );
  });

  it("composes three files times two variations into six named items", () => {
    let n = 0;
    const items = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "v1", thumbnailUrl: "t1", durationSeconds: 1, fileName: "one.mp4" },
        { videoId: "v2", thumbnailUrl: "t2", durationSeconds: 2, fileName: "two.mp4" },
        { videoId: "v3", thumbnailUrl: "t3", durationSeconds: 3, fileName: "three.mp4" },
      ],
      ...SHARED,
      variationCount: 2,
      newId: () => `id-${++n}`,
    });
    assert.equal(items.length, 6);
    assert.deepEqual(
      items.map((item) => item.videoId),
      ["v1", "v1", "v2", "v2", "v3", "v3"],
    );
    const names = items.map((item) => item.name);
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(names, nameCreativeVariations("Hero", 6));
    assert.deepEqual(
      items.map((item) => item.title),
      ["one.mp4", "one.mp4", "two.mp4", "two.mp4", "three.mp4", "three.mp4"],
    );
  });

  it("clamps variationCount to 1..10 on the upload path", () => {
    assert.equal(clampTikTokVariationCount(0), 1);
    assert.equal(clampTikTokVariationCount("0"), 1);
    assert.equal(clampTikTokVariationCount(""), 1);
    assert.equal(clampTikTokVariationCount("nope"), 1);
    assert.equal(clampTikTokVariationCount(99), 10);
    assert.equal(clampTikTokVariationCount("99"), 10);
    assert.equal(clampTikTokVariationCount(3), 3);

    let n = 0;
    const tooMany = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "v1", thumbnailUrl: "t1", durationSeconds: 1, fileName: "a.mp4" },
      ],
      ...SHARED,
      variationCount: 99,
      newId: () => `id-${++n}`,
    });
    assert.equal(tooMany.length, 10);
    assert.deepEqual(
      tooMany.map((item) => item.name),
      nameCreativeVariations("Hero", 10),
    );

    n = 0;
    const tooFew = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "v1", thumbnailUrl: "t1", durationSeconds: 1, fileName: "a.mp4" },
      ],
      ...SHARED,
      variationCount: 0,
      newId: () => `id-${++n}`,
    });
    assert.equal(tooFew.length, 1);
    assert.deepEqual(tooFew.map((item) => item.name), nameCreativeVariations("Hero", 1));
  });

  it("numbering continues from existing items rather than restarting", () => {
    let n = 0;
    const existing = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "old-1", thumbnailUrl: "t0", durationSeconds: 1, fileName: "old-a.mp4" },
        { videoId: "old-2", thumbnailUrl: "t0", durationSeconds: 1, fileName: "old-b.mp4" },
      ],
      ...SHARED,
      newId: () => `id-${++n}`,
    });
    const items = appendUploadedTikTokCreatives({
      existing,
      uploads: [
        { videoId: "vid-1", thumbnailUrl: "t1", durationSeconds: 8, fileName: "promo.mp4" },
      ],
      ...SHARED,
      variationCount: 3,
      newId: () => `id-${++n}`,
    });
    const added = items.slice(existing.length).map((item) => item.name);
    assert.deepEqual(added, ["Hero · v3", "Hero · v4", "Hero · v5"]);
    assert.equal(new Set(items.map((item) => item.name)).size, items.length);
  });

  it("two sequential pastes get distinct names continuing the sequence", () => {
    const first = nextTikTokCreativeNames("Hero", 0, 2);
    const second = nextTikTokCreativeNames("Hero", first.length, 2);
    const names = [...first, ...second];
    assert.equal(new Set(names).size, names.length);
    assert.deepEqual(names, nameCreativeVariations("Hero", 4));
  });

  it("maps two spark posts to SPARK_AD items with the post identity", () => {
    let n = 0;
    const posts: TikTokSparkPost[] = [
      {
        item_id: "item-1",
        text: "One",
        status: "HESITATE_RECOMMEND",
        item_type: "VIDEO",
        identity_id: "id-a",
        identity_type: "AUTH_CODE",
        identity_display_name: "nxloves",
        ad_auth_status: "AUTHORIZED",
        auth_end_time: "2026-11-18 14:39:06",
        poster_url: "https://cdn.example/a.jpg",
        preview_url: "https://cdn.example/a.mp4",
        duration_seconds: 12,
        fetched_at: "2026-09-07T21:00:00.000Z",
      },
      {
        item_id: "item-2",
        text: "Two",
        status: "HESITATE_RECOMMEND",
        item_type: "VIDEO",
        identity_id: "id-b",
        identity_type: "AUTH_CODE",
        identity_display_name: "electricstudios",
        ad_auth_status: "AUTHORIZED",
        auth_end_time: "2026-11-18 14:39:06",
        poster_url: "https://cdn.example/b.jpg",
        preview_url: "https://cdn.example/b.mp4",
        duration_seconds: 20,
        fetched_at: "2026-09-07T21:00:00.000Z",
      },
    ];
    const items = appendSparkTikTokCreatives({
      existing: [],
      posts,
      baseName: "Hero",
      adText: "Book now",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
      now: Date.parse("2026-09-07T21:00:00.000Z"),
      newId: () => `id-${++n}`,
    });
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => item.mode),
      ["SPARK_AD", "SPARK_AD"],
    );
    assert.deepEqual(
      items.map((item) => item.sparkPostId),
      ["item-1", "item-2"],
    );
    assert.deepEqual(
      items.map((item) => item.identityId),
      ["id-a", "id-b"],
    );
    assert.equal(items[0]!.videoId, null);
  });

  it("maps two library picks at variationCount 1 to two VIDEO_REFERENCE items", () => {
    let n = 0;
    const items = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "lib-1", thumbnailUrl: "t1", durationSeconds: 12, fileName: "one.mp4" },
        { videoId: "lib-2", thumbnailUrl: "t2", durationSeconds: 20, fileName: "two.mp4" },
      ],
      ...SHARED,
      variationCount: 1,
      newId: () => `id-${++n}`,
    });
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((item) => item.videoId),
      ["lib-1", "lib-2"],
    );
    assert.deepEqual(
      items.map((item) => item.mode),
      ["VIDEO_REFERENCE", "VIDEO_REFERENCE"],
    );
    assert.equal(new Set(items.map((item) => item.id)).size, 2);
  });

  it("produces a UUID-shaped id when newId is not injected", () => {
    const items = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "v1", thumbnailUrl: "t1", durationSeconds: 1, fileName: "a.mp4" },
      ],
      ...SHARED,
    });
    assert.equal(items.length, 1);
    assert.match(
      items[0]!.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
