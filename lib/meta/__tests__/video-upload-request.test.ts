/**
 * Tests for lib/meta/video-upload-request.ts — task #90 follow-up
 * (bypass the App-Review-blocked POST /adimages entirely via thumb_offset
 * at video-upload time, rather than a per-creative image-hash write).
 *
 * These exercise the pure request-field builders `uploadVideoAsset`
 * (lib/meta/client.ts) delegates to — see that file's doc comment for why
 * client.ts itself can't be imported directly under
 * `--experimental-strip-types` (MetaApiError's parameter properties).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildVideoUploadFields,
  buildVideoThumbnailOverrideRequest,
  DEFAULT_THUMB_OFFSET_MS,
} from "../video-upload-request.ts";

describe("buildVideoUploadFields", () => {
  it("defaults thumbOffsetMs to 1000ms (1s in) when not provided", () => {
    const fields = buildVideoUploadFields("my video.mp4");
    assert.equal(fields.thumbOffsetMs, 1000);
    assert.equal(DEFAULT_THUMB_OFFSET_MS, 1000);
  });

  it("sanitises the filename — special characters become underscores", () => {
    const fields = buildVideoUploadFields("IPC Newcastle (final) v2!.mp4");
    assert.equal(fields.safeFilename, "IPC_Newcastle__final__v2_.mp4");
  });

  it("falls back to upload.mp4 when given an empty filename", () => {
    const fields = buildVideoUploadFields("");
    assert.equal(fields.safeFilename, "upload.mp4");
  });

  it("derives the title by stripping the file extension", () => {
    const fields = buildVideoUploadFields("event_teaser.mov");
    assert.equal(fields.title, "event_teaser");
  });

  it("respects a caller-supplied thumbOffsetMs override", () => {
    const fields = buildVideoUploadFields("clip.mp4", 3500);
    assert.equal(fields.thumbOffsetMs, 3500);
  });

  it("omits thumbOffsetMs entirely when explicitly passed 0 (opt-out of thumb_offset)", () => {
    const fields = buildVideoUploadFields("clip.mp4", 0);
    assert.equal("thumbOffsetMs" in fields, false);
  });

  it("omits thumbOffsetMs when passed a negative value (defensive — never sends a negative offset)", () => {
    const fields = buildVideoUploadFields("clip.mp4", -500);
    assert.equal("thumbOffsetMs" in fields, false);
  });
});

describe("buildVideoThumbnailOverrideRequest", () => {
  it("builds the /{videoId}/thumbnails path with isPreferred always true", () => {
    const req = buildVideoThumbnailOverrideRequest("vid_abc123");
    assert.deepEqual(req, { path: "/vid_abc123/thumbnails", isPreferred: true });
  });
});
