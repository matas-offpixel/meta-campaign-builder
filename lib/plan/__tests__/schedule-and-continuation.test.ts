import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planToGoogleDraft } from "../adapters/google.ts";
import { planToMetaDraft } from "../adapters/meta.ts";
import { planToTikTokDraft } from "../adapters/tiktok.ts";
import { campaignPlanToRow, upsertPlanLaunchRow } from "../persist.ts";
import { recordWizardMetaLaunch } from "../record-wizard-launch.ts";
import {
  composeMetaScheduleIso,
  composeTikTokScheduleAt,
  GOOGLE_DATE_ONLY_NOTE,
  normalizePlanTime,
  planContinuationHref,
  planTimeFromInput,
  TIKTOK_DEFAULT_END_HOUR,
  TIKTOK_DEFAULT_START_HOUR,
  WIZARD_ACTIVE_VS_PLAN_PAUSED,
} from "../schedule.ts";
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
      budget: { totalDaily: 90, metaDaily: 40, tiktokDaily: 30, googleDaily: 20 },
      destinationUrl: "https://tickets.example.com/bb26",
      audienceClusterRef: "Music & Nightlife",
      creativeSetRef: null,
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      startTime: null,
      endTime: null,
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

describe("plan schedule composition", () => {
  it("Meta ISO: date-only stays date-only; time produces Z-suffixed ISO", () => {
    assert.equal(composeMetaScheduleIso("2026-09-01", null), "2026-09-01");
    assert.equal(composeMetaScheduleIso("2026-09-01", undefined), "2026-09-01");
    assert.equal(composeMetaScheduleIso("2026-09-01", "10:30"), "2026-09-01T10:30:00Z");
    assert.equal(composeMetaScheduleIso("2026-09-01", "10:30:00"), "2026-09-01T10:30:00Z");
    assert.equal(composeMetaScheduleIso(null, "10:30"), "");
  });

  it("TikTok: no time keeps the Z-suffixed defaults; a time is naive wall clock", () => {
    assert.equal(
      composeTikTokScheduleAt("2026-09-01", null, TIKTOK_DEFAULT_START_HOUR),
      "2026-09-01T09:00:00Z",
    );
    assert.equal(
      composeTikTokScheduleAt("2026-09-14", null, TIKTOK_DEFAULT_END_HOUR),
      "2026-09-14T21:00:00Z",
    );
    const withTime = composeTikTokScheduleAt("2026-09-01", "10:30", TIKTOK_DEFAULT_START_HOUR);
    assert.equal(withTime, "2026-09-01T10:30:00");
    assert.doesNotMatch(withTime ?? "", /Z$/);
    assert.equal(composeTikTokScheduleAt(null, "10:30", TIKTOK_DEFAULT_START_HOUR), null);
  });

  it("normalizePlanTime accepts HH:MM and HH:MM:SS, rejects junk", () => {
    assert.equal(normalizePlanTime("09:15"), "09:15");
    assert.equal(normalizePlanTime("09:15:00"), "09:15");
    assert.equal(normalizePlanTime(""), null);
    assert.equal(normalizePlanTime("not-a-time"), null);
    assert.equal(normalizePlanTime("00:00"), "00:00");
  });

  it("null-time round-trip: date-only stays date-only; set then clear returns to null; midnight is not a clear", () => {
    assert.equal(planTimeFromInput(""), null);
    assert.equal(planTimeFromInput("00:00"), "00:00");
    assert.equal(planTimeFromInput("10:30"), "10:30");
    let time: string | null = null;
    time = planTimeFromInput("10:30");
    assert.equal(time, "10:30");
    time = planTimeFromInput("");
    assert.equal(time, null);
    assert.equal(composeMetaScheduleIso("2026-09-01", time), "2026-09-01");
    assert.equal(composeMetaScheduleIso("2026-09-01", "00:00"), "2026-09-01T00:00:00Z");
  });
});

describe("adapter time threading", () => {
  it("existing plans without times keep the current adapter defaults", () => {
    const plan = goldenPlan();
    const meta = planToMetaDraft(plan);
    const tiktok = planToTikTokDraft(plan);
    const google = planToGoogleDraft(plan);

    assert.equal(meta.budgetSchedule.startDate, "2026-09-01");
    assert.equal(meta.budgetSchedule.endDate, "2026-09-14");
    assert.doesNotMatch(meta.budgetSchedule.startDate, /T/);

    assert.equal(tiktok.budgetSchedule.scheduleStartAt, "2026-09-01T09:00:00Z");
    assert.equal(tiktok.budgetSchedule.scheduleEndAt, "2026-09-14T21:00:00Z");

    assert.deepEqual(google.plan.date_range, { since: "2026-09-01", until: "2026-09-14" });
    assert.ok(!("start_time" in google.plan.date_range!));
  });

  it("times thread to Meta ISO and TikTok naive advertiser-tz path; Google stays date-only", () => {
    const plan = goldenPlan({ startTime: "10:30", endTime: "21:00" });
    const meta = planToMetaDraft(plan);
    const tiktok = planToTikTokDraft(plan);
    const google = planToGoogleDraft(plan);

    assert.equal(meta.budgetSchedule.startDate, "2026-09-01T10:30:00Z");
    assert.equal(meta.budgetSchedule.endDate, "2026-09-14T21:00:00Z");
    assert.match(meta.budgetSchedule.startDate, /Z$/);

    assert.equal(tiktok.budgetSchedule.scheduleStartAt, "2026-09-01T10:30:00");
    assert.equal(tiktok.budgetSchedule.scheduleEndAt, "2026-09-14T21:00:00");
    assert.doesNotMatch(tiktok.budgetSchedule.scheduleStartAt ?? "", /Z$/);

    assert.deepEqual(google.plan.date_range, { since: "2026-09-01", until: "2026-09-14" });
  });

  it("persist writes null times so a clear returns to date-only; midnight is 00:00", () => {
    const without = campaignPlanToRow(goldenPlan());
    assert.equal(without.start_time, null);
    assert.equal(without.end_time, null);

    const midnight = campaignPlanToRow(goldenPlan({ startTime: "00:00", endTime: "00:00" }));
    assert.equal(midnight.start_time, "00:00");
    assert.equal(midnight.end_time, "00:00");

    const withTimes = campaignPlanToRow(goldenPlan({ startTime: "10:30", endTime: "21:00" }));
    assert.equal(withTimes.start_time, "10:30");
    assert.equal(withTimes.end_time, "21:00");

    const cleared = campaignPlanToRow(
      goldenPlan({ startTime: "10:30", endTime: "21:00", ...{ startTime: null, endTime: null } }),
    );
    assert.equal(cleared.start_time, null);
    assert.equal(cleared.end_time, null);
  });
});

describe("wizard launch writes the plan child row", () => {
  function memoryDb(existing?: Record<string, unknown>) {
    const rows = new Map<string, Record<string, unknown>>();
    if (existing) rows.set(`campaign_plan_meta_launch:${existing.plan_id}`, existing);
    const updates: Array<{ table: string; row: Record<string, unknown> }> = [];
    return {
      rows,
      updates,
      from(table: string) {
        return {
          select() {
            return {
              eq: (_col: string, value: string) => ({
                maybeSingle: async () => {
                  if (table === "campaign_plan_meta_launch") {
                    const hit = [...rows.values()].find(
                      (row) => row.draft_id === value || row.plan_id === value,
                    );
                    return { data: hit ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            };
          },
          upsert: async (row: Record<string, unknown>) => {
            rows.set(`${table}:${row.plan_id}`, row);
            return { error: null };
          },
          update: (row: Record<string, unknown>) => ({
            eq: async () => {
              updates.push({ table, row });
              return { error: null };
            },
          }),
        };
      },
    };
  }

  it("writes live + campaign id when the draft is plan-linked", async () => {
    const db = memoryDb({
      plan_id: "plan-1",
      user_id: "user-1",
      draft_id: "draft-1",
      platform_campaign_id: null,
      status: "idle",
      error: null,
    });
    const result = await recordWizardMetaLaunch(db, {
      draftId: "draft-1",
      userId: "user-1",
      campaignId: "120251192700000",
      ok: true,
    });
    assert.equal(result.recorded, true);
    assert.equal(result.planId, "plan-1");
    const row = db.rows.get("campaign_plan_meta_launch:plan-1");
    assert.equal(row?.status, "live");
    assert.equal(row?.platform_campaign_id, "120251192700000");
    assert.ok(db.updates.some((u) => u.table === "campaign_plans" && u.row.status === "live"));
  });

  it("writes failed when the wizard campaign create fails", async () => {
    const db = memoryDb({
      plan_id: "plan-1",
      user_id: "user-1",
      draft_id: "draft-1",
      platform_campaign_id: null,
      status: "idle",
      error: null,
    });
    const result = await recordWizardMetaLaunch(db, {
      draftId: "draft-1",
      userId: "user-1",
      campaignId: null,
      ok: false,
      error: "Failed to create campaign",
    });
    assert.equal(result.recorded, true);
    const row = db.rows.get("campaign_plan_meta_launch:plan-1");
    assert.equal(row?.status, "failed");
    assert.equal(row?.error, "Failed to create campaign");
  });

  it("is a no-op for an ordinary (non-plan) draft", async () => {
    const db = memoryDb();
    const result = await recordWizardMetaLaunch(db, {
      draftId: "lonely-draft",
      userId: "user-1",
      campaignId: "1202",
      ok: true,
    });
    assert.equal(result.recorded, false);
    assert.equal(db.rows.size, 0);
  });

  it("upsertPlanLaunchRow still writes the fan-out shape", async () => {
    const db = memoryDb();
    const write = await upsertPlanLaunchRow(db, {
      planId: "plan-1",
      userId: "user-1",
      adapter: "meta",
      record: {
        status: "live",
        platformCampaignId: "meta_live",
        draftId: "draft-1",
        error: null,
      },
    });
    assert.equal(write.ok, true);
  });
});

describe("continuation link only for plan-linked drafts", () => {
  it("ReviewLaunch gates the continuation on linkedPlan + launchSummary", () => {
    const review = readFileSync("components/steps/review-launch.tsx", "utf8");
    assert.match(review, /linkedPlan \?/);
    assert.match(review, /Continue plan/);
    assert.match(review, /derive TikTok & Google/);
    assert.match(review, /Go to Campaign Library/);
    assert.match(review, /planContinuationHref\(linkedPlan\.id\)/);
  });

  it("WizardShell forwards linkedPlan and does not invent one", () => {
    const shell = readFileSync("components/wizard/wizard-shell.tsx", "utf8");
    assert.match(shell, /linkedPlan=\{linkedPlan\}/);
    assert.match(shell, /linkedPlan = null/);
    assert.doesNotMatch(shell, /Continue plan/);
  });

  it("the campaign route passes a looked-up plan, not a hardcoded one", () => {
    const page = readFileSync("app/campaign/[id]/page.tsx", "utf8");
    assert.match(page, /loadPlanForMetaDraft/);
    assert.match(page, /linkedPlan=\{linkedPlan\}/);
    assert.equal(planContinuationHref("plan-1"), "/plan/plan-1#plan-step-2");
  });

  it("launch route records the plan child on wizard success and Phase 1 failure", () => {
    const route = readFileSync("app/api/meta/launch-campaign/route.ts", "utf8");
    assert.match(route, /recordWizardMetaLaunch/);
    assert.equal((route.match(/recordWizardMetaLaunch/g) ?? []).length, 3);
  });
});

describe("plan page time inputs and ACTIVE vs PAUSED warning", () => {
  it("workspace collects times and warns before Prepare", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /PlanDateTimeField/);
    assert.match(workspace, /label="Start"/);
    assert.match(workspace, /label="End"/);
    const field = readFileSync("components/plan/plan-datetime-field.tsx", "utf8");
    assert.match(field, /type="date"/);
    assert.match(field, /type="time"/);
    assert.match(field, /Clear time/);
    assert.match(field, /planTimeFromInput/);
    assert.match(workspace, /WIZARD_ACTIVE_VS_PLAN_PAUSED/);
    assert.match(workspace, /GOOGLE_DATE_ONLY_NOTE/);
    assert.match(workspace, /id=\{PLAN_STEP2_HASH\}/);
    assert.ok(WIZARD_ACTIVE_VS_PLAN_PAUSED.includes("ACTIVE"));
    assert.ok(WIZARD_ACTIVE_VS_PLAN_PAUSED.includes("PAUSED"));
    assert.match(GOOGLE_DATE_ONLY_NOTE, /date-level/);
  });

  it("migration 159 adds nullable time columns and is not applied by this PR", () => {
    const sql = readFileSync("supabase/migrations/159_campaign_plans_schedule_times.sql", "utf8");
    assert.match(sql, /add column if not exists start_time time/);
    assert.match(sql, /add column if not exists end_time time/);
    assert.match(sql, /Do not apply in this run/);
  });
});
