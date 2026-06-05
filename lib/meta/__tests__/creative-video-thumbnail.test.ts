/**
 * Regression tests for the video creative thumbnail fix.
 *
 * Root cause: buildVideoCreative was building video_data without image_url or
 * image_hash, causing Meta to reject every video creative with:
 *   code=100 · subcode=1443226
 *   "Please specify one of image_hash or image_url in the video_data field
 *    of object_story_spec."
 *
 * Fix: plumb thumbnailUrl (from Asset, populated by uploadVideoAsset →
 * previewUrl) into videoData.image_url.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCreativePayload } from "../creative.ts";
import type { AdCreativeDraft } from "../../types.ts";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeVideoCreative(overrides?: {
  thumbnailUrl?: string;
  aspectRatio?: string;
}): AdCreativeDraft {
  const { thumbnailUrl, aspectRatio = "9:16" } = overrides ?? {};
  return {
    id: "cr_test",
    name: "Test Video",
    sourceType: "new",
    mediaType: "video",
    assetMode: "single",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [
      {
        id: "var_1",
        name: "Variation 1",
        assets: [
          {
            id: "asset_1",
            aspectRatio: aspectRatio as "9:16",
            uploadStatus: "uploaded",
            videoId: "vid_abc123",
            thumbnailUrl,
          },
        ],
      },
    ],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Buy tickets now",
    description: "",
    destinationUrl: "https://example.com/tickets",
    cta: "book_now",
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildVideoCreative — thumbnail fix (code=100 subcode=1443226)", () => {
  it("sets image_url on video_data when thumbnailUrl is present", () => {
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });
    const payload = buildCreativePayload(creative);
    const videoData = payload.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.equal(
      videoData.image_url,
      "https://cdn.meta.com/preview/vid_abc123.jpg",
      "image_url must match thumbnailUrl",
    );
  });

  it("omits image_url (no throw) when thumbnailUrl is missing — old drafts", () => {
    const creative = makeVideoCreative({ thumbnailUrl: undefined });
    // Must not throw even though no thumbnailUrl
    let payload: ReturnType<typeof buildCreativePayload>;
    assert.doesNotThrow(() => {
      payload = buildCreativePayload(creative);
    });
    const videoData = payload!.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.equal(
      videoData.image_url,
      undefined,
      "image_url must be undefined when no thumbnailUrl",
    );
  });

  it("still sets video_id correctly alongside image_url", () => {
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });
    const payload = buildCreativePayload(creative);
    const videoData = payload.object_story_spec?.video_data;
    assert.equal(videoData?.video_id, "vid_abc123");
    assert.equal(videoData?.image_url, "https://cdn.meta.com/preview/vid_abc123.jpg");
  });

  it("multi-ratio draft: uses thumbnail from the same asset as the chosen videoId", () => {
    // 4:5 and 9:16 slots, each with different videoIds and thumbnails.
    // Priority order is 9:16 → 4:5 → 1:1, so 9:16 should win.
    const creative: AdCreativeDraft = {
      ...makeVideoCreative(),
      assetVariations: [
        {
          id: "var_1",
          name: "Variation 1",
          assets: [
            {
              id: "asset_45",
              aspectRatio: "4:5",
              uploadStatus: "uploaded",
              videoId: "vid_45",
              thumbnailUrl: "https://cdn.meta.com/thumb_45.jpg",
            },
            {
              id: "asset_916",
              aspectRatio: "9:16",
              uploadStatus: "uploaded",
              videoId: "vid_916",
              thumbnailUrl: "https://cdn.meta.com/thumb_916.jpg",
            },
          ],
        },
      ],
    };

    const payload = buildCreativePayload(creative);
    const videoData = payload.object_story_spec?.video_data;

    // 9:16 wins per VIDEO_PRIORITY
    assert.equal(videoData?.video_id, "vid_916", "should pick 9:16 videoId first");
    assert.equal(
      videoData?.image_url,
      "https://cdn.meta.com/thumb_916.jpg",
      "thumbnail must match the chosen video asset (9:16), not the 4:5 slot",
    );
  });
});
