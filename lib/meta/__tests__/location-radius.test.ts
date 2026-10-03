import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { cityRadiusMessage } from "../launch-error-classify.ts";
import {
  CITY_RADIUS_MESSAGE,
  CITY_RADIUS_TOO_SMALL_MESSAGE,
  cityRadiusOutOfRange,
  cityRadiusProblemInDraft,
} from "../location-radius.ts";
import { validateStep } from "../../validation.ts";
import type { LocationSelection } from "../../types.ts";

function draftWithCity(radius: number, unit: "kilometer" | "mile") {
  const draft = createDefaultDraft();
  draft.budgetSchedule.budgetAmount = 50;
  draft.budgetSchedule.startDate = "2026-10-10";
  draft.budgetSchedule.endDate = "2026-10-20";
  const selection: LocationSelection = {
    id: "newcastle",
    source: "search",
    label: "Newcastle",
    mode: "include",
    locationType: "city",
    locationKey: "2420322",
    radius,
    distanceUnit: unit,
  };
  draft.budgetSchedule.locationGroups = [
    { id: "g", label: "Newcastle", source: "manual", selections: [selection] },
  ];
  return draft;
}

describe("city radius bounds", () => {
  it("blocks 100 km and allows 80 km", () => {
    assert.equal(cityRadiusOutOfRange(100, "kilometer"), true);
    assert.equal(cityRadiusOutOfRange(80, "kilometer"), false);
    assert.equal(cityRadiusProblemInDraft(draftWithCity(100, "kilometer")), CITY_RADIUS_MESSAGE);
    assert.equal(cityRadiusProblemInDraft(draftWithCity(80, "kilometer")), null);
    assert.ok(validateStep(5, draftWithCity(100, "kilometer")).errors.includes(CITY_RADIUS_MESSAGE));
    assert.equal(
      validateStep(5, draftWithCity(80, "kilometer")).errors.includes(CITY_RADIUS_MESSAGE),
      false,
    );
  });

  it("allows 50 mi and blocks 51 mi", () => {
    assert.equal(cityRadiusOutOfRange(50, "mile"), false);
    assert.equal(cityRadiusOutOfRange(51, "mile"), true);
    assert.equal(cityRadiusProblemInDraft(draftWithCity(50, "mile")), null);
    assert.equal(cityRadiusProblemInDraft(draftWithCity(51, "mile")), CITY_RADIUS_MESSAGE);
  });

  it("maps subcode 1487110", () => {
    assert.equal(
      cityRadiusMessage({
        code: 100,
        subcode: 1487110,
        message: "geographical radius isn't within the specified bounds",
      }),
      CITY_RADIUS_MESSAGE,
    );
  });

  it("radius 0 passes", () => {
    assert.equal(cityRadiusOutOfRange(0, "kilometer"), false);
    assert.equal(cityRadiusProblemInDraft(draftWithCity(0, "kilometer")), null);
    assert.equal(
      validateStep(5, draftWithCity(0, "kilometer")).errors.includes(CITY_RADIUS_MESSAGE),
      false,
    );
  });

  it("undefined radius passes", () => {
    assert.equal(cityRadiusOutOfRange(undefined, "kilometer"), false);
    const draft = draftWithCity(40, "kilometer");
    draft.budgetSchedule.locationGroups[0]!.selections[0]!.radius = undefined;
    assert.equal(cityRadiusProblemInDraft(draft), null);
    assert.equal(validateStep(5, draft).errors.includes(CITY_RADIUS_MESSAGE), false);
  });

  it("maps a too-small 1487110 away from the 80 km sentence", () => {
    assert.equal(
      cityRadiusMessage({
        code: 100,
        subcode: 1487110,
        message: "The radius is below the minimum",
      }),
      CITY_RADIUS_TOO_SMALL_MESSAGE,
    );
  });
});
