import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveModuleSources } from "../../landing-pages/modules.ts";
import { rebuildModulesFromLegacy } from "../page-modules-sync.ts";

/**
 * Sprint 1 PR 3 — the editor keeps writing the legacy columns; this helper
 * regenerates `modules` so the renderer (which reads modules post-139)
 * reflects the edit. Deterministic ids via an injected factory.
 */

let counter = 0;
const ids = () => `id-${counter++}`;

describe("rebuildModulesFromLegacy", () => {
  it("builds hero → youtube → grid → socials in order, skipping empties", () => {
    counter = 0;
    const mods = rebuildModulesFromLegacy(
      {
        heroImages: ["https://h1", "https://h2"],
        artworkUrl: null,
        youtubeUrl: "https://youtu.be/abc",
        bottomImages: ["https://g1"],
        brandInstagramUrl: "https://ig",
        brandTiktokUrl: null,
      },
      ids,
    );
    assert.deepEqual(
      mods.map((m) => [m.type, m.order, m.enabled]),
      [
        ["hero_carousel", 0, true],
        ["youtube_embed", 1, true],
        ["image_grid", 2, true],
        ["brand_socials", 3, true],
      ],
    );
    assert.deepEqual(mods[0].config, { images: ["https://h1", "https://h2"] });
    assert.deepEqual(mods[1].config, { url: "https://youtu.be/abc" });
    assert.deepEqual(mods[3].config, {
      instagram_url: "https://ig",
      tiktok_url: null,
    });
  });

  it("empty inputs → empty array (renderer falls back to legacy, byte-identical)", () => {
    const mods = rebuildModulesFromLegacy(
      {
        heroImages: [],
        artworkUrl: null,
        youtubeUrl: null,
        bottomImages: [],
        brandInstagramUrl: null,
        brandTiktokUrl: null,
      },
      ids,
    );
    assert.deepEqual(mods, []);
  });

  it("round-trips: rebuilt modules resolve to the same sources as legacy", () => {
    counter = 0;
    const legacy = {
      heroImages: ["https://h1"],
      artworkUrl: null,
      youtubeUrl: "https://youtu.be/x",
      bottomImages: ["https://g1", "https://g2"],
      brandInstagramUrl: "https://ig",
      brandTiktokUrl: "https://tt",
    };
    const modules = rebuildModulesFromLegacy(legacy, ids);

    const viaModules = resolveModuleSources({
      modules,
      hero_images: [],
      youtube_url: null,
      bottom_images: [],
      content: {},
    });
    assert.deepEqual(viaModules.heroImagesRaw, legacy.heroImages);
    assert.equal(viaModules.youtubeUrlRaw, legacy.youtubeUrl);
    assert.deepEqual(viaModules.gridImagesRaw, legacy.bottomImages);
    assert.equal(viaModules.brandInstagramRaw, legacy.brandInstagramUrl);
    assert.equal(viaModules.brandTiktokRaw, legacy.brandTiktokUrl);
  });

  // ── P0 fix, 2026-07-17: content.artwork_url must always survive rebuild ──
  // as hero-carousel slide 1 (Jackies Mallorca LP artwork-wipe incident,
  // page_event_id 40873449-8464-4f87-a035-40cef5a7b79d).
  describe("artworkUrl → hero-carousel slide 1", () => {
    it("artworkUrl present, heroImages empty → 1-image carousel (artwork)", () => {
      counter = 0;
      const mods = rebuildModulesFromLegacy(
        {
          heroImages: [],
          artworkUrl: "https://cdn/artwork.jpg",
          youtubeUrl: null,
          bottomImages: [],
          brandInstagramUrl: null,
          brandTiktokUrl: null,
        },
        ids,
      );
      assert.equal(mods.length, 1);
      assert.equal(mods[0].type, "hero_carousel");
      assert.deepEqual(mods[0].config, { images: ["https://cdn/artwork.jpg"] });
    });

    it("artworkUrl present, heroImages [A,B,C] → 4-image carousel (artwork, A, B, C)", () => {
      counter = 0;
      const mods = rebuildModulesFromLegacy(
        {
          heroImages: ["https://A", "https://B", "https://C"],
          artworkUrl: "https://cdn/artwork.jpg",
          youtubeUrl: null,
          bottomImages: [],
          brandInstagramUrl: null,
          brandTiktokUrl: null,
        },
        ids,
      );
      assert.deepEqual(mods[0].config, {
        images: ["https://cdn/artwork.jpg", "https://A", "https://B", "https://C"],
      });
    });

    it("artworkUrl present, heroImages [artwork, A, B] → 3-image (deduped)", () => {
      counter = 0;
      const mods = rebuildModulesFromLegacy(
        {
          heroImages: ["https://cdn/artwork.jpg", "https://A", "https://B"],
          artworkUrl: "https://cdn/artwork.jpg",
          youtubeUrl: null,
          bottomImages: [],
          brandInstagramUrl: null,
          brandTiktokUrl: null,
        },
        ids,
      );
      assert.deepEqual(mods[0].config, {
        images: ["https://cdn/artwork.jpg", "https://A", "https://B"],
      });
    });

    it("artworkUrl null → byte-identical to current (pre-fix) behaviour", () => {
      counter = 0;
      const mods = rebuildModulesFromLegacy(
        {
          heroImages: ["https://A", "https://B"],
          artworkUrl: null,
          youtubeUrl: null,
          bottomImages: [],
          brandInstagramUrl: null,
          brandTiktokUrl: null,
        },
        ids,
      );
      assert.deepEqual(mods[0].config, { images: ["https://A", "https://B"] });
    });
  });
});
