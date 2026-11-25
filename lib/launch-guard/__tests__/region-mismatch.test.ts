import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { isPresetPinGroup, presetPinGroup } from "../../meta/location-pins.ts";
import type { CampaignDraft, LocationSelection, LocationTargetingGroup } from "../../types.ts";
import { applyLaunchCheckFix, checkLaunchReferences, keptLocationLines } from "../check.ts";
import { venueDefaultsFromMap } from "../venue-defaults.ts";
import { NX27_GLITTERBOX, glitterboxNxDraft, othersThan } from "./fixtures.ts";

/**
 * The Leeds, Kent launch warning (#1370 LP4, wired into the launch checks).
 * Everything it says and does comes from lib/meta/location-pins.ts.
 */

const KENT_SELECTION: LocationSelection = {
  id: "city_811209_include_1",
  source: "search",
  label: "Leeds, Kent, England, United Kingdom",
  mode: "include",
  locationType: "city",
  locationKey: "811209",
  countryCode: "GB",
  radius: 80,
  distanceUnit: "kilometer",
  tier: "secondary",
};

const KENT: LocationTargetingGroup = {
  id: "manual_1795103585517",
  label: "Leeds, Kent, England, United Kingdom (+80 km)",
  source: "manual",
  selections: [KENT_SELECTION],
};

function withLocations(groups: LocationTargetingGroup[], pool: LocationSelection[] = []): CampaignDraft {
  const draft = glitterboxNxDraft();
  return {
    ...draft,
    budgetSchedule: { ...draft.budgetSchedule, locationGroups: groups, excludedLocations: pool },
  };
}

function run(draft: CampaignDraft) {
  return checkLaunchReferences(draft, NX27_GLITTERBOX, venueDefaultsFromMap(NX27_GLITTERBOX), othersThan(NX27_GLITTERBOX));
}

const mismatches = (draft: CampaignDraft) =>
  run(draft).checks.filter((check) => check.key === "region_mismatch");

const ctx = { keptBy: "Matas", now: new Date("2026-11-24T16:40:00Z") };

describe("region_mismatch (Leeds, Kent)", () => {
  it("a draft with 811209 raises a warning with the Leeds pin as its first fix", () => {
    const draft = withLocations([KENT]);
    const [check, ...rest] = mismatches(draft);
    assert.equal(rest.length, 0);
    assert.ok(check);
    assert.equal(check.severity, "warning");
    assert.equal(check.sentence, "Leeds, Kent: this is in Kent, not West Yorkshire.");
    assert.deepEqual(
      check.fixes.map((fix) => [fix.action, fix.label]),
      [
        ["use_location_pin", "Use the Leeds pin"],
        ["keep_location", "Keep Leeds, Kent"],
      ],
    );
    // A warning: the launch is not held.
    assert.equal(run(draft).blockers, run(withLocations([])).blockers);

    const fixed = applyLaunchCheckFix(draft, check.fixes[0]!, ctx);
    const group = fixed.budgetSchedule.locationGroups![0]!;
    assert.ok(isPresetPinGroup(group, "leeds"));
    assert.equal(group.id, KENT.id, "the ad sets that target the row target the pin");
    assert.equal(group.selections[0]!.tier, "secondary");
    assert.deepEqual(mismatches(fixed), []);
  });

  it("after Keep the warning goes and the .kept line shows who and when", () => {
    const draft = withLocations([KENT]);
    const keep = mismatches(draft)[0]!.fixes[1]!;
    const kept = applyLaunchCheckFix(draft, keep, ctx);
    assert.deepEqual(kept.budgetSchedule.locationGroups![0]!.selections[0]!.regionMismatchKept, {
      keptBy: "Matas",
      keptAt: "2026-11-24T16:40:00.000Z",
    });
    assert.deepEqual(mismatches(kept), []);
    assert.deepEqual(keptLocationLines(kept), ["Leeds, Kent kept by Matas, Tue 24 Nov, 16:40"]);
    assert.deepEqual(keptLocationLines(draft), []);
  });

  it("a draft with the Leeds pin raises nothing", () => {
    const draft = withLocations([presetPinGroup("leeds")]);
    assert.deepEqual(mismatches(draft), []);
    assert.deepEqual(keptLocationLines(draft), []);
  });

  it("the exclusion pool counts too, one line for the city, and the pin keeps the exclusion's id", () => {
    const pooled: LocationSelection = { ...KENT_SELECTION, id: "pool_kent", mode: "exclude", tier: undefined };
    const draft = withLocations([KENT], [pooled]);
    const found = mismatches(draft);
    assert.equal(found.length, 1);
    const fixed = applyLaunchCheckFix(draft, found[0]!.fixes[0]!, ctx);
    const pin = fixed.budgetSchedule.excludedLocations![0]!;
    assert.equal(pin.id, "pool_kent");
    assert.equal(pin.mode, "exclude");
    assert.equal(pin.locationType, "pin");
    assert.deepEqual(mismatches(fixed), []);

    const onlyPool = withLocations([], [pooled]);
    assert.equal(mismatches(onlyPool).length, 1);
    const kept = applyLaunchCheckFix(onlyPool, mismatches(onlyPool)[0]!.fixes[1]!, ctx);
    assert.deepEqual(mismatches(kept), []);
    assert.deepEqual(keptLocationLines(kept), ["Leeds, Kent kept by Matas, Tue 24 Nov, 16:40"]);
  });

  it("lib/launch-guard holds no copy of the map or the words", () => {
    const dir = new URL("../", import.meta.url);
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
      const text = readFileSync(new URL(name, dir), "utf8");
      assert.ok(!text.includes("811209"), `${name} has 811209`);
      assert.ok(!/West Yorkshire|Leeds pin/.test(text), `${name} has #1370's words`);
    }
  });
});
