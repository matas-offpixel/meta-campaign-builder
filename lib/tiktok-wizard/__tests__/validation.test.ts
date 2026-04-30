import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTikTokWizardValidationIssues,
  TIKTOK_PIXEL_ID_PATTERN,
  validateTikTokWizardStep,
} from "../validation.ts";
import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";

describe("TikTok wizard validation", () => {
  it("flags Step 0 account and pixel failures", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    assert.ok(
      validateTikTokWizardStep(draft, 0).some((issue) => issue.id === "advertiser"),
    );
    draft.accountSetup.advertiserId = "adv-1";
    draft.accountSetup.pixelId = "abc";
    assert.equal(TIKTOK_PIXEL_ID_PATTERN.test("123456"), true);
    assert.ok(
      validateTikTokWizardStep(draft, 0).some((issue) => issue.id === "pixel-id"),
    );
  });

  it("blocks Step 1 when event_code is missing or objective/goal is invalid", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.campaignSetup.objective = "TRAFFIC";
    draft.campaignSetup.optimisationGoal = "CONVERSION";
    const issues = validateTikTokWizardStep(draft, 1, {
      eventEditPath: "/events/event-1/edit",
    });
    assert.ok(issues.some((issue) => issue.id === "event-code"));
    assert.ok(issues.some((issue) => issue.id === "objective-goal"));
  });

  it("surfaces audience, creative, budget, schedule, and assignment failures", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.audiences.locationCodes = [];
    draft.audiences.languages = [];
    draft.budgetSchedule.budgetAmount = 0;
    draft.budgetSchedule.scheduleStartAt = "2026-05-02T10:00";
    draft.budgetSchedule.scheduleEndAt = "2026-05-01T10:00";

    const ids = buildTikTokWizardValidationIssues(draft).map((issue) => issue.id);
    assert.ok(ids.includes("targeting"));
    assert.ok(ids.includes("creatives"));
    assert.ok(ids.includes("budget-positive"));
    assert.ok(ids.includes("schedule-order"));
    assert.ok(ids.includes("creative-assignments"));
  });

  it("passes assignment validation when every creative and ad group is covered", () => {
    const draft = createDefaultTikTokDraft("draft-1");
    draft.creatives.items = [
      {
        id: "creative-1",
        name: "Creative 1",
        baseName: "Creative",
        mode: "VIDEO_REFERENCE",
        videoId: "v1",
        videoUrl: null,
        thumbnailUrl: null,
        durationSeconds: null,
        title: null,
        sparkPostId: null,
        caption: "Copy",
        adText: "Copy",
        displayName: "Identity",
        landingPageUrl: "https://example.com",
        cta: "LEARN_MORE",
        musicId: null,
      },
    ];
    draft.budgetSchedule.adGroups = [
      { id: "ag-1", name: "AG 1", budget: null, startAt: null, endAt: null },
    ];
    draft.creativeAssignments.byAdGroupId = { "ag-1": ["creative-1"] };

    assert.equal(
      validateTikTokWizardStep(draft, 6).some(
        (issue) => issue.id === "creative-assignments",
      ),
      false,
    );
  });
});
