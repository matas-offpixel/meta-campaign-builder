import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { AdSetSuggestion, CampaignDraft } from "../../types.ts";
import { planLaunchedAdSetBackfill } from "../backfill.ts";

function suggestion(id: string): AdSetSuggestion {
  return {
    id,
    name: `Set ${id}`,
    sourceType: "page_group",
    sourceId: "pg-1",
    sourceName: "Pages",
    ageMin: 18,
    ageMax: 65,
    budgetPerDay: 10,
    advantagePlus: true,
    enabled: true,
  };
}

function draftWithResults(
  results: CampaignDraft["launchSummary"],
  suggestions: AdSetSuggestion[],
): CampaignDraft {
  const draft = createDefaultDraft();
  draft.settings.eventId = "11111111-1111-4111-8111-111111111111";
  draft.settings.clientId = "22222222-2222-4222-8222-222222222222";
  draft.adSetSuggestions = suggestions;
  draft.launchSummary = results;
  draft.metaCampaignId = "camp-1";
  return draft;
}

describe("planLaunchedAdSetBackfill", () => {
  it("writes a row when the suggestion is still on the draft", () => {
    const draft = draftWithResults(
      {
        launchRunId: "run-old",
        metaCampaignId: "camp-1",
        adSetLaunchResults: {
          "sug-1": { launchStatus: "created", metaAdSetId: "120399" },
        },
      },
      [suggestion("sug-1")],
    );
    const plan = planLaunchedAdSetBackfill(
      [{ id: "draft-1", user_id: "user-1", event_id: null, draft_json: draft }],
      new Map(),
    );
    assert.equal(plan.writes.length, 1);
    assert.equal(plan.missingSuggestion.length, 0);
    assert.equal(plan.writes[0]?.meta_adset_id, "120399");
    assert.equal(plan.writes[0]?.descriptor_source, "backfill_from_launch_summary");
    assert.equal(plan.writes[0]?.suggestion_id, "sug-1");
    assert.equal(plan.writes[0]?.source_type, "page_group");
  });

  it("reports a missing suggestion instead of guessing", () => {
    const draft = draftWithResults(
      {
        launchRunId: "run-old",
        metaCampaignId: "camp-1",
        adSetLaunchResults: {
          "gone": { launchStatus: "created", metaAdSetId: "120400" },
        },
      },
      [suggestion("still-here")],
    );
    const plan = planLaunchedAdSetBackfill(
      [{ id: "draft-1", user_id: "user-1", event_id: null, draft_json: draft }],
      new Map(),
    );
    assert.equal(plan.writes.length, 0);
    assert.deepEqual(plan.missingSuggestion, [
      { draftId: "draft-1", suggestionId: "gone", metaAdSetId: "120400" },
    ]);
  });

  it("skips a meta_adset_id that already has a row — never overwrite a launch snapshot", () => {
    const draft = draftWithResults(
      {
        launchRunId: "run-old",
        metaCampaignId: "camp-1",
        adSetLaunchResults: {
          "sug-1": { launchStatus: "created", metaAdSetId: "120399" },
        },
      },
      [suggestion("sug-1")],
    );
    const plan = planLaunchedAdSetBackfill(
      [{ id: "draft-1", user_id: "user-1", event_id: null, draft_json: draft }],
      new Map(),
      new Date(),
      new Set(["120399"]),
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.missingSuggestion.length, 0);
  });

  it("ignores failed and skipped results", () => {
    const draft = draftWithResults(
      {
        launchRunId: "run-old",
        metaCampaignId: "camp-1",
        adSetLaunchResults: {
          a: { launchStatus: "failed", error: "nope" },
          b: { launchStatus: "skipped", skippedReason: "not ready" },
        },
      },
      [suggestion("a"), suggestion("b")],
    );
    const plan = planLaunchedAdSetBackfill(
      [{ id: "draft-1", user_id: "user-1", event_id: null, draft_json: draft }],
      new Map(),
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(plan.missingSuggestion.length, 0);
  });
});
