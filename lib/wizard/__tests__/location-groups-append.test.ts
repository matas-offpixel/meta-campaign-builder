import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { CampaignDraft, LocationTargetingGroup } from "../../types.ts";
import { commitAccountSwitch } from "../account-switch.ts";
import {
  applyBudgetScheduleUpdate,
  mapLocationGroups,
  patchBudgetSchedule,
} from "../budget-schedule-update.ts";
import { applyEventEndToDraft } from "../event-end-date.ts";

const AE: LocationTargetingGroup = {
  id: "country:AE",
  label: "AE",
  source: "manual",
  selections: [{
    id: "country:AE",
    source: "search",
    label: "AE",
    mode: "include",
    locationType: "country",
    countryCode: "AE",
  }],
};

const US: LocationTargetingGroup = {
  id: "country:US",
  label: "US",
  source: "manual",
  selections: [{
    id: "country:US",
    source: "search",
    label: "US",
    mode: "include",
    locationType: "country",
    countryCode: "US",
  }],
};

/** The group addFromSearch wrote on the DHB → Innellea draft at 2026-10-06T15:35:25.968Z. */
const NEW_YORK: LocationTargetingGroup = {
  id: "manual_1791300925968",
  label: "New York, New York, United States (+40 km)",
  source: "manual",
  selections: [{
    id: "city_2490299_include_1791300925968",
    source: "search",
    label: "New York, New York, United States",
    mode: "include",
    locationType: "city",
    locationKey: "2490299",
    radius: 40,
    distanceUnit: "kilometer",
    countryCode: "US",
  }],
};

const OPERATOR: LocationTargetingGroup = {
  id: "manual_111",
  label: "Operator city",
  source: "manual",
  selections: [{
    id: "city_1_include_111",
    source: "search",
    label: "Operator city",
    mode: "include",
    locationType: "city",
    locationKey: "1",
    countryCode: "GB",
  }],
};

function dhbDraft(groups: LocationTargetingGroup[]): CampaignDraft {
  const draft = createDefaultDraft();
  draft.settings.adAccountId = "act_968594768066330";
  draft.settings.metaAdAccountId = "act_968594768066330";
  draft.settings.campaignName = "[I26-NYC] Registration";
  draft.budgetSchedule.budgetAmount = 375;
  draft.budgetSchedule.endDate = "";
  draft.budgetSchedule.locationGroups = groups;
  draft.audiences.customAudienceGroups = [{
    id: "custom:1",
    name: "Buyers",
    audienceIds: ["1234567890123"],
    audienceNames: { "1234567890123": "Buyers" },
  }];
  return draft;
}

/** Search add, as the picker does: append the new group onto the schedule at flush time. */
function addSearchedCity(draft: CampaignDraft): CampaignDraft {
  return applyBudgetScheduleUpdate(draft, (prev) =>
    mapLocationGroups(prev, (groups) => [...groups, NEW_YORK]),
  );
}

function eventSync(draft: CampaignDraft): CampaignDraft {
  return applyEventEndToDraft(draft, {
    previousEventDate: null,
    nextEventDate: "2026-11-07",
  });
}

function accountSwitch(draft: CampaignDraft): CampaignDraft {
  return commitAccountSwitch(draft, "act_713771672906815", "confirm", {
    nextAccountName: "Innellea",
  });
}

function ids(draft: CampaignDraft): string[] {
  return (draft.budgetSchedule.locationGroups ?? []).map((group) => group.id);
}

describe("location group adds append", () => {
  it("adding a searched city appends, and an event sync plus account switch in the same flush keep all three", () => {
    const draft = dhbDraft([AE, US]);
    const added = addSearchedCity(draft);
    assert.deepEqual(ids(added), ["country:AE", "country:US", "manual_1791300925968"]);
    assert.equal(added.budgetSchedule.budgetAmount, 375);

    const steps = [addSearchedCity, eventSync, accountSwitch];
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const order of orders) {
      const next = order.reduce((state, index) => steps[index]!(state), draft);
      assert.deepEqual(ids(next), ["country:AE", "country:US", "manual_1791300925968"]);
      assert.equal(next.budgetSchedule.endDate, "2026-11-07T23:59");
      assert.equal(next.budgetSchedule.endDateSource, "event");
      assert.equal(next.settings.metaAdAccountId, "act_713771672906815");
      assert.equal(next.budgetSchedule.budgetAmount, 375);
    }

    const withOperator = dhbDraft([OPERATOR, AE]);
    const kept = [addSearchedCity, eventSync, accountSwitch].reduce(
      (state, step) => step(state),
      withOperator,
    );
    assert.deepEqual(ids(kept), ["manual_111", "country:AE", "manual_1791300925968"]);

    const patched = applyBudgetScheduleUpdate(added, (prev) =>
      patchBudgetSchedule(prev, { endDate: "2026-11-01T18:00", endDateSource: "operator" }),
    );
    assert.deepEqual(ids(patched), ["country:AE", "country:US", "manual_1791300925968"]);
    assert.equal(patched.budgetSchedule.endDate, "2026-11-01T18:00");
  });
});
