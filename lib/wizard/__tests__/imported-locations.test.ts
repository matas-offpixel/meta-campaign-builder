import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyEventToCampaignSettings, buildDuplicatedCampaign } from "../../campaign-event.ts";
import { createDefaultDraft } from "../../campaign-defaults.ts";
import { migrateDraft } from "../../autosave.ts";
import { groupToGeo } from "../../meta/location-targeting.ts";
import type { MetaImportMeta } from "../../meta/import/types.ts";
import { validateStep } from "../../validation.ts";
import { applyEventEndDate } from "../event-end-date.ts";
import { generateSuggestions } from "../generate-adset-suggestions.ts";
import { commitAccountSwitch } from "../account-switch.ts";
import type {
  AdSetSuggestion,
  CampaignDraft,
  InterestGroup,
  LocationTargetingGroup,
  PageAudienceGroup,
} from "../../types.ts";

const FALLBACK: LocationTargetingGroup = {
  id: "preset_gb_nationwide",
  label: "UK (nationwide)",
  source: "preset",
  selections: [{
    id: "gb_nationwide_include",
    source: "preset",
    label: "United Kingdom",
    mode: "include",
    locationType: "country",
    countryCode: "GB",
  }],
};

const PAGE_ID = "821c71d8-8fa0-486c-8a15-1ca3d17f7109";

function row(overrides: Partial<AdSetSuggestion>): AdSetSuggestion {
  return {
    id: "as1",
    name: "Wide",
    sourceType: "blank",
    sourceId: "",
    sourceName: "Wide",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    locationGroupIds: ["country:AE"],
    importedFromAdSetId: "120249960813980453",
    ...overrides,
  };
}

function importMeta(dropped: MetaImportMeta["dropped"] = []): MetaImportMeta {
  return {
    sourceCampaignId: "120249957285130453",
    sourceCampaignName: "[DHB26-DUBAI] Traffic",
    sourceAdAccountId: "act_968594768066330",
    dropped,
    notCarried: [],
    creativeCounts: { read: 1, carried: 1, notCarried: 0 },
    flexibleSpec: {},
    appUsageCallCount: null,
  };
}

function interest(id: string): InterestGroup {
  return {
    id,
    name: id,
    interests: [{ id: "6003108826384", name: "House music", source: "search" }],
  };
}

describe("Generate rebuilds from the current audiences", () => {
  it("includes an uncreated page group and drops the imported rows", () => {
    const interestIds = ["ig1", "ig2", "ig3", "ig4", "ig5", "ig6"];
    const imported = [
      ...interestIds.map((id, i) =>
        row({
          id: `imp_ig_${i}`,
          name: `Interest ${i}`,
          sourceType: "interest_group",
          sourceId: id,
          importedFromAdSetId: `12024995729${i}`,
          locationGroupIds: ["country:AE"],
        }),
      ),
      ...Array.from({ length: 16 }, (_, i) =>
        row({
          id: `imp_blank_${i}`,
          name: `Wide ${i}`,
          importedFromAdSetId: `1202499608${i}`,
          locationGroupIds: i % 2 === 0 ? ["country:AE"] : ["country:US"],
        }),
      ),
    ];
    assert.equal(imported.length, 22);

    const page: PageAudienceGroup = {
      id: PAGE_ID,
      name: "Innellea ",
      pageIds: ["848347421890620"],
      engagementTypes: ["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"],
      lookalike: false,
      lookalikeRanges: ["0-1%"],
      customAudienceIds: [],
    };
    const draft = createDefaultDraft();
    draft.audiences.pageGroups = [page];
    draft.audiences.interestGroups = interestIds.map(interest);
    draft.adSetSuggestions = imported;

    const generated = generateSuggestions(draft.audiences, 100, [], FALLBACK);
    const pageRow = generated.find((adSet) => adSet.id === `as_pg_${PAGE_ID}`);
    assert.ok(pageRow);
    assert.equal(pageRow.enabled, true);
    assert.deepEqual(pageRow.geoLocations, groupToGeo(FALLBACK));
    assert.equal(generated.filter((adSet) => adSet.sourceType === "interest_group").length, 6);
    assert.equal(generated.some((adSet) => adSet.importedFromAdSetId), false);
    assert.equal(generated.some((adSet) => imported.some((row) => row.id === adSet.id)), false);
  });
});

function locatedDraft(): CampaignDraft {
  const draft = createDefaultDraft();
  draft.settings.adAccountId = "act_968594768066330";
  draft.settings.metaAdAccountId = "act_968594768066330";
  draft.settings.campaignName = "[DHB26-DUBAI] Traffic";
  draft.importMeta = importMeta();
  draft.budgetSchedule.locationGroups = [
    {
      id: "country:AE",
      label: "AE",
      source: "manual",
      selections: [{ id: "country:AE", source: "search", label: "AE", mode: "include", locationType: "country", countryCode: "AE" }],
    },
    {
      id: "country:US",
      label: "US",
      source: "manual",
      selections: [{ id: "country:US", source: "search", label: "US", mode: "include", locationType: "country", countryCode: "US" }],
    },
  ];
  draft.audiences.customAudienceGroups = [{
    id: "custom:1",
    name: "Buyers",
    audienceIds: ["1234567890123"],
    audienceNames: { "1234567890123": "Buyers" },
  }];
  draft.adSetSuggestions = [
    row({ id: "120249960783160453", name: "DHB Primary – USA", sourceType: "custom_group", sourceId: "custom:1", locationGroupIds: ["country:US"] }),
    row({ id: "120249960813980453", name: "Wide – V2", locationGroupIds: ["country:AE"] }),
  ];
  return draft;
}

function noLocationErrors(draft: CampaignDraft): string[] {
  return validateStep(5, draft).errors.filter((error) => error.includes("has no locations"));
}

describe("imported locations survive later edits", () => {
  it("commitAccountSwitch keeps every imported row's locations resolving", () => {
    const next = commitAccountSwitch(locatedDraft(), "act_713771672906815", "confirm", {
      nextAccountName: "Innellea",
    });
    assert.deepEqual(
      next.budgetSchedule.locationGroups?.map((group) => group.id),
      ["country:AE", "country:US"],
    );
    assert.deepEqual(next.adSetSuggestions.map((adSet) => adSet.locationGroupIds), [
      ["country:US"],
      ["country:AE"],
    ]);
    assert.deepEqual(noLocationErrors(next), []);
  });

  it("an event change keeps the imported location groups", () => {
    const draft = locatedDraft();
    draft.budgetSchedule.endDate = "";
    draft.budgetSchedule.endDateSource = undefined;
    const duplicated = buildDuplicatedCampaign(
      draft,
      { id: "evt-nyc", event_code: "I26-NYC", name: "Registration", venue_city: "New York", event_date: "2026-11-01" },
      "2026-10-06T15:00:00.000Z",
      "copy-1",
    );
    const synced = applyEventEndDate({
      endDate: duplicated.budgetSchedule.endDate,
      endDateSource: duplicated.budgetSchedule.endDateSource,
      previousEventDate: null,
      nextEventDate: "2026-11-01",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    const next: CampaignDraft = {
      ...duplicated,
      settings: applyEventToCampaignSettings(duplicated.settings, {
        id: "evt-nyc",
        event_code: "I26-NYC",
        event_date: "2026-11-01",
      }),
      budgetSchedule: {
        ...duplicated.budgetSchedule,
        endDate: synced.endDate,
        ...(synced.endDateSource ? { endDateSource: synced.endDateSource } : {}),
      },
    };
    assert.deepEqual(next.budgetSchedule.locationGroups?.map((group) => group.id), ["country:AE", "country:US"]);
    assert.deepEqual(next.adSetSuggestions.map((adSet) => adSet.locationGroupIds), [
      ["country:US"],
      ["country:AE"],
    ]);
    assert.deepEqual(noLocationErrors(next), []);
  });

  it("migrateDraft puts back groups an imported row still names, and dropped country groups", () => {
    const draft = createDefaultDraft();
    draft.budgetSchedule.locationGroups = [{
      id: "manual_1791300925968",
      label: "New York, New York, United States (+40 km)",
      source: "manual",
      selections: [{
        id: "city_2490299_include",
        source: "search",
        label: "New York, New York, United States",
        mode: "include",
        locationType: "city",
        locationKey: "2490299",
        radius: 40,
        distanceUnit: "kilometer",
        countryCode: "US",
      }],
    }];
    draft.importMeta = importMeta([
      { field: "country_groups", adSetId: "eu-1", adSetName: "DHB Primary – EU", value: ["europe"] },
      { field: "location_types", adSetId: "eu-1", value: ["home", "recent"] },
    ]);
    draft.adSetSuggestions = [
      row({ id: "us-1", name: "Wide – USA", locationGroupIds: ["country:US"] }),
      row({ id: "ae-1", name: "Wide – V2", locationGroupIds: ["country:AE"] }),
      row({ id: "eu-1", name: "DHB Primary – EU", locationGroupIds: [] }),
      row({
        id: "blank-new",
        name: "Blank",
        sourceType: "blank",
        sourceId: "",
        importedFromAdSetId: undefined,
        locationGroupIds: [],
      }),
    ];

    const loaded = migrateDraft(JSON.parse(JSON.stringify(draft)));
    assert.deepEqual(loaded.budgetSchedule.locationGroups?.map((group) => group.id), [
      "manual_1791300925968",
      "country:US",
      "country:AE",
      "country_group:europe",
    ]);
    assert.deepEqual(loaded.adSetSuggestions.find((adSet) => adSet.id === "eu-1")?.locationGroupIds, [
      "country_group:europe",
    ]);
    const errors = noLocationErrors(loaded);
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /Blank/);

    const cleared = JSON.parse(JSON.stringify(loaded)) as CampaignDraft;
    const eu = cleared.adSetSuggestions.find((adSet) => adSet.id === "eu-1")!;
    eu.locationGroupIds = [];
    const again = migrateDraft(JSON.parse(JSON.stringify(cleared)));
    assert.deepEqual(again.adSetSuggestions.find((adSet) => adSet.id === "eu-1")?.locationGroupIds, []);
  });
});
