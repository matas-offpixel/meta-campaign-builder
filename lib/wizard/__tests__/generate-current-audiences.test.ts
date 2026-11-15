import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { validateStep } from "../../validation.ts";
import { customAudienceUnavailableSubtitle } from "../account-switch.ts";
import {
  AUDIENCE_REMOVED_SUBTITLE,
  adSetAudienceRemoved,
  adSetDisplaySubtitle,
  skippedAudienceReviewLine,
} from "../import-edits.ts";
import type {
  AdSetSuggestion,
  AudienceSettings,
  LocationTargetingGroup,
  PageAudienceGroup,
} from "../../types.ts";

const PAGE_ID = "821c71d8-8fa0-486c-8a15-1ca3d17f7109";
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

function interest(id: string) {
  return {
    id,
    name: id,
    interests: [{ id: "6003108826384", name: "House music", source: "search" as const }],
  };
}

function pageGroup(): PageAudienceGroup {
  return {
    id: PAGE_ID,
    name: "Innellea ",
    pageIds: ["848347421890620"],
    engagementTypes: ["fb_likes", "fb_engagement_365d", "ig_followers", "ig_engagement_365d"],
    lookalike: false,
    lookalikeRanges: ["0-1%"],
    customAudienceIds: [],
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
    budgetPerDay: 10,
    advantagePlus: false,
    enabled: true,
    locationGroupIds: ["country:AE"],
    importedFromAdSetId: "120249960813980453",
    ...overrides,
  };
}

function audiencesFor(interestIds: string[]): AudienceSettings {
  return {
    pageGroups: [pageGroup()],
    customAudienceGroups: [],
    savedAudiences: { audienceIds: [] },
    interestGroups: interestIds.map(interest),
    selectedPagesLookalikeGroups: [],
  };
}

describe("Generate reflects the audiences on the draft", () => {
  it("a stale row before Generate is disabled with the audience removed subtitle, is not a validateStep error, and is counted on Review", () => {
    const draft = createDefaultDraft();
    draft.budgetSchedule.budgetAmount = 40;
    draft.budgetSchedule.startDate = "2026-10-06T00:00";
    draft.budgetSchedule.endDate = "2026-11-07T23:59";
    draft.budgetSchedule.locationGroups = [FALLBACK];
    draft.audiences = audiencesFor(["ig1"]);
    const stale = row({
      id: "stale",
      name: "DHB Primary",
      sourceType: "custom_group",
      sourceId: "custom:gone",
      sourceName: "DHB Primary",
      enabled: true,
      locationGroupIds: [],
    });
    const live = row({
      id: "live",
      name: "House",
      sourceType: "interest_group",
      sourceId: "ig1",
      sourceName: "House",
      enabled: true,
      locationGroupIds: [FALLBACK.id],
      importedFromAdSetId: "120249957296280453",
    });
    draft.adSetSuggestions = [stale, live];

    assert.equal(adSetAudienceRemoved(stale, draft.audiences), true);
    assert.equal(adSetAudienceRemoved(live, draft.audiences), false);
    assert.equal(adSetDisplaySubtitle(stale, draft.audiences), AUDIENCE_REMOVED_SUBTITLE);
    assert.equal(AUDIENCE_REMOVED_SUBTITLE, "audience removed");

    const step = validateStep(5, draft);
    assert.equal(step.errors.some((error) => error.includes("DHB Primary")), false);
    assert.equal(step.errors.some((error) => error.includes("has no locations")), false);
    const review = validateStep(7, draft);
    assert.equal(review.errors.some((error) => error.includes("DHB Primary")), false);
    assert.equal(skippedAudienceReviewLine(1), "1 ad set skipped — audience no longer on draft");

    const switched = row({
      ...stale,
      id: "ca-only",
      sourceId: "ig1",
      sourceType: "custom_group",
      enabled: false,
      sourceName: customAudienceUnavailableSubtitle("act_968594768066330", "Innellea"),
    });
    draft.audiences.customAudienceGroups = [{
      id: "ig1",
      name: "Buyers",
      audienceIds: ["120000000000004"],
      audienceNames: { "120000000000004": "Buyers" },
    }];
    assert.equal(adSetAudienceRemoved(switched, draft.audiences), true);

    const ui = readFileSync(join(HERE, "../../../components/steps/budget-schedule.tsx"), "utf8");
    assert.match(ui, /disabled=\{audienceRemoved\}/);
    assert.match(ui, /adSetDisplaySubtitle\(s, audiences\)/);
    const reviewUi = readFileSync(join(HERE, "../../../components/steps/review-launch.tsx"), "utf8");
    assert.match(reviewUi, /skippedAudienceReviewLine\(skipped\)/);
  });
});
