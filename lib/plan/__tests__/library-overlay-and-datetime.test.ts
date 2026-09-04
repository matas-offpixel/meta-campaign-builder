import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultCreative, createDefaultDraft } from "../../campaign-defaults.ts";
import { nextDuplicateName } from "../../duplicate-name.ts";
import { applyTemplate } from "../../templates.ts";
import type { CampaignDraft, CampaignTemplate } from "../../types.ts";
import {
  cloneCampaignDraft,
  draftFromLibraryTemplate,
  overlayPlanSharedInputs,
  planLaunchStatusIsIdle,
  PLAN_TO_DRAFT_OVERLAY,
} from "../from-existing.ts";
import { composeMetaScheduleIso } from "../schedule.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

function goldenPlan(overrides: Partial<CampaignPlan["intent"]> = {}): CampaignPlan {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "BB26 Kayode",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "registration",
      target: { value: null, unit: null },
      budget: { totalDaily: 90, metaDaily: 40, tiktokDaily: 30, googleDaily: 20 },
      destinationUrl: "https://tickets.example.com/bb26",
      audienceClusterRef: "Music & Nightlife",
      creativeSetRef: null,
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      startTime: "10:30",
      endTime: "21:00",
      ...overrides,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
}

function sourceDraft(): CampaignDraft {
  const draft = createDefaultDraft();
  const creative = createDefaultCreative();
  creative.name = "Kayode 9x16";
  creative.headline = "Keep this headline";
  creative.destinationUrl = "https://old.example/tickets";
  creative.captions[0] = { id: "cap-1", text: "Keep this caption" };
  draft.settings.campaignName = "DOD Kayode";
  draft.settings.eventId = "old-event";
  draft.settings.objective = "awareness";
  draft.settings.metaAdAccountId = "act_999";
  draft.creatives = [creative];
  draft.audiences.interestGroups = [
    {
      id: "ig-keep",
      name: "Techno",
      interests: [{ id: "1", name: "Techno" }],
      clusterType: "Music & Nightlife",
    },
  ];
  draft.audiences.pageGroups = [];
  draft.adSetSuggestions = [
    {
      id: "as-1",
      name: "Prospecting",
      sourceType: "interest_group",
      sourceId: "ig-keep",
      sourceName: "Techno",
      ageMin: 18,
      ageMax: 65,
      budgetPerDay: 25,
      advantagePlus: false,
      enabled: true,
    },
  ];
  draft.creativeAssignments = { "as-1": [creative.id] };
  draft.budgetSchedule.budgetAmount = 25;
  draft.budgetSchedule.startDate = "2026-01-01";
  draft.budgetSchedule.endDate = "2026-01-31";
  return draft;
}

describe("cloneCampaignDraft + overlayPlanSharedInputs", () => {
  it("duplicates via nextDuplicateName and never mutates the source", () => {
    const source = sourceDraft();
    const snapshot = structuredClone(source);
    const copy = cloneCampaignDraft(source, [source.settings.campaignName]);
    assert.notEqual(copy.id, source.id);
    assert.equal(copy.status, "draft");
    assert.equal(
      copy.settings.campaignName,
      nextDuplicateName("DOD Kayode", ["DOD Kayode"]),
    );
    assert.deepEqual(source, snapshot);
    assert.equal(source.settings.campaignName, "DOD Kayode");
    assert.equal(source.id, snapshot.id);
  });

  it("overlays exactly the shared plan inputs and only those", () => {
    const source = sourceDraft();
    const snapshot = structuredClone(source);
    const plan = goldenPlan();
    const copy = overlayPlanSharedInputs(cloneCampaignDraft(source, ["DOD Kayode"]), plan, {
      clientId: "client-1",
    });

    assert.equal(copy.settings.campaignName, "BB26 Kayode");
    assert.equal(copy.settings.eventId, plan.intent.eventId);
    assert.equal(copy.settings.clientId, "client-1");
    assert.equal(copy.creatives[0]?.destinationUrl, plan.intent.destinationUrl);
    assert.equal(copy.budgetSchedule.budgetAmount, 40);
    assert.equal(copy.optimisationStrategy.guardrails.baseCampaignBudget, 40);
    assert.equal(
      copy.budgetSchedule.startDate,
      composeMetaScheduleIso(plan.intent.startDate, plan.intent.startTime),
    );
    assert.equal(
      copy.budgetSchedule.endDate,
      composeMetaScheduleIso(plan.intent.endDate, plan.intent.endTime),
    );

    assert.equal(copy.settings.objective, "awareness");
    assert.equal(copy.settings.metaAdAccountId, "act_999");
    assert.equal(copy.creatives[0]?.headline, "Keep this headline");
    assert.equal(copy.creatives[0]?.name, "Kayode 9x16");
    assert.equal(copy.creatives[0]?.captions[0]?.text, "Keep this caption");
    assert.deepEqual(copy.audiences.interestGroups, source.audiences.interestGroups);
    assert.equal(copy.adSetSuggestions[0]?.budgetPerDay, 25);
    assert.deepEqual(copy.creativeAssignments, source.creativeAssignments);
    assert.notEqual(copy.id, source.id);

    assert.deepEqual(source, snapshot, "source campaign is unmutated");
    assert.ok(PLAN_TO_DRAFT_OVERLAY.some((row) => row.draft === "settings.campaignName"));
  });

  it("date-only overlay stays date-only when plan times are null", () => {
    const plan = goldenPlan({ startTime: null, endTime: null });
    const copy = overlayPlanSharedInputs(cloneCampaignDraft(sourceDraft(), ["x"]), plan);
    assert.equal(copy.budgetSchedule.startDate, "2026-09-01");
    assert.doesNotMatch(copy.budgetSchedule.startDate, /T/);
  });

  it("template apply is a new draft; overlay then sets plan fields", () => {
    const source = sourceDraft();
    const template: CampaignTemplate = {
      id: "tpl-1",
      name: "Kayode template",
      description: "",
      tags: [],
      snapshot: {
        settings: source.settings,
        audiences: source.audiences,
        creatives: source.creatives,
        optimisationStrategy: source.optimisationStrategy,
        budgetSchedule: source.budgetSchedule,
        adSetSuggestions: source.adSetSuggestions,
        creativeAssignments: source.creativeAssignments,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const applied = applyTemplate(template);
    const named = draftFromLibraryTemplate(template, [template.name]);
    assert.notEqual(named.id, source.id);
    assert.notEqual(named.id, applied.id);
    const overlaid = overlayPlanSharedInputs(named, goldenPlan());
    assert.equal(overlaid.settings.campaignName, "BB26 Kayode");
    assert.equal(overlaid.creatives[0]?.headline, "Keep this headline");
    assert.equal(source.settings.campaignName, "DOD Kayode");
  });
});

describe("from-existing wiring and density", () => {
  it("prepare-draft links the copy draft_id and does not reuse on library source", () => {
    const route = readFileSync("app/api/plan/[id]/prepare-draft/route.ts", "utf8");
    assert.match(route, /overlayPlanSharedInputs/);
    assert.match(route, /cloneCampaignDraft/);
    assert.match(route, /draftFromLibraryTemplate/);
    assert.match(route, /fromLibrary/);
    assert.match(route, /existing && !fromLibrary/);
    assert.match(route, /draftId: copy\.id/);
  });

  it("Meta card offers New from plan and the library picker", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /New from plan/);
    assert.match(workspace, /From existing campaign/);
    assert.match(workspace, /CampaignLibraryPicker/);
    assert.match(workspace, /Nothing prepared yet/);
    assert.match(workspace, /planLaunchStatusIsIdle/);
    assert.doesNotMatch(workspace, /Preview not ready yet/);
    assert.doesNotMatch(workspace, /Prepare the draft to see what is left/);
    assert.equal(planLaunchStatusIsIdle(goldenPlan()), true);
  });

  it("picker reuses library rows and tabs; library page still duplicates locally", () => {
    const picker = readFileSync("components/library/campaign-library-picker.tsx", "utf8");
    assert.match(picker, /CampaignRow/);
    assert.match(picker, /TemplateRow/);
    assert.match(picker, /LibraryTab/);
    assert.match(picker, /Drafts/);
    assert.match(picker, /Published/);
    assert.match(picker, /Archived/);
    assert.match(picker, /Templates/);
    assert.match(picker, /loadCampaignList/);
    assert.match(picker, /loadTemplatesFromDb/);
    const library = readFileSync("components/library/campaign-library.tsx", "utf8");
    assert.match(library, /duplicateCampaign/);
    assert.match(library, /New Campaign/);
    const drafts = readFileSync("lib/db/drafts.ts", "utf8");
    assert.match(drafts, /\(Copy\)/);
  });
});
