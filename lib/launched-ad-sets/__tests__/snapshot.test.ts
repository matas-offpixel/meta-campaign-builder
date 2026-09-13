import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdSetSuggestion, AudienceSettings } from "../../types.ts";
import {
  interestIdsFromGroup,
  phaseAtLaunchFromEvent,
  snapshotAudienceDescriptor,
} from "../snapshot.ts";

function suggestion(partial: Partial<AdSetSuggestion> = {}): AdSetSuggestion {
  return {
    id: "sug-1",
    name: "Interest — UK 18-34",
    sourceType: "interest_group",
    sourceId: "ig-1",
    sourceName: "House cluster",
    ageMin: 18,
    ageMax: 34,
    budgetPerDay: 25.5,
    advantagePlus: false,
    enabled: true,
    ...partial,
  };
}

describe("snapshotAudienceDescriptor", () => {
  it("resolves InterestGroup ids at launch, including replacements", () => {
    const audiences: AudienceSettings = {
      ...createDefaultDraft().audiences,
      interestGroups: [
        {
          id: "ig-1",
          name: "House cluster",
          interests: [
            { id: "6001", name: "House" },
            { id: "6002", name: "Old", replacement: { id: "6009", name: "New" } },
          ],
        },
      ],
    };
    const snap = snapshotAudienceDescriptor(suggestion(), audiences);
    assert.deepEqual(snap.interestIds, ["6001", "6009"]);
    assert.equal(snap.initialDailyBudgetPence, 2550);
    assert.equal(snap.suggestionId, "sug-1");
    assert.equal(snap.sourceType, "interest_group");
  });

  it("does not invent interest ids when the group is gone from the draft", () => {
    const snap = snapshotAudienceDescriptor(suggestion(), createDefaultDraft().audiences);
    assert.deepEqual(snap.interestIds, []);
  });
});

describe("interestIdsFromGroup", () => {
  it("skips empty ids", () => {
    assert.deepEqual(
      interestIdsFromGroup({
        id: "g",
        name: "g",
        interests: [{ id: "", name: "x" }, { id: "1", name: "y" }],
      }),
      ["1"],
    );
  });
});

describe("phaseAtLaunchFromEvent", () => {
  it("uses deriveCampaignPlanPhase — presale when start is in the presale span", () => {
    assert.equal(
      phaseAtLaunchFromEvent({
        launchedAt: new Date("2026-08-10T12:00:00.000Z"),
        presaleAt: "2026-08-06T09:00:00.000Z",
        generalSaleAt: "2026-08-20T09:00:00.000Z",
        soldOutAt: null,
      }),
      "presale",
    );
  });

  it("is null when sale dates cannot derive a phase — never defaults to on_sale", () => {
    assert.equal(
      phaseAtLaunchFromEvent({
        launchedAt: new Date("2026-08-10T12:00:00.000Z"),
        presaleAt: null,
        generalSaleAt: null,
        soldOutAt: null,
      }),
      null,
    );
  });
});
