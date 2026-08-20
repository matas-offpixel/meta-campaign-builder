import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nameCreativeVariations } from "../../tiktok/creative.ts";
import {
  appendUploadedTikTokCreatives,
  clampTikTokVariationCount,
} from "../creative-items.ts";

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
      nameCreativeVariations("Hero", 1).concat(
        nameCreativeVariations("Hero", 1),
        nameCreativeVariations("Hero", 1),
      ),
    );
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
    assert.deepEqual(
      items.map((item) => item.name),
      [
        ...nameCreativeVariations("Hero", 2),
        ...nameCreativeVariations("Hero", 2),
        ...nameCreativeVariations("Hero", 2),
      ],
    );
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
