/**
 * Location pins (design record 2026-11-24-campaign-creator-location-pin,
 * LP1–LP5): the model, the form's checks, the wrong-place warning, and the
 * pin reaching Meta as `geo_locations.custom_locations` on launch, replicate
 * and bulk-attach (all three build the ad set through `buildAdSetPayload`).
 * Meta is never called.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrateDraft } from "../../autosave.ts";
import { createDefaultDraft } from "../../campaign-defaults.ts";
import { replicateDraft } from "../../replicate/replicate.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  CampaignDraft,
  LocationTargetingGroup,
} from "../../types.ts";
import { buildAdSetPayload } from "../adset.ts";
import {
  KNOWN_AMBIGUOUS_CITIES,
  PIN_PRESETS,
  isPresetPinGroup,
  keepRegionMismatch,
  keptRegionMismatchLine,
  manualPinGroup,
  openRegionMismatch,
  parseLatLngPair,
  pinChipLabel,
  presetPinGroup,
  regionMismatchForCityKey,
  swapGroupForPinPreset,
  validatePinForm,
} from "../location-pins.ts";
import { findAdSetLocationProblems, groupToGeo, locationsToGeo } from "../location-targeting.ts";

const LEEDS_PIN = { latitude: 53.7997, longitude: -1.5492, radius: 80, distance_unit: "kilometer", name: "Leeds" };

const KENT: LocationTargetingGroup = {
  id: "manual_1795103585517",
  label: "Leeds, Kent, England, United Kingdom (+80 km)",
  source: "manual",
  selections: [
    {
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
    },
  ],
};

const CARLISLE: LocationTargetingGroup = {
  id: "city:805149:80:kilometer",
  label: "Carlisle",
  source: "manual",
  selections: [
    { id: "c1", source: "search", label: "Carlisle", mode: "include", locationType: "city", locationKey: "805149", radius: 80, distanceUnit: "kilometer", tier: "secondary" },
  ],
};

const audiences = {
  interestGroups: [],
  customAudienceGroups: [],
  pageGroups: [],
  savedAudiences: { audienceIds: [] },
  selectedPagesLookalikeGroups: [],
} as unknown as AudienceSettings;

function adSet(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "s1",
    name: "Lineup — Secondary",
    sourceType: "interest_group",
    sourceId: "g1",
    sourceName: "Lineup",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    ...overrides,
  } as AdSetSuggestion;
}

describe("LP1: a pin is a location", () => {
  it("the preset's row and chip read as the record says", () => {
    const g = presetPinGroup("leeds");
    assert.equal(g.label, "Leeds (pin) · 80 km");
    assert.equal(g.source, "preset");
    assert.equal(pinChipLabel(g.selections[0]!), "+ Leeds (pin) · 80 km · 53.7997, -1.5492");
    const ex = presetPinGroup("leeds", { mode: "exclude" });
    assert.equal(pinChipLabel(ex.selections[0]!), "− Leeds (pin) · 80 km · 53.7997, -1.5492");
  });

  it("goes to Meta as one custom location and no city", () => {
    const geo = groupToGeo(presetPinGroup("leeds"));
    assert.deepEqual(geo, { custom_locations: [LEEDS_PIN] });
    const excluded = locationsToGeo([CARLISLE], [presetPinGroup("leeds", { mode: "exclude" }).selections[0]!]);
    assert.deepEqual(excluded.excluded_geo_locations, { custom_locations: [LEEDS_PIN] });
  });

  it("a pin listed twice keeps the wider radius", () => {
    const small = manualPinGroup({ name: "Leeds", latitude: 53.7997, longitude: -1.5492, radiusKm: 20, mode: "include" }, 1);
    const geo = locationsToGeo([small, presetPinGroup("leeds")]);
    assert.deepEqual(geo.custom_locations, [LEEDS_PIN]);
  });

  it("a pin-only ad set is not 'no included locations'", () => {
    const schedule = { locationGroups: [presetPinGroup("leeds")], excludedLocations: [] } as unknown as BudgetScheduleSettings;
    assert.deepEqual(findAdSetLocationProblems([adSet({ locationGroupIds: ["preset_leeds_pin"] })], schedule), []);
  });

  it("an exclusion pin as wide as the included pin is caught like a city", () => {
    const schedule = {
      locationGroups: [presetPinGroup("leeds")],
      excludedLocations: [{ ...presetPinGroup("leeds", { mode: "exclude" }).selections[0]!, id: "ex1" }],
    } as unknown as BudgetScheduleSettings;
    const problems = findAdSetLocationProblems(
      [adSet({ locationGroupIds: ["preset_leeds_pin"], excludedLocationIds: ["ex1"] })],
      schedule,
    );
    assert.equal(problems.length, 1);
  });
});

describe("launch: the pin reaches Meta as geo_locations.custom_locations", () => {
  const schedule = {
    startDate: "",
    endDate: "",
    locationGroups: [CARLISLE, presetPinGroup("leeds", { tier: "secondary" })],
    excludedLocations: [],
  } as unknown as BudgetScheduleSettings;

  it("the preset alone: one custom location at 53.7997, -1.5492, 80 km, and no city (acceptance)", () => {
    const payload = buildAdSetPayload(
      adSet({ locationGroupIds: ["preset_leeds_pin"] }),
      "cam", audiences, schedule, "link_clicks", "traffic",
    );
    assert.deepEqual(payload.targeting.geo_locations.custom_locations, [LEEDS_PIN]);
    assert.equal(payload.targeting.geo_locations.cities, undefined);
  });

  it("with a city: the city and the pin, the same fields as #1368's write", () => {
    const payload = buildAdSetPayload(
      adSet({ locationGroupIds: ["city:805149:80:kilometer", "preset_leeds_pin"] }),
      "cam", audiences, schedule, "link_clicks", "traffic",
    );
    assert.deepEqual(payload.targeting.geo_locations.cities, [{ key: "805149", radius: 80, distance_unit: "kilometer" }]);
    assert.deepEqual(payload.targeting.geo_locations.custom_locations, [LEEDS_PIN]);
  });

  it("a stamped snapshot that holds a pin is sent too (legacy rows)", () => {
    const payload = buildAdSetPayload(
      adSet({ geoLocations: { custom_locations: [LEEDS_PIN as never] } }),
      "cam", audiences, { startDate: "", endDate: "" } as unknown as BudgetScheduleSettings, "link_clicks", "traffic",
    );
    assert.deepEqual(payload.targeting.geo_locations.custom_locations, [LEEDS_PIN]);
  });

  it("replicate keeps the pin, and the replicated draft launches it", () => {
    const source = createDefaultDraft();
    source.budgetSchedule = { ...source.budgetSchedule, locationGroups: [presetPinGroup("leeds")] };
    source.adSetSuggestions = [adSet({ locationGroupIds: ["preset_leeds_pin"] })];
    const { draft } = replicateDraft(
      source,
      {
        event: { id: "e2", event_code: "NX27-TEST", client_id: "c", name: "Test", venue_name: "NX Newcastle", event_date: "2027-03-06" },
        venue: { id: "v", name: "NX Newcastle", meta_ad_account_id: "act_1", meta_pixel_id: "1" },
      },
      { now: new Date("2026-11-26T09:00:00Z"), id: "x" },
    );
    assert.deepEqual(draft.budgetSchedule.locationGroups, [presetPinGroup("leeds")]);
    const payload = buildAdSetPayload(draft.adSetSuggestions[0]!, "cam", audiences, draft.budgetSchedule, "link_clicks", "traffic");
    assert.deepEqual(payload.targeting.geo_locations.custom_locations, [LEEDS_PIN]);
  });
});

describe("migrateDraft", () => {
  function roundTrip(draft: CampaignDraft): CampaignDraft {
    return migrateDraft(JSON.parse(JSON.stringify(draft)) as Record<string, unknown>);
  }

  it("an old draft without pins loads unchanged where locations are concerned", () => {
    const old = createDefaultDraft();
    old.budgetSchedule = { ...old.budgetSchedule, locationGroups: [CARLISLE, KENT], excludedLocations: [] };
    old.adSetSuggestions = [adSet({ locationGroupIds: [CARLISLE.id, KENT.id] })];
    const once = roundTrip(old);
    assert.deepEqual(once.budgetSchedule.locationGroups, [CARLISLE, KENT]);
    assert.deepEqual(once.adSetSuggestions[0]!.locationGroupIds, [CARLISLE.id, KENT.id]);
    assert.deepEqual(roundTrip(once), once);
  });

  it("a draft with a pin keeps it, kept marks included", () => {
    const d = createDefaultDraft();
    const kept = keepRegionMismatch(KENT, KENT.selections[0]!.id, "matas@offpixel.co.uk", new Date("2026-11-24T16:40:00Z"));
    d.budgetSchedule = { ...d.budgetSchedule, locationGroups: [presetPinGroup("leeds", { tier: "secondary" }), kept], excludedLocations: [] };
    d.adSetSuggestions = [adSet({ locationGroupIds: ["preset_leeds_pin", KENT.id] })];
    const once = roundTrip(d);
    assert.deepEqual(once.budgetSchedule.locationGroups, d.budgetSchedule.locationGroups);
    assert.deepEqual(roundTrip(once), once);
  });
});

describe("LP2: the form's checks", () => {
  const ok = { name: "Leeds", latitude: "53.7997", longitude: "-1.5492", radius: "80" };

  it("a good pin passes", () => {
    assert.deepEqual(validatePinForm(ok), {
      errors: {},
      pin: { name: "Leeds", latitude: 53.7997, longitude: -1.5492, radiusKm: 80 },
    });
  });

  it("each error under its own field, Meta's 1–80 km for the radius", () => {
    assert.deepEqual(validatePinForm({ name: " ", latitude: "91", longitude: "-181", radius: "81" }).errors, {
      name: "location.pin.error.name",
      latitude: "location.pin.error.latitude",
      longitude: "location.pin.error.longitude",
      radius: "location.pin.error.radius",
    });
    assert.deepEqual(validatePinForm({ ...ok, radius: "81" }).errors, { radius: "location.pin.error.radius" });
    assert.equal(validatePinForm({ ...ok, radius: "81" }).pin, null);
    assert.deepEqual(validatePinForm({ ...ok, radius: "0" }).errors, { radius: "location.pin.error.radius" });
    assert.deepEqual(validatePinForm({ ...ok, radius: "1" }).errors, {});
    assert.deepEqual(validatePinForm({ ...ok, latitude: "abc" }).errors, { latitude: "location.pin.error.latitude" });
    assert.deepEqual(validatePinForm({ ...ok, latitude: "" }).errors, { latitude: "location.pin.error.latitude" });
  });

  it("a pair pasted into Latitude fills both", () => {
    assert.deepEqual(parseLatLngPair("53.7997, -1.5492"), { latitude: "53.7997", longitude: "-1.5492" });
    assert.deepEqual(parseLatLngPair(" 53.7997,-1.5492 "), { latitude: "53.7997", longitude: "-1.5492" });
    assert.equal(parseLatLngPair("53.7997"), null);
  });

  it("a hand-added pin has its own row label and the 'pin' source", () => {
    const g = manualPinGroup({ name: "Leeds", latitude: 53.7997, longitude: -1.5492, radiusKm: 40, mode: "include" }, 7);
    assert.equal(g.label, "Leeds (pin) · 40 km");
    assert.equal(g.source, "manual");
    assert.equal(g.selections[0]!.locationType, "pin");
  });
});

describe("LP3: the Leeds preset", () => {
  it("is the point #1368 wrote", () => {
    assert.deepEqual(
      { lat: PIN_PRESETS.leeds.latitude, lng: PIN_PRESETS.leeds.longitude, km: PIN_PRESETS.leeds.radiusKm },
      { lat: 53.7997, lng: -1.5492, km: 80 },
    );
  });
  it("the chip is on for the preset group, whatever its id (a swapped row keeps its own)", () => {
    assert.ok(isPresetPinGroup(presetPinGroup("leeds"), "leeds"));
    assert.ok(isPresetPinGroup(swapGroupForPinPreset(KENT, "leeds"), "leeds"));
    assert.ok(!isPresetPinGroup(CARLISLE, "leeds"));
    assert.ok(!isPresetPinGroup(manualPinGroup({ name: "Leeds", latitude: 53.7997, longitude: -1.5492, radiusKm: 80, mode: "include" }, 1), "leeds"));
  });
});

describe("LP4: a hit in the wrong place", () => {
  it("the known list starts with 811209", () => {
    assert.deepEqual(Object.keys(KNOWN_AMBIGUOUS_CITIES), ["811209"]);
  });

  it("'Leeds' and 'Leeds, West Yorkshire' give the line; 'Leeds, Kent' doesn't (acceptance)", () => {
    for (const q of ["Leeds", "leeds", "Leeds, West Yorkshire"]) {
      const m = regionMismatchForCityKey("811209", q);
      assert.equal(m?.line, "Leeds, Kent: this is in Kent, not West Yorkshire.", q);
      assert.equal(m?.fix, "Use the Leeds pin");
      assert.equal(m?.keep, "Keep Leeds, Kent");
    }
    assert.equal(regionMismatchForCityKey("811209", "Leeds, Kent"), null);
    assert.equal(regionMismatchForCityKey("811209", "leeds, kent "), null);
    assert.equal(regionMismatchForCityKey("805149", "Carlisle"), null);
  });

  it("an entry with no preset offers 'Add a pin'", () => {
    const list = KNOWN_AMBIGUOUS_CITIES as Record<string, unknown>;
    list["999"] = { name: "Newport", actual: "Shropshire", expected: "Gwent" };
    try {
      assert.equal(regionMismatchForCityKey("999")?.fix, "Add a pin");
    } finally {
      delete list["999"];
    }
  });
});

describe("LP5: a draft that holds Leeds, Kent", () => {
  it("shows the line at once", () => {
    assert.equal(openRegionMismatch(KENT)?.mismatch.line, "Leeds, Kent: this is in Kent, not West Yorkshire.");
    assert.equal(openRegionMismatch(CARLISLE), null);
  });

  it("'Use the Leeds pin' swaps the row for the pin, keeping its id, tier and mode", () => {
    const swapped = swapGroupForPinPreset(KENT, "leeds");
    assert.equal(swapped.id, KENT.id);
    assert.equal(swapped.label, "Leeds (pin) · 80 km");
    assert.equal(swapped.selections[0]!.tier, "secondary");
    assert.equal(swapped.selections[0]!.mode, "include");
    assert.deepEqual(groupToGeo(swapped), { custom_locations: [LEEDS_PIN] });
  });

  it("Keep clears the line and stores who and when; the muted line reads London time", () => {
    const kept = keepRegionMismatch(KENT, KENT.selections[0]!.id, "Matas", new Date("2026-11-24T16:40:00Z"));
    assert.deepEqual(kept.selections[0]!.regionMismatchKept, { keptBy: "Matas", keptAt: "2026-11-24T16:40:00.000Z" });
    assert.equal(openRegionMismatch(kept), null);
    assert.equal(keptRegionMismatchLine(kept.selections[0]!), "Leeds, Kent kept by Matas, Tue 24 Nov, 16:40");
    assert.equal(keptRegionMismatchLine(KENT.selections[0]!), null);
  });
});
