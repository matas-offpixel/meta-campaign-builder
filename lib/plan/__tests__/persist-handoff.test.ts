import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { planToGoogleDraft } from "../adapters/google.ts";
import { loadPlanLaunchRecords } from "../load.ts";
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
      target: { value: null, unit: null },
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
    linked.settings.adAccountId = "act_606252931141334";
    linked.settings.metaAdAccountId = "act_606252931141334";
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
    assert.equal(result.plan.launches.meta.platformAdAccountId, "act_606252931141334");
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
    assert.equal(
      db.launches.get(`campaign_plan_meta_launch:${plan.id}`)?.platform_ad_account_id,
      "act_606252931141334",
    );
  });

  it("google ledger stores the customer id, never the google_ads_accounts uuid", async () => {
    const accountUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const customerId = "793-280-0197";
    const plan = goldenPlan();
    plan.intent.budget = {
      totalDaily: 10,
      metaDaily: 0,
      tiktokDaily: 0,
      googleDaily: 10,
    };
    const tree = planToGoogleDraft(plan);
    tree.plan.google_ads_account_id = accountUuid;
    const withCustomer = await orchestratePlanLaunch({
      plan,
      linkedDrafts: { google: tree },
      googleCustomerId: customerId,
      env: { ENABLE_PLAN_FANOUT: "1" },
      launchers: {
        meta: async () => ({ ok: true, campaignId: "m", draftId: "m" }),
        tiktok: async () => ({ ok: true, campaignId: "t", draftId: "t" }),
        google: async () => ({ ok: true, campaignId: "g_live", draftId: tree.plan.id }),
      },
    });
    assert.equal(withCustomer.plan.launches.google.platformAdAccountId, customerId);

    const uuidOnly = await orchestratePlanLaunch({
      plan,
      linkedDrafts: { google: tree },
      env: { ENABLE_PLAN_FANOUT: "1" },
      launchers: {
        meta: async () => ({ ok: true, campaignId: "m", draftId: "m" }),
        tiktok: async () => ({ ok: true, campaignId: "t", draftId: "t" }),
        google: async () => ({ ok: true, campaignId: "g_live", draftId: tree.plan.id }),
      },
    });
    assert.equal(uuidOnly.plan.launches.google.platformAdAccountId, null);
  });

  it("load attaches the linked draft adAccountId when the ledger is still null (D.O.D)", async () => {
    const draftId = "645ed600-0000-4000-8000-000000000000";
    const supabase = {
      from(table: string) {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => {
                    if (table === "campaign_plan_meta_launch") {
                      return {
                        data: {
                          status: "live",
                          platform_campaign_id: "120251576269510755",
                          draft_id: draftId,
                          platform_ad_account_id: null,
                        },
                        error: null,
                      };
                    }
                    if (table === "campaign_drafts") {
                      return {
                        data: {
                          draft_json: {
                            settings: { adAccountId: "act_606252931141334" },
                          },
                        },
                        error: null,
                      };
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
    const launches = await loadPlanLaunchRecords(supabase, "plan-dod");
    assert.equal(launches.meta.platformAdAccountId, null);
    assert.equal(launches.meta.draftAdAccountId, "act_606252931141334");
    const persist = readFileSync("lib/plan/persist.ts", "utf8");
    assert.doesNotMatch(persist, /draftAdAccountId|draft_ad_account_id/);
  });
});

describe("plan page guards", () => {
  it("workspace no longer hardcodes the 157 persist disclaimer", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.doesNotMatch(workspace, /Migration 157 is required to persist/);
    /**
     * A successful save says nothing — silence is the signal. A failed one
     * surfaces the server's own message, which is why there is no
     * hardcoded sentence about migrations left to go stale.
     */
    assert.match(workspace, /setError\(json\.error \?\? null\)/);
    assert.match(workspace, /shouldPersistPlanOnChange/);
    /**
     * PR 4 landed the Meta drawer, so a Meta row no longer navigates —
     * it opens the drawer in state and records it in the query. TikTok
     * and Google still route to their wizards until PR 5, which is why
     * one function decides between the two.
     */
    assert.match(workspace, /openDrawerOrWizard/);
    assert.match(workspace, /wizardHrefForDraft/);
    assert.match(workspace, /wizardHrefForDraft/);
  });

  it("plan pages do not grow account pickers or asset upload", () => {
    const files = [
      "components/plan/plan-workspace.tsx",
      "app/(dashboard)/plans/page.tsx",
      "app/(dashboard)/plan/[id]/page.tsx",
      "components/plan/canvas-window.tsx",
      "components/plan/plan-identity-chips.tsx",
      "components/library/campaign-library-picker.tsx",
      "components/library/plan-library.tsx",
      "components/library/library-rows.tsx",
      "app/api/plan/[id]/duplicate/route.ts",
      "app/api/plan/from-template/route.ts",
      "app/api/plan/templates/route.ts",
      "components/viz/overflow-menu.tsx",
      "lib/viz/overflow-menu.ts",
      "lib/plan/surface.ts",
      "components/plan/canvas-budget.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /type=["']file["']/);
      assert.doesNotMatch(source, /AccountPicker|account-picker|AssetUpload|upload-asset/);
      assert.doesNotMatch(source, /AutomationArmControl|optimisation-strategy|evaluateAdSet/);
    }
  });

  it("list probe no longer substring-matches campaign_plans", () => {
    const list = readFileSync("app/(dashboard)/plans/page.tsx", "utf8");
    assert.match(list, /isRelationMissing/);
    assert.doesNotMatch(list, /includes\("campaign_plans"\)/);
  });

  it("migration 169 stores the launched account on the ledger", () => {
    const sql = readFileSync(
      "supabase/migrations/169_campaign_plan_platform_ad_account.sql",
      "utf8",
    );
    assert.match(sql, /platform_ad_account_id/);
    assert.match(sql, /campaign_plan_meta_launch/);
    assert.match(sql, /campaign_plan_tiktok_launch/);
    assert.match(sql, /campaign_plan_google_launch/);
    assert.match(sql, /draft_json->'settings'->>'adAccountId'/);
    assert.match(sql, /draft_json->'settings'->>'metaAdAccountId'/);
    assert.doesNotMatch(sql, /d\.settings->>'adAccountId'/);
    assert.match(sql, /google_ads_accounts/);
    assert.match(sql, /a\.google_customer_id/);
    assert.doesNotMatch(sql, /p\.google_ads_account_id::text/);
    assert.match(sql, /Do not apply in this run/);
    const persist = readFileSync("lib/plan/persist.ts", "utf8");
    assert.match(persist, /platform_ad_account_id/);
  });
});
