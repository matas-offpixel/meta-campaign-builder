/**
 * Tests for the post-upload thumbnail polling added to uploadVideoAsset.
 *
 * Root cause: Meta's POST /advideos response never contains `picture` or
 * `preview_image_url` — the video is still ENCODING at that point.
 * uploadVideoAsset had been silently returning previewUrl="" for every
 * video since it was first written. This was only surfaced when PR #551
 * started requiring image_url on video_data; Meta then returned
 * code=100 subcode=1443226 on every video ad.
 *
 * Fix: after the POST (videoId captured), poll GET /{videoId}?fields=picture
 * twice at 3 s intervals. Use picture when available; fall through to "" +
 * WARNING log after 6 s total.
 *
 * These tests use fetchVideoThumbnailWithRetry directly (exported for testing)
 * with _pollDelayMs=0 so they run instantly without real clock sleeps.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { fetchVideoThumbnailWithRetry } from "../video-thumbnail-poll.ts";

// ─── fetch mock helpers ───────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("fetchVideoThumbnailWithRetry", () => {
  it("returns picture URL when first GET contains it", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ id: "vid_abc", picture: "https://cdn.example.com/thumb.jpg" });

    const result = await fetchVideoThumbnailWithRetry("vid_abc", "tok_123", 0);
    assert.equal(result, "https://cdn.example.com/thumb.jpg");
  });

  it("returns picture URL on second attempt when first has no picture", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return jsonResponse({ id: "vid_abc" }); // no picture yet
      return jsonResponse({ id: "vid_abc", picture: "https://cdn.example.com/thumb-2.jpg" });
    };

    const result = await fetchVideoThumbnailWithRetry("vid_abc", "tok_123", 0);
    assert.equal(result, "https://cdn.example.com/thumb-2.jpg");
    assert.equal(callCount, 2, "should have polled twice");
  });

  it("returns empty string when neither attempt returns a picture", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_abc" }); // picture always absent

    const result = await fetchVideoThumbnailWithRetry("vid_abc", "tok_123", 0);
    assert.equal(result, "");
  });

  it("logs WARNING to console.error when thumbnail unavailable after both attempts", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_warn" });

    const warnings: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      await fetchVideoThumbnailWithRetry("vid_warn", "tok_123", 0);
    } finally {
      console.error = orig;
    }

    assert.ok(
      warnings.some((w) => w.includes("WARNING") && w.includes("vid_warn")),
      `expected WARNING log for vid_warn — got: ${JSON.stringify(warnings)}`,
    );
  });

  it("does NOT log WARNING when picture is found on first attempt", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ id: "vid_ok", picture: "https://cdn.example.com/ok.jpg" });

    const warnings: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      await fetchVideoThumbnailWithRetry("vid_ok", "tok_123", 0);
    } finally {
      console.error = orig;
    }

    assert.ok(
      !warnings.some((w) => w.includes("WARNING")),
      "should not log WARNING when thumbnail is found",
    );
  });

  it("returns empty string (no throw) when fetch throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("Network failure");
    };

    const result = await fetchVideoThumbnailWithRetry("vid_err", "tok_123", 0);
    assert.equal(result, "");
  });

  it("ignores empty-string picture values (treats as absent)", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_empty", picture: "" });

    const result = await fetchVideoThumbnailWithRetry("vid_empty", "tok_123", 0);
    assert.equal(result, "");
  });

  it("includes token in the fetch URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = input instanceof Request ? input.url : String(input);
      return jsonResponse({ id: "vid_url", picture: "https://cdn.example.com/x.jpg" });
    };

    await fetchVideoThumbnailWithRetry("vid_url", "my_secret_token", 0);
    assert.ok(capturedUrl.includes("vid_url"), "URL should contain videoId");
    assert.ok(capturedUrl.includes("fields=picture"), "URL should request picture field");
    assert.ok(capturedUrl.includes("my_secret_token"), "URL should contain token");
  });

  it("makes exactly 2 GET calls when first attempt has no picture", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse({ id: "vid_2calls" }); // never returns picture
    };

    await fetchVideoThumbnailWithRetry("vid_2calls", "tok_123", 0);
    assert.equal(calls, 2, "should poll exactly twice before giving up");
  });

  it("makes exactly 1 GET call when first attempt returns a picture", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse({ id: "vid_1call", picture: "https://cdn.example.com/y.jpg" });
    };

    await fetchVideoThumbnailWithRetry("vid_1call", "tok_123", 0);
    assert.equal(calls, 1, "should stop after first successful fetch");
  });
});
