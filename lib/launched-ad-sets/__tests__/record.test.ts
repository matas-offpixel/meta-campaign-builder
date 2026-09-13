import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AdSetSuggestion } from "../../types.ts";
import { launchedAdSetPayload, recordLaunchedAdSet } from "../record.ts";

const suggestion: AdSetSuggestion = {
  id: "sug-1",
  name: "Prospecting",
  sourceType: "blank",
  sourceId: "",
  sourceName: "Blank",
  ageMin: 18,
  ageMax: 65,
  budgetPerDay: 12,
  advantagePlus: true,
  enabled: true,
};

describe("recordLaunchedAdSet", () => {
  it("does not throw when supabase rejects", async () => {
    const supabase = {
      from() {
        return {
          upsert: async () => {
            throw new Error("jwt expired");
          },
        };
      },
    };
    await assert.doesNotReject(() =>
      recordLaunchedAdSet(supabase as never, {
        metaAdsetId: "120399",
        metaCampaignId: "camp",
        adAccountId: "act_1",
        draftId: "draft",
        userId: "user",
        clientId: null,
        eventId: null,
        launchRunId: "11111111-1111-4111-8111-111111111111",
        objective: "registration",
        phaseAtLaunch: null,
        descriptorSource: "launch",
        suggestion,
        audiences: null,
      }),
    );
  });

  it("does not throw when meta_adset_id is empty", async () => {
    await assert.doesNotReject(() =>
      recordLaunchedAdSet({} as never, {
        metaAdsetId: "  ",
        metaCampaignId: null,
        adAccountId: null,
        draftId: null,
        userId: null,
        clientId: null,
        eventId: null,
        launchRunId: "run",
        objective: null,
        phaseAtLaunch: null,
        descriptorSource: "launch",
        suggestion,
        audiences: null,
      }),
    );
  });
});

describe("launchedAdSetPayload", () => {
  it("upserts on meta_adset_id and marks a launch snapshot", () => {
    const row = launchedAdSetPayload({
      metaAdsetId: "120399",
      metaCampaignId: "camp",
      adAccountId: "act_1",
      draftId: "draft",
      userId: "user",
      clientId: null,
      eventId: "evt",
      launchRunId: "run-1",
      objective: "registration",
      phaseAtLaunch: "on_sale",
      descriptorSource: "launch",
      suggestion,
      audiences: null,
    });
    assert.equal(row.meta_adset_id, "120399");
    assert.equal(row.launch_run_id, "run-1");
    assert.equal(row.descriptor_source, "launch");
    assert.equal(row.channel, "meta");
    assert.equal(row.initial_daily_budget_pence, 1200);
    assert.equal(row.advantage_plus, true);
    assert.equal(row.advantage_plus_effective, true);
    assert.equal(row.launch_note, null);
    assert.doesNotMatch(JSON.stringify(row), /suggested audience/i);
  });

  it("a 1870196 salvage stores effective Advantage+ off and names the salvage", () => {
    const row = launchedAdSetPayload({
      metaAdsetId: "120399",
      metaCampaignId: "camp",
      adAccountId: "act_1",
      draftId: "draft",
      userId: "user",
      clientId: null,
      eventId: "evt",
      launchRunId: "run-1",
      objective: "registration",
      phaseAtLaunch: "on_sale",
      descriptorSource: "launch",
      suggestion,
      audiences: null,
      ageModeOverride: "strict",
      launchNote: "1870196 salvage stripped Advantage+ Audience",
      droppedNote: "dropped 1 custom audience at preflight",
    });
    assert.equal(row.advantage_plus, true);
    assert.equal(row.advantage_plus_effective, false);
    assert.equal(
      row.launch_note,
      "dropped 1 custom audience at preflight · 1870196 salvage stripped Advantage+ Audience",
    );
  });
});
