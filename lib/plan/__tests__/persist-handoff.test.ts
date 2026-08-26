import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { collectPlanPreflight } from "../preflight.ts";
import { orchestratePlanLaunch } from "../orchestrator.ts";
import {
  campaignPlanToRow,
  probeCampaignPlansTable,
  upsertCampaignPlan,
  upsertPlanLaunchRow,
} from "../persist.ts";
import {
  GOOGLE_PREPARE_REASON,
  buildPrefillMetaDraft,
  buildPrefillTikTokDraft,
  resolvePreparedDraftId,
  wizardHrefForDraft,
} from "../prepare-draft.ts";
import { isRelationMissing } from "../schema-probe.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan } from "../types.ts";

function goldenPlan(): CampaignPlan {
  const now = "2026-08-25T12:00:00.000Z";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    name: "BB26 Kayode",
    status: "draft",
    intent: {
      eventId: "33333333-3333-4333-8333-333333333333",
      objectiveIntent: "registration",
      budget: {
        totalDaily: 90,
        metaDaily: 40,
        tiktokDaily: 50,
        googleDaily: 0,
      },
      destinationUrl: "https://tickets.example.com/bb26",
      audienceClusterRef: "Music & Nightlife",
      creativeSetRef: null,
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      startTime: null,
      endTime: null,
    },
    launches: {
      meta: { ...IDLE_PLAN_LAUNCH },
      tiktok: { ...IDLE_PLAN_LAUNCH },
      google: { ...IDLE_PLAN_LAUNCH },
    },
    createdAt: now,
    updatedAt: now,
  };
}

function memoryDb(opts: { tableMissing?: boolean; extraError?: { code?: string; message: string } } = {}) {
  const plans = new Map<string, Record<string, unknown>>();
  const launches = new Map<string, Record<string, unknown>>();
  return {
    plans,
    launches,
    from(table: string) {
      return {
        select() {
          return {
            limit: async () => {
              if (opts.tableMissing) {
                return { data: null, error: { code: "PGRST205", message: "schema cache" } };
              }
              if (opts.extraError) return { data: null, error: opts.extraError };
              return { data: [...plans.values()].slice(0, 1), error: null };
            },
          };
        },
        upsert: async (row: Record<string, unknown>) => {
          if (opts.tableMissing) {
            return { error: { code: "42P01", message: "relation does not exist" } };
          }
          if (table === "campaign_plans") {
            plans.set(String(row.id), row);
          } else {
            launches.set(`${table}:${String(row.plan_id)}`, row);
          }
          return { error: null };
        },
      };
    },
  };
}

describe("campaign_plans probe", () => {
  it("treats only PostgREST/Postgres missing-relation codes as table-missing", () => {
    assert.equal(isRelationMissing({ code: "PGRST205", message: "schema cache" }), true);
    assert.equal(isRelationMissing({ code: "42P01", message: "relation does not exist" }), true);
    assert.equal(
      isRelationMissing({
        code: "42501",
        message: "new row violates row-level security on campaign_plans",
      }),
      false,
    );
    assert.equal(
      isRelationMissing({ message: "insert into campaign_plans failed" }),
      false,
    );
  });

  it("probe is false when campaign_plans exists even with zero rows", async () => {
    const db = memoryDb();
    const probe = await probeCampaignPlansTable(db);
    assert.equal(probe.tableMissing, false);
  });

  it("persist writes a campaign_plans row when the table exists", async () => {
    const db = memoryDb();
    const plan = goldenPlan();
    const result = await upsertCampaignPlan(db, plan);
    assert.equal(result.ok, true);
    assert.equal(db.plans.get(plan.id)?.event_id, plan.intent.eventId);
    assert.equal(db.plans.get(plan.id)?.destination_url, plan.intent.destinationUrl);
    assert.deepEqual(campaignPlanToRow(plan).daily_budget_meta, 40);
  });
});

describe("prepare draft handoff", () => {
  it("prefilled Meta and TikTok drafts carry plan invariants, not new guesses", () => {
    const plan = goldenPlan();
    const meta = buildPrefillMetaDraft(plan, "client-1");
    assert.equal(meta.settings.eventId, plan.intent.eventId);
    assert.equal(meta.settings.clientId, "client-1");
    assert.equal(meta.settings.objective, "registration");
    assert.equal(meta.budgetSchedule.budgetAmount, 40);
    assert.equal(meta.creatives[0]?.destinationUrl, plan.intent.destinationUrl);
    assert.equal(meta.audiences.interestGroups[0]?.clusterType, "Music & Nightlife");

    const tiktok = buildPrefillTikTokDraft(plan, "client-1");
    assert.equal(tiktok.eventId, plan.intent.eventId);
    assert.equal(tiktok.clientId, "client-1");
    assert.equal(tiktok.budgetSchedule.dailyBudget, 50);
    assert.equal(tiktok.creatives.items[0]?.landingPageUrl, plan.intent.destinationUrl);
  });

  it("reuses an existing draft_id instead of minting a second draft", () => {
    const first = resolvePreparedDraftId(null, "new-draft");
    assert.deepEqual(first, { draftId: "new-draft", reused: false });
    const second = resolvePreparedDraftId(first.draftId, "another");
    assert.deepEqual(second, { draftId: "new-draft", reused: true });
  });

  it("wizard hrefs stay on the existing platform routes", () => {
    assert.equal(wizardHrefForDraft("meta", "d1"), "/campaign/d1");
    assert.equal(wizardHrefForDraft("tiktok", "d2"), "/tiktok-campaign/d2");
    // Google gained a real linked plan once seed keywords became derivable
    // from the Meta draft (v2.2) — it is no longer a dead end.
    assert.equal(wizardHrefForDraft("google", "d3"), "/google-search/d3");
    assert.match(GOOGLE_PREPARE_REASON, /keywords/);
    assert.match(GOOGLE_PREPARE_REASON, /Meta/);
  });
});

describe("linked-draft preflight and fan-out persist", () => {
  it("preflight uses the linked Meta draft's ad account, not the empty adapter field", () => {
    const plan = goldenPlan();
    const linked = buildPrefillMetaDraft(plan);
    linked.settings.metaAdAccountId = "act_1234567890";
    linked.settings.adAccountId = "act_1234567890";
    const fromPlan = collectPlanPreflight(plan);
    const fromLinked = collectPlanPreflight(plan, { meta: linked });
    assert.ok(
      fromPlan.issues.some((issue) => issue.adapter === "meta" && /ad account/i.test(issue.message)),
    );
    assert.equal(
      fromLinked.issues.some((issue) => issue.adapter === "meta" && /ad account/i.test(issue.message)),
      false,
    );
  });

  it("fan-out launches the linked draft and writes launch child rows", async () => {
    const plan = goldenPlan();
    const linked = buildPrefillMetaDraft(plan);
    const persisted: Array<{ adapter: string; draftId: string | null; status: string }> = [];
    let launchedId: string | null = null;
    const result = await orchestratePlanLaunch({
      plan: {
        ...plan,
        launches: {
          ...plan.launches,
          meta: { ...IDLE_PLAN_LAUNCH, draftId: linked.id },
        },
      },
      linkedDrafts: { meta: linked },
      env: { ENABLE_PLAN_FANOUT: "1" },
      persistLaunch: async (adapter, record) => {
        persisted.push({
          adapter,
          draftId: record.draftId,
          status: record.status,
        });
      },
      launchers: {
        meta: async (draft) => {
          launchedId = draft.id;
          return { ok: true, campaignId: "meta_live", draftId: draft.id };
        },
        tiktok: async () => ({ ok: true, campaignId: "tt_live", draftId: "tt" }),
        google: async () => ({ ok: false, error: "skipped in this test" }),
      },
    });
    assert.equal(launchedId, linked.id);
    assert.equal(result.plan.launches.meta.draftId, linked.id);
    assert.ok(persisted.some((row) => row.adapter === "meta" && row.status === "live"));
    const db = memoryDb();
    const write = await upsertPlanLaunchRow(db, {
      planId: plan.id,
      userId: plan.userId,
      adapter: "meta",
      record: result.plan.launches.meta,
    });
    assert.equal(write.ok, true);
    assert.equal(
      db.launches.get(`campaign_plan_meta_launch:${plan.id}`)?.platform_campaign_id,
      "meta_live",
    );
  });
});

describe("plan page guards", () => {
  it("workspace no longer hardcodes the 157 persist disclaimer", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.doesNotMatch(workspace, /Migration 157 is required to persist/);
    assert.match(workspace, /Saved to campaign_plans|persistState/);
    assert.match(workspace, /shouldPersistPlanOnChange/);
    assert.match(workspace, /New from plan/);
    assert.match(workspace, /From existing campaign/);
    assert.match(workspace, /Continue in wizard/);
  });

  it("plan pages do not grow account pickers or asset upload", () => {
    const files = [
      "components/plan/plan-workspace.tsx",
      "components/plan/asset-routing-matrix.tsx",
      "app/(dashboard)/plans/page.tsx",
      "app/(dashboard)/plan/[id]/page.tsx",
      "components/plan/plan-datetime-field.tsx",
      "components/library/campaign-library-picker.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /type=["']file["']/);
      assert.doesNotMatch(source, /AccountPicker|account-picker|AssetUpload|upload-asset/);
    }
  });

  it("list probe no longer substring-matches campaign_plans", () => {
    const list = readFileSync("app/(dashboard)/plans/page.tsx", "utf8");
    assert.match(list, /isRelationMissing/);
    assert.doesNotMatch(list, /includes\("campaign_plans"\)/);
  });
});
