/**
 * Tests for the upload validation helpers and size-limit constants exported
 * from lib/meta/upload.ts, covering the direct-upload code path requirements:
 *
 *  - Static image upload up to 30 MB is accepted.
 *  - Images larger than 30 MB are rejected with a clear error.
 *  - Videos up to 200 MB are accepted.
 *  - Videos larger than 200 MB are rejected with a clear error.
 *  - Wrong mime types are rejected.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateAssetFile,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
} from "../upload.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBlob(sizeBytes: number, mimeType: string): File {
  // Use a Uint8Array so the size is exact — no network or filesystem needed.
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], "test-asset", { type: mimeType });
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe("MAX limits (Meta documented values)", () => {
  it("MAX_IMAGE_BYTES is 30 MB", () => {
    assert.equal(MAX_IMAGE_BYTES, 30 * 1024 * 1024);
  });

  it("MAX_VIDEO_BYTES is 200 MB", () => {
    assert.equal(MAX_VIDEO_BYTES, 200 * 1024 * 1024);
  });
});

// ─── Image validation ─────────────────────────────────────────────────────────

describe("validateAssetFile — images", () => {
  it("accepts a 1 MB JPEG", () => {
    const file = makeBlob(1 * 1024 * 1024, "image/jpeg");
    const { isValid, error } = validateAssetFile(file, "image");
    assert.ok(isValid, `Expected valid, got error: ${error}`);
    assert.equal(error, null);
  });

  it("accepts a 30 MB JPEG (exactly at the limit)", () => {
    const file = makeBlob(MAX_IMAGE_BYTES, "image/jpeg");
    const { isValid, error } = validateAssetFile(file, "image");
    assert.ok(isValid, `Expected valid, got error: ${error}`);
    assert.equal(error, null);
  });

  it("accepts a PNG", () => {
    const file = makeBlob(512 * 1024, "image/png");
    const { isValid } = validateAssetFile(file, "image");
    assert.ok(isValid);
  });

  it("rejects an image larger than 30 MB with a readable error", () => {
    const file = makeBlob(MAX_IMAGE_BYTES + 1, "image/jpeg");
    const { isValid, error } = validateAssetFile(file, "image");
    assert.ok(!isValid);
    assert.ok(error !== null);
    assert.match(error, /30 MB/i, "Error should mention the 30 MB limit");
    assert.match(error, /too large/i, "Error should say 'too large'");
  });

  it("rejects an unsupported mime type (WebP)", () => {
    const file = makeBlob(100 * 1024, "image/webp");
    const { isValid, error } = validateAssetFile(file, "image");
    assert.ok(!isValid);
    assert.ok(error !== null);
    assert.match(error, /JPEG or PNG/i, "Error should mention accepted types");
  });

  it("rejects a video file submitted as an image type", () => {
    const file = makeBlob(2 * 1024 * 1024, "video/mp4");
    const { isValid, error } = validateAssetFile(file, "image");
    assert.ok(!isValid);
    assert.ok(error !== null);
  });
});

// ─── Video validation ─────────────────────────────────────────────────────────

describe("validateAssetFile — videos", () => {
  it("accepts a 10 MB MP4", () => {
    const file = makeBlob(10 * 1024 * 1024, "video/mp4");
    const { isValid, error } = validateAssetFile(file, "video");
    assert.ok(isValid, `Expected valid, got error: ${error}`);
    assert.equal(error, null);
  });

  it("accepts a 200 MB MP4 (exactly at the limit)", () => {
    const file = makeBlob(MAX_VIDEO_BYTES, "video/mp4");
    const { isValid, error } = validateAssetFile(file, "video");
    assert.ok(isValid, `Expected valid, got error: ${error}`);
    assert.equal(error, null);
  });

  it("accepts a MOV file", () => {
    const file = makeBlob(50 * 1024 * 1024, "video/quicktime");
    const { isValid } = validateAssetFile(file, "video");
    assert.ok(isValid);
  });

  it("rejects a video larger than 200 MB with a readable error", () => {
    const file = makeBlob(MAX_VIDEO_BYTES + 1, "video/mp4");
    const { isValid, error } = validateAssetFile(file, "video");
    assert.ok(!isValid);
    assert.ok(error !== null);
    assert.match(error, /200 MB/i, "Error should mention the 200 MB limit");
    assert.match(error, /too large/i, "Error should say 'too large'");
  });

  it("rejects an unsupported mime type (AVI)", () => {
    const file = makeBlob(5 * 1024 * 1024, "video/avi");
    const { isValid, error } = validateAssetFile(file, "video");
    assert.ok(!isValid);
    assert.ok(error !== null);
    assert.match(error, /MP4 or MOV/i, "Error should mention accepted types");
  });
});
