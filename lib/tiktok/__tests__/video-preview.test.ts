import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isTikTokPreviewExpired,
  parseTikTokPreviewExpiry,
  pickTikTokCoverUrl,
  resolveTikTokPreviewExpiry,
  tiktokLibraryThumbUrl,
  tiktokSparkPosterUrl,
} from "../video-preview.ts";

describe("TikTok preview URL expiry", () => {
  it("parses unix seconds and ISO strings", () => {
    assert.equal(
      parseTikTokPreviewExpiry(1_700_000_000),
      "2023-11-14T22:13:20.000Z",
    );
    assert.equal(
      parseTikTokPreviewExpiry("2026-08-20T12:00:00.000Z"),
      "2026-08-20T12:00:00.000Z",
    );
  });

  it("treats a past expiry as expired so callers refetch instead of rendering a dead image", () => {
    const now = Date.parse("2026-08-20T18:00:00.000Z");
    assert.equal(
      isTikTokPreviewExpired("2026-08-20T12:00:00.000Z", now),
      true,
    );
    assert.equal(
      isTikTokPreviewExpired("2026-08-20T20:00:00.000Z", now),
      false,
    );
    assert.equal(isTikTokPreviewExpired(null, now), true);
    assert.equal(isTikTokPreviewExpired(undefined, now), true);
  });

  it("prefers the cover image over preview_url", () => {
    assert.equal(
      pickTikTokCoverUrl({
        coverUrl: "https://cdn.example/cover.jpg",
        previewUrl: "https://cdn.example/preview.mp4",
        thumbnailUrl: "https://cdn.example/thumb.jpg",
      }),
      "https://cdn.example/cover.jpg",
    );
  });

  it("defaults missing expiry to six hours from now", () => {
    const now = Date.parse("2026-08-20T12:00:00.000Z");
    assert.equal(
      resolveTikTokPreviewExpiry(null, now),
      "2026-08-20T18:00:00.000Z",
    );
  });

  it("does not render a library thumb past preview_url_expire_time", () => {
    const now = Date.parse("2026-08-20T18:00:00.000Z");
    assert.equal(
      tiktokLibraryThumbUrl(
        {
          thumbnail_url: "https://cdn.example/dead.jpg",
          preview_url_expire_time: "2026-08-20T12:00:00.000Z",
        },
        now,
      ),
      null,
    );
    assert.equal(
      tiktokLibraryThumbUrl(
        {
          thumbnail_url: "https://cdn.example/live.jpg",
          preview_url_expire_time: "2026-08-20T20:00:00.000Z",
        },
        now,
      ),
      "https://cdn.example/live.jpg",
    );
  });

  it("hides a spark poster after one hour, not six", () => {
    const fetched = "2026-09-07T12:00:00.000Z";
    assert.equal(
      tiktokSparkPosterUrl(
        { poster_url: "https://cdn.example/poster.jpg", fetched_at: fetched },
        Date.parse("2026-09-07T12:30:00.000Z"),
      ),
      "https://cdn.example/poster.jpg",
    );
    assert.equal(
      tiktokSparkPosterUrl(
        { poster_url: "https://cdn.example/poster.jpg", fetched_at: fetched },
        Date.parse("2026-09-07T13:00:00.000Z"),
      ),
      null,
    );
  });
});
