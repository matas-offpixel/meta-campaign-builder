/**
 * Fixtures for the M3b live tools: one event (DHB27-LIVE: DHB has no brand
 * default, so `ceiling: null` is a show with no spend ceiling) with three
 * campaigns on its tree, each with a published draft (two on one account,
 * one on another) and one campaign with no draft; a spy McpLiveDeps whose
 * objects change when it writes, and a spy McpMetaDeps for the send step.
 * No Meta, no network.
 */
import type { GraphCampaign } from "../../campaign-tree/load.ts";
import type { LiveKind, LiveObject, LiveSwitches, McpLiveDeps } from "../live/types.ts";
import type { McpMetaDeps, ToolContext } from "../tool-types.ts";
import { fakeDb } from "./fake-db.ts";
import { OPERATOR } from "./helpers.ts";

export const CLIENT = "c0000000-0000-4000-8000-00000000c001";
export const EVENT = "e0000000-0000-4000-8000-00000000e001";
export const CODE = "DHB27-LIVE";
export const ACT = "act_111111111";
export const ACT2 = "act_222222222";
export const DRAFT_A = "d0000000-0000-4000-8000-00000000d001";
export const DRAFT_B = "d0000000-0000-4000-8000-00000000d002";
export const DRAFT_C = "d0000000-0000-4000-8000-00000000d003";
export const CAMP_A = "120000000000000001";
export const CAMP_B = "120000000000000002";
export const CAMP_C = "120000000000000003";
export const CAMP_NODRAFT = "120000000000000009";
export const AS_BROAD = "120000000000000011";
export const AS_FANS = "120000000000000012";
export const AS_B1 = "120000000000000021";
export const AS_C1 = "120000000000000031";
export const AD_1 = "120000000000000111";
export const AUD = "230000000000000001";
export const NOW = new Date("2026-11-26T10:00:00Z");
export const SCOPE_META_ALL = "mcp:read mcp:draft mcp:meta";
export const YES = { asked: "Pause Broad on NX27-LIVE (live → paused)?", answer: "yes" };

const obj = (o: Partial<LiveObject> & { id: string; kind: LiveKind }): LiveObject => ({
  name: o.id,
  accountId: ACT,
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  dailyBudgetMinor: null,
  lifetimeBudgetMinor: null,
  budgetRemainingMinor: null,
  startTime: "2026-11-20T00:00:00Z",
  endTime: null,
  campaignId: null,
  adsetId: null,
  learningStatus: null,
  targeting: null,
  ...o,
});

export function liveObjects(): Map<string, LiveObject> {
  const list: LiveObject[] = [
    obj({ id: CAMP_A, kind: "campaign", name: "[DHB27-LIVE] ON SALE", campaignId: CAMP_A }),
    obj({ id: CAMP_B, kind: "campaign", name: "[DHB27-LIVE] ON SALE 2", campaignId: CAMP_B }),
    obj({ id: CAMP_C, kind: "campaign", name: "[DHB27-LIVE] ON SALE US", accountId: ACT2, campaignId: CAMP_C }),
    obj({ id: CAMP_NODRAFT, kind: "campaign", name: "[DHB27-LIVE] ON SALE OLD", campaignId: CAMP_NODRAFT }),
    obj({
      id: AS_BROAD,
      kind: "adset",
      name: "Broad",
      campaignId: CAMP_A,
      adsetId: AS_BROAD,
      dailyBudgetMinor: 3000,
      learningStatus: "LEARNING",
      targeting: { age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 0 }, custom_audiences: [{ id: AUD, name: "NX Signups" }] },
    }),
    obj({ id: AS_FANS, kind: "adset", name: "Fans", campaignId: CAMP_A, adsetId: AS_FANS, dailyBudgetMinor: 2000, targeting: { age_min: 18, age_max: 65, age_range: [25, 40], targeting_automation: { advantage_audience: 1 } } }),
    obj({ id: AS_B1, kind: "adset", name: "Other campaign set", campaignId: CAMP_B, adsetId: AS_B1, dailyBudgetMinor: 1500, targeting: { targeting_automation: { advantage_audience: 1 } } }),
    // Paused: an account not in £ with a live budget would refuse every spend change on the show.
    obj({ id: AS_C1, kind: "adset", name: "US set", accountId: ACT2, campaignId: CAMP_C, adsetId: AS_C1, dailyBudgetMinor: 1500, status: "PAUSED", effectiveStatus: "PAUSED" }),
    obj({ id: AD_1, kind: "ad", name: "Teaser 1", campaignId: CAMP_A, adsetId: AS_BROAD }),
  ];
  return new Map(list.map((o) => [o.id, o]));
}

const draftRow = (id: string, campaignId: string, account: string, json: Record<string, unknown> = {}) => ({
  id,
  user_id: OPERATOR,
  event_id: EVENT,
  client_id: CLIENT,
  name: `Draft ${id.slice(-1)}`,
  status: "published",
  objective: "purchase",
  ad_account_id: account,
  metaCampaignId: campaignId,
  updated_at: `2026-11-2${id.slice(-1)}T10:00:00Z`,
  draft_json: { id, metaCampaignId: campaignId, settings: { metaAdAccountId: account, eventId: EVENT, objective: "purchase" }, creatives: [], adSetSuggestions: [], ...json },
});

/**
 * The show's committed spend at NOW with nothing changed: Broad £30 + Fans £20
 * + Other campaign set £15 a day, 25 days to show day (26 Nov → 20 Dec, both
 * included) = £1,625.00, plus `spent` from ad_daily_insights.
 */
export const BASE_COMMITTED = 1625;

/** `ceiling`: the show's own total in £ (show_spend_ceilings); null = none. `spent`: £ in ad_daily_insights on campaign A. */
export function liveTables(opts: { ceiling?: number | null; spent?: number } = {}) {
  return {
    clients: [{ id: CLIENT, name: "NX Live", status: "active", meta_business_id: null }],
    events: [
      {
        id: EVENT,
        user_id: OPERATOR,
        name: "Live test show",
        event_code: CODE,
        venue_name: "Venue",
        venue_city: "Newcastle",
        event_date: "2026-12-20",
        announcement_at: null,
        presale_at: null,
        general_sale_at: "2026-11-01T10:00:00Z",
        status: "on_sale",
        client_id: CLIENT,
        meta_campaign_id: `${CAMP_A},${CAMP_NODRAFT}`,
        client: { name: "NX Live" },
        drive_folder_id: null,
        ticket_url: "https://tickets.example/nx",
      },
    ],
    campaign_drafts: [
      draftRow(DRAFT_A, CAMP_A, ACT, {
        adSetSuggestions: [
          { name: "Broad", advantagePlus: true },
          { name: "Fans", advantagePlus: true },
        ],
        launchSummary: {
          adSetsCreated: [
            { name: "Broad", metaAdSetId: AS_BROAD, ageMode: "suggested" },
            { name: "Fans", metaAdSetId: AS_FANS, ageMode: "suggested" },
          ],
        },
        creatives: [{ id: "cr-1", name: "Teaser 1", assetVariations: [{ id: "v1", name: "V1", assets: [{ id: "slot-1", aspectRatio: "9:16", uploadStatus: "uploaded", videoId: "vid-1" }] }] }],
      }),
      draftRow(DRAFT_B, CAMP_B, ACT),
      draftRow(DRAFT_C, CAMP_C, ACT2),
    ],
    launched_ad_sets: [
      { meta_adset_id: AS_BROAD, meta_campaign_id: CAMP_A, ad_account_id: ACT, draft_id: DRAFT_A, event_id: EVENT, phase_at_launch: "on_sale", source_name: "Broad", channel: "meta", launched_at: "2026-11-20T10:00:00Z" },
      { meta_adset_id: AS_FANS, meta_campaign_id: CAMP_A, ad_account_id: ACT, draft_id: DRAFT_A, event_id: EVENT, phase_at_launch: "on_sale", source_name: "Fans", channel: "meta", launched_at: "2026-11-20T10:00:01Z" },
      { meta_adset_id: AS_B1, meta_campaign_id: CAMP_B, ad_account_id: ACT, draft_id: DRAFT_B, event_id: EVENT, phase_at_launch: "on_sale", source_name: "B1", channel: "meta", launched_at: "2026-11-20T10:00:02Z" },
      { meta_adset_id: AS_C1, meta_campaign_id: CAMP_C, ad_account_id: ACT2, draft_id: DRAFT_C, event_id: EVENT, phase_at_launch: "on_sale", source_name: "C1", channel: "meta", launched_at: "2026-11-20T10:00:03Z" },
    ],
    campaign_additions: [],
    client_spend_ceilings: [] as Record<string, unknown>[],
    show_spend_ceilings: opts.ceiling == null ? [] : [{ id: "5e000000-0000-4000-8000-000000000001", event_id: EVENT, group_name: null, total_gbp: opts.ceiling, set_by: OPERATOR, set_at: "2026-11-26T09:00:00Z" }],
    show_spend_ceiling_events: [] as Record<string, unknown>[],
    ad_daily_insights: opts.spent ? [{ meta_ad_id: AD_1, meta_adset_id: AS_BROAD, meta_campaign_id: CAMP_A, ad_account_id: ACT, date: "2026-11-25", spend: opts.spent }] : ([] as Record<string, unknown>[]),
    mcp_actions: [] as Record<string, unknown>[],
    scheduled_meta_changes: [] as Record<string, unknown>[],
    meta_write_idempotency: [] as Record<string, unknown>[],
    meta_custom_audiences: [{ meta_audience_id: AUD, name: "NX Signups", client_id: CLIENT }],
  };
}

export interface LiveSpy {
  objects: Map<string, LiveObject>;
  switches: LiveSwitches;
  calls: Array<{ method: string; input: Record<string, unknown> }>;
  studies: Map<string, string>;
  failWrite: boolean;
  bulkAttachResponse?: { status: number; body: Record<string, unknown> };
}

export function liveSpy(): LiveSpy {
  return {
    objects: liveObjects(),
    switches: { adsetStatus: true, adStatus: true, budget: true, treeAdd: true, targeting: true },
    calls: [],
    studies: new Map(),
    failWrite: false,
  };
}

export const writes = (spy: LiveSpy) => spy.calls.filter((c) => !c.method.startsWith("read") && c.method !== "accountInfo" && c.method !== "runningStudies");

export function liveDeps(spy: LiveSpy): McpLiveDeps {
  const rec = (method: string, input: Record<string, unknown>) => spy.calls.push({ method, input });
  const fail = () => {
    if (spy.failWrite) throw Object.assign(new Error("Meta said no (raw, must never reach Claude)"), { name: "MetaApiError" });
  };
  return {
    switches: () => spy.switches,
    async readCampaigns(_userId, ids) {
      rec("readCampaigns", { ids });
      const out = new Map<string, GraphCampaign>();
      for (const id of ids) {
        const c = spy.objects.get(id);
        if (!c) continue;
        const sets = [...spy.objects.values()].filter((o) => o.kind === "adset" && o.campaignId === id);
        out.set(id, { id, name: c.name ?? id, effective_status: c.effectiveStatus ?? undefined, account_id: c.accountId?.replace("act_", ""), adsets: { data: sets.map((s) => ({ id: s.id, name: s.name ?? s.id, effective_status: s.effectiveStatus ?? undefined })) } });
      }
      return out;
    },
    async readObjects(_userId, kind, ids) {
      rec("readObjects", { kind, ids });
      return { objects: new Map(ids.map((id) => spy.objects.get(id)).filter((o): o is LiveObject => Boolean(o && o.kind === kind)).map((o) => [o.id, structuredClone(o)])), metaGets: 1 };
    },
    async readChildren(_userId, campaignId) {
      rec("readChildren", { campaignId });
      const all = [...spy.objects.values()];
      return { adsets: all.filter((o) => o.kind === "adset" && o.campaignId === campaignId), ads: all.filter((o) => o.kind === "ad" && o.campaignId === campaignId), metaGets: 2 };
    },
    async readInsights(_userId, ids) {
      rec("readInsights", { ids });
      return { insights: new Map(ids.map((id) => [id, { spendToday: 5, spendToDate: 120, results: 10, resultType: "purchase", costPerResult: 12 }])), metaGets: 2 };
    },
    async accountInfo(_userId, accountId) {
      rec("accountInfo", { accountId });
      return { currency: accountId === ACT2 ? "USD" : "GBP", timezone: "Europe/London", businessId: accountId === ACT2 ? "999" : "111" };
    },
    async setStatus(input) {
      rec("setStatus", input as unknown as Record<string, unknown>);
      fail();
      spy.objects.get(input.id)!.status = input.status;
    },
    async setBudget(input) {
      rec("setBudget", input as unknown as Record<string, unknown>);
      fail();
      const o = spy.objects.get(input.id)!;
      if (input.field === "daily_budget") o.dailyBudgetMinor = input.minor;
      else o.lifetimeBudgetMinor = input.minor;
    },
    async moveBudget(input) {
      rec("moveBudget", input as unknown as Record<string, unknown>);
      fail();
      const from = spy.objects.get(input.fromAdsetId)!;
      const to = spy.objects.get(input.toAdsetId)!;
      const plan = input.previous ?? { fromAdsetId: from.id, toAdsetId: to.id, deltaMinor: input.deltaMinor, from: { before: from.dailyBudgetMinor!, after: from.dailyBudgetMinor! - input.deltaMinor }, to: { before: to.dailyBudgetMinor!, after: to.dailyBudgetMinor! + input.deltaMinor } };
      from.dailyBudgetMinor = plan.from.after;
      to.dailyBudgetMinor = plan.to.after;
      return { state: "applied", written: [from.id, to.id], plan };
    },
    async rename(input) {
      rec("rename", input as unknown as Record<string, unknown>);
      fail();
      spy.objects.get(input.id)!.name = input.name;
    },
    async bulkAttach(input) {
      rec("bulkAttach", input as unknown as Record<string, unknown>);
      fail();
      if (spy.bulkAttachResponse) return spy.bulkAttachResponse;
      const sel = input.body.campaignAdSets as Record<string, string[]>;
      return { status: 200, body: { campaigns: Object.entries(sel).map(([campaignId, sets]) => ({ campaignId, adIds: sets.map((s) => `ad-${s}`), adSetsAdded: sets })), totalAdsCreated: 1, totalAdsFailed: 0 } };
    },
    async adsetAudience(input) {
      rec("adsetAudience", input as unknown as Record<string, unknown>);
      fail();
      const sets = input.body.adSetIds as string[];
      return { status: 200, body: { results: sets.map((adSetId) => ({ adSetId, outcome: "written" })) } };
    },
    async runningStudies(_userId, businessId) {
      rec("runningStudies", { businessId });
      return spy.studies;
    },
    async createStudy(input) {
      rec("createStudy", input as unknown as Record<string, unknown>);
      fail();
      return "study-1";
    },
  };
}

export function metaSendSpy(calls: Array<{ method: string; input: Record<string, unknown> }>): McpMetaDeps {
  return {
    async sendAssets({ draft }) {
      calls.push({ method: "sendAssets", input: { creatives: draft.creatives.length, account: draft.settings.metaAdAccountId } });
      return { draft, slots: [], results: [], uploaded: 0, calls: 0, failed: [], changed: false };
    },
    async waitVideos({ videoIds }) {
      calls.push({ method: "waitVideos", input: { videoIds } });
      return { ready: [...videoIds], errored: [], timedOut: [] };
    },
    async launch() {
      throw new Error("not used");
    },
  };
}

export function liveCtx(opts: { ceiling?: number | null; spent?: number; scope?: string; isMatas?: boolean } = {}) {
  const db = fakeDb(liveTables({ ceiling: opts.ceiling, spent: opts.spent }));
  const spy = liveSpy();
  const ctx = {
    db,
    readers: { ticketSnapshots: async () => [], migrateDraft: (raw: Record<string, unknown>) => raw },
    userId: OPERATOR,
    scope: opts.scope ?? SCOPE_META_ALL,
    isMatas: opts.isMatas ?? true,
    seesClientNames: true,
    today: "2026-11-26",
    now: NOW,
    live: liveDeps(spy),
    meta: metaSendSpy(spy.calls),
  } as ToolContext & { db: ReturnType<typeof fakeDb> };
  return { ctx, db, spy };
}
