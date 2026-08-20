import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  readTikTokUploadedImageId,
  TIKTOK_AD_IMAGE_UPLOAD_PATH,
  uploadTikTokAdImageByUrl,
} from "../image-upload.ts";
import { hydrateDraftCoverImageIds } from "../write/cover-image.ts";
import type { TikTokPost } from "../write/idempotency.ts";
import type { BodyValue } from "../client.ts";

describe("readTikTokUploadedImageId", () => {
  it("reads image_id from the unwrapped data object TikTok returns", () => {
    assert.equal(
      readTikTokUploadedImageId({ image_id: "ad-site-i18n-sg/cover-1" }),
      "ad-site-i18n-sg/cover-1",
    );
    assert.equal(readTikTokUploadedImageId({ list: [{ image_id: "img-list" }] }), "img-list");
    assert.equal(readTikTokUploadedImageId([{ image_id: "img-arr" }]), "img-arr");
    assert.equal(readTikTokUploadedImageId({ material_id: "not-it" }), null);
  });
});

describe("uploadTikTokAdImageByUrl", () => {
  it("POSTs FileImageAdUpload UPLOAD_BY_URL and returns image_id", async () => {
    const calls: Array<{ path: string; body: Record<string, BodyValue> }> = [];
    const request: TikTokPost = async (path, body) => {
      calls.push({ path, body });
      return { image_id: "img-from-url" };
    };
    const imageId = await uploadTikTokAdImageByUrl({
      advertiserId: "7639802149165301776",
      token: "tok",
      imageUrl: "https://cdn.example/hero.jpg",
      fileName: "Hero cover.jpg",
      request,
    });
    assert.equal(imageId, "img-from-url");
    assert.equal(calls[0].path, TIKTOK_AD_IMAGE_UPLOAD_PATH);
    assert.equal(calls[0].body.upload_type, "UPLOAD_BY_URL");
    assert.equal(calls[0].body.image_url, "https://cdn.example/hero.jpg");
    assert.equal(calls[0].body.advertiser_id, "7639802149165301776");
    assert.equal("video_id" in calls[0].body, false);
    assert.equal(calls[0].body.upload_type !== "UPLOAD_BY_VIDEO_ID", true);
  });
});

describe("hydrateDraftCoverImageIds", () => {
  it("uploads a distinct cover per creative from that creative's thumbnail", async () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.accountSetup.advertiserId = "advertiser_1";
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "Prospecting", budget: 50, startAt: null, endAt: null },
    ];
    draft.creatives.items = [
      {
        id: "c-a",
        name: "A",
        mode: "VIDEO_REFERENCE",
        baseName: "A",
        videoId: "video-a",
        videoUrl: null,
        thumbnailUrl: "https://cdn.example/a.jpg",
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "",
        adText: "Ad",
        displayName: "Brand",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
      {
        id: "c-b",
        name: "B",
        mode: "VIDEO_REFERENCE",
        baseName: "B",
        videoId: "video-b",
        videoUrl: null,
        thumbnailUrl: "https://cdn.example/b.jpg",
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "",
        adText: "Ad",
        displayName: "Brand",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["c-a", "c-b"] };

    const request: TikTokPost = async (_path, body) => {
      const url = String(body.image_url);
      return { image_id: url.includes("/a.jpg") ? "img-a" : "img-b" };
    };

    const resolved = await hydrateDraftCoverImageIds({
      draft,
      token: "tok",
      request,
    });
    assert.equal(resolved, 2);
    assert.equal(draft.creatives.items[0].coverImageId, "img-a");
    assert.equal(draft.creatives.items[1].coverImageId, "img-b");
  });

  it("does not re-upload a creative that already has coverImageId", async () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.accountSetup.advertiserId = "advertiser_1";
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "Prospecting", budget: 50, startAt: null, endAt: null },
    ];
    draft.creatives.items = [
      {
        id: "c-a",
        name: "A",
        mode: "VIDEO_REFERENCE",
        baseName: "A",
        videoId: "video-a",
        videoUrl: null,
        thumbnailUrl: "https://cdn.example/a.jpg",
        coverImageId: "already-there",
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "",
        adText: "Ad",
        displayName: "Brand",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["c-a"] };
    let calls = 0;
    const request: TikTokPost = async () => {
      calls += 1;
      return { image_id: "should-not-run" };
    };
    const resolved = await hydrateDraftCoverImageIds({
      draft,
      token: "tok",
      request,
    });
    assert.equal(resolved, 0);
    assert.equal(calls, 0);
    assert.equal(draft.creatives.items[0].coverImageId, "already-there");
  });
});
