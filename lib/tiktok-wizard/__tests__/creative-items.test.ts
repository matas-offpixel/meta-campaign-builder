import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { appendUploadedTikTokCreatives } from "../creative-items.ts";

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
      baseName: "Hero",
      adText: "Book now",
      displayName: "Brand",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
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
  });

  it("produces a UUID-shaped id when newId is not injected", () => {
    const items = appendUploadedTikTokCreatives({
      existing: [],
      uploads: [
        { videoId: "v1", thumbnailUrl: "t1", durationSeconds: 1, fileName: "a.mp4" },
      ],
      baseName: "Hero",
      adText: "Book now",
      displayName: "Brand",
      landingPageUrl: "https://example.com",
      cta: "LEARN_MORE",
    });
    assert.equal(items.length, 1);
    assert.match(
      items[0]!.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
