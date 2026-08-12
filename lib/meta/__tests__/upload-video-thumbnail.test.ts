/**
 * Tests for the post-upload thumbnail polling added to uploadVideoAsset.
 *
 * Root cause (original, PR #554): Meta's POST /advideos response never
 * contains `picture` or `preview_image_url` — the video is still ENCODING
 * at that point. uploadVideoAsset had been silently returning previewUrl=""
 * for every video since it was first written. This was only surfaced when
 * PR #551 started requiring image_url on video_data; Meta then returned
 * code=100 subcode=1443226 on every video ad.
 *
 * Fix (original): after the POST (videoId captured), poll GET
 * /{videoId}?fields=picture twice at 3 s intervals. Use picture when
 * available; fall through to "" + WARNING log after 6 s total.
 *
 * Root cause (task #128, this file's second root cause): while a video is
 * still encoding, Meta doesn't omit `picture` or return null — it returns a
 * URL to its OWN internal "still processing" spinner GIF, served from
 * `static.xx.fbcdn.net/rsrc.php/` (the UI-resource CDN, never user content).
 * The original `if (typeof data.picture === "string" && data.picture)`
 * check happily accepted that as a real thumbnail because it's a non-empty
 * string. Every motion ad since PR #748 started uploading `picture` as
 * `image_hash` shipped with Meta's spinner as its still frame whenever
 * encoding took longer than the original 6s budget — which, per Meta's
 * docs, is the vast majority of uploads (p95 ≈ 45s for HD).
 *
 * Fix (task #128): `isMetaPlaceholderThumbnailUrl` rejects the spinner (and
 * any other `rsrc.php` UI-CDN URL) so it's treated exactly like "picture not
 * ready yet" — keep polling. The polling budget also grew from 2 attempts /
 * 6s to 5 attempts / 48s (`DEFAULT_POLL_DELAYS_MS` = [3s, 5s, 8s, 12s, 20s])
 * to actually catch the encode finishing within Meta's documented p95.
 *
 * These tests use fetchVideoThumbnailWithRetry directly (exported for testing)
 * with an all-zero delay schedule so they run instantly without real clock
 * sleeps.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  fetchVideoThumbnailWithRetry,
  isMetaPlaceholderThumbnailUrl,
  isMetaPlaceholderThumbnailImage,
  DEFAULT_POLL_DELAYS_MS,
  SPINNER_MAX_DIMENSION_PX,
  SPINNER_MAX_CONTENT_LENGTH_BYTES,
  type MetaAdImageFingerprint,
} from "../video-thumbnail-poll.ts";

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

// Zero-delay schedule matching the production attempt count, so tests run
// instantly but still exercise the full 5-attempt budget.
const ZERO_DELAYS = DEFAULT_POLL_DELAYS_MS.map(() => 0);

const SPINNER_URL = "https://static.xx.fbcdn.net/rsrc.php/v4/yN/r/AAqMW82PqGg.gif";
const REAL_THUMB_URL = "https://scontent.xx.fbcdn.net/v/t15.5256-10/thumb_real_frame.jpg";

// ─── isMetaPlaceholderThumbnailUrl ────────────────────────────────────────────

describe("isMetaPlaceholderThumbnailUrl", () => {
  it("flags the exact reproducer spinner URL (static CDN, rsrc.php)", () => {
    assert.equal(isMetaPlaceholderThumbnailUrl(SPINNER_URL), true);
  });

  it("flags any rsrc.php URL on a static.*.fbcdn.net host, regardless of filename", () => {
    assert.equal(
      isMetaPlaceholderThumbnailUrl("https://static.xx.fbcdn.net/rsrc.php/v4/yz/r/SomeOtherIcon.png"),
      true,
    );
  });

  it("flags rsrc.php URLs on a www.*.fbcdn.net host too", () => {
    assert.equal(
      isMetaPlaceholderThumbnailUrl("https://www.static.fbcdn.net/rsrc.php/v4/yz/r/Other.png"),
      true,
    );
  });

  it("flags the known spinner filename fragment even under a different CDN path", () => {
    assert.equal(
      isMetaPlaceholderThumbnailUrl("https://static.xx.fbcdn.net/some/other/path/AAqMW82PqGg.gif"),
      true,
    );
  });

  it("does NOT flag a real user-content thumbnail on scontent*.fbcdn.net", () => {
    assert.equal(isMetaPlaceholderThumbnailUrl(REAL_THUMB_URL), false);
  });

  it("does NOT flag an arbitrary non-fbcdn URL", () => {
    assert.equal(isMetaPlaceholderThumbnailUrl("https://cdn.example.com/thumb.jpg"), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(isMetaPlaceholderThumbnailUrl(""), false);
  });
});

// ─── isMetaPlaceholderThumbnailImage (task #128 continued — detection gap) ───
//
// isMetaPlaceholderThumbnailUrl above only catches the placeholder while it's
// still served from Meta's static UI CDN — the LIVE pre-upload
// /{videoId}?fields=picture response. Once scripts/repair-video-thumbnails.mjs
// uploads that URL via /adimages to resolve a creative's CURRENT image_hash,
// Meta returns an ad-account-scoped scontent*.fbcdn.net URL that no longer
// carries any placeholder signal in its host/path. This classifier instead
// fingerprints the image itself (dimensions/format/size), which survives
// that upload → hash → resolve roundtrip.

describe("isMetaPlaceholderThumbnailImage", () => {
  const BROKEN_IMAGE: MetaAdImageFingerprint = {
    url: "https://scontent.xx.fbcdn.net/v/t45.1600-4/ADXYZ_spinner.gif",
    width: 16,
    height: 16,
    name: "AAqMW82PqGg.gif",
  };
  const REAL_IMAGE: MetaAdImageFingerprint = {
    url: "https://scontent.xx.fbcdn.net/v/t45.1600-4/real-thumbnail.jpg",
    width: 1080,
    height: 1080,
    name: "real-thumbnail.jpg",
  };

  it("flags the exact task-#128-continued reproducer (tiny GIF, spinner filename fragment)", () => {
    assert.equal(isMetaPlaceholderThumbnailImage(BROKEN_IMAGE), true);
  });

  it("does NOT flag a real, full-size JPG video thumbnail", () => {
    assert.equal(isMetaPlaceholderThumbnailImage(REAL_IMAGE), false);
  });

  it(`flags any image with both dimensions <= ${SPINNER_MAX_DIMENSION_PX}px, regardless of name/url`, () => {
    assert.equal(
      isMetaPlaceholderThumbnailImage({ url: "https://scontent.xx.fbcdn.net/x.jpg", width: 32, height: 20, name: "anything.jpg" }),
      true,
    );
  });

  it("does NOT flag an image with only one dimension small (must be both)", () => {
    assert.equal(
      isMetaPlaceholderThumbnailImage({ url: "https://scontent.xx.fbcdn.net/x.jpg", width: 16, height: 1280, name: "tall.jpg" }),
      false,
    );
  });

  it("flags a .gif url even with real-looking dimensions (real video thumbnails are always JPG)", () => {
    assert.equal(
      isMetaPlaceholderThumbnailImage({ url: "https://scontent.xx.fbcdn.net/x.gif", width: 1080, height: 1080 }),
      true,
    );
  });

  it("flags a .gif name even without a matching url extension", () => {
    assert.equal(isMetaPlaceholderThumbnailImage({ name: "weird.gif", url: "https://scontent.xx.fbcdn.net/x" }), true);
  });

  it("flags the known spinner filename fragment in `name` even with real dimensions", () => {
    assert.equal(
      isMetaPlaceholderThumbnailImage({ name: "AAqMW82PqGg.png", url: "https://scontent.xx.fbcdn.net/x.jpg", width: 1080, height: 1080 }),
      true,
    );
  });

  it(`flags contentLengthBytes below ${SPINNER_MAX_CONTENT_LENGTH_BYTES} even when other fields look fine`, () => {
    assert.equal(
      isMetaPlaceholderThumbnailImage({ url: "https://scontent.xx.fbcdn.net/x.jpg", width: 1080, height: 1080, contentLengthBytes: 900 }),
      true,
    );
  });

  it("does NOT flag a real image with a comfortably large contentLengthBytes", () => {
    assert.equal(
      isMetaPlaceholderThumbnailImage({ url: "https://scontent.xx.fbcdn.net/x.jpg", width: 1080, height: 1080, contentLengthBytes: 32000 }),
      false,
    );
  });

  it("returns false for a bare empty object (no signal at all)", () => {
    assert.equal(isMetaPlaceholderThumbnailImage({}), false);
  });
});

// ─── fetchVideoThumbnailWithRetry ─────────────────────────────────────────────

describe("fetchVideoThumbnailWithRetry", () => {
  it("returns picture URL when first GET contains it", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_abc", picture: REAL_THUMB_URL });

    const result = await fetchVideoThumbnailWithRetry("vid_abc", "tok_123", ZERO_DELAYS);
    assert.equal(result, REAL_THUMB_URL);
  });

  it("returns picture URL on second attempt when first has no picture", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      if (callCount === 1) return jsonResponse({ id: "vid_abc" }); // no picture yet
      return jsonResponse({ id: "vid_abc", picture: "https://scontent.xx.fbcdn.net/thumb-2.jpg" });
    };

    const result = await fetchVideoThumbnailWithRetry("vid_abc", "tok_123", ZERO_DELAYS);
    assert.equal(result, "https://scontent.xx.fbcdn.net/thumb-2.jpg");
    assert.equal(callCount, 2, "should have polled twice");
  });

  it("returns empty string when no attempt returns a picture", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_abc" }); // picture always absent

    const result = await fetchVideoThumbnailWithRetry("vid_abc", "tok_123", ZERO_DELAYS);
    assert.equal(result, "");
  });

  it("logs WARNING to console.error when thumbnail unavailable after every attempt", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_warn" });

    const warnings: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      await fetchVideoThumbnailWithRetry("vid_warn", "tok_123", ZERO_DELAYS);
    } finally {
      console.error = orig;
    }

    assert.ok(
      warnings.some((w) => w.includes("WARNING") && w.includes("vid_warn")),
      `expected WARNING log for vid_warn — got: ${JSON.stringify(warnings)}`,
    );
  });

  it("does NOT log WARNING when picture is found on first attempt", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_ok", picture: REAL_THUMB_URL });

    const warnings: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => warnings.push(String(args[0]));
    try {
      await fetchVideoThumbnailWithRetry("vid_ok", "tok_123", ZERO_DELAYS);
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

    const result = await fetchVideoThumbnailWithRetry("vid_err", "tok_123", ZERO_DELAYS);
    assert.equal(result, "");
  });

  it("ignores empty-string picture values (treats as absent)", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_empty", picture: "" });

    const result = await fetchVideoThumbnailWithRetry("vid_empty", "tok_123", ZERO_DELAYS);
    assert.equal(result, "");
  });

  it("includes token in the fetch URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = input instanceof Request ? input.url : String(input);
      return jsonResponse({ id: "vid_url", picture: REAL_THUMB_URL });
    };

    await fetchVideoThumbnailWithRetry("vid_url", "my_secret_token", ZERO_DELAYS);
    assert.ok(capturedUrl.includes("vid_url"), "URL should contain videoId");
    assert.ok(capturedUrl.includes("fields=picture"), "URL should request picture field");
    assert.ok(capturedUrl.includes("my_secret_token"), "URL should contain token");
  });

  it("makes exactly 5 GET calls when every attempt has no picture", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse({ id: "vid_5calls" }); // never returns picture
    };

    await fetchVideoThumbnailWithRetry("vid_5calls", "tok_123", ZERO_DELAYS);
    assert.equal(calls, 5, "should poll exactly 5 times before giving up");
  });

  it("makes exactly 1 GET call when first attempt returns a picture", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse({ id: "vid_1call", picture: REAL_THUMB_URL });
    };

    await fetchVideoThumbnailWithRetry("vid_1call", "tok_123", ZERO_DELAYS);
    assert.equal(calls, 1, "should stop after first successful fetch");
  });

  // ── task #128 — placeholder/spinner rejection ────────────────────────────

  it("treats a placeholder spinner URL as 'not ready' and keeps polling", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse({ id: "vid_spinner", picture: SPINNER_URL });
    };

    const result = await fetchVideoThumbnailWithRetry("vid_spinner", "tok_123", ZERO_DELAYS);
    assert.equal(result, "", "should never return the spinner URL");
    assert.equal(calls, 5, "should exhaust the full retry budget rather than accept the spinner");
  });

  it("polls through repeated placeholders and returns the real thumbnail once encoding finishes", async () => {
    const sequence = [SPINNER_URL, SPINNER_URL, REAL_THUMB_URL];
    let callCount = 0;
    globalThis.fetch = async () => {
      const picture = sequence[Math.min(callCount, sequence.length - 1)];
      callCount++;
      return jsonResponse({ id: "vid_mixed", picture });
    };

    const result = await fetchVideoThumbnailWithRetry("vid_mixed", "tok_123", ZERO_DELAYS);
    assert.equal(result, REAL_THUMB_URL);
    assert.equal(callCount, 3, "should stop polling as soon as a real thumbnail appears");
  });

  it("regression: returns '' after exhausting all 5 attempts when every response is a placeholder", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return jsonResponse({ id: "vid_all_placeholder", picture: SPINNER_URL });
    };

    const result = await fetchVideoThumbnailWithRetry("vid_all_placeholder", "tok_123", ZERO_DELAYS);
    assert.equal(result, "");
    assert.equal(calls, 5);
  });

  it("logs the placeholder detection distinctly from a plain 'not yet available' miss", async () => {
    globalThis.fetch = async () => jsonResponse({ id: "vid_spinner_log", picture: SPINNER_URL });

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => logs.push(String(args[0]));
    try {
      await fetchVideoThumbnailWithRetry("vid_spinner_log", "tok_123", ZERO_DELAYS);
    } finally {
      console.log = orig;
    }

    assert.ok(
      logs.some((l) => l.includes("placeholder") || l.includes("spinner")),
      `expected a placeholder/spinner log line — got: ${JSON.stringify(logs)}`,
    );
  });

  it("uses DEFAULT_POLL_DELAYS_MS (5 entries, 48s total) as the production schedule", () => {
    assert.equal(DEFAULT_POLL_DELAYS_MS.length, 5);
    assert.equal(
      DEFAULT_POLL_DELAYS_MS.reduce((sum, ms) => sum + ms, 0),
      48000,
    );
    assert.deepEqual([...DEFAULT_POLL_DELAYS_MS], [3000, 5000, 8000, 12000, 20000]);
  });
});
