import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import type { TikTokCreativeDraft } from "../../types/tiktok-draft.ts";
import {
  readTikTokUploadedImageId,
  TIKTOK_AD_IMAGE_UPLOAD_PATH,
  uploadTikTokAdImageByUrl,
} from "../image-upload.ts";
import { hydrateDraftCoverImageIds } from "../write/cover-image.ts";
import { collectTikTokLaunchPreflight } from "../write/preflight.ts";
import { resolveTikTokCreativeCovers } from "../../tiktok-wizard/resolve-cover.ts";
import type { TikTokPost } from "../write/idempotency.ts";
import type { BodyValue } from "../client.ts";

const CAPTURED_DUPLICATE = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../__fixtures__/captured/tiktok-cover-duplicate-material-name-2026-09-24.json",
    ),
    "utf8",
  ),
) as { lines: string[] };

function capturedDuplicateMessage(): string {
  const line = CAPTURED_DUPLICATE.lines[0] ?? "";
  const marker = "failed: ";
  const at = line.indexOf(marker);
  assert.ok(at >= 0, line);
  return line.slice(at + marker.length);
}

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
    assert.equal(resolved.resolved, 2);
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
    assert.equal(resolved.resolved, 0);
    assert.equal(calls, 0);
    assert.equal(draft.creatives.items[0].coverImageId, "already-there");
  });
});

function assignedVideo(name: string): TikTokCreativeDraft {
  return {
    id: "c-a",
    name,
    mode: "VIDEO_REFERENCE",
    baseName: name,
    videoId: "v10033g50000daqjk",
    videoUrl: null,
    thumbnailUrl: "https://cdn.example/cover.jpg",
    durationSeconds: null,
    title: null,
    sparkPostId: null,
    caption: "",
    adText: "Ad",
    displayName: "Brand",
    landingPageUrl: "https://example.com",
    cta: "LEARN_MORE",
    musicId: null,
  };
}

function draftWith(creative: TikTokCreativeDraft) {
  const draft = createDefaultTikTokDraft("draft-1");
  draft.accountSetup.advertiserId = "7639802149165301776";
  draft.budgetSchedule.adGroups = [
    { id: "ag-1", name: "London", budget: 50, startAt: null, endAt: null },
  ];
  draft.creatives.items = [creative];
  draft.creativeAssignments.byAdGroupId = { "ag-1": [creative.id] };
  return draft;
}

describe("captured duplicate material name", () => {
  it("retries under a new file name and stores the cover id", async () => {
    const reason = capturedDuplicateMessage();
    assert.equal(reason, "Duplicate material name.");
    const names: string[] = [];
    let calls = 0;
    const request: TikTokPost = async (_path, body) => {
      calls += 1;
      names.push(String(body.file_name));
      if (calls === 1) throw new Error(reason);
      return { image_id: "img-retried" };
    };
    const draft = draftWith(assignedVideo("TikTok creative · v1"));
    const result = await hydrateDraftCoverImageIds({ draft, token: "tok", request, now: 1 });
    assert.equal(result.resolved, 1);
    assert.equal(result.failed, 0);
    assert.equal(draft.creatives.items[0].coverImageId, "img-retried");
    assert.equal(draft.creatives.items[0].coverImageError ?? null, null);
    assert.equal(names.length, 2);
    assert.notEqual(names[0], names[1]);
    const preflight = collectTikTokLaunchPreflight(draft);
    assert.equal(
      preflight.issues.some((issue) => issue.message.includes("could not be uploaded")),
      false,
    );
  });

  it("names the creative when the retry also fails, including in preflight", async () => {
    const reason = capturedDuplicateMessage();
    const request: TikTokPost = async () => {
      throw new Error(reason);
    };
    const draft = draftWith(assignedVideo("TikTok creative · v2"));
    const result = await hydrateDraftCoverImageIds({ draft, token: "tok", request, now: 1 });
    assert.equal(result.resolved, 0);
    assert.equal(result.failed, 1);
    assert.equal(draft.creatives.items[0].coverImageId ?? null, null);
    const stored = draft.creatives.items[0].coverImageError ?? "";
    assert.match(stored, /TikTok creative · v2/);
    assert.match(stored, /Duplicate material name\./);
    assert.match(stored, /re-select the video/);
    const preflight = collectTikTokLaunchPreflight(draft);
    const cover = preflight.issues.find((issue) => issue.field === "image_ids");
    assert.ok(cover);
    assert.match(cover.message, /TikTok creative · v2/);
    assert.match(cover.message, /re-select the video/);
  });

  it("stores a reason when no cover URL comes back", async () => {
    const draft = draftWith({
      ...assignedVideo("TikTok creative · v3"),
      thumbnailUrl: null,
    });
    const result = await hydrateDraftCoverImageIds({
      draft,
      token: "tok",
      requestGet: async () => ({ list: [] }),
    });
    assert.equal(result.failed, 1);
    assert.equal(draft.creatives.items[0].coverImageId ?? null, null);
    assert.match(draft.creatives.items[0].coverImageError ?? "", /no cover URL/);
  });

  it("has no silent skip when a cover does not resolve", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../write/cover-image.ts"),
      "utf8",
    );
    assert.equal(source.includes("if (!imageUrl) continue"), false);
  });
});

describe("resolveTikTokCreativeCovers", () => {
  it("writes the failure onto the row when the cover cannot be fetched", async () => {
    const item = assignedVideo("TikTok creative · v4");
    const [next] = await resolveTikTokCreativeCovers({
      advertiserId: "7639802149165301776",
      items: [item],
      fetchCover: async () => ({
        coverImageId: null,
        error: "Creative \"TikTok creative · v4\" — cover image could not be uploaded to TikTok (Duplicate material name.). Open Creatives and re-select the video.",
      }),
    });
    assert.equal(next?.coverImageId ?? null, null);
    assert.match(next?.coverImageError ?? "", /Duplicate material name\./);
  });

  it("stores the cover id and shows no error when the upload succeeds", async () => {
    const item = assignedVideo("TikTok creative · v5");
    const [next] = await resolveTikTokCreativeCovers({
      advertiserId: "7639802149165301776",
      items: [item],
      fetchCover: async () => ({ coverImageId: "img-ok", error: null }),
    });
    assert.equal(next?.coverImageId, "img-ok");
    assert.equal(next?.coverImageError ?? null, null);
  });
});
