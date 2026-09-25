import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { CREATIVE_NAME_MAX_LENGTH, metaAdName } from "../../creative-name-from-filename.ts";
import { buildAdPayload } from "../creative.ts";

const ROOT = new URL("../../../", import.meta.url);

const LAUNCH_ROUTES = [
  "app/api/meta/launch-campaign/route.ts",
  "app/api/meta/create-creatives-and-ads/route.ts",
  "app/api/meta/bulk-attach-ads/route.ts",
];

function source(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

describe("a Meta ad is named after its creative", () => {
  it("one creative in three ad sets sends three ads with one shared name", () => {
    const creativeName = "Motion - Ahmed";
    const adSets = ["120249957292970453", "120249957296630453", "120249957285130453"];
    const payloads = adSets.map((adSetId) =>
      buildAdPayload(metaAdName(creativeName), "1121399913744296", adSetId, "PAUSED"),
    );
    assert.deepEqual(
      payloads.map((payload) => payload.name),
      [creativeName, creativeName, creativeName],
    );
    assert.deepEqual(
      payloads.map((payload) => payload.adset_id),
      adSets,
    );
    for (const payload of payloads) {
      assert.doesNotMatch(payload.name, /attached:|\d{4}-\d{2}-\d{2}-[0-9a-f]{32}| — /);
    }
  });

  it("caps at the shared creative-name limit and never sends an empty name", () => {
    assert.equal(metaAdName("x".repeat(600)).length, CREATIVE_NAME_MAX_LENGTH);
    assert.equal(metaAdName("   "), "Ad");
  });

  it("every launch path passes metaAdName(creative.name) to buildAdPayload", () => {
    for (const path of LAUNCH_ROUTES) {
      const route = source(path);
      assert.equal(route.includes("${creative.name} — "), false, `${path} still suffixes the ad name`);
      const calls = route.match(/buildAdPayload\(\s*([^,]+),/g) ?? [];
      assert.ok(calls.length >= 1, `${path} has no buildAdPayload call`);
      for (const call of calls) {
        assert.match(call, /buildAdPayload\(\s*(metaAdName\(creative\.name\)|adName),/, `${path}: ${call}`);
      }
      if (route.includes("buildAdPayload(adName,")) {
        assert.match(route, /const adName = metaAdName\(creative\.name\);/, path);
      }
    }
  });
});
