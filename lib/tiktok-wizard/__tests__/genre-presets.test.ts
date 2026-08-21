import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  filterTikTokKeywordsByWordBoundary,
  formatTikTokUnresolvedPresetKeywords,
  formatTikTokUnresolvedPresetPaths,
  mergeTikTokPresetTaxonomy,
  resolveTikTokPresetKeywords,
  resolveTikTokPresetTaxonomy,
  tikTokHashtagPresetQuery,
  tikTokKeywordMatchesWordBoundary,
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

const TECHNO_NOISE = [
  { id: "kw-techno", name: "Techno" },
  { id: "kw-technology", name: "technology" },
  { id: "kw-smart", name: "smart technology" },
  { id: "kw-technodom", name: "technodom" },
];

describe("resolveTikTokPresetKeywords", () => {
  it("adds an exact catalog term and refuses a substring-only hit", async () => {
    const result = await resolveTikTokPresetKeywords(
      ["techno"],
      async () => TECHNO_NOISE,
    );
    assert.deepEqual(
      result.rows.map((row) => row.name),
      ["Techno"],
    );
    assert.deepEqual(result.unresolvedTerms, []);
    assert.deepEqual(result.failedTerms, []);
    assert.ok(!result.rows.some((row) => /technology/i.test(row.name)));
  });

  it("does not pull resident evil when a preset term is resident", async () => {
    const result = await resolveTikTokPresetKeywords(
      ["resident"],
      async () => [
        { id: "kw-evil", name: "resident evil" },
        { id: "kw-residential", name: "residential" },
        { id: "kw-uk", name: "uk residents" },
        { id: "kw-resident", name: "Resident" },
      ],
    );
    assert.deepEqual(
      result.rows.map((row) => row.name),
      ["Resident"],
    );
    assert.equal(
      result.rows.some((row) => /evil|residential|residents/i.test(row.name)),
      false,
    );
  });

  it("does not pull technology when a preset term is techno", async () => {
    const result = await resolveTikTokPresetKeywords(
      ["techno", "electronic music"],
      async (term) => {
        if (term === "techno") return TECHNO_NOISE;
        return [
          { id: "kw-electronic-music", name: "electronic music" },
          { id: "kw-electronics", name: "consumer electronics" },
        ];
      },
    );
    assert.deepEqual(
      result.rows.map((row) => row.name).sort(),
      ["Techno", "electronic music"],
    );
    assert.equal(
      result.rows.some((row) => row.name.toLowerCase() === "technology"),
      false,
    );
    assert.equal(
      result.rows.some((row) => /technology/i.test(row.name)),
      false,
    );
  });

  it("names an unresolved curated term instead of dropping it", async () => {
    const result = await resolveTikTokPresetKeywords(
      ["techno", "tech house"],
      async (term) => (term === "techno" ? TECHNO_NOISE : []),
    );
    assert.deepEqual(
      result.rows.map((row) => row.name),
      ["Techno"],
    );
    assert.deepEqual(result.unresolvedTerms, ["tech house"]);
    assert.equal(
      formatTikTokUnresolvedPresetKeywords(result.unresolvedTerms),
      "TikTok catalog has no keyword for tech house.",
    );
  });

  it("keeps other terms when one recommend rejects", async () => {
    const result = await resolveTikTokPresetKeywords(
      ["ok", "bad", "also-ok"],
      async (term) => {
        if (term === "bad") throw new Error("term failed");
        return [{ id: term, name: term }];
      },
    );
    assert.deepEqual(
      result.rows.map((row) => row.id).sort(),
      ["also-ok", "ok"],
    );
    assert.deepEqual(result.failedTerms, ["bad"]);
    assert.deepEqual(result.unresolvedTerms, []);
  });
});

describe("tikTokKeywordMatchesWordBoundary", () => {
  it("keeps Techno and drops technology for techno", () => {
    assert.equal(tikTokKeywordMatchesWordBoundary("techno", "Techno"), true);
    assert.equal(tikTokKeywordMatchesWordBoundary("techno", "technology"), false);
    assert.equal(
      tikTokKeywordMatchesWordBoundary("techno", "smart technology"),
      false,
    );
    const filtered = filterTikTokKeywordsByWordBoundary("techno", [
      { name: "Techno" },
      { name: "technology" },
      { name: "internet & technology" },
      { name: "technodom" },
    ]);
    assert.deepEqual(
      filtered.map((row) => row.name),
      ["Techno"],
    );
  });

  it("drops residential noise for resident; resident evil stays as leftover phrase noise", () => {
    assert.equal(
      tikTokKeywordMatchesWordBoundary("resident", "residential"),
      false,
    );
    assert.equal(
      tikTokKeywordMatchesWordBoundary("resident", "uk residents"),
      false,
    );
    assert.equal(
      tikTokKeywordMatchesWordBoundary("resident", "your residential unit"),
      false,
    );
    assert.equal(
      tikTokKeywordMatchesWordBoundary("resident", "resident evil"),
      true,
    );
  });

  it("drops discount 50 for disco", () => {
    assert.equal(
      tikTokKeywordMatchesWordBoundary("disco", "discount 50"),
      false,
    );
    assert.equal(tikTokKeywordMatchesWordBoundary("disco", "discord"), false);
    assert.equal(
      tikTokKeywordMatchesWordBoundary("disco", "discoloration"),
      false,
    );
  });

  it("still keeps beach house for house — the helper is not a solution", () => {
    assert.equal(tikTokKeywordMatchesWordBoundary("house", "beach house"), true);
    assert.equal(tikTokKeywordMatchesWordBoundary("house", "household"), false);
  });

  it("narrows the live dj and concert noisy sets the way word-boundary measured", () => {
    const dj = filterTikTokKeywordsByWordBoundary("dj", [
      { name: "djing" },
      { name: "dj mixer" },
      { name: "dj set" },
      { name: "this dj app" },
      { name: "djs" },
      { name: "dji" },
      { name: "novak djokovic" },
    ]);
    assert.deepEqual(
      dj.map((row) => row.name),
      ["dj mixer", "dj set", "this dj app"],
    );
    const concert = filterTikTokKeywordsByWordBoundary("concert", [
      { name: "Concerts" },
      { name: "concert tickets" },
      { name: "live concerts" },
      { name: "the concert" },
      { name: "concert" },
    ]);
    assert.deepEqual(
      concert.map((row) => row.name),
      ["concert tickets", "the concert", "concert"],
    );
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

  it("ships the Electronic music preset as curated terms plus full taxonomy paths", () => {
    const preset = tikTokPresetById("electronic-music");
    assert.ok(preset);
    assert.equal(preset.cluster, "Music & Nightlife");
    assert.ok(preset.seeds.includes("techno"));
    assert.ok(preset.seeds.includes("electronic music"));
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
        preset.seeds.length > 0 &&
          preset.seeds.every((seed) => seed.trim().length > 0),
        `${preset.id} is missing curated keyword terms`,
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
