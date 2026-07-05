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
});
