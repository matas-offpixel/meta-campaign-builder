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
import { handleTikTokLaunch } from "../launch.ts";
import type { Database } from "../../../db/database.types.ts";
import type { TikTokCampaignDraft } from "../../../types/tiktok-draft.ts";

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
        if (patch) this.rows.filter(match).forEach((row) => Object.assign(row, patch));
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
    return builder;
  }
}

type Call = { path: string; body: Record<string, BodyValue> };

/** `prefix` keeps ids unique across runs that share a ledger, as TikTok's are. */
function recorder(fail: (path: string, nth: number) => boolean = () => false, prefix = "new") {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  let seq = 0;
  const request = async <T,>(path: string, body: Record<string, BodyValue>): Promise<T> => {
    calls.push({ path, body });
    seen[path] = (seen[path] ?? 0) + 1;
    if (fail(path, seen[path]!)) throw new TikTokApiError("rejected", 40002, `req-${seq}`, 400);
    seq += 1;
    if (path === "/adgroup/create/") return { adgroup_id: `${prefix}_ag_${seq}` } as T;
    if (path === "/ad/create/") return { ad_id: `${prefix}_ad_${seq}` } as T;
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

/** One campaign; one draft ad group per name, one ad each. */
function adGroupPlan(names: string[], paused = false): TikTokAttachPlan {
  const c = campaign("existing_campaign");
  const draft = salesDraft();
  draft.launchPaused = paused;
  draft.budgetSchedule.adGroups = names.map((name) => ({
    id: `ag-${name}`,
    name,
    budget: 50,
    startAt: null,
    endAt: null,
  }));
  draft.creativeAssignments.byAdGroupId = Object.fromEntries(names.map((name) => [`ag-${name}`, ["creative-1"]]));
  const out = planTikTokAttachLaunch(
    { ...draft, launchMode: "attach_campaign", attachCampaigns: [snap(c)] },
    { source: "live", campaigns: [c], adGroups: [adGroup("existing_ag", c.id)] },
    OPTS,
  );
  assert.ok(out.plan, JSON.stringify(out.issues));
  return out.plan;
}

function threeAdGroupPlan(paused = false): TikTokAttachPlan {
  return adGroupPlan(["A", "B", "C"], paused);
}

function adsOnlyPlan(paused = false, only?: "existing_g1"): TikTokAttachPlan {
  const c1 = campaign("existing_c1");
  const c2 = campaign("existing_c2");
  const g1 = adGroup("existing_g1", c1.id);
  const g2 = adGroup("existing_g2", c2.id);
  const draft = salesDraft();
  draft.launchPaused = paused;
  const picks = only ? [g1] : [g1, g2];
  const out = planTikTokAttachLaunch(
    { ...draft, launchMode: "attach_adgroup", attachAdGroups: picks.map(snapGroup) },
    { source: "live", campaigns: [c1, c2], adGroups: [g1, g2] },
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

  it("rows for objects the cleanup could not delete are marked failed, so a retry creates instead of reusing them", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const ledger = new Ledger();
    const first = recorder(
      (path, nth) => (path === "/adgroup/create/" && nth === 2) || path === TIKTOK_ADGROUP_STATUS_UPDATE_PATH,
    );
    await assert.rejects(launchTikTokAttachPlan(context(ledger, first.request), threeAdGroupPlan()));
    const orphanGroup = ledger.rows.find((r) => r.op_result_id === "new_ag_1")!;
    const orphanAd = ledger.rows.find((r) => r.op_result_id === "new_ad_2")!;
    assert.equal(orphanGroup.op_status, "failed");
    assert.equal(orphanAd.op_status, "failed");
    assert.deepEqual(ledger.rows.filter((r) => r.op_status === "success"), []);

    const retry = recorder(() => false, "retry");
    const out = await launchTikTokAttachPlan(context(ledger, retry.request), threeAdGroupPlan());
    assert.equal(retry.calls.filter((c) => c.path === "/adgroup/create/").length, 3);
    assert.equal(out.adgroup_ids.includes("new_ag_1"), false);
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

describe("ids reused from an earlier launch are never deleted", () => {
  it("a real ledger hit on an ad group survives a later failure, and so does its ledger row", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const ledger = new Ledger();
    const first = recorder();
    const earlier = await launchTikTokAttachPlan(context(ledger, first.request), adGroupPlan(["A"]));
    const [liveGroup] = earlier.adgroup_ids;
    const [liveAd] = earlier.ad_ids;
    assert.ok(liveGroup && liveAd);

    // Same draft, same target: A hashes identically and is reused; B is
    // created; C fails.
    const second = recorder((path, nth) => path === "/adgroup/create/" && nth === 2, "run2");
    await assert.rejects(
      launchTikTokAttachPlan(context(ledger, second.request), adGroupPlan(["A", "B", "C"])),
      /rejected/,
    );

    assert.deepEqual(second.calls.map((c) => c.path), [
      "/adgroup/create/",
      "/ad/create/",
      "/adgroup/create/",
      TIKTOK_ADGROUP_STATUS_UPDATE_PATH,
    ]);
    const createdB = "run2_ag_1";
    assert.deepEqual(second.calls.at(-1)!.body.adgroup_ids, [createdB]);
    for (const call of second.calls) {
      const ids = [...((call.body.adgroup_ids as string[]) ?? []), ...((call.body.ad_ids as string[]) ?? [])];
      assert.equal(ids.includes(liveGroup), false, `deleted reused ad group ${liveGroup}`);
      assert.equal(ids.includes(liveAd), false, `deleted reused ad ${liveAd}`);
    }
    const survivors = ledger.rows.filter((r) => r.op_status === "success").map((r) => r.op_result_id);
    assert.deepEqual(survivors.sort(), [liveAd, liveGroup].sort());
  });

  it("a real ledger hit on an ad in an existing ad group survives a later failure", async () => {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const ledger = new Ledger();
    const first = recorder();
    const earlier = await launchTikTokAttachPlan(context(ledger, first.request), adsOnlyPlan(false, "existing_g1"));
    assert.equal(earlier.ad_ids.length, 2);

    // g1's two ads are reused; g2's first ad is created, its second fails.
    const second = recorder((path, nth) => path === "/ad/create/" && nth === 2, "run2");
    await assert.rejects(launchTikTokAttachPlan(context(ledger, second.request), adsOnlyPlan()), /rejected/);

    assert.deepEqual(second.calls.map((c) => c.path), ["/ad/create/", "/ad/create/", TIKTOK_AD_STATUS_UPDATE_PATH]);
    assert.deepEqual(second.calls.at(-1)!.body.ad_ids, ["run2_ad_1"]);
    assertNoTargetTouched(second.calls);
    const survivors = ledger.rows.filter((r) => r.op_status === "success").map((r) => r.op_result_id);
    assert.deepEqual(survivors.sort(), [...earlier.ad_ids].sort());
  });

  it("the guard drops reused ids from every status call, ads as well as ad groups", async () => {
    const { calls, request } = recorder();
    await rollbackTikTokAttach(context(new Ledger(), request), adsOnlyPlan(), {
      adgroupIds: ["reused_ag", "new_ag_9"],
      nestedAdIds: [],
      looseAdIds: ["reused_ad", "existing_g1", "new_ad_9"],
      reusedIds: ["reused_ag", "reused_ad"],
    });
    assert.deepEqual(
      calls.map((c) => [c.path, c.body.adgroup_ids ?? c.body.ad_ids]),
      [
        [TIKTOK_ADGROUP_STATUS_UPDATE_PATH, ["new_ag_9"]],
        [TIKTOK_AD_STATUS_UPDATE_PATH, ["new_ad_9"]],
      ],
    );
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

/** Serves one draft row; every other table reads empty. Records what was asked. */
function draftSession(draft: TikTokCampaignDraft) {
  const tables: string[] = [];
  const session = {
    from(table: string) {
      tables.push(table);
      const data =
        table === "tiktok_campaign_drafts"
          ? {
              id: draft.id,
              client_id: null,
              event_id: draft.eventId,
              status: draft.status,
              state: draft,
              created_at: NOW.toISOString(),
              updated_at: NOW.toISOString(),
            }
          : null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data, error: null }),
      };
      return builder;
    },
    rpc() {
      tables.push("rpc");
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { session, tables };
}

describe("relaunching an attach draft", () => {
  function publishedAttachDraft(): TikTokCampaignDraft {
    const g1 = adGroup("existing_g1", "existing_c1");
    return {
      ...salesDraft(),
      id: ATTACH_CONTEXT.draftId,
      eventId: ATTACH_CONTEXT.eventId,
      status: "published",
      launchMode: "attach_adgroup",
      attachAdGroups: [snapGroup(g1)],
      publishedIds: {
        campaignId: "existing_c1",
        adgroupIds: [],
        adIds: ["live_ad_1", "live_ad_2"],
        launchedAt: "2027-08-01T10:00:00.000Z",
        launchMode: "attach_adgroup",
        campaignIds: ["existing_c1"],
      },
    };
  }

  async function launch(draft: TikTokCampaignDraft) {
    process.env.OFFPIXEL_TIKTOK_WRITES_ENABLED = "true";
    const { session, tables } = draftSession(draft);
    const posts = recorder();
    let gets = 0;
    const requestGet = (async () => {
      gets += 1;
      return {};
    }) as never;
    const result = await handleTikTokLaunch({
      userId: ATTACH_CONTEXT.userId,
      draftId: draft.id,
      session: session as unknown as SupabaseClient<Database>,
      admin: new Ledger() as unknown as SupabaseClient,
      request: posts.request,
      requestGet,
      sleep: async () => {},
    });
    return { result, tables, posts: posts.calls.length, gets };
  }

  it("returns 409 with zero TikTok calls when the draft already launched", async () => {
    const { result, tables, posts, gets } = await launch(publishedAttachDraft());
    assert.equal(result.status, 409);
    assert.equal(result.body.ok, false);
    assert.match((result.body as { error: string }).error, /already launched into existing TikTok objects on 2027-08-01.*Duplicate the draft/);
    assert.equal(posts, 0);
    assert.equal(gets, 0);
    assert.deepEqual(tables, ["tiktok_campaign_drafts"]);
  });

  it("refuses on either record: publishedIds alone, or status published alone", async () => {
    const idsOnly = { ...publishedAttachDraft(), status: "draft" as const };
    const statusOnly = { ...publishedAttachDraft(), publishedIds: null };
    assert.equal((await launch(idsOnly)).result.status, 409);
    assert.equal((await launch(statusOnly)).result.status, 409);
  });

  it("new mode is not gated: a published new-mode draft gets past the check as before", async () => {
    const draft = { ...publishedAttachDraft(), launchMode: "new" as const };
    const { result, tables } = await launch(draft);
    assert.notEqual(result.status, 409);
    assert.ok(tables.includes("tiktok_accounts"), JSON.stringify(tables));
  });
});
