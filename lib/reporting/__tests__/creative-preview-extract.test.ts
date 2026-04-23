import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractPreview,
  type RawCreative,
} from "../creative-preview-extract.ts";

describe("extractPreview waterfall", () => {
  it("prefers asset_feed_spec.images[0].url over top-level thumbnail_url", () => {
    const c: RawCreative = {
      thumbnail_url: "https://cdn.test/thumb-64x64",
      asset_feed_spec: {
        images: [{ url: "https://cdn.test/full-1080.jpg" }],
      },
    };
    const p = extractPreview(c);
    assert.equal(p.tier, "afs_image_url");
    assert.equal(p.image_url, "https://cdn.test/full-1080.jpg");
  });

  it("keeps top-level image_url before carousel / AFS / thumbnail", () => {
    const c: RawCreative = {
      image_url: "https://top.jpg",
      thumbnail_url: "https://64.jpg",
      asset_feed_spec: { images: [{ url: "https://afs.jpg" }] },
    };
    const p = extractPreview(c);
    assert.equal(p.tier, "top_image_url");
    assert.equal(p.image_url, "https://top.jpg");
  });

  it("falls back to top_thumbnail_url when AFS and higher tiers are empty", () => {
    const c: RawCreative = { thumbnail_url: "https://64.jpg" };
    const p = extractPreview(c);
    assert.equal(p.tier, "top_thumbnail_url");
    assert.equal(p.is_low_res_fallback, true);
  });
});
