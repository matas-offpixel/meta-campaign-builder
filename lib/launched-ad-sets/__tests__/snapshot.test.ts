import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdSetSuggestion, AudienceSettings, CampaignObjective } from "../../types.ts";
import {
  effectiveAdvantagePlus,
  interestIdsFromGroup,
  phaseAtLaunchFromEvent,
  phaseAtLaunchFromObjective,
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

  it("a missing interest group is null, not an empty list", () => {
    const snap = snapshotAudienceDescriptor(suggestion(), createDefaultDraft().audiences);
    assert.equal(snap.interestIds, null);
  });

  it("a found empty interest group is []", () => {
    const audiences: AudienceSettings = {
      ...createDefaultDraft().audiences,
      interestGroups: [{ id: "ig-1", name: "Empty", interests: [] }],
    };
    const snap = snapshotAudienceDescriptor(suggestion(), audiences);
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

describe("effectiveAdvantagePlus", () => {
  it("a 1870196 salvage is what Meta accepted, not what the draft asked", () => {
    assert.equal(effectiveAdvantagePlus(true, "strict"), false);
    assert.equal(effectiveAdvantagePlus(true, undefined), true);
    assert.equal(effectiveAdvantagePlus(false, undefined), false);
  });
});

describe("phaseAtLaunchFromObjective", () => {
  it("registration (Complete Registration) → presale", () => {
    assert.equal(phaseAtLaunchFromObjective("registration"), "presale");
  });

  it("every other CampaignObjective → on_sale", () => {
    const others: CampaignObjective[] = ["purchase", "initiate_checkout", "traffic", "awareness", "engagement"];
    for (const objective of others) assert.equal(phaseAtLaunchFromObjective(objective), "on_sale", objective);
  });

  it("maps every CampaignObjective (a new objective fails to compile here)", () => {
    const all: Record<CampaignObjective, true> = {
      purchase: true,
      initiate_checkout: true,
      registration: true,
      traffic: true,
      awareness: true,
      engagement: true,
    };
    for (const objective of Object.keys(all)) assert.notEqual(phaseAtLaunchFromObjective(objective), null, objective);
  });

  it("missing or unknown objective → null, never a guess", () => {
    assert.equal(phaseAtLaunchFromObjective(null), null);
    assert.equal(phaseAtLaunchFromObjective(undefined), null);
    assert.equal(phaseAtLaunchFromObjective(""), null);
    assert.equal(phaseAtLaunchFromObjective("OUTCOME_LEADS"), null);
    assert.equal(phaseAtLaunchFromObjective("lead"), null);
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
