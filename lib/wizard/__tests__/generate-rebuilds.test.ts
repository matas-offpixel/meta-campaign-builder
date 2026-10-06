import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { generateSuggestions } from "../generate-adset-suggestions.ts";
import {
  adSetDisplayName,
  adSetDisplaySubtitle,
  generateNeedsImportedConfirm,
  generateRebuiltNotice,
  generateReplaceImportedConfirm,
  withLifetimeAdSetBudgets,
} from "../import-edits.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  CustomAudienceGroup,
  InterestGroup,
  LocationTargetingGroup,
  PageAudienceGroup,
} from "../../types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const FALLBACK: LocationTargetingGroup = {
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

function pageGroup(): PageAudienceGroup {
  return {
    id: "pg-innellea",
    name: "Innellea",
    pageIds: ["848347421890620"],
    engagementTypes: ["fb_likes"],
    lookalike: false,
    lookalikeRanges: [],
    customAudienceIds: [],
  };
}

function buyers(): CustomAudienceGroup {
  return {
    id: "cg-buyers",
    name: "Buyers",
    audienceIds: ["120000000000004"],
    lookalike: true,
    lookalikeRanges: ["0-1%", "1-2%"],
  };
}

function audiences(): AudienceSettings {
  return {
    pageGroups: [pageGroup()],
    customAudienceGroups: [buyers()],
    savedAudiences: { audienceIds: [] },
    interestGroups: [interest("ig-stream", "Streaming"), interest("ig-contemp", "Contemporary")],
    selectedPagesLookalikeGroups: [],
  };
}

function row(overrides: Partial<AdSetSuggestion>): AdSetSuggestion {
  return {
    id: "as1",
    name: "Wide",
    sourceType: "blank",
    sourceId: "",
    sourceName: "Wide",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 5,
    advantagePlus: false,
    enabled: true,
    locationGroupIds: ["country:AE"],
    importedFromAdSetId: "120249960813980453",
    ...overrides,
  };
}

function importedRows(): AdSetSuggestion[] {
  return [
    row({
      id: "imp-stream",
      name: "Media & Entertainment",
      sourceType: "interest_group",
      sourceId: "ig-stream",
      sourceName: "Media & Entertainment (6 interests)",
      importedFromAdSetId: "120249957291",
      budgetPerDay: 5,
      locationGroupIds: ["country:AE"],
    }),
    row({
      id: "imp-house",
      name: "House Music Interests",
      sourceType: "interest_group",
      sourceId: "ig-contemp",
      sourceName: "House Music Interests (4 interests)",
      importedFromAdSetId: "120249957292",
      budgetPerDay: 5,
      locationGroupIds: ["country:AE"],
    }),
    row({
      id: "imp-wide",
      name: "Wide",
      sourceType: "blank",
      sourceId: "",
      importedFromAdSetId: "120249960813980453",
    }),
  ];
}

describe("Generate rebuilds Step 5 from the current audiences", () => {
  it("Imported draft, groups renamed → Generate: rows named from current group names, imported rows gone, count = groups + lookalike ranges; undo restores the imported list byte-identical", () => {
    const current = audiences();
    const imported = importedRows();
    const previous = imported;
    const next = generateSuggestions(current, 375, [], FALLBACK);

    const groups =
      current.pageGroups.length +
      current.customAudienceGroups.length +
      current.interestGroups.length +
      current.savedAudiences.audienceIds.length;
    const ranges = current.customAudienceGroups.reduce(
      (count, group) => count + (group.lookalike && group.lookalikeRanges ? group.lookalikeRanges.length : 0),
      0,
    );
    assert.equal(next.length, groups + ranges);
    assert.deepEqual(
      next.map((adSet) => adSet.name),
      [
        "Innellea",
        "Buyers",
        "Buyers — 1% Lookalike",
        "Buyers — 2% Lookalike",
        "Streaming",
        "Contemporary",
      ],
    );
    assert.equal(next.some((adSet) => adSet.importedFromAdSetId), false);
    assert.equal(next.some((adSet) => adSet.name === "Media & Entertainment"), false);
    assert.equal(next.some((adSet) => adSet.name === "Wide"), false);

    const restored = previous;
    assert.equal(restored, imported);
    assert.deepEqual(restored, imported);
    assert.equal(restored[0], imported[0]);
    assert.equal(restored[0]!.budgetPerDay, 5);
    assert.deepEqual(restored[0]!.locationGroupIds, ["country:AE"]);

    const ui = readFileSync(join(HERE, "../../../components/steps/budget-schedule.tsx"), "utf8");
    assert.match(ui, /applyWithUndo\(generateRebuiltNotice\(next\.length, adSetSuggestions\.length\), next\)/);
    assert.match(ui, /onSuggestionsChange\(undoState\.previous\)/);
    assert.equal(
      generateRebuiltNotice(next.length, imported.length),
      "Generate rebuilt 6 ad sets from the current audiences. Undo to restore the previous 3.",
    );
  });

  it("Generate twice → same result, second click no confirm", () => {
    const current = audiences();
    const imported = importedRows();
    const first = generateSuggestions(current, 375, [], FALLBACK);
    const second = generateSuggestions(current, 375, [], FALLBACK);
    assert.deepEqual(second, first);

    assert.equal(generateNeedsImportedConfirm(imported, false), true);
    assert.equal(generateNeedsImportedConfirm(imported, true), false);
    assert.equal(generateNeedsImportedConfirm(first, false), false);
    assert.equal(
      generateReplaceImportedConfirm(10),
      "Generate replaces the 10 imported ad sets with rows built from the current audiences. Undo is available for 5 seconds.",
    );

    const ui = readFileSync(join(HERE, "../../../components/steps/budget-schedule.tsx"), "utf8");
    assert.match(ui, /generateNeedsImportedConfirm\(adSetSuggestions, generateReplaceImportedConfirmed\)/);
    assert.match(ui, /window\.confirm\(generateReplaceImportedConfirm\(importedCount\)\)/);
    assert.doesNotMatch(ui, /mergeGeneratedWithImported/);
    const hook = readFileSync(join(HERE, "../use-campaign-draft.ts"), "utf8");
    assert.match(hook, /generateReplaceImportedConfirmed: true/);
  });

  it("Row display name follows a group rename; operator-renamed row does not", () => {
    const current = audiences();
    const imported = importedRows()[0]!;
    assert.equal(imported.name, "Media & Entertainment");
    assert.equal(adSetDisplayName(imported, current), "Streaming");
    assert.equal(adSetDisplaySubtitle(imported, current), "Streaming (1 interests)");
    assert.equal(imported.name, "Media & Entertainment");

    const operator = { ...imported, name: "My house row", nameSource: "operator" as const };
    current.interestGroups[0] = interest("ig-stream", "Electronic Music");
    assert.equal(adSetDisplayName(operator, current), "My house row");
    assert.equal(adSetDisplaySubtitle(operator, current), "Electronic Music (1 interests)");
    assert.equal(operator.name, "My house row");

    const ui = readFileSync(join(HERE, "../../../components/steps/budget-schedule.tsx"), "utf8");
    assert.match(ui, /value=\{adSetDisplayName\(s, audiences\)\}/);
    assert.match(ui, /nameSource: "operator"/);
  });

  it("Lifetime draft → generated rows carry budgetLifetime, budgetPerDay 0", () => {
    const generated = generateSuggestions(audiences(), 90, [], FALLBACK);
    const next = withLifetimeAdSetBudgets(generated);
    assert.ok(next.length > 0);
    for (const row of next) {
      const source = generated.find((adSet) => adSet.id === row.id);
      assert.equal(row.budgetPerDay, 0);
      assert.equal(row.budgetLifetime, source?.budgetPerDay);
      assert.ok((row.budgetLifetime ?? 0) > 0);
    }
    const ui = readFileSync(join(HERE, "../../../components/steps/budget-schedule.tsx"), "utf8");
    assert.match(ui, /bs\.budgetType === "lifetime" \? withLifetimeAdSetBudgets\(generated\) : generated/);
  });
});
