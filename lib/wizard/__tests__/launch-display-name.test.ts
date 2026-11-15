/**
 * Launch sends the same name Step 5 shows.
 *
 * Run: node --test lib/wizard/__tests__/launch-display-name.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../../meta/adset.ts";
import { setAdSetLocations, splitAdSetByLocation } from "../adset-suggestions.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  BudgetScheduleSettings,
  InterestGroup,
  LocationTargetingGroup,
} from "../../types.ts";

function interest(name: string): InterestGroup {
  return {
    id: "ig-stream",
    name,
    interests: [{ id: "6003108826384", name: "House music", source: "search" }],
  };
}

function audiences(groupName: string): AudienceSettings {
  return {
    pageGroups: [],
    customAudienceGroups: [],
    savedAudiences: { audienceIds: [] },
    interestGroups: [interest(groupName)],
    selectedPagesLookalikeGroups: [],
  };
}

function row(overrides: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "as-stream",
    name: "Media & Entertainment",
    sourceType: "interest_group",
    sourceId: "ig-stream",
    sourceName: "Media & Entertainment (6 interests)",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 20,
    advantagePlus: false,
    enabled: true,
    ...overrides,
  };
}

const schedule = {
  budgetLevel: "ad_set",
  budgetType: "daily",
  budgetAmount: 20,
  currency: "GBP",
  startDate: "2026-10-01T00:00",
  endDate: "2026-10-08T23:59",
  timezone: "Europe/London",
} as BudgetScheduleSettings;

function city(id: string, label: string): LocationTargetingGroup {
  return {
    id,
    label,
    source: "manual",
    selections: [
      {
        id: `sel_${id}`,
        source: "search",
        label,
        mode: "include",
        locationType: "city",
        locationKey: id,
        countryCode: "GB",
      },
    ],
  };
}

const BRISTOL = city("grp_bristol", "Bristol");
const LONDON = city("grp_london", "London");

function payloadName(adSet: AdSetSuggestion, groupName = "Innellea"): string {
  return buildAdSetPayload(
    adSet,
    "camp_1",
    audiences(groupName),
    { ...schedule, locationGroups: [BRISTOL, LONDON] },
    "link_clicks",
    "traffic",
  ).name;
}

describe("launch name follows the group", () => {
  it("renamed group, non-operator row → payload name is the current group name; operator-renamed row → stored name", () => {
    const renamed = buildAdSetPayload(
      row(),
      "camp_1",
      audiences("Streaming"),
      schedule,
      "link_clicks",
      "traffic",
    );
    assert.equal(renamed.name, "Streaming");

    const typed = buildAdSetPayload(
      row({ name: "My house row", nameSource: "operator" }),
      "camp_1",
      audiences("Streaming"),
      schedule,
      "link_clicks",
      "traffic",
    );
    assert.equal(typed.name, "My house row");
  });

  it("split by city launches as the stored city name", () => {
    const source = row({
      name: "Innellea",
      locationGroupIds: [BRISTOL.id, LONDON.id],
      locationLabel: "Bristol · London",
    });
    const split = splitAdSetByLocation([source], source.id, [BRISTOL, LONDON]);
    const bristol = split.find((item) => item.name === "Innellea — Bristol");
    assert.ok(bristol);
    assert.equal(bristol.nameSource, "operator");
    assert.equal(payloadName(bristol), "Innellea — Bristol");
  });

  it("single-city row launches as the stored city name", () => {
    const picked = setAdSetLocations(
      row({
        name: "Innellea — Primary",
        locationTier: "primary",
        locationLabel: "London",
        locationGroupIds: [LONDON.id, BRISTOL.id],
      }),
      [BRISTOL.id],
      [BRISTOL, LONDON],
    );
    assert.equal(picked.name, "Innellea — Bristol");
    assert.equal(picked.nameSource, "operator");
    assert.equal(payloadName(picked), "Innellea — Bristol");

    const existing = row({
      name: "Innellea — Bristol",
      locationLabel: "Bristol",
      locationGroupIds: [BRISTOL.id],
    });
    assert.equal(payloadName(existing), "Innellea — Bristol");
    assert.equal(payloadName(existing, "Innellea 2"), "Innellea 2 — Bristol");
  });
});
