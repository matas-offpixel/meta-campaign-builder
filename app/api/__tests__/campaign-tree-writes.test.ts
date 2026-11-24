// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { FakeDb } from "@/lib/campaign-tree/__tests__/fake-db";

/**
 * The campaign tree's two write paths (R7, RC6), with Meta mocked: no Graph
 * call leaves the test. "Add creatives to…" runs through
 * POST /api/meta/bulk-attach-ads with `tree`; "Add audience to…" through
 * POST /api/meta/adset-audience with `addition`. Each Meta create or update
 * goes through the write ledger with `required`, and each run writes one
 * campaign_additions row per campaign. The acceptance line: "Add creatives
 * to…" on On sale writes one row per campaign.
 */

const USER = "b0000000-0000-4000-8000-000000000001";
const EVENT = "e0000000-0000-4000-8000-000000000001";
const RUN = "c0000000-0000-4000-8000-000000000001";
const PURCHASE = "120250000000002";
const TRAFFIC = "120250000000003";
const ADHOC = "120250000000004";

const state = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  ledger: new Map<string, string>(),
  ledgerCalls: [] as Array<{ op: string; draftId: string; payload: unknown; required: boolean }>,
  creatives: 0,
  ads: [] as string[],
  targetingWrites: [] as string[],
  failAdSet: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ from: () => ({}) }),
  createClient: async () => {
    const db = state.db;
    return Object.assign(db, {
      auth: { getUser: async () => ({ data: { user: { id: USER, user_metadata: { full_name: "Matas Example" } } } }) },
    });
  },
}));
vi.mock("@/lib/meta/write-idempotency", () => ({
  MetaWriteLedgerRequiredError: class extends Error {},
  invalidateMetaWritePayload: async () => undefined,
  withMetaWriteIdempotency: async (
    ctx: { draftId: string },
    op: string,
    payload: unknown,
    run: () => Promise<string>,
    options?: { required?: boolean },
  ) => {
    state.ledgerCalls.push({ op, draftId: ctx.draftId, payload, required: options?.required === true });
    const key = `${ctx.draftId}:${op}:${JSON.stringify(payload)}`;
    const done = state.ledger.get(key);
    if (done) return done;
    const id = await run();
    state.ledger.set(key, id);
    return id;
  },
}));
vi.mock("@/lib/meta/agency-token", () => ({ agencyMetaToken: () => "token", mayUseAgencyMetaToken: () => true }));
vi.mock("@/lib/launched-ads/launch-recorder", () => ({
  bindLaunchAdRecorder: async () => async () => undefined,
  noopRecordCreatedAd: async () => undefined,
}));
vi.mock("@/lib/meta/client", () => ({
  MetaApiError: class extends Error {},
  fetchAdSetGuardInfo: async () => new Map(),
  createMetaCreative: async () => ({ id: `cr${++state.creatives}` }),
  createMetaAd: async (_account: string, payload: { adset_id: string }) => {
    if (payload.adset_id === state.failAdSet) throw new Error("Meta said no");
    state.ads.push(payload.adset_id);
    return { id: `ad${state.ads.length}` };
  },
  graphGetWithToken: async (path: string) => {
    const adSetId = path.slice(1);
    const campaign = adSetId.startsWith("238001") ? PURCHASE : TRAFFIC;
    return { id: adSetId, name: `Ad set ${adSetId}`, effective_status: "ACTIVE", campaign_id: campaign, targeting: { geo_locations: { countries: ["GB"] } } };
  },
  graphPostWithToken: async (path: string) => {
    state.targetingWrites.push(path.slice(1));
    return {};
  },
}));
vi.mock("@/lib/meta/creative", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meta/creative")>()),
  buildCreativePayload: async () => ({ object_story_spec: {} }),
  buildAdPayload: (name: string, creativeId: string, adSetId: string) => ({ name, creative: { creative_id: creativeId }, adset_id: adSetId }),
  validateCreativePayload: () => ({ isValid: true, errors: [] }),
}));
vi.mock("@/lib/meta/ig-actor-validator", () => ({ createIgActorValidator: () => ({ validate: async () => null }) }));
vi.mock("@/lib/meta/page-token", () => ({ resolvePageIdentity: async () => ({ pageAccessToken: null }) }));
vi.mock("@/lib/meta/server-token", () => ({ resolveServerMetaToken: async () => ({ token: "token" }) }));
vi.mock("@/lib/meta/adset-targeting-write", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/meta/adset-targeting-write")>();
  return { ...real, adsetTargetingWritesEnabled: () => process.env.OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED === "true" };
});

function tables() {
  return {
    campaign_drafts: [
      { id: "d0000000-0000-4000-8000-000000000002", user_id: USER, event_id: EVENT, name: "[NX27-GLITTERBOX] PURCHASE", status: "published", objective: "purchase", ad_account_id: "act_1", draft_json: { metaCampaignId: PURCHASE } },
      { id: "d0000000-0000-4000-8000-000000000003", user_id: USER, event_id: EVENT, name: "[NX27-GLITTERBOX] TRAFFIC", status: "published", objective: "traffic", ad_account_id: "act_1", draft_json: { metaCampaignId: TRAFFIC } },
    ],
    launched_ad_sets: [],
    campaign_additions: [],
  };
}

const CREATIVES = [1, 2, 3].map((i) => ({ id: `c${i}`, name: `Static ${i}`, identity: { pageId: "", instagramActorId: "" } }));

function attachBody(campaignAdSets: Record<string, string[]>, tree: unknown = { eventId: EVENT, stage: "on_sale", runId: RUN }) {
  return new NextRequest("http://localhost/api/meta/bulk-attach-ads", {
    method: "POST",
    body: JSON.stringify({ adAccountId: "act_1", campaignAdSets, newCreatives: CREATIVES, ...(tree === null ? {} : { tree }) }),
  });
}

beforeEach(() => {
  state.db = new FakeDb(tables());
  state.ledger = new Map();
  state.ledgerCalls = [];
  state.creatives = 0;
  state.ads = [];
  state.targetingWrites = [];
  state.failAdSet = null;
  delete process.env.OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED;
});

describe("Add creatives to… (bulk-attach with a tree run)", () => {
  const selection = { [PURCHASE]: ["23800100001", "23800100002"], [TRAFFIC]: ["23800200001"] };

  it("puts every creative and ad on the ledger, required, and logs one campaign_additions row per campaign", async () => {
    const { POST } = await import("@/app/api/meta/bulk-attach-ads/route");
    const res = await POST(attachBody(selection));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalAdsCreated).toBe(9);
    // 3 creatives × 2 campaigns, 3 creatives × 3 ad sets.
    expect(state.ledgerCalls.filter((c) => c.op === "creative_upload")).toHaveLength(6);
    expect(state.ledgerCalls.filter((c) => c.op === "ad_create")).toHaveLength(9);
    expect(state.ledgerCalls.every((c) => c.required)).toBe(true);
    expect(new Set(state.ledgerCalls.filter((c) => c.payload && (c.payload as { campaign_id: string }).campaign_id === TRAFFIC).map((c) => c.draftId))).toEqual(
      new Set(["d0000000-0000-4000-8000-000000000003"]),
    );
    const rows = state.db.tables.campaign_additions!;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.meta_campaign_id, r.stage, r.kind, (r.meta_adset_ids as string[]).length, (r.detail as { creatives: number }).creatives, (r.detail as { who: string }).who])).toEqual([
      [PURCHASE, "on_sale", "creative", 2, 3, "Matas"],
      [TRAFFIC, "on_sale", "creative", 1, 3, "Matas"],
    ]);
    expect(rows.every((r) => r.user_id === USER && r.created_by === USER && r.event_id === EVENT)).toBe(true);
  });

  it("a retry of the same run makes nothing twice and keeps one row per campaign", async () => {
    const { POST } = await import("@/app/api/meta/bulk-attach-ads/route");
    state.failAdSet = "23800200001";
    const first = await (await POST(attachBody(selection))).json();
    expect(first.totalAdsCreated).toBe(6);
    expect(state.db.tables.campaign_additions).toHaveLength(1);
    state.failAdSet = null;
    const second = await (await POST(attachBody(selection))).json();
    expect(second.totalAdsCreated).toBe(3);
    expect(state.ads).toHaveLength(9);
    expect(state.creatives).toBe(6);
    expect(state.db.tables.campaign_additions).toHaveLength(2);
  });

  it("refuses a campaign with no published draft on the event, before any Meta call", async () => {
    const { POST } = await import("@/app/api/meta/bulk-attach-ads/route");
    const res = await POST(attachBody({ ...selection, [ADHOC]: ["23800300001"] }));
    expect(res.status).toBe(400);
    expect((await res.json()).missing).toEqual([ADHOC]);
    expect(state.creatives).toBe(0);
    expect(state.ads).toHaveLength(0);
  });

  it("refuses a malformed run", async () => {
    const { POST } = await import("@/app/api/meta/bulk-attach-ads/route");
    const res = await POST(attachBody(selection, { eventId: EVENT, stage: "later", runId: RUN }));
    expect(res.status).toBe(400);
    expect(state.creatives).toBe(0);
  });

  it("without a tree run, bulk-attach is unchanged: no ledger, no log", async () => {
    const { POST } = await import("@/app/api/meta/bulk-attach-ads/route");
    const res = await POST(attachBody(selection, null));
    expect(res.status).toBe(200);
    expect(state.ledgerCalls).toHaveLength(0);
    expect(state.db.tables.campaign_additions).toHaveLength(0);
  });
});

describe("Add audience to… (adset-audience with a tree run)", () => {
  function audienceBody(draftId: string, adSetIds: string[], addition: unknown = { eventId: EVENT, stage: "on_sale", runId: RUN }) {
    return new Request("http://localhost/api/meta/adset-audience", {
      method: "POST",
      body: JSON.stringify({
        draftId,
        audienceId: "6000000001",
        audienceName: "Techno page engagers",
        direction: "include",
        action: "add",
        adSetIds,
        commit: true,
        addition,
      }),
    });
  }

  it("stays behind OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED: 403, nothing written or logged", async () => {
    const { POST } = await import("@/app/api/meta/adset-audience/route");
    const res = await POST(audienceBody("d0000000-0000-4000-8000-000000000002", ["23800100001"]));
    expect(res.status).toBe(403);
    expect(state.targetingWrites).toHaveLength(0);
    expect(state.db.tables.campaign_additions).toHaveLength(0);
  });

  it("writes through the ledger and logs one row per campaign across batches", async () => {
    process.env.OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED = "true";
    const { POST } = await import("@/app/api/meta/adset-audience/route");
    expect((await POST(audienceBody("d0000000-0000-4000-8000-000000000002", ["23800100001"]))).status).toBe(200);
    expect((await POST(audienceBody("d0000000-0000-4000-8000-000000000002", ["23800100002"]))).status).toBe(200);
    expect((await POST(audienceBody("d0000000-0000-4000-8000-000000000003", ["23800200001"]))).status).toBe(200);
    expect(state.targetingWrites).toEqual(["23800100001", "23800100002", "23800200001"]);
    expect(state.ledgerCalls.map((c) => [c.op, c.required])).toEqual([
      ["adset_targeting_update", true],
      ["adset_targeting_update", true],
      ["adset_targeting_update", true],
    ]);
    const rows = state.db.tables.campaign_additions!;
    expect(rows.map((r) => [r.meta_campaign_id, r.kind, r.meta_adset_ids, (r.detail as { audienceName: string }).audienceName])).toEqual([
      [PURCHASE, "audience", ["23800100001", "23800100002"], "Techno page engagers"],
      [TRAFFIC, "audience", ["23800200001"], "Techno page engagers"],
    ]);
  });

  it("refuses a draft that isn't on the run's event", async () => {
    process.env.OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED = "true";
    state.db.tables.campaign_drafts![0]!.event_id = "e0000000-0000-4000-8000-00000000ffff";
    const { POST } = await import("@/app/api/meta/adset-audience/route");
    const res = await POST(audienceBody("d0000000-0000-4000-8000-000000000002", ["23800100001"]));
    expect(res.status).toBe(400);
    expect(state.targetingWrites).toHaveLength(0);
  });
});
