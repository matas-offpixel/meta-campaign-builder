import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  expandTikTokPresetKeywords,
  mergeTikTokPresetTaxonomy,
  resolveTikTokPresetTaxonomy,
  tikTokHashtagPresetQuery,
  TIKTOK_ELECTRONIC_BEHAVIOUR_LABELS,
  TIKTOK_ELECTRONIC_INTEREST_LABELS,
  TIKTOK_GENRE_PRESETS,
} from "../genre-presets.ts";

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

  it("ships the Electronic music preset as single-word seeds plus taxonomy labels", () => {
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
    assert.deepEqual([...preset.interestLabels], [...TIKTOK_ELECTRONIC_INTEREST_LABELS]);
    assert.deepEqual([...preset.behaviourLabels], [...TIKTOK_ELECTRONIC_BEHAVIOUR_LABELS]);
  });
});

describe("resolveTikTokPresetTaxonomy", () => {
  it("selects the expected taxonomy node ids by exact catalog label", () => {
    const preset = TIKTOK_GENRE_PRESETS.find((item) => item.id === "electronic-music");
    assert.ok(preset);
    const taxonomy = resolveTikTokPresetTaxonomy(
      {
        interests: [
          { id: "int-games", label: "Music Games", parent_id: "int-music" },
          { id: "int-music", label: "Music", parent_id: null },
          { id: "int-dance", label: "Dance", parent_id: "int-music" },
          { id: "int-entertainment", label: "Entertainment", parent_id: null },
          { id: "int-audio", label: "Audio players", parent_id: "int-music" },
        ],
        behaviours: [
          { id: "beh-music", label: "Music", parent_id: null },
          { id: "beh-dance", label: "Dance", parent_id: null },
          { id: "beh-sing", label: "Singing & Dancing", parent_id: null },
          { id: "beh-perf", label: "Performance", parent_id: null },
          { id: "beh-other", label: "Creators", parent_id: null },
        ],
      },
      preset,
    );
    assert.deepEqual(
      taxonomy.interestItems.map((item) => item.id),
      ["int-music", "int-dance", "int-entertainment"],
    );
    assert.deepEqual(
      taxonomy.behaviourItems.map((item) => item.id),
      ["beh-music", "beh-dance", "beh-sing", "beh-perf"],
    );
    const merged = mergeTikTokPresetTaxonomy(
      {
        interestIds: [{ id: "int-music", name: "Music", kind: "category" }],
        behaviourIds: [],
      },
      taxonomy,
    );
    assert.deepEqual(
      merged.interestIds.map((item) => item.id),
      ["int-music", "int-dance", "int-entertainment"],
    );
    assert.deepEqual(
      merged.behaviourIds.map((item) => item.id),
      ["beh-music", "beh-dance", "beh-sing", "beh-perf"],
    );
  });
});
