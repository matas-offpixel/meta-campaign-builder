import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refreshExpiredTikTokThumbnails } from "../creative-thumbnails.ts";
import type { TikTokCreativeDraft } from "../../types/tiktok-draft.ts";

function creative(partial: Partial<TikTokCreativeDraft> & { id: string }): TikTokCreativeDraft {
  return {
    name: partial.name ?? "Hero",
    mode: "VIDEO_REFERENCE",
    baseName: "Hero",
    videoId: partial.videoId ?? "v1",
    videoUrl: null,
    thumbnailUrl: partial.thumbnailUrl ?? "https://cdn.example/dead.jpg",
    thumbnailExpiresAt: partial.thumbnailExpiresAt ?? null,
    durationSeconds: 8,
    title: "one.mp4",
    sparkPostId: null,
    caption: "",
    adText: "",
    displayName: "Brand",
    landingPageUrl: "",
    cta: "LEARN_MORE",
    musicId: null,
    ...partial,
  };
}

describe("refreshExpiredTikTokThumbnails", () => {
  it("refetches via video info when the cover URL is expired instead of rendering a dead image", async () => {
    const now = Date.parse("2026-08-20T18:00:00.000Z");
    let fetched = 0;
    const result = await refreshExpiredTikTokThumbnails({
      now,
      items: [
        creative({
          id: "c1",
          videoId: "v1",
          thumbnailUrl: "https://cdn.example/dead.jpg",
          thumbnailExpiresAt: "2026-08-20T12:00:00.000Z",
        }),
        creative({
          id: "c2",
          videoId: "v2",
          thumbnailUrl: "https://cdn.example/live.jpg",
          thumbnailExpiresAt: "2026-08-20T20:00:00.000Z",
        }),
      ],
      fetchInfo: async (videoId) => {
        fetched += 1;
        assert.equal(videoId, "v1");
        return {
          thumbnailUrl: "https://cdn.example/fresh.jpg",
          expiresAt: "2026-08-21T00:00:00.000Z",
        };
      },
    });
    assert.equal(fetched, 1);
    assert.deepEqual(result.refetchedIds, ["c1"]);
    assert.equal(result.items[0]?.thumbnailUrl, "https://cdn.example/fresh.jpg");
    assert.equal(result.items[1]?.thumbnailUrl, "https://cdn.example/live.jpg");
  });

  it("treats a missing expiry as expired so pre-fix creatives refetch", async () => {
    let fetched = 0;
    const result = await refreshExpiredTikTokThumbnails({
      items: [
        creative({
          id: "legacy",
          videoId: "v-old",
          thumbnailUrl: "https://cdn.example/dead.jpg",
          thumbnailExpiresAt: null,
        }),
      ],
      fetchInfo: async () => {
        fetched += 1;
        return { thumbnailUrl: "https://cdn.example/fresh.jpg" };
      },
    });
    assert.equal(fetched, 1);
    assert.deepEqual(result.refetchedIds, ["legacy"]);
    assert.equal(result.items[0]?.thumbnailUrl, "https://cdn.example/fresh.jpg");
  });
});
