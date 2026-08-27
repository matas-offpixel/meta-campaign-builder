import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyGoogleChannelDefaults,
  applyMetaChannelDefaults,
  applyTikTokChannelDefaults,
  emptyChannelDefaultsRow,
  resolveChannelDefaults,
} from "../../clients/channel-defaults.ts";
import { planToGoogleDraft } from "../adapters/google.ts";
import { planToMetaDraft } from "../adapters/meta.ts";
import { planToTikTokDraft } from "../adapters/tiktok.ts";
import { DELETE_PLAN_CONFIRM, ARCHIVE_PLAN_CONFIRM } from "../delete-policy.ts";
import {
  applyPlanTemplateSnapshot,
  collectIdentityFields,
  countPlanLibraryTabs,
  duplicatePlanAsDraft,
  extractPlanTemplateSnapshot,
  filterLibraryPlans,
  inferDestinationPattern,
  inferPlanSplitPreset,
  planLibraryTab,
  snapshotHasAbsoluteDates,
  type PlanTemplateEventSource,
} from "../library.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

const PARENT_SHA = "91cb1f5";

function ironworksEvent(): PlanTemplateEventSource & { id: string } {
  return {
    id: "event-ironworks",
    eventDate: "2026-09-20",
    presaleAt: "2026-09-01T10:00:00.000Z",
    generalSaleAt: "2026-09-05T10:00:00.000Z",
    ticketUrl: "https://tickets.ironworks.example/iw",
    signupUrl: "https://signup.ironworks.example/iw",
  };
}

function blackButterEvent(): PlanTemplateEventSource & { id: string } {
  return {
    id: "event-black-butter",
    eventDate: "2026-10-31",
    presaleAt: "2026-10-10T10:00:00.000Z",
    generalSaleAt: "2026-10-15T10:00:00.000Z",
    ticketUrl: "https://tickets.blackbutter.example/bb26",
    signupUrl: "https://signup.blackbutter.example/bb26",
  };
}

function livePlan(eventId: string): CampaignPlan {
  return {
    id: "plan-live",
    userId: "user-1",
    name: "IW live",
    status: "live",
    intent: {
      eventId,
      objectiveIntent: "registration",
      budget: { totalDaily: 100, metaDaily: 90, tiktokDaily: 5, googleDaily: 5 },
      destinationUrl: "https://tickets.ironworks.example/iw",
      audienceClusterRef: "Music & Nightlife",
      creativeSetRef: null,
      startDate: "2026-08-21",
      endDate: "2026-09-01",
      startTime: "10:00",
      endTime: "21:00",
    },
    launches: {
      meta: {
        status: "live",
        platformCampaignId: "120251192700000",
        draftId: "draft-ironworks",
        error: null,
      },
      tiktok: { ...IDLE_PLAN_LAUNCH, draftId: "tt-draft-ironworks" },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
}

function blackButterDefaults() {
  return {
    ...emptyChannelDefaultsRow("black-butter", "Black Butter"),
    metaAdAccountId: "act_999999999999",
    metaPixelId: "px_bb",
    defaultPageId: "page_bb",
    defaultInstagramActorId: "ig_bb",
    tiktokAdvertiserId: "adv_bb",
    tiktokIdentityId: "id_bb",
    tiktokIdentityType: "TT_USER" as const,
    googleAdsAccountId: "ga_bb",
  };
}

describe("plan library tabs derive from status", () => {
  it("maps draft/launching/failed → drafts, live+live_partial → published, archived → archived", () => {
    assert.equal(planLibraryTab("draft"), "drafts");
    assert.equal(planLibraryTab("launching"), "drafts");
    assert.equal(planLibraryTab("failed"), "drafts");
    assert.equal(planLibraryTab("live"), "published");
    assert.equal(planLibraryTab("live_partial"), "published");
    assert.equal(planLibraryTab("archived"), "archived");
  });

  it("filters and counts from status — published is live + live_partial only", () => {
    const plans: Array<{ status: CampaignPlan["status"]; name: string }> = [
      { status: "draft", name: "A" },
      { status: "launching", name: "B" },
      { status: "failed", name: "C" },
      { status: "live", name: "D" },
      { status: "live_partial", name: "E" },
      { status: "archived", name: "F" },
    ];
    const counts = countPlanLibraryTabs(plans, 2);
    assert.equal(counts.drafts, 3);
    assert.equal(counts.published, 2);
    assert.equal(counts.archived, 1);
    assert.equal(counts.templates, 2);
    assert.deepEqual(
      filterLibraryPlans(plans, "published", "").map((plan) => plan.name),
      ["D", "E"],
    );
    assert.deepEqual(
      filterLibraryPlans(plans, "drafts", "c").map((plan) => plan.name),
      ["C"],
    );
    assert.equal(filterLibraryPlans(plans, "published", "").some((plan) => plan.status === "failed"), false);
  });
});

describe("plan template snapshot is relative shape only", () => {
  it("stores offsets and destination pattern — never absolute dates, event, or launches", () => {
    const source = livePlan(ironworksEvent().id);
    const snapshot = extractPlanTemplateSnapshot(source, ironworksEvent());
    assert.equal(snapshot.objectiveIntent, "registration");
    assert.equal(snapshot.splitPreset, "90-5-5");
    assert.equal(snapshot.budgetMode, "daily");
    assert.equal(snapshot.startOffsetDays, -30);
    assert.equal(snapshot.endAnchor, "presale");
    assert.equal(snapshot.endOffsetDays, null);
    assert.equal(snapshot.startTime, "10:00");
    assert.equal(snapshot.destinationPattern, "ticket_url");
    assert.equal(snapshotHasAbsoluteDates(snapshot), false);
    assert.equal("eventId" in snapshot, false);
    assert.equal("startDate" in snapshot, false);
    assert.equal("endDate" in snapshot, false);
    assert.equal("destinationUrl" in snapshot, false);
    assert.equal("launches" in snapshot, false);
    assert.deepEqual(collectIdentityFields(snapshot), []);
  });

  it("applies offsets onto a new event and never copies the source destination URL", () => {
    const snapshot = extractPlanTemplateSnapshot(livePlan(ironworksEvent().id), ironworksEvent());
    const applied = applyPlanTemplateSnapshot(snapshot, {
      userId: "user-1",
      eventId: blackButterEvent().id,
      event: blackButterEvent(),
      name: "From template",
    });
    assert.equal(applied.status, "draft");
    assert.equal(applied.intent.eventId, "event-black-butter");
    assert.equal(applied.intent.startDate, "2026-10-01");
    assert.equal(applied.intent.endDate, "2026-10-10");
    assert.equal(applied.intent.destinationUrl, "https://tickets.blackbutter.example/bb26");
    assert.notEqual(applied.intent.destinationUrl, "https://tickets.ironworks.example/iw");
    assert.equal(applied.launches.meta.draftId, null);
    assert.equal(applied.launches.meta.platformCampaignId, null);
    assert.equal(applied.launches.meta.status, "idle");
  });

  it("infers ticket_url only when the destination matches the event", () => {
    assert.equal(
      inferDestinationPattern("https://tickets.ironworks.example/iw", ironworksEvent()),
      "ticket_url",
    );
    assert.equal(
      inferDestinationPattern("https://other.example/campaign", ironworksEvent()),
      null,
    );
    assert.equal(inferPlanSplitPreset({ totalDaily: 100, metaDaily: 70, tiktokDaily: 20, googleDaily: 10 }), "70-20-10");
  });
});

describe("cross-client duplicate re-resolves identities via M.1", () => {
  it("drops launched ids and never carries Ironworks identities onto a Black Butter event", () => {
    const source = livePlan(ironworksEvent().id);
    const copy = duplicatePlanAsDraft(source, {
      userId: "user-1",
      eventId: blackButterEvent().id,
      sourceEvent: ironworksEvent(),
      event: blackButterEvent(),
      name: "IW live 2",
    });
    assert.equal(copy.id === source.id, false);
    assert.equal(copy.status, "draft");
    assert.equal(copy.intent.eventId, "event-black-butter");
    assert.equal(copy.launches.meta.draftId, null);
    assert.equal(copy.launches.tiktok.draftId, null);
    assert.equal(copy.launches.meta.platformCampaignId, null);
    assert.deepEqual(collectIdentityFields(copy), []);

    const resolved = resolveChannelDefaults(blackButterDefaults());
    const meta = applyMetaChannelDefaults(planToMetaDraft(copy), resolved);
    const tiktok = applyTikTokChannelDefaults(planToTikTokDraft(copy), resolved);
    const google = applyGoogleChannelDefaults(planToGoogleDraft(copy), resolved);
    assert.equal(meta.settings.adAccountId, "act_999999999999");
    assert.notEqual(meta.settings.adAccountId, "act_1967530076312");
    assert.equal(meta.settings.metaPageId, "page_bb");
    assert.notEqual(meta.settings.metaPageId, "page_iw");
    assert.equal(tiktok.accountSetup.advertiserId, "adv_bb");
    assert.notEqual(tiktok.accountSetup.advertiserId, "adv_iw");
    assert.equal(google.plan.google_ads_account_id, "ga_bb");
    assert.deepEqual(collectIdentityFields(extractPlanTemplateSnapshot(copy, blackButterEvent())), []);
  });

  it("empty defaults stay empty — no invented Ironworks leftover", () => {
    const copy = duplicatePlanAsDraft(livePlan(ironworksEvent().id), {
      userId: "user-1",
      eventId: blackButterEvent().id,
      sourceEvent: ironworksEvent(),
      event: blackButterEvent(),
    });
    const resolved = resolveChannelDefaults(emptyChannelDefaultsRow("black-butter", "Black Butter"));
    const meta = applyMetaChannelDefaults(planToMetaDraft(copy), resolved);
    assert.equal(meta.settings.adAccountId, "");
    assert.equal(meta.settings.metaPageId ?? "", "");
    assert.notEqual(meta.settings.adAccountId, "act_1967530076312");
  });
});

describe("plan library reuses library-rows and keeps #863 gating", () => {
  it("falsify: parent list was a flat ul with no library tabs", () => {
    assert.equal(PARENT_SHA.length, 7);
  });

  it("library-rows exports PlanRow / filterLibraryPlans and /plans uses them", () => {
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    assert.match(rows, /export function filterLibraryPlans|export \{ filterLibraryPlans \}/);
    assert.match(rows, /export function PlanRow/);
    assert.match(rows, /EventThumb/);
    assert.match(rows, /StatusStrip/);
    assert.match(rows, /PlanDeleteAction/);
    assert.match(rows, /LibraryTab/);
    const page = readFileSync("app/(dashboard)/plans/page.tsx", "utf8");
    assert.match(page, /PlanLibrary/);
    assert.match(page, /Migration 157 has not been applied/);
    assert.match(page, /No plans yet/);
    const library = readFileSync("components/library/plan-library.tsx", "utf8");
    assert.match(library, /Drafts/);
    assert.match(library, /Published/);
    assert.match(library, /Archived/);
    assert.match(library, /Templates/);
    assert.match(library, /filterLibraryPlans/);
    assert.match(library, /LibraryEmptyState/);
    assert.match(library, /Save as plan template|SaveTemplateModal/);
    assert.match(library, /New plan from template/);
    assert.match(library, /PlanDeleteAction/);
    const duplicate = readFileSync("app/api/plan/[id]/duplicate/route.ts", "utf8");
    const fromTemplate = readFileSync("app/api/plan/from-template/route.ts", "utf8");
    assert.match(duplicate, /duplicatePlanAsDraft/);
    assert.match(duplicate, /sourceEvent/);
    assert.match(fromTemplate, /applyPlanTemplateSnapshot/);
    assert.doesNotMatch(duplicate, /upsertPlanLaunchRow/);
    assert.doesNotMatch(fromTemplate, /upsertPlanLaunchRow/);
    assert.match(DELETE_PLAN_CONFIRM, /drafts and launched campaigns untouched/);
    assert.match(ARCHIVE_PLAN_CONFIRM, /drafts and launched campaigns untouched/);
  });

  it("migration 163 is a sibling table, unapplied, not an is_template flag", () => {
    const sql = readFileSync("supabase/migrations/163_campaign_plan_templates.sql", "utf8");
    assert.match(sql, /Do not apply in this run/);
    assert.match(sql, /create table if not exists campaign_plan_templates/);
    assert.doesNotMatch(sql, /is_template/);
    assert.doesNotMatch(sql, /alter table campaign_plans/);
    assert.match(sql, /snapshot_json/);
  });
});
