/**
 * Every fallback ID is a row copied from Google's geotargets CSV of
 * 2026-08-12. An ID that is not in that extract fails this file.
 */

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { GEO_TARGET_CONSTANTS_MAP, lookupFallbackGeoConstant } from "../geo-resolve.ts";
import { NO_LOCATIONS_MESSAGE } from "../../google-search/validation.ts";
import { editorLocation } from "../../google-video/locations.ts";
import {
  ENGLISH_REGION_KEYS,
  englishRegionWarning,
  VERIFIED_GEOTARGETS,
} from "../verified-geotargets.ts";

const FIXTURE = new URL("./fixtures/geotargets-2026-08-12-verified.csv", import.meta.url);

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function loadFixture(): Map<string, Record<string, string>> {
  const text = readFileSync(FIXTURE, "utf8").replace(/^\uFEFF/, "").trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const headers = splitCsv(head);
  const byId = new Map<string, Record<string, string>>();
  for (const line of lines) {
    const cells = splitCsv(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
    byId.set(row["Criteria ID"], row);
  }
  return byId;
}

const PINNED: ReadonlyArray<readonly [key: string, id: string, name: string, targetType: string]> = [
  ["united kingdom", "2826", "United Kingdom", "Country"],
  ["uk", "2826", "United Kingdom", "Country"],
  ["england", "20339", "England", "Province"],
  ["scotland", "20342", "Scotland", "Province"],
  ["wales", "20343", "Wales", "Province"],
  ["northern ireland", "20341", "Northern Ireland", "Province"],
  ["london", "1006886", "London", "City"],
  ["greater london", "1006886", "London", "City"],
  ["manchester", "1006912", "Manchester", "City"],
  ["birmingham", "1006524", "Birmingham", "City"],
  ["leeds", "1006864", "Leeds", "City"],
  ["liverpool", "1006884", "Liverpool", "City"],
  ["bristol", "1006567", "Bristol", "City"],
  ["brighton", "1006565", "Brighton", "City"],
  ["sheffield", "1007064", "Sheffield", "City"],
  ["nottingham", "1006965", "Nottingham", "City"],
  ["leicester", "1006867", "Leicester", "City"],
  ["newcastle", "1006948", "Newcastle upon Tyne", "City"],
  ["edinburgh", "1007326", "Edinburgh", "City"],
  ["glasgow", "1007336", "Glasgow", "City"],
  ["cardiff", "1007416", "Cardiff", "City"],
  ["belfast", "1007274", "Belfast", "City"],
  ["ireland", "2372", "Ireland", "Country"],
  ["germany", "2276", "Germany", "Country"],
  ["france", "2250", "France", "Country"],
  ["netherlands", "2528", "Netherlands", "Country"],
  ["spain", "2724", "Spain", "Country"],
  ["italy", "2380", "Italy", "Country"],
  ["belgium", "2056", "Belgium", "Country"],
];

describe("verified geotargets", () => {
  const fixture = loadFixture();

  it("fails if any fallback ID is missing from the verified list", () => {
    const ids = new Set([...GEO_TARGET_CONSTANTS_MAP.values()].map((resource) => resource.split("/")[1]));
    for (const id of ids) {
      assert.ok(fixture.has(id), `${id} is not in the 2026-08-12 geotargets extract`);
      assert.equal(fixture.get(id)?.Status, "Active");
    }
    for (const row of VERIFIED_GEOTARGETS) {
      assert.ok(fixture.has(row.id), row.id);
    }
  });

  it("pins each name to the CSV row", () => {
    for (const [key, id, name, targetType] of PINNED) {
      const row = fixture.get(id);
      assert.ok(row, id);
      assert.equal(row.Name, name, key);
      assert.equal(row["Target Type"], targetType, key);
      assert.equal(lookupFallbackGeoConstant(key), `geoTargetConstants/${id}`, key);
    }
    assert.equal(lookupFallbackGeoConstant("London"), "geoTargetConstants/1006886");
    assert.equal(fixture.get("1006886")?.["Country Code"], "GB");
    assert.equal(fixture.get("1006886")?.["Canonical Name"], "London,England,United Kingdom");
    assert.equal(lookupFallbackGeoConstant("United Kingdom"), "geoTargetConstants/2826");
    assert.equal(editorLocation("London")?.id, "1006886");
    assert.equal(editorLocation("London")?.location, "London, England, United Kingdom");
  });

  it("an English region is not in the map and warns", () => {
    for (const key of ENGLISH_REGION_KEYS) {
      assert.equal(GEO_TARGET_CONSTANTS_MAP.has(key), false, key);
      assert.equal(lookupFallbackGeoConstant(key), null, key);
      assert.match(englishRegionWarning(key) ?? "", /no English region target/);
    }
    assert.equal([...GEO_TARGET_CONSTANTS_MAP.values()].some((resource) => resource.endsWith("/9049069")), false);
    assert.equal(fixture.has("9049069"), false);
  });

  it("the Search no-location message is unchanged", () => {
    assert.equal(NO_LOCATIONS_MESSAGE, "No locations — this would run worldwide. Add at least one location.");
  });
});
