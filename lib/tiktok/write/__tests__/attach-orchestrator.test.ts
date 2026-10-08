import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { planTikTokAttachLaunch, type TikTokAttachPlan } from "../../attach/plan.ts";
import type { TikTokAttachAdGroup, TikTokAttachCampaign } from "../../attach/targets.ts";
import { ATTACH_CONTEXT, salesDraft } from "../../attach/__tests__/fixtures.ts";
import { TikTokApiError, type BodyValue } from "../../client.ts";
import {
  TIKTOK_ADGROUP_STATUS_UPDATE_PATH,
  TIKTOK_AD_STATUS_UPDATE_PATH,
  launchTikTokAttachPlan,
  rollbackTikTokAttach,
} from "../attach-orchestrator.ts";
import { TIKTOK_CAMPAIGN_STATUS_UPDATE_PATH } from "../orchestrator.ts";

const NOW = new Date("2027-08-01T00:00:00Z");
const OPTS = { now: NOW, advertiserTimezone: "Europe/London" };

type Row = {
  id: string;
  draft_id: string;
  op_kind: string;
  op_payload_hash: string;
  op_result_id: string | null;
  op_status: string;
};

/** tiktok_write_idempotency in memory: select/eq/in/upsert/update/delete. */
class Ledger {
  rows: Row[] = [];
  from(table: string) {
    assert.equal(table, "tiktok_write_idempotency");
    const eqs: Record<string, unknown> = {};
    const ins: Record<string, unknown[]> = {};
    let upserted: Row | null = null;
    let patch: Record<string, unknown> | null = null;
    let deleting = false;
    const match = (row: Row) =>
      Object.entries(eqs).every(([k, v]) => row[k as keyof Row] === v) &&
      Object.entries(ins).every(([k, vs]) => vs.includes(row[k as keyof Row]));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        eqs[col] = val;
        if (patch) this.rows.filter(match).forEach((row) => Object.assign(row, patch));
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        ins[col] = vals;
        return builder;
      },
      upsert: (payload: Row) => {
        const existing = this.rows.find(
          (r) =>
            r.draft_id === payload.draft_id &&
            r.op_kind === payload.op_kind &&
            r.op_payload_hash === payload.op_payload_hash,
        );
        if (existing) {
          Object.assign(existing, payload);
          upserted = existing;
        } else {
          upserted = { ...payload, id: `row_${this.rows.length + 1}`, op_result_id: null };
          this.rows.push(upserted);
        }
        return builder;
      },
      update: (next: Record<string, unknown>) => {
        patch = next;
        return builder;
      },
      delete: () => {
        deleting = true;
        return builder;
      },
      maybeSingle: async () => {
        if (upserted) return { data: { id: upserted.id }, error: null };
        return { data: this.rows.find(match) ?? null, error: null };
      },
      then: (resolve: (v: { data: null; error: null }) => unknown) => {
        if (deleting) this.rows = this.rows.filter((row) => !match(row));
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
    return builder;
  }
}

type Call = { path: string; body: Record<string, BodyValue> };

function recorder(fail: (path: string, nth: number) => boolean = () => false) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  let seq = 0;
  const request = async <T,>(path: string, body: Record<string, BodyValue>): Promise<T> => {
    calls.push({ path, body });
    seen[path] = (seen[path] ?? 0) + 1;
    if (fail(path, seen[path]!)) throw new TikTokApiError("rejected", 40002, `req-${seq}`, 400);
    seq += 1;
    if (path === "/adgroup/create/") return { adgroup_id: `new_ag_${seq}` } as T;
    if (path === "/ad/create/") return { ad_id: `new_ad_${seq}` } as T;
    return {} as T;
  };
  return { calls, request };
}

function campaign(id: string): TikTokAttachCampaign {
  return {
    id,
    name: `Campaign ${id}`,
    operationStatus: "ENABLE",
    secondaryStatus: null,
    objectiveType: "WEB_CONVERSIONS",
    salesDestination: "WEBSITE",
    budgetMode: "BUDGET_MODE_INFINITE",
    budgetOptimizeOn: false,
    automationType: "MANUAL",
    isSmartPerformanceCampaign: false,
  };
}

function adGroup(id: string, campaignId: string): TikTokAttachAdGroup {
  return {
    id,
    name: `Ad group ${id}`,
    campaignId,
    campaignName: null,
    operationStatus: "ENABLE",
    secondaryStatus: null,
    optimizationGoal: "CONVERT",
    optimizationEvent: "SHOPPING",
    pixelId: "pixel_live",
    promotionType: "WEBSITE",
    automationType: "MANUAL",
    isSmartPerformanceCampaign: false,
  };
}

function snap(c: TikTokAttachCampaign) {
  return {
    id: c.id,
    name: c.name,
    status: c.operationStatus,
    objectiveType: c.objectiveType,
    budgetMode: c.budgetMode,
    budgetOptimizeOn: c.budgetOptimizeOn,
    automationType: c.automationType,
    adGroupCount: null,
    capturedAt: NOW.toISOString(),
  };
}

function snapGroup(g: TikTokAttachAdGroup) {
  return {
    id: g.id,
    name: g.name,
    campaignId: g.campaignId,
    campaignName: `Campaign ${g.campaignId}`,
    status: g.operationStatus,
    optimizationGoal: g.optimizationGoal,
    optimizationEvent: g.optimizationEvent,
    pixelId: g.pixelId,
    automationType: g.automationType,
    capturedAt: NOW.toISOString(),
  };
}

/** One campaign, three draft ad groups with one ad each. */
function threeAdGroupPlan(paused = false): TikTokAttachPlan {
  const c = campaign("existing_campaign");
  const draft = salesDraft();
  draft.launchPaused = paused;
  draft.budgetSchedule.adGroups = ["A", "B", "C"].map((name, i) => ({
    id: `ag-${i}`,
    name,
    budget: 50,
    startAt: null,
    endAt: null,
  }));
  draft.creativeAssignments.byAdGroupId = { "ag-0": ["creative-1"], "ag-1": ["creative-1"], "ag-2": ["creative-1"] };
  const out = planTikTokAttachLaunch(
    { ...draft, launchMode: "attach_campaign", attachCampaigns: [snap(c)] },
    { source: "live", campaigns: [c], adGroups: [adGroup("existing_ag", c.id)], adGroupReadFailed: [] },
    OPTS,
  );
  assert.ok(out.plan, JSON.stringify(out.issues));
  return out.plan;
}

function adsOnlyPlan(paused = false): TikTokAttachPlan {
  const c1 = campaign("existing_c1");
  const c2 = campaign("existing_c2");
  const g1 = adGroup("existing_g1", c1.id);
  const g2 = adGroup("existing_g2", c2.id);
  const draft = salesDraft();
  draft.launchPaused = paused;
  const out = planTikTokAttachLaunch(
    { ...draft, launchMode: "attach_adgroup", attachAdGroups: [snapGroup(g1), snapGroup(g2)] },
    { source: "live", campaigns: [c1, c2], adGroups: [g1, g2], adGroupReadFailed: [] },
    OPTS,
  );
  assert.ok(out.plan, JSON.stringify(out.issues));
  return out.plan;
}

function context(ledger: Ledger, request: ReturnType<typeof recorder>["request"]) {
  return {
    ...ATTACH_CONTEXT,
    supabase: ledger as unknown as SupabaseClient,
    request,
    sleep: async () => {},
  };
}

const EXISTING_IDS = ["existing_campaign", "existing_ag", "existing_c1", "existing_c2", "existing_g1", "existing_g2"];

function assertNoTargetTouched(calls: Call[]) {
  for (const call of calls) {
    assert.notEqual(call.path, TIKTOK_CAMPAIGN_STATUS_UPDATE_PATH);
    assert.notEqual(call.path, "/campaign/create/");
    assert.notEqual(call.path, "/campaign/update/");
    assert.notEqual(call.path, "/adgroup/update/");
    if (call.path.endsWith("/status/update/")) {
      const ids = [...((call.body.adgroup_ids as string[]) ?? []), ...((call.body.ad_ids as string[]) ?? [])];
      for (const id of ids) assert.equal(EXISTING_IDS.includes(id), false, `deleted pre-existing ${id}`);
    }
  }
}

afterEach(() => {
  delete process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED;
});

describe("attach_campaign rollback", () => {
  it("a failure after the 2nd ad group deletes exactly the 2 new ad groups and never calls the campaign endpoint", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const ledger = new Ledger();
    ledger.rows.push({
      id: "earlier",
      draft_id: ATTACH_CONTEXT.draftId,
      op_kind: "adgroup_create",
      op_payload_hash: "earlier-launch",
      op_result_id: "ag_from_an_earlier_launch",
      op_status: "success",
    });
    const { calls, request } = recorder((path, nth) => path === "/adgroup/create/" && nth === 3);

    await assert.rejects(launchTikTokAttachPlan(context(ledger, request), threeAdGroupPlan()), /rejected/);

    assert.deepEqual(
      calls.map((c) => c.path),
      ["/adgroup/create/", "/ad/create/", "/adgroup/create/", "/ad/create/", "/adgroup/create/", TIKTOK_ADGROUP_STATUS_UPDATE_PATH],
    );
    const created = ["new_ag_1", "new_ag_3"];
    const cleanup = calls.at(-1)!;
    assert.deepEqual(cleanup.body, {
      advertiser_id: ATTACH_CONTEXT.advertiserId,
      adgroup_ids: created,
      operation_status: "DELETE",
    });
    assert.equal(calls.some((c) => c.path === TIKTOK_CAMPAIGN_STATUS_UPDATE_PATH), false);
    assertNoTargetTouched(calls);

    // Only this run's successful rows are cleared; the earlier launch keeps its ledger.
    assert.deepEqual(
      ledger.rows.map((r) => r.op_result_id),
      ["ag_from_an_earlier_launch", null],
    );
  });

  it("reports what it could not remove when the delete itself fails", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const { calls, request } = recorder(
      (path, nth) => (path === "/adgroup/create/" && nth === 2) || path === TIKTOK_ADGROUP_STATUS_UPDATE_PATH,
    );
    await assert.rejects(
      launchTikTokAttachPlan(context(new Ledger(), request), threeAdGroupPlan()),
      (err: unknown) => {
        assert.ok(err instanceof TikTokApiError);
        assert.match(err.message, /new_ag_1/);
        assert.match(err.message, /existing campaigns and ad groups were not changed/);
        return true;
      },
    );
    assertNoTargetTouched(calls);
  });

  it("launchPaused creates the new ad groups and ads DISABLE and sends nothing to the target", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const { calls, request } = recorder();
    const out = await launchTikTokAttachPlan(context(new Ledger(), request), threeAdGroupPlan(true));
    assert.equal(out.adgroup_ids.length, 3);
    assert.deepEqual(out.campaign_ids, ["existing_campaign"]);
    for (const call of calls) {
      assert.ok(call.path === "/adgroup/create/" || call.path === "/ad/create/", call.path);
      assert.equal(call.body.operation_status, "DISABLE");
    }
    assert.ok(calls.filter((c) => c.path === "/adgroup/create/").every((c) => c.body.campaign_id === "existing_campaign"));
  });

  it("a retry into the same campaign reuses the ledger instead of duplicating", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const ledger = new Ledger();
    const first = recorder();
    const plan = threeAdGroupPlan();
    const a = await launchTikTokAttachPlan(context(ledger, first.request), plan);
    const second = recorder();
    const b = await launchTikTokAttachPlan(context(ledger, second.request), plan);
    assert.equal(second.calls.length, 0);
    assert.deepEqual(b.adgroup_ids, a.adgroup_ids);
    assert.deepEqual(b.ad_ids, a.ad_ids);
  });
});

describe("ads-only rollback", () => {
  it("deletes only the ads it created, by ad id, and never an ad group or campaign", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const ledger = new Ledger();
    const { calls, request } = recorder((path, nth) => path === "/ad/create/" && nth === 3);

    await assert.rejects(launchTikTokAttachPlan(context(ledger, request), adsOnlyPlan()), /rejected/);

    assert.deepEqual(calls.map((c) => c.path), ["/ad/create/", "/ad/create/", "/ad/create/", TIKTOK_AD_STATUS_UPDATE_PATH]);
    assert.deepEqual(calls[3]!.body, {
      advertiser_id: ATTACH_CONTEXT.advertiserId,
      ad_ids: ["new_ad_1", "new_ad_2"],
      operation_status: "DELETE",
    });
    assert.equal(calls.some((c) => c.path === TIKTOK_ADGROUP_STATUS_UPDATE_PATH), false);
    assertNoTargetTouched(calls);
    assert.deepEqual(ledger.rows.map((r) => r.op_result_id), [null]);
  });

  it("writes ads into each existing ad group, paused when asked, and leaves the ad groups alone", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const { calls, request } = recorder();
    const out = await launchTikTokAttachPlan(context(new Ledger(), request), adsOnlyPlan(true));
    assert.equal(out.adgroup_ids.length, 0);
    assert.equal(out.ad_ids.length, 4);
    assert.deepEqual(out.campaign_ids, ["existing_c1", "existing_c2"]);
    assert.deepEqual(calls.map((c) => c.body.adgroup_id), ["existing_g1", "existing_g1", "existing_g2", "existing_g2"]);
    assert.ok(calls.every((c) => c.path === "/ad/create/" && c.body.operation_status === "DISABLE"));
  });

  it("the rollback guard never sends a target id even if one is passed as created", async () => {
    const { calls, request } = recorder();
    await rollbackTikTokAttach(context(new Ledger(), request), adsOnlyPlan(), {
      adgroupIds: ["existing_g1", "new_ag_9"],
      nestedAdIds: [],
      looseAdIds: [],
    });
    assert.deepEqual(calls.map((c) => c.body.adgroup_ids), [["new_ag_9"]]);
  });
});
