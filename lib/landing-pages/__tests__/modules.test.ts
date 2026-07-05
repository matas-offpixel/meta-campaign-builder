import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseModules,
  resolveCustomisation,
  resolveModuleSources,
  resolveVisibility,
} from "../modules.ts";

/**
 * Sprint 1 PR 2 — modules resolver. The critical guarantee is the
 * byte-identical fallback: with an empty `modules` column the resolver
 * hands back the legacy columns verbatim, so the /l renderer output is
 * unchanged for every pre-139 (and un-migrated) page.
 */

describe("parseModules", () => {
  it("empty / non-array → []", () => {
    assert.deepEqual(parseModules(undefined), []);
    assert.deepEqual(parseModules(null), []);
    assert.deepEqual(parseModules("[]"), []);
    assert.deepEqual(parseModules([]), []);
  });

  it("drops unknown types and non-objects, keeps valid", () => {
    const out = parseModules([
      { type: "hero_carousel", order: 0, config: { images: ["a"] } },
      { type: "not_a_real_type", order: 1 },
      "garbage",
      null,
      { order: 2 },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "hero_carousel");
  });

  it("sorts by order and defaults enabled=true, config={}", () => {
    const out = parseModules([
      { type: "image_grid", order: 2 },
      { type: "hero_carousel", order: 0 },
      { type: "youtube_embed", order: 1, enabled: false },
    ]);
    assert.deepEqual(
      out.map((m) => m.type),
      ["hero_carousel", "youtube_embed", "image_grid"],
    );
    assert.equal(out[0].enabled, true);
    assert.deepEqual(out[0].config, {});
    assert.equal(out[1].enabled, false);
  });
});

describe("resolveModuleSources — legacy fallback (byte-identical)", () => {
  it("empty modules → returns legacy columns verbatim", () => {
    const sources = resolveModuleSources({
      modules: [],
      hero_images: ["https://cdn/hero1.jpg"],
      youtube_url: "https://youtu.be/abc123",
      bottom_images: ["https://cdn/grid1.jpg"],
      content: {
        brand_instagram_url: "https://instagram.com/x",
        brand_tiktok_url: "https://tiktok.com/@x",
      },
    });
    assert.deepEqual(sources.heroImagesRaw, ["https://cdn/hero1.jpg"]);
    assert.equal(sources.youtubeUrlRaw, "https://youtu.be/abc123");
    assert.deepEqual(sources.gridImagesRaw, ["https://cdn/grid1.jpg"]);
    assert.equal(sources.brandInstagramRaw, "https://instagram.com/x");
    assert.equal(sources.brandTiktokRaw, "https://tiktok.com/@x");
  });

  it("undefined modules column also falls back to legacy", () => {
    const sources = resolveModuleSources({
      modules: undefined,
      hero_images: ["https://cdn/hero1.jpg"],
      youtube_url: null,
      bottom_images: [],
      content: {},
    });
    assert.deepEqual(sources.heroImagesRaw, ["https://cdn/hero1.jpg"]);
    assert.equal(sources.youtubeUrlRaw, null);
    assert.equal(sources.brandInstagramRaw, null);
  });
});

describe("resolveModuleSources — module-driven", () => {
  const base = {
    hero_images: ["https://legacy/hero.jpg"],
    youtube_url: "https://youtu.be/legacy",
    bottom_images: ["https://legacy/grid.jpg"],
    content: { brand_instagram_url: "https://legacy/ig" },
  };

  it("enabled modules supply content, ignoring legacy columns", () => {
    const sources = resolveModuleSources({
      ...base,
      modules: [
        {
          type: "hero_carousel",
          order: 0,
          enabled: true,
          config: { images: ["https://mod/hero.jpg"] },
        },
        {
          type: "youtube_embed",
          order: 1,
          enabled: true,
          config: { url: "https://youtu.be/mod" },
        },
      ],
    });
    assert.deepEqual(sources.heroImagesRaw, ["https://mod/hero.jpg"]);
    assert.equal(sources.youtubeUrlRaw, "https://youtu.be/mod");
    // No image_grid / brand_socials module present → nothing (NOT legacy).
    assert.deepEqual(sources.gridImagesRaw, []);
    assert.equal(sources.brandInstagramRaw, null);
  });

  it("disabled module contributes nothing", () => {
    const sources = resolveModuleSources({
      ...base,
      modules: [
        {
          type: "hero_carousel",
          order: 0,
          enabled: false,
          config: { images: ["https://mod/hero.jpg"] },
        },
      ],
    });
    assert.deepEqual(sources.heroImagesRaw, []);
  });

  it("first enabled module of a type wins", () => {
    const sources = resolveModuleSources({
      ...base,
      modules: [
        {
          type: "hero_carousel",
          order: 0,
          enabled: true,
          config: { images: ["https://first.jpg"] },
        },
        {
          type: "hero_carousel",
          order: 1,
          enabled: true,
          config: { images: ["https://second.jpg"] },
        },
      ],
    });
    assert.deepEqual(sources.heroImagesRaw, ["https://first.jpg"]);
  });
});

describe("resolveVisibility", () => {
  it("absent column → everything visible (byte-identical default)", () => {
    const v = resolveVisibility({ visibility: undefined });
    assert.deepEqual(v, {
      showEventDate: true,
      showVenue: true,
      showDescription: true,
      showPresale: true,
      showCountdown: true,
    });
  });

  it("explicit false hides only that section", () => {
    const v = resolveVisibility({
      visibility: { show_venue: false, show_countdown: false },
    });
    assert.equal(v.showVenue, false);
    assert.equal(v.showCountdown, false);
    assert.equal(v.showEventDate, true);
  });

  it("non-boolean values are treated as visible", () => {
    const v = resolveVisibility({ visibility: { show_venue: "nope" } });
    assert.equal(v.showVenue, true);
  });
});

describe("resolveCustomisation", () => {
  it("absent column → defaults reproduce pre-139 look", () => {
    const c = resolveCustomisation({ customisation: undefined });
    assert.deepEqual(c, {
      primaryButtonBg: null,
      primaryButtonText: null,
      descriptionAlign: "left",
    });
  });

  it("valid hex colours pass, junk is rejected", () => {
    assert.equal(
      resolveCustomisation({ customisation: { primary_button_bg: "#abc" } })
        .primaryButtonBg,
      "#abc",
    );
    assert.equal(
      resolveCustomisation({
        customisation: { primary_button_bg: "#A1B2C3" },
      }).primaryButtonBg,
      "#A1B2C3",
    );
    assert.equal(
      resolveCustomisation({
        customisation: { primary_button_bg: "red; content:url(x)" },
      }).primaryButtonBg,
      null,
    );
  });

  it("description_align only honours 'center'", () => {
    assert.equal(
      resolveCustomisation({ customisation: { description_align: "center" } })
        .descriptionAlign,
      "center",
    );
    assert.equal(
      resolveCustomisation({ customisation: { description_align: "right" } })
        .descriptionAlign,
      "left",
    );
  });
});
