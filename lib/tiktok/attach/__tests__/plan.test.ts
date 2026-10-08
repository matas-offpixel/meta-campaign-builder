import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createMockTikTokClient } from "../../__mocks__/client.ts";
import { hashTikTokWritePayload } from "../../write/idempotency.ts";
import { collectTikTokDraftLaunchPreflight } from "../../write/launch-preflight.ts";
import { launchTikTokDraftState } from "../../write/orchestrator.ts";
import { collectTikTokLaunchPreflight } from "../../write/preflight.ts";
import { duplicateTikTokDraftState } from "../../../tiktok-wizard/library.ts";
import { migrateTikTokDraft } from "../../../tiktok-wizard/migrate-draft.ts";
import { inheritTikTokConversion, planTikTokAttachLaunch } from "../plan.ts";
import { listTikTokAttachAdGroups } from "../read.ts";
import { describeTikTokAttachLaunch } from "../summary.ts";
import type {
  TikTokAttachAdGroup,
  TikTokAttachCampaign,
  TikTokAttachLiveTargets,
} from "../targets.ts";
import { ATTACH_CONTEXT, salesDraft } from "./fixtures.ts";
import golden from "./new-mode-golden.json" with { type: "json" };

const NOW = new Date("2027-08-01T00:00:00Z");

function campaign(id: string, extra: Partial<TikTokAttachCampaign> = {}): TikTokAttachCampaign {
  return {
    id,
    name: `Campaign ${id}`,
    operationStatus: "ENABLE",
    secondaryStatus: "CAMPAIGN_STATUS_ENABLE",
    objectiveType: "WEB_CONVERSIONS",
    salesDestination: "WEBSITE",
    budgetMode: "BUDGET_MODE_INFINITE",
    budgetOptimizeOn: false,
    automationType: "MANUAL",
    isSmartPerformanceCampaign: false,
    ...extra,
  };
}

function adGroup(id: string, campaignId: string, extra: Partial<TikTokAttachAdGroup> = {}): TikTokAttachAdGroup {
  return {
    id,
    name: `Ad group ${id}`,
    campaignId,
    campaignName: `Campaign ${campaignId}`,
    operationStatus: "ENABLE",
    secondaryStatus: "ADGROUP_STATUS_DELIVERY_OK",
    optimizationGoal: "CONVERT",
    optimizationEvent: "SHOPPING",
    pixelId: "pixel_live",
    promotionType: "WEBSITE",
    automationType: "MANUAL",
    isSmartPerformanceCampaign: false,
    ...extra,
  };
}

function live(campaigns: TikTokAttachCampaign[], adGroups: TikTokAttachAdGroup[]): TikTokAttachLiveTargets {
  return { source: "live", campaigns, adGroups, adGroupReadFailed: [] };
}

function snap(c: TikTokAttachCampaign, adGroupCount: number | null = null) {
  return {
    id: c.id,
    name: c.name,
    status: c.operationStatus,
    objectiveType: c.objectiveType,
    budgetMode: c.budgetMode,
    budgetOptimizeOn: c.budgetOptimizeOn,
    automationType: c.automationType,
    adGroupCount,
    capturedAt: NOW.toISOString(),
  };
}

function snapGroup(g: TikTokAttachAdGroup) {
  return {
    id: g.id,
    name: g.name,
    campaignId: g.campaignId,
    campaignName: g.campaignName ?? g.campaignId,
    status: g.operationStatus,
    optimizationGoal: g.optimizationGoal,
    optimizationEvent: g.optimizationEvent,
    pixelId: g.pixelId,
    automationType: g.automationType,
    capturedAt: NOW.toISOString(),
  };
}

const OPTS = { now: NOW, advertiserTimezone: "Europe/London" };

afterEach(() => {
  delete process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED;
});

describe("attach_campaign plan", () => {
  it("creates the draft's ad groups under each campaign; CBO sends no ad-group budget", () => {
    const abo = campaign("c_abo");
    const cbo = campaign("c_cbo", { budgetOptimizeOn: true, budgetMode: "BUDGET_MODE_DAY" });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(abo), snap(cbo)] };

    const out = planTikTokAttachLaunch(
      draft,
      live([abo, cbo], [adGroup("g1", "c_abo"), adGroup("g2", "c_cbo")]),
      OPTS,
    );

    assert.equal(out.ok, true, JSON.stringify(out.issues));
    const plan = out.plan!;
    assert.deepEqual(plan.counts, { campaigns: 2, adGroupsCreated: 4, adGroupTargets: 0, ads: 6 });
    const [aboPlan, cboPlan] = plan.campaigns;
    assert.deepEqual(aboPlan!.adGroups.map((g) => g.payload.campaign_id), ["c_abo", "c_abo"]);
    assert.deepEqual(aboPlan!.adGroups.map((g) => g.payload.budget), [60, 50]);
    assert.deepEqual(aboPlan!.adGroups.map((g) => g.payload.budget_mode), ["BUDGET_MODE_DAY", "BUDGET_MODE_DAY"]);
    for (const group of cboPlan!.adGroups) {
      assert.equal(group.payload.campaign_id, "c_cbo");
      assert.equal("budget" in group.payload, false);
      assert.equal("budget_mode" in group.payload, false);
    }
  });

  it("CBO skips the draft's ad-group budget floor (the campaign owns the budget)", () => {
    const cbo = campaign("c_cbo", { budgetOptimizeOn: true });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(cbo)] };
    draft.budgetSchedule = {
      ...draft.budgetSchedule,
      budgetAmount: null,
      adGroups: draft.budgetSchedule.adGroups.map((g) => ({ ...g, budget: 5 })),
    };
    const out = planTikTokAttachLaunch(draft, live([cbo], []), OPTS);
    assert.equal(out.ok, true, JSON.stringify(out.issues));
  });

  it("builds new ad groups for the campaign's objective, not the draft's", () => {
    const lead = campaign("c_lead", { objectiveType: "LEAD_GENERATION", salesDestination: null });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(lead)] };
    assert.equal(draft.campaignSetup.objective, "CONVERSIONS");

    const out = planTikTokAttachLaunch(
      draft,
      live([lead], [adGroup("g1", "c_lead", { optimizationEvent: "ON_WEB_REGISTER", pixelId: "pixel_lead" })]),
      OPTS,
    );

    assert.equal(out.ok, true, JSON.stringify(out.issues));
    const payload = out.plan!.campaigns[0]!.adGroups[0]!.payload;
    assert.equal(payload.promotion_type, "LEAD_GENERATION");
    assert.equal(payload.promotion_target_type, "EXTERNAL_WEBSITE");
    assert.equal(payload.pixel_id, "pixel_lead");
    assert.equal(payload.optimization_event, "ON_WEB_REGISTER");
  });

  it("blocks an optimisation goal the campaign's objective does not allow, naming both", () => {
    const traffic = campaign("c_traffic", { objectiveType: "TRAFFIC", salesDestination: null });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(traffic)] };

    const out = planTikTokAttachLaunch(draft, live([traffic], []), OPTS);

    assert.equal(out.ok, false);
    assert.equal(out.plan, null);
    const mismatch = out.issues.find((i) => i.id === "attach-objective-goal-c_traffic");
    assert.ok(mismatch, JSON.stringify(out.issues));
    assert.match(mismatch.message, /TRAFFIC/);
    assert.match(mismatch.message, /CONVERSION/);
    assert.match(mismatch.message, /Campaign c_traffic/);
  });

  it("blocks an objective the launcher cannot build ad groups for", () => {
    const engagement = campaign("c_eng", { objectiveType: "ENGAGEMENT", salesDestination: null });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(engagement)] };
    const out = planTikTokAttachLaunch(draft, live([engagement], []), OPTS);
    assert.equal(out.ok, false);
    assert.match(out.issues[0]!.message, /ENGAGEMENT/);
  });

  it("blocks a Smart+ campaign", () => {
    const smart = campaign("c_smart", { automationType: "UPGRADED_SMART_PLUS" });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(smart)] };
    const out = planTikTokAttachLaunch(draft, live([smart], []), OPTS);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((i) => i.id === "attach-smart-plus-c_smart" && /Smart\+/.test(i.message)));
  });

  it("inherits the most common pixel + event from the campaign's ad groups", () => {
    const c = campaign("c1");
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(c)] };
    const groups = [
      adGroup("g1", "c1", { pixelId: "pixel_a", optimizationEvent: "SHOPPING" }),
      adGroup("g2", "c1", { pixelId: "pixel_b", optimizationEvent: "ON_WEB_REGISTER" }),
      adGroup("g3", "c1", { pixelId: "pixel_b", optimizationEvent: "ON_WEB_REGISTER" }),
      adGroup("g4", "c1", { pixelId: null, optimizationEvent: null }),
    ];
    assert.deepEqual(inheritTikTokConversion(groups), {
      pixelId: "pixel_b",
      optimisationEvent: "ON_WEB_REGISTER",
      matching: 2,
      withPixel: 3,
    });
    // Under Sales, ON_WEB_REGISTER is on the deny-list (Ads Manager can't
    // edit the result), so the most common allowed pair wins.
    const out = planTikTokAttachLaunch(draft, live([c], groups), OPTS);
    assert.equal(out.ok, true, JSON.stringify(out.issues));
    const conversion = out.plan!.campaigns[0]!.conversion!;
    assert.equal(conversion.source, "inherited");
    assert.equal(conversion.pixelId, "pixel_a");
    assert.equal(conversion.optimisationEvent, "SHOPPING");
    assert.equal(out.plan!.campaigns[0]!.adGroups[0]!.payload.pixel_id, "pixel_a");
  });

  it("falls back to the draft's pixel, with a warning, when every inherited pair is denied", () => {
    const c = campaign("c1");
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(c)] };
    const groups = [adGroup("g1", "c1", { pixelId: "pixel_b", optimizationEvent: "ON_WEB_REGISTER" })];
    const out = planTikTokAttachLaunch(draft, live([c], groups), OPTS);
    assert.equal(out.ok, true, JSON.stringify(out.issues));
    assert.equal(out.plan!.campaigns[0]!.conversion!.source, "draft");
    assert.equal(out.plan!.campaigns[0]!.adGroups[0]!.payload.pixel_id, "pixel_draft");
    assert.ok(out.warnings.some((w) => w.id === "attach-conversion-draft-c1"));
  });

  it("the operator override beats the inherited pixel", () => {
    const c = campaign("c1");
    const draft = {
      ...salesDraft(),
      launchMode: "attach_campaign" as const,
      attachCampaigns: [snap(c)],
      attachConversionOverride: { pixelId: "pixel_draft", optimisationEvent: "SHOPPING" },
    };
    const out = planTikTokAttachLaunch(draft, live([c], [adGroup("g1", "c1", { pixelId: "pixel_b" })]), OPTS);
    assert.equal(out.plan!.campaigns[0]!.conversion!.source, "override");
    assert.equal(out.plan!.campaigns[0]!.adGroups[0]!.payload.pixel_id, "pixel_draft");
  });

  it("blocks a campaign a successful read no longer returns; a failed read falls back to the snapshot", () => {
    const c = campaign("c1");
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(c)] };
    const gone = planTikTokAttachLaunch(draft, live([], []), OPTS);
    assert.ok(gone.issues.some((i) => i.id === "attach-campaign-missing-c1"));

    const fromSnapshot = collectTikTokDraftLaunchPreflight(draft, OPTS);
    assert.equal(fromSnapshot.ok, true, JSON.stringify(fromSnapshot.issues));
  });

  it("launchPaused makes the new ad groups and ads DISABLE", () => {
    const c = campaign("c1");
    const draft = {
      ...salesDraft(),
      launchPaused: true,
      launchMode: "attach_campaign" as const,
      attachCampaigns: [snap(c)],
    };
    const out = planTikTokAttachLaunch(draft, live([c], []), OPTS);
    for (const group of out.plan!.campaigns[0]!.adGroups) {
      assert.equal(group.payload.operation_status, "DISABLE");
      for (const ad of group.ads) assert.equal(ad.draft.launchPaused, true);
    }
  });
});

describe("ads-only plans", () => {
  it("attach_adgroup spans campaigns and creates only ads", () => {
    const c1 = campaign("c1");
    const c2 = campaign("c2", { objectiveType: "LEAD_GENERATION", salesDestination: null });
    const g1 = adGroup("g1", "c1");
    const g2 = adGroup("g2", "c2");
    const draft = {
      ...salesDraft(),
      launchMode: "attach_adgroup" as const,
      attachCampaigns: [snap(c1), snap(c2)],
      attachAdGroups: [snapGroup(g1), snapGroup(g2)],
    };

    const out = planTikTokAttachLaunch(draft, live([c1, c2], [g1, g2, adGroup("g_other", "c1")]), OPTS);

    assert.equal(out.ok, true, JSON.stringify(out.issues));
    const plan = out.plan!;
    assert.equal(plan.campaigns.length, 0);
    assert.deepEqual(plan.counts, { campaigns: 2, adGroupsCreated: 0, adGroupTargets: 2, ads: 4 });
    assert.deepEqual(
      plan.adGroups.flatMap((g) => g.ads.map((ad) => ad.payload.adgroup_id)),
      ["g1", "g1", "g2", "g2"],
    );
    const creative = (plan.adGroups[0]!.ads[0]!.payload.creatives as Array<Record<string, unknown>>)[0]!;
    assert.equal(creative.identity_id, "identity_1");
    assert.equal(creative.landing_page_url, "https://example.com");
    assert.equal(creative.call_to_action, "LEARN_MORE");
  });

  it("blocks a Smart+ ad group even inside a manual campaign", () => {
    const c1 = campaign("c1");
    const smart = adGroup("g_smart", "c1", { automationType: "UPGRADED_SMART_PLUS" });
    const draft = {
      ...salesDraft(),
      launchMode: "attach_adgroup" as const,
      attachAdGroups: [snapGroup(smart)],
    };
    const out = planTikTokAttachLaunch(draft, live([c1], [smart]), OPTS);
    assert.equal(out.ok, false);
    assert.ok(out.issues.some((i) => /Ad group "Ad group g_smart" is Smart\+/.test(i.message)));
  });

  it("blocks an ad group a successful read no longer returns", () => {
    const c1 = campaign("c1");
    const g1 = adGroup("g1", "c1");
    const draft = { ...salesDraft(), launchMode: "attach_adgroup" as const, attachAdGroups: [snapGroup(g1)] };
    const out = planTikTokAttachLaunch(draft, live([c1], []), OPTS);
    assert.ok(out.issues.some((i) => i.id === "attach-adgroup-missing-g1"));
  });

  it("attach_all_adgroups adds ads to every live ad group of the campaigns", () => {
    const c1 = campaign("c1");
    const c2 = campaign("c2");
    const groups = [adGroup("g1", "c1"), adGroup("g2", "c1", { operationStatus: "DISABLE" }), adGroup("g3", "c2")];
    const draft = { ...salesDraft(), launchMode: "attach_all_adgroups" as const, attachCampaigns: [snap(c1)] };

    const out = planTikTokAttachLaunch(draft, live([c1, c2], groups), OPTS);

    assert.equal(out.ok, true, JSON.stringify(out.issues));
    assert.deepEqual(out.plan!.adGroups.map((g) => g.adGroupId), ["g1", "g2"]);
    assert.equal(out.plan!.counts.ads, 4);
    assert.ok(out.warnings.some((w) => w.id === "attach-adgroup-paused-g2"));
  });

  it("attach_all_adgroups refuses when the ad-group read failed — there is nothing to attach to", () => {
    const c1 = campaign("c1");
    const draft = { ...salesDraft(), launchMode: "attach_all_adgroups" as const, attachCampaigns: [snap(c1)] };
    const out = planTikTokAttachLaunch(
      draft,
      { source: "snapshot", campaigns: [c1], adGroups: [], adGroupReadFailed: ["c1"] },
      OPTS,
    );
    assert.ok(out.issues.some((i) => i.id === "attach-adgroup-read-c1"));
  });

  it("launchPaused makes the new ads DISABLE; no payload targets an existing ad group's status", () => {
    const c1 = campaign("c1");
    const g1 = adGroup("g1", "c1");
    const draft = {
      ...salesDraft(),
      launchPaused: true,
      launchMode: "attach_adgroup" as const,
      attachAdGroups: [snapGroup(g1)],
    };
    const out = planTikTokAttachLaunch(draft, live([c1], [g1]), OPTS);
    for (const ad of out.plan!.adGroups[0]!.ads) {
      assert.equal(ad.payload.operation_status, "DISABLE");
      assert.equal(ad.payload.adgroup_id, "g1");
    }
  });

  it("the idempotency hash includes the target ad group, so two targets never collide", () => {
    const c1 = campaign("c1");
    const g1 = adGroup("g1", "c1");
    const g2 = adGroup("g2", "c1");
    const draft = {
      ...salesDraft(),
      launchMode: "attach_adgroup" as const,
      attachAdGroups: [snapGroup(g1), snapGroup(g2)],
    };
    const plan = planTikTokAttachLaunch(draft, live([c1], [g1, g2]), OPTS).plan!;
    const a = plan.adGroups[0]!.ads[0]!.payload;
    const b = plan.adGroups[1]!.ads[0]!.payload;
    assert.notEqual(hashTikTokWritePayload(a), hashTikTokWritePayload(b));
  });
});

describe("Review summary", () => {
  it("states what is created where", () => {
    const c1 = campaign("c1");
    const c2 = campaign("c2", { budgetOptimizeOn: true });
    const draft = { ...salesDraft(), launchMode: "attach_campaign" as const, attachCampaigns: [snap(c1), snap(c2)] };
    const summary = describeTikTokAttachLaunch(draft)!;
    assert.equal(summary.headline, "2 ad groups × 2 campaigns, 6 ads");
    assert.match(summary.into[1]!, /no ad-group budget sent/);

    const adGroupDraft = {
      ...salesDraft(),
      launchMode: "attach_adgroup" as const,
      attachAdGroups: [snapGroup(adGroup("g1", "c1")), snapGroup(adGroup("g2", "c2"))],
    };
    assert.equal(describeTikTokAttachLaunch(adGroupDraft)!.headline, "2 ads × 2 ad groups in 2 campaigns, 4 ads");
    assert.equal(describeTikTokAttachLaunch(salesDraft()), null);
  });
});

describe("new mode is unchanged", () => {
  it("sends byte-identical bodies to main (golden captured before this change)", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    for (const paused of [false, true] as const) {
      const draft = salesDraft();
      draft.launchPaused = paused;
      const mock = createMockTikTokClient();
      await launchTikTokDraftState(
        { ...ATTACH_CONTEXT, supabase: memoryLedger() as unknown as SupabaseClient, request: mock.tiktokPost },
        draft,
      );
      const calls = mock.calls.map((c) => ({ path: c.path, body: c.body }));
      assert.equal(JSON.stringify(calls), JSON.stringify(paused ? golden.paused : golden.live));
    }
  });

  it("the mode-aware preflight is the old preflight for new drafts", () => {
    const draft = salesDraft();
    const { attachPlan, ...rest } = collectTikTokDraftLaunchPreflight(draft, OPTS);
    assert.equal(attachPlan, null);
    assert.deepEqual(rest, collectTikTokLaunchPreflight(draft, OPTS));
  });
});

describe("draft persistence", () => {
  it("migrate keeps a valid mode and selections and drops an unknown mode", () => {
    const c = campaign("c1");
    const kept = migrateTikTokDraft({ ...salesDraft(), launchMode: "attach_campaign", attachCampaigns: [snap(c)] });
    assert.equal(kept.launchMode, "attach_campaign");
    assert.equal(kept.attachCampaigns?.[0]?.name, "Campaign c1");
    const dropped = migrateTikTokDraft({ ...salesDraft(), launchMode: "bogus" });
    assert.equal(dropped.launchMode, undefined);
  });

  it("a duplicate starts as a new campaign with no targets", () => {
    const c = campaign("c1");
    const copy = duplicateTikTokDraftState(
      { ...salesDraft(), launchMode: "attach_campaign", attachCampaigns: [snap(c)] },
      "00000000-0000-0000-0000-000000000099",
      [],
      NOW,
    );
    assert.equal(copy.launchMode, undefined);
    assert.equal(copy.attachCampaigns, undefined);
  });
});

describe("attach reads", () => {
  it("drops deleted rows, asks for the verified fields, and chunks campaign_ids at 100", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const request = (async (_path: string, params: Record<string, unknown>) => {
      calls.push(params);
      const ids = (params.filtering as { campaign_ids: string[] }).campaign_ids;
      return {
        list: [
          { adgroup_id: `${ids[0]}_live`, campaign_id: ids[0], operation_status: "ENABLE", secondary_status: "ADGROUP_STATUS_DELIVERY_OK" },
          { adgroup_id: `${ids[0]}_gone`, campaign_id: ids[0], operation_status: "DISABLE", secondary_status: "ADGROUP_STATUS_DELETE" },
          { adgroup_id: `${ids[0]}_del`, campaign_id: ids[0], operation_status: "DELETE", secondary_status: null },
        ],
        page_info: { page: 1, total_page: 1 },
      };
    }) as never;
    const ids = Array.from({ length: 150 }, (_, i) => `c${i}`);
    const rows = await listTikTokAttachAdGroups({ advertiserId: "adv", token: "t", campaignIds: ids, request });
    assert.equal(calls.length, 2);
    assert.equal((calls[0]!.filtering as { campaign_ids: string[] }).campaign_ids.length, 100);
    assert.equal((calls[1]!.filtering as { campaign_ids: string[] }).campaign_ids.length, 50);
    assert.ok((calls[0]!.fields as string[]).includes("pixel_id"));
    assert.deepEqual(rows.map((r) => r.id), ["c0_live", "c100_live"]);
  });
});

function memoryLedger() {
  const rows: Array<Record<string, unknown>> = [];
  return {
    from() {
      const eqs: Record<string, unknown> = {};
      let upserted: Record<string, unknown> | null = null;
      let patch: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        eq(col: string, val: unknown) {
          eqs[col] = val;
          if (patch) {
            const row = rows.find((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
            if (row) Object.assign(row, patch);
          }
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          upserted = { id: `row_${rows.length}`, ...payload };
          rows.push(upserted);
          return builder;
        },
        update(next: Record<string, unknown>) {
          patch = next;
          return builder;
        },
        maybeSingle: async () => ({ data: upserted ? { id: upserted.id } : null, error: null }),
      };
      return builder;
    },
  };
}
