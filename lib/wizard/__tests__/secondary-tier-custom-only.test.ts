/**
 * Secondary tier rows are for custom audiences. Interest audiences take
 * Primary only, or every location when Primary is not tagged.
 *
 * Run: node --test lib/wizard/__tests__/secondary-tier-custom-only.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withGroupTier } from "../../meta/location-targeting.ts";
import { generateSuggestions } from "../generate-adset-suggestions.ts";
import type {
  AudienceSettings,
  CustomAudienceGroup,
  InterestGroup,
  LocationTargetingGroup,
  PageAudienceGroup,
} from "../../types.ts";

function city(id: string, label: string, key: string): LocationTargetingGroup {
  return {
    id,
    label,
    source: "manual",
    selections: [{
      id: `sel_${id}`,
      source: "search",
      label,
      mode: "include",
      locationType: "city",
      locationKey: key,
      radius: 40,
      distanceUnit: "kilometer",
      countryCode: "GB",
    }],
  };
}

const BRISTOL = city("grp_bristol", "Bristol", "111");
const BATH = city("grp_bath", "Bath", "222");
const CARDIFF = city("grp_cardiff", "Cardiff", "333");

const UK: LocationTargetingGroup = {
  id: "preset_gb_nationwide",
  label: "UK (nationwide)",
  source: "preset",
  selections: [{
    id: "gb",
    source: "preset",
    label: "United Kingdom",
    mode: "include",
    locationType: "country",
    countryCode: "GB",
  }],
};

function interest(id: string, name: string): InterestGroup {
  return {
    id,
    name,
    interests: [{ id: "6003108826384", name: "House music", source: "search" }],
  };
}

function audiences(): AudienceSettings {
  const page: PageAudienceGroup = {
    id: "pg-innellea",
    name: "Innellea",
    pageIds: ["848347421890620"],
    engagementTypes: ["fb_likes"],
    lookalike: false,
    lookalikeRanges: [],
    customAudienceIds: [],
  };
  const custom: CustomAudienceGroup = {
    id: "cg-buyers",
    name: "Buyers",
    audienceIds: ["120000000000004"],
    lookalike: false,
    lookalikeRanges: [],
  };
  return {
    pageGroups: [page],
    customAudienceGroups: [custom],
    savedAudiences: { audienceIds: [] },
    interestGroups: [interest("ig-stream", "Streaming"), interest("ig-contemp", "Contemporary")],
    selectedPagesLookalikeGroups: [],
  };
}

function signature(rows: ReturnType<typeof generateSuggestions>) {
  return rows.map((row) => ({
    name: row.name,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    locationTier: row.locationTier,
    locationGroupIds: row.locationGroupIds,
  }));
}

describe("secondary tier is custom audiences only", () => {
  it("Bristol Primary + Bath Secondary: page and custom get two rows, each interest gets one Primary row (6 total)", () => {
    const groups = [withGroupTier(BRISTOL, "primary"), withGroupTier(BATH, "secondary")];
    const rows = generateSuggestions(audiences(), 100, groups, UK);
    assert.equal(rows.length, 6);
    assert.deepEqual(signature(rows), [
      { name: "Innellea — Primary", sourceType: "page_group", sourceId: "pg-innellea", locationTier: "primary", locationGroupIds: ["grp_bristol"] },
      { name: "Innellea — Secondary", sourceType: "page_group", sourceId: "pg-innellea", locationTier: "secondary", locationGroupIds: ["grp_bath"] },
      { name: "Buyers — Primary", sourceType: "custom_group", sourceId: "cg-buyers", locationTier: "primary", locationGroupIds: ["grp_bristol"] },
      { name: "Buyers — Secondary", sourceType: "custom_group", sourceId: "cg-buyers", locationTier: "secondary", locationGroupIds: ["grp_bath"] },
      { name: "Streaming — Primary", sourceType: "interest_group", sourceId: "ig-stream", locationTier: "primary", locationGroupIds: ["grp_bristol"] },
      { name: "Contemporary — Primary", sourceType: "interest_group", sourceId: "ig-contemp", locationTier: "primary", locationGroupIds: ["grp_bristol"] },
    ]);
  });

  it("only Secondary tagged: interest rows target all locations, custom rows target Secondary", () => {
    const groups = [CARDIFF, withGroupTier(BATH, "secondary")];
    const rows = generateSuggestions(audiences(), 100, groups, UK);
    const custom = rows.filter((row) => row.sourceType === "page_group" || row.sourceType === "custom_group");
    const interests = rows.filter((row) => row.sourceType === "interest_group");
    assert.equal(rows.length, 4);
    assert.ok(custom.every((row) => row.locationTier === "secondary"));
    assert.deepEqual(custom.map((row) => row.locationGroupIds), [
      ["grp_bath"],
      ["grp_bath"],
    ]);
    assert.equal(interests.length, 2);
    assert.ok(interests.every((row) => row.locationTier === undefined));
    assert.ok(interests.every((row) => JSON.stringify(row.locationGroupIds) === JSON.stringify(["grp_cardiff", "grp_bath"])));
    assert.ok(interests.every((row) => !row.name.endsWith("Secondary")));
  });

  it("no tiers: one row per audience, unchanged counts", () => {
    const groups = [BRISTOL, BATH];
    const rows = generateSuggestions(audiences(), 100, groups, UK);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((row) => row.sourceType), [
      "page_group",
      "custom_group",
      "interest_group",
      "interest_group",
    ]);
    assert.ok(rows.every((row) => row.locationTier === undefined));
    assert.ok(rows.every((row) => JSON.stringify(row.locationGroupIds) === JSON.stringify(["grp_bristol", "grp_bath"])));
  });
});
