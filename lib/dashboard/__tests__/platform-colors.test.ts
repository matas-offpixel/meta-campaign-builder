import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
  PLATFORM_ORDER,
  parsePlatformParam,
} from "../platform-colors.ts";

describe("platform-colors", () => {
  describe("PLATFORM_ORDER", () => {
    it("has all four platforms in canonical order", () => {
      assert.deepEqual(PLATFORM_ORDER, ["all", "meta", "tiktok", "google_ads"]);
    });

    it("every platform has a label and a color", () => {
      for (const p of PLATFORM_ORDER) {
        assert.ok(PLATFORM_LABELS[p], `missing label for ${p}`);
        assert.ok(PLATFORM_COLORS[p], `missing colour for ${p}`);
      }
    });
  });

  describe("PLATFORM_COLORS", () => {
    it("uses Meta blue", () => {
      assert.equal(PLATFORM_COLORS.meta.toLowerCase(), "#1877f2");
    });

    it("uses Google Ads red", () => {
      assert.equal(PLATFORM_COLORS.google_ads.toLowerCase(), "#ea4335");
    });

    it("uses TikTok black per the user choice", () => {
      // The other option was pink (#FE2C55). Black was chosen for
      // contrast and to avoid clashing with the destructive pink.
      assert.equal(PLATFORM_COLORS.tiktok.toLowerCase(), "#000000");
    });
  });

  describe("parsePlatformParam", () => {
    it("falls back to 'all' for missing / unknown", () => {
      assert.equal(parsePlatformParam(undefined), "all");
      assert.equal(parsePlatformParam(null), "all");
      assert.equal(parsePlatformParam(""), "all");
      assert.equal(parsePlatformParam("facebook"), "all");
      assert.equal(parsePlatformParam(42), "all");
    });

    it("accepts each canonical platform id", () => {
      assert.equal(parsePlatformParam("all"), "all");
      assert.equal(parsePlatformParam("meta"), "meta");
      assert.equal(parsePlatformParam("tiktok"), "tiktok");
      assert.equal(parsePlatformParam("google_ads"), "google_ads");
    });

    it("rejects case-mismatched ids", () => {
      // URL search params are case-sensitive in our routing layer;
      // the parser stays strict so a mistyped link isn't silently
      // promoted to "meta".
      assert.equal(parsePlatformParam("Meta"), "all");
      assert.equal(parsePlatformParam("TIKTOK"), "all");
    });
  });
});
