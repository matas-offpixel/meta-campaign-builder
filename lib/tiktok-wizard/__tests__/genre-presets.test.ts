import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  expandTikTokPresetKeywords,
  tikTokHashtagPresetQuery,
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

  it("ships the Electronic music preset as a seed bundle", () => {
    const preset = TIKTOK_GENRE_PRESETS.find((item) => item.id === "electronic-music");
    assert.ok(preset);
    assert.deepEqual(preset.seeds, [
      "Electronic music",
      "tech house",
      "house music",
      "techno music",
      "disco music",
    ]);
  });
});
