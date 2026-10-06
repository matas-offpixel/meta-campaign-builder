/**
 * Launch sends the same name Step 5 shows.
 *
 * Run: node --test lib/wizard/__tests__/launch-display-name.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAdSetPayload } from "../../meta/adset.ts";
import type { AdSetSuggestion, AudienceSettings, BudgetScheduleSettings, InterestGroup } from "../../types.ts";

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
});
