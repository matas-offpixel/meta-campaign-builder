import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  expandTikTokPresetKeywords,
  formatTikTokUnresolvedPresetPaths,
  mergeTikTokPresetTaxonomy,
  resolveTikTokPresetTaxonomy,
  tikTokHashtagPresetQuery,
  tikTokPresetById,
  tikTokPresetTaxonomyPendingReason,
  tikTokPresetsForCluster,
  TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS,
  TIKTOK_ELECTRONIC_INTEREST_PATHS,
  TIKTOK_GENRE_PRESETS,
  TIKTOK_PRESET_CLUSTERS,
} from "../genre-presets.ts";
import {
  APPS_MUSIC_PLAYER_ID,
  LIVE_BEHAVIOUR_CATALOG,
  LIVE_INTEREST_CATALOG,
} from "./live-catalog-fixture.ts";

const LIVE_CATALOG = {
  interests: LIVE_INTEREST_CATALOG,
  behaviours: LIVE_BEHAVIOUR_CATALOG,
};

describe("expandTikTokPresetKeywords", () => {
  it("fires one keyword call per seed in parallel and unions by id", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const started: string[] = [];
    const rows = await expandTikTokPresetKeywords(
      ["house music", "techno music", "disco music"],
      async (seed) => {
        started.push(seed);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return [
          { id: "shared", name: "House" },
          { id: `only-${seed}`, name: seed },
        ];
      },
    );
    assert.equal(started.length, 3);
    assert.equal(maxInFlight, 3);
    assert.equal(rows.requested, 3);
    assert.deepEqual(rows.failedSeeds, []);
    assert.equal(rows.rows.length, 4);
    const shared = rows.rows.find((row) => row.id === "shared");
    assert.deepEqual(shared?.seeds, [
      "house music",
      "techno music",
      "disco music",
    ]);
  });

  it("keeps other seeds when one recommend rejects", async () => {
    const rows = await expandTikTokPresetKeywords(
      ["ok", "bad", "also-ok"],
      async (seed) => {
        if (seed === "bad") throw new Error("seed failed");
        return [{ id: seed, name: seed }];
      },
    );
    assert.deepEqual(
      rows.rows.map((row) => row.id).sort(),
      ["also-ok", "ok"],
    );
    assert.deepEqual(rows.failedSeeds, ["bad"]);
  });
});

describe("tikTokHashtagPresetQuery", () => {
  it("sends operator OR and caps at 10 keywords", () => {
    const seeds = Array.from({ length: 12 }, (_, index) => `kw${index + 1}`);
    const query = tikTokHashtagPresetQuery(seeds);
    assert.equal(query.operator, "OR");
    assert.equal(query.keywords.length, 10);
    assert.deepEqual(query.keywords, seeds.slice(0, 10));
  });

  it("ships the Electronic music preset as single-word seeds plus full taxonomy paths", () => {
    const preset = tikTokPresetById("electronic-music");
    assert.ok(preset);
    assert.equal(preset.cluster, "Music & Nightlife");
    assert.ok(preset.seeds.every((seed) => !/\s/.test(seed)));
    assert.deepEqual(preset.seeds, [
      "techno",
      "house",
      "disco",
      "electronic",
      "dance",
    ]);
    assert.deepEqual(preset.interestPaths, TIKTOK_ELECTRONIC_INTEREST_PATHS);
    assert.deepEqual(preset.behaviourPaths, TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS);
  });
});

describe("resolveTikTokPresetTaxonomy", () => {
  it("picks Culture & Art Music, not the Apps music-player node", () => {
    const preset = tikTokPresetById("electronic-music");
    assert.ok(preset);
    const taxonomy = resolveTikTokPresetTaxonomy(LIVE_CATALOG, preset);
    assert.deepEqual(
      taxonomy.interestItems.map((item) => item.id),
      ["23116107", "10106102"],
    );
    assert.ok(!taxonomy.interestItems.some((item) => item.id === APPS_MUSIC_PLAYER_ID));
    assert.ok(!taxonomy.interestItems.some((item) => item.id === "20107103"));
    assert.deepEqual(
      taxonomy.behaviourItems.map((item) => item.id),
      ["1810101", "1101", "1101100"],
    );
    assert.ok(!taxonomy.behaviourItems.some((item) => item.id === "3002"));
    assert.ok(!taxonomy.behaviourItems.some((item) => item.id === "10"));
    assert.deepEqual(taxonomy.unresolvedPaths, []);
    const merged = mergeTikTokPresetTaxonomy(
      {
        interestIds: [
          {
            id: "23116107",
            name: "News & Entertainment > Culture & Art > Music",
            kind: "category",
          },
        ],
        behaviourIds: [],
      },
      taxonomy,
    );
    assert.deepEqual(
      merged.interestIds.map((item) => item.id),
      ["23116107", "10106102"],
    );
    assert.deepEqual(
      merged.behaviourIds.map((item) => item.id),
      ["1810101", "1101", "1101100"],
    );
  });

  it("names an unresolvable path instead of skipping it or falling back to a leaf label", () => {
    const taxonomy = resolveTikTokPresetTaxonomy(LIVE_CATALOG, {
      interestPaths: [["News & Entertainment", "Culture & Art", "Techno"]],
      behaviourPaths: [["Talents", "Singing & Dancing"]],
    });
    assert.deepEqual(taxonomy.interestItems, []);
    assert.deepEqual(
      taxonomy.behaviourItems.map((item) => item.id),
      ["1101"],
    );
    assert.deepEqual(taxonomy.unresolvedPaths, [
      {
        kind: "interest",
        path: ["News & Entertainment", "Culture & Art", "Techno"],
      },
    ]);
    assert.equal(
      formatTikTokUnresolvedPresetPaths(taxonomy.unresolvedPaths),
      "TikTok catalog has no node for News & Entertainment > Culture & Art > Techno.",
    );
  });

  it("stays pending when no interest group exists rather than dropping the taxonomy", () => {
    assert.equal(
      tikTokPresetTaxonomyPendingReason({ hasGroup: false, catalogLoaded: true }),
      "no-group",
    );
    assert.equal(
      tikTokPresetTaxonomyPendingReason({ hasGroup: true, catalogLoaded: false }),
      "catalog-empty",
    );
    assert.equal(
      tikTokPresetTaxonomyPendingReason({ hasGroup: true, catalogLoaded: true }),
      null,
    );
  });

  it("resolves every shipped preset and never lands on the Apps Music player node", () => {
    const ids = new Set(TIKTOK_GENRE_PRESETS.map((preset) => preset.id));
    assert.equal(ids.size, TIKTOK_GENRE_PRESETS.length);
    assert.ok(ids.has("electronic-music"));
    assert.deepEqual(
      [...new Set(TIKTOK_GENRE_PRESETS.map((preset) => preset.cluster))],
      [...TIKTOK_PRESET_CLUSTERS],
    );
    for (const cluster of TIKTOK_PRESET_CLUSTERS) {
      assert.ok(
        tikTokPresetsForCluster(cluster).length >= 3,
        `${cluster} should have several targeting angles`,
      );
    }
    for (const preset of TIKTOK_GENRE_PRESETS) {
      assert.ok(
        preset.seeds.every((seed) => seed.length > 0 && !/\s/.test(seed)),
        `${preset.id} has a multi-word seed`,
      );
      const taxonomy = resolveTikTokPresetTaxonomy(LIVE_CATALOG, preset);
      assert.ok(
        !taxonomy.interestItems.some((item) => item.id === APPS_MUSIC_PLAYER_ID),
        `${preset.id} resolved to Apps > Audio & Video Players > Music`,
      );
      assert.ok(
        !taxonomy.interestItems.some((item) => item.id === "20107103"),
        `${preset.id} resolved to Apps > Life & Leisure > Entertainment`,
      );
      assert.equal(
        taxonomy.interestItems.length + taxonomy.unresolvedPaths.filter((item) => item.kind === "interest").length,
        preset.interestPaths.length,
      );
      assert.equal(
        taxonomy.behaviourItems.length + taxonomy.unresolvedPaths.filter((item) => item.kind === "behaviour").length,
        preset.behaviourPaths.length,
      );
      assert.deepEqual(taxonomy.unresolvedPaths, []);
    }
  });
});
