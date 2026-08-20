import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  expandTikTokPresetKeywords,
  formatTikTokUnresolvedPresetPaths,
  mergeTikTokPresetTaxonomy,
  resolveTikTokPresetTaxonomy,
  tikTokHashtagPresetQuery,
  tikTokPresetTaxonomyPendingReason,
  TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS,
  TIKTOK_ELECTRONIC_INTEREST_PATHS,
  TIKTOK_GENRE_PRESETS,
} from "../genre-presets.ts";

const LIVE_INTEREST_CATALOG = [
  { id: "20101", label: "Apps", parent_id: null },
  { id: "20101100", label: "Audio & Video Players", parent_id: "20101" },
  { id: "20101101", label: "Music", parent_id: "20101100" },
  { id: "231", label: "News & Entertainment", parent_id: null },
  { id: "23116", label: "Culture & Art", parent_id: "231" },
  { id: "23116107", label: "Music", parent_id: "23116" },
  { id: "23119", label: "Movie", parent_id: "231" },
  { id: "23119115", label: "Dance", parent_id: "23119" },
  { id: "10106102", label: "Dance", parent_id: "23116" },
  { id: "259", label: "Games", parent_id: null },
  { id: "25999", label: "Genre", parent_id: "259" },
  { id: "25999001", label: "Hyper-Casual", parent_id: "25999" },
  { id: "25999001005", label: "Music", parent_id: "25999001" },
  { id: "25999012", label: "Party", parent_id: "25999" },
  { id: "25999012003", label: "Dance", parent_id: "25999012" },
  { id: "20107", label: "Life & Leisure", parent_id: "20101" },
  { id: "20107103", label: "Entertainment", parent_id: "20107" },
];

const LIVE_BEHAVIOUR_CATALOG = [
  { id: "18", label: "Entertainment", parent_id: null },
  { id: "18101", label: "Entertainment & Culture", parent_id: "18" },
  { id: "1810101", label: "Music", parent_id: "18101" },
  { id: "3", label: "Talent", parent_id: null },
  { id: "3002", label: "Music", parent_id: "3" },
  { id: "11", label: "Talents", parent_id: null },
  { id: "1101", label: "Singing & Dancing", parent_id: "11" },
  { id: "1101100", label: "Dance", parent_id: "1101" },
  { id: "10", label: "Performance", parent_id: null },
];

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
    const preset = TIKTOK_GENRE_PRESETS.find((item) => item.id === "electronic-music");
    assert.ok(preset);
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
    assert.ok(
      !preset.interestPaths.some((path) => path[path.length - 1] === "Entertainment"),
    );
    assert.ok(
      !preset.behaviourPaths.some((path) => path[path.length - 1] === "Performance"),
    );
  });
});

describe("resolveTikTokPresetTaxonomy", () => {
  it("picks Culture & Art Music, not the Apps music-player node", () => {
    const preset = TIKTOK_GENRE_PRESETS.find((item) => item.id === "electronic-music");
    assert.ok(preset);
    const taxonomy = resolveTikTokPresetTaxonomy(
      { interests: LIVE_INTEREST_CATALOG, behaviours: LIVE_BEHAVIOUR_CATALOG },
      preset,
    );
    assert.deepEqual(
      taxonomy.interestItems.map((item) => item.id),
      ["23116107", "10106102"],
    );
    assert.ok(!taxonomy.interestItems.some((item) => item.id === "20101101"));
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
    const taxonomy = resolveTikTokPresetTaxonomy(
      { interests: LIVE_INTEREST_CATALOG, behaviours: LIVE_BEHAVIOUR_CATALOG },
      {
        interestPaths: [["News & Entertainment", "Culture & Art", "Techno"]],
        behaviourPaths: [["Talents", "Singing & Dancing"]],
      },
    );
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
});
