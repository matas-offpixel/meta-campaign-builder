/**
 * Regression tests for the video creative thumbnail fix, across three tasks:
 *
 * Task #68 root cause: buildVideoCreative was building video_data without
 * image_url or image_hash, causing Meta to reject every video creative with:
 *   code=100 · subcode=1443226
 *   "Please specify one of image_hash or image_url in the video_data field
 *    of object_story_spec."
 * Fix (#68): plumb thumbnailUrl (from Asset, populated by uploadVideoAsset →
 * previewUrl) into videoData.image_url.
 *
 * Task #112 root cause: sending Meta's own CDN thumbnail URL back as
 * `image_url` is accepted at create time, but Meta then uploads that URL
 * itself and stores BOTH `image_url` AND an internally-generated
 * `image_hash` on the creative. When the operator uses Meta UI's Duplicate
 * flow, both fields get copied into the new creative and Meta's stricter
 * write-side validator rejects with code=100 · subcode=1443051
 * "ObjectStorySpecRedundant: Only one of image_url and image_hash should be
 * specified in the field video_data."
 * Fix (#112): upload the thumbnail ourselves (POST /adimages via
 * `uploadImageFromUrl`) and send ONLY `image_hash` — never both fields.
 *
 * Task #90 follow-up (this fix) root cause: `POST /adimages` — including
 * task #112's own upload call — is unconditionally blocked under this app's
 * App Review status (code=3 "Application does not have the capability"),
 * regardless of which token is used (PR #766 ruled out "wrong token" as the
 * cause). Escaping App Review is a weeks-long unblock.
 * Fix (#90 follow-up): stop calling `/adimages` entirely.
 * `lib/meta/client.ts`'s `uploadVideoAsset` now always passes `thumb_offset`
 * at `POST /advideos` upload time, so Meta already has a real frame
 * attached to the video OBJECT itself — `video_data` is sent WITHOUT
 * `image_hash` AND WITHOUT `image_url`; Meta renders the thumb_offset frame
 * at ad-serving time. This never regresses #68 (Meta doesn't need either
 * field once thumb_offset is set) and makes #112's Duplicate-flow bug
 * structurally impossible (neither field is ever set, so there's nothing
 * for Duplicate to copy).
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

describe("buildVideoCreative — never sends image_hash/image_url (task #90 follow-up)", () => {
  it("omits both image_hash and image_url even when the asset has a real thumbnailUrl", async () => {
    const creative = makeVideoCreative({
      thumbnailUrl: "https://scontent.xx.fbcdn.net/preview/vid_abc123.jpg",
    });

    const payload = await buildCreativePayload(creative);

    const videoData = payload.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.equal(videoData.image_hash, undefined, "image_hash must never be set — /adimages is App-Review-blocked");
    assert.equal(videoData.image_url, undefined, "image_url must never be set either — relies on thumb_offset instead");
  });

  it("omits both fields when thumbnailUrl is missing entirely (old drafts) — never throws", async () => {
    const creative = makeVideoCreative({ thumbnailUrl: undefined });

    let payload: Awaited<ReturnType<typeof buildCreativePayload>>;
    await assert.doesNotReject(async () => {
      payload = await buildCreativePayload(creative);
    });
    const videoData = payload!.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.equal(videoData.image_hash, undefined);
    assert.equal(videoData.image_url, undefined);
  });

  it("never touches Meta's write API — buildCreativePayload takes no upload/token options for video", async () => {
    // BuildCreativePayloadOpts only carries validatedIgActorId as of this
    // fix; passing metaAdAccountId/metaAccessToken/uploadThumbnailAsImage
    // is now a TypeScript error (see the removed fields' history in git),
    // so there is nothing left for a test to inject — this test instead
    // asserts the payload builds correctly with zero opts at all.
    const creative = makeVideoCreative({
      thumbnailUrl: "https://scontent.xx.fbcdn.net/preview/vid_abc123.jpg",
    });
    const payload = await buildCreativePayload(creative, {});
    assert.equal(payload.object_story_spec?.video_data?.video_id, "vid_abc123");
  });

  it("still sets video_id correctly with no thumbnail fields alongside it", async () => {
    const creative = makeVideoCreative({
      thumbnailUrl: "https://scontent.xx.fbcdn.net/preview/vid_abc123.jpg",
    });
    const payload = await buildCreativePayload(creative);
    const videoData = payload.object_story_spec?.video_data;
    assert.equal(videoData?.video_id, "vid_abc123");
    assert.equal(videoData?.image_hash, undefined);
    assert.equal(videoData?.image_url, undefined);
  });

  it("multi-ratio draft: still picks the 9:16 videoId first, with no thumbnail fields", async () => {
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
              thumbnailUrl: "https://scontent.xx.fbcdn.net/thumb_45.jpg",
            },
            {
              id: "asset_916",
              aspectRatio: "9:16",
              uploadStatus: "uploaded",
              videoId: "vid_916",
              thumbnailUrl: "https://scontent.xx.fbcdn.net/thumb_916.jpg",
            },
          ],
        },
      ],
    };

    const payload = await buildCreativePayload(creative);
    const videoData = payload.object_story_spec?.video_data;

    // 9:16 wins per VIDEO_PRIORITY
    assert.equal(videoData?.video_id, "vid_916", "should pick 9:16 videoId first");
    assert.equal(videoData?.image_hash, undefined);
    assert.equal(videoData?.image_url, undefined);
  });
});
