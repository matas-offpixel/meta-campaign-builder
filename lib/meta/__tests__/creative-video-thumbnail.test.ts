/**
 * Regression tests for the video creative thumbnail fix (task #68, then #112).
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
 * `buildCreativePayload` accepts an injectable `uploadThumbnailAsImage` so
 * these tests never hit the network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCreativePayload, type BuildCreativePayloadOpts } from "../creative.ts";
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

/**
 * A stub uploader standing in for `uploadImageFromUrl` (lib/meta/client.ts) —
 * deterministic, no network. Records every call so tests can assert on
 * exactly what was uploaded.
 */
function stubUploader(prefix = "hash_for") {
  const calls: { adAccountId: string; imageUrl: string; token?: string }[] = [];
  const uploader: NonNullable<BuildCreativePayloadOpts["uploadThumbnailAsImage"]> = async (
    adAccountId,
    imageUrl,
    token,
  ) => {
    calls.push({ adAccountId, imageUrl, token });
    return { hash: `${prefix}:${imageUrl}` };
  };
  return { uploader, calls };
}

const AD_ACCOUNT_ID = "act_999";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildVideoCreative — image_hash, not image_url (task #112)", () => {
  it("uploads the thumbnail and sets image_hash on video_data — image_url is NOT set", async () => {
    const { uploader, calls } = stubUploader();
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });

    const payload = await buildCreativePayload(creative, {
      metaAdAccountId: AD_ACCOUNT_ID,
      uploadThumbnailAsImage: uploader,
    });

    const videoData = payload.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.equal(
      videoData.image_hash,
      "hash_for:https://cdn.meta.com/preview/vid_abc123.jpg",
      "image_hash must be the uploaded hash for the thumbnail URL",
    );
    assert.equal(
      videoData.image_url,
      undefined,
      "image_url must NOT be set alongside image_hash — Meta rejects both being present " +
        "on Duplicate (subcode=1443051)",
    );
    assert.equal(calls.length, 1, "exactly one upload call");
    assert.deepEqual(calls[0], {
      adAccountId: AD_ACCOUNT_ID,
      imageUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
      token: undefined,
    });
  });

  it("passes the access token through to the uploader when provided", async () => {
    const { uploader, calls } = stubUploader();
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });

    await buildCreativePayload(creative, {
      metaAdAccountId: AD_ACCOUNT_ID,
      metaAccessToken: "tok_live_123",
      uploadThumbnailAsImage: uploader,
    });

    assert.equal(calls[0].token, "tok_live_123");
  });

  it("omits image_hash (no throw) when thumbnailUrl is missing — old drafts", async () => {
    const { uploader, calls } = stubUploader();
    const creative = makeVideoCreative({ thumbnailUrl: undefined });

    let payload: Awaited<ReturnType<typeof buildCreativePayload>>;
    await assert.doesNotReject(async () => {
      payload = await buildCreativePayload(creative, {
        metaAdAccountId: AD_ACCOUNT_ID,
        uploadThumbnailAsImage: uploader,
      });
    });
    const videoData = payload!.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.equal(videoData.image_hash, undefined, "no thumbnailUrl → no hash");
    assert.equal(videoData.image_url, undefined, "no thumbnailUrl → no url either");
    assert.equal(calls.length, 0, "uploader must not be called with no thumbnailUrl");
  });

  it("falls back to image_url (never both) when no metaAdAccountId is provided", async () => {
    const { uploader, calls } = stubUploader();
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });

    // No metaAdAccountId → upload is skipped entirely, so the uploader must
    // never be invoked, and video_data falls back to image_url so a
    // thumbnail is still sent (never regresses #68's subcode=1443226).
    const payload = await buildCreativePayload(creative, {
      uploadThumbnailAsImage: uploader,
    });

    const videoData = payload.object_story_spec?.video_data;
    assert.equal(calls.length, 0, "uploader must not be called without an ad account");
    assert.equal(
      videoData?.image_url,
      "https://cdn.meta.com/preview/vid_abc123.jpg",
      "falls back to image_url so a thumbnail is still present",
    );
    assert.equal(videoData?.image_hash, undefined);
  });

  it("falls back to image_url (never both) when the upload call fails", async () => {
    const failingUploader: NonNullable<BuildCreativePayloadOpts["uploadThumbnailAsImage"]> = async () => {
      throw new Error("Meta API error: rate limited");
    };
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });

    const payload = await buildCreativePayload(creative, {
      metaAdAccountId: AD_ACCOUNT_ID,
      uploadThumbnailAsImage: failingUploader,
    });

    const videoData = payload.object_story_spec?.video_data;
    assert.equal(
      videoData?.image_url,
      "https://cdn.meta.com/preview/vid_abc123.jpg",
      "upload failure falls back to image_url rather than throwing",
    );
    assert.equal(videoData?.image_hash, undefined);
  });

  it("still sets video_id correctly alongside image_hash", async () => {
    const { uploader } = stubUploader();
    const creative = makeVideoCreative({
      thumbnailUrl: "https://cdn.meta.com/preview/vid_abc123.jpg",
    });
    const payload = await buildCreativePayload(creative, {
      metaAdAccountId: AD_ACCOUNT_ID,
      uploadThumbnailAsImage: uploader,
    });
    const videoData = payload.object_story_spec?.video_data;
    assert.equal(videoData?.video_id, "vid_abc123");
    assert.equal(
      videoData?.image_hash,
      "hash_for:https://cdn.meta.com/preview/vid_abc123.jpg",
    );
  });

  it("multi-ratio draft: uploads the thumbnail from the same asset as the chosen videoId", async () => {
    // 4:5 and 9:16 slots, each with different videoIds and thumbnails.
    // Priority order is 9:16 → 4:5 → 1:1, so 9:16 should win.
    const { uploader, calls } = stubUploader();
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

    const payload = await buildCreativePayload(creative, {
      metaAdAccountId: AD_ACCOUNT_ID,
      uploadThumbnailAsImage: uploader,
    });
    const videoData = payload.object_story_spec?.video_data;

    // 9:16 wins per VIDEO_PRIORITY
    assert.equal(videoData?.video_id, "vid_916", "should pick 9:16 videoId first");
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].imageUrl,
      "https://cdn.meta.com/thumb_916.jpg",
      "uploaded thumbnail must match the chosen video asset (9:16), not the 4:5 slot",
    );
    assert.equal(
      videoData?.image_hash,
      "hash_for:https://cdn.meta.com/thumb_916.jpg",
    );
  });
});
