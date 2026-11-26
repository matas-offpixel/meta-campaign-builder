/**
 * lib/mcp/meta-deps.ts
 *
 * The real McpMetaDeps (M3a) and McpLiveDeps (M3b) for the route: the only
 * place the MCP reaches Meta's write API, and only through the app's own
 * paths. Not imported by
 * tests (they pass spies); the guard test pins what this file imports.
 *
 *   - sendAssets: standalone Launch's first step, sendStoredDraftAssetsToMeta
 *     (the MML path: creative_asset_channel_ids, then handleUploadAsset on a
 *     service-role copy), with the upload handler bound to the operator
 *     (uploadAssetHooksForUser) because the connector has no browser session.
 *   - waitVideos: FC4's "Waiting for Meta to finish {n} videos…" step
 *     (waitForStoredVideosAs: status GETs with the operator's token).
 *   - launch: POST /api/meta/launch-campaign's own handler through
 *     launchCampaignAs: the launch checks, the token, the ledger
 *     (meta_write_idempotency), createPaused and the published save are the
 *     route's.
 */
import "server-only";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { launchCampaignAs } from "@/app/api/meta/launch-campaign/route";
import { handleUploadAsset, uploadAssetHooksForUser } from "@/lib/meta/upload-asset-handler";
import { sendStoredDraftAssetsToMeta, waitForStoredVideosAs } from "@/lib/plan/creative-intake-server";
import type { McpMetaDeps } from "./tool-types";
import { bulkAttachAs } from "@/app/api/meta/bulk-attach-ads/route";
import { adsetAudienceAs } from "@/app/api/meta/adset-audience/route";
import { graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { adStatusWritesEnabled, writeAdStatus } from "@/lib/meta/ad-status-write";
import { adsetStatusWritesEnabled, writeAdSetStatus } from "@/lib/meta/adset-status-write";
import { writeCampaignStatus } from "@/lib/meta/campaign-status-write";
import { budgetWritesEnabled, writeBudget } from "@/lib/meta/budget-write";
import { writeObjectName } from "@/lib/meta/object-name-write";
import { campaignsInRunningStudies, studyPayload, writeAdStudy } from "@/lib/meta/ad-study";
import { adsetTargetingWritesEnabled } from "@/lib/meta/adset-targeting-write";
import { treeAddWritesEnabled } from "@/lib/campaign-tree/switch";
import { moveAdSetDailyBudget } from "@/lib/onsale-refresh/apply";
import type { MetaWriteContext } from "@/lib/meta/write-idempotency";
import type { GraphCampaign } from "@/lib/campaign-tree/load";
import type { LedgerRef, LiveInsight, LiveKind, LiveObject, McpLiveDeps } from "./live/types";

export function realMetaDeps(db: SupabaseClient): McpMetaDeps {
  return {
    async sendAssets({ userId, draft }) {
      const hooks = await uploadAssetHooksForUser(userId);
      return sendStoredDraftAssetsToMeta({ supabase: db, draft, userId, upload: (request) => handleUploadAsset(request, hooks) });
    },
    waitVideos({ userId, videoIds }) {
      return waitForStoredVideosAs({ supabase: db, userId, videoIds });
    },
    async launch({ userId, draft, createPaused }) {
      const req = new NextRequest(new URL("http://localhost/api/meta/launch-campaign"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draft, createPaused }),
      });
      const res = await launchCampaignAs(req, { supabase: db as never, user: { id: userId } });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: res.status, body };
    },
  };
}

// ── M3b: the live tools' reach (McpLiveDeps) ────────────────────────────────
//
// Reads are GETs with the operator's token (resolveServerMetaToken, as the
// campaign tree route reads). Each write is the app's own path and gate:
// the status writes, the budget write, the refresh's move, the name write,
// bulk-attach and the targeting write through their routes' handlers, and
// the ad study. Every write is on meta_write_idempotency (service role).

const OBJECT_FIELDS: Record<LiveKind, string> = {
  campaign: "id,name,account_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time",
  adset: "id,name,account_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,start_time,end_time,campaign_id,learning_stage_info,targeting",
  ad: "id,name,account_id,status,effective_status,campaign_id,adset_id",
};

/** The result count: the first of these action types an insights row carries. */
export const RESULT_ACTIONS = [
  "offsite_conversion.fb_pixel_purchase",
  "offsite_conversion.fb_pixel_complete_registration",
  "purchase",
  "complete_registration",
  "lead",
  "landing_page_view",
  "link_click",
] as const;

type GraphRow = Record<string, unknown>;
const int = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function toObject(kind: LiveKind, r: GraphRow): LiveObject {
  return {
    id: String(r.id),
    kind,
    name: str(r.name),
    accountId: r.account_id == null ? null : `act_${String(r.account_id).replace(/^act_/, "")}`,
    status: str(r.status),
    effectiveStatus: str(r.effective_status),
    dailyBudgetMinor: int(r.daily_budget),
    lifetimeBudgetMinor: int(r.lifetime_budget),
    budgetRemainingMinor: int(r.budget_remaining),
    startTime: str(r.start_time),
    endTime: str(r.end_time) ?? str(r.stop_time),
    campaignId: kind === "campaign" ? String(r.id) : str(r.campaign_id),
    adsetId: kind === "ad" ? str(r.adset_id) : kind === "adset" ? String(r.id) : null,
    learningStatus: str((r.learning_stage_info as GraphRow | undefined)?.status),
    targeting: kind === "adset" && r.targeting && typeof r.targeting === "object" ? (r.targeting as Record<string, unknown>) : null,
  };
}

function insightOf(today: GraphRow | undefined, total: GraphRow | undefined): LiveInsight {
  const first = (row: GraphRow | undefined) => ((row?.insights as { data?: GraphRow[] } | undefined)?.data ?? [])[0];
  const t = first(today);
  const all = first(total);
  const actions = (all?.actions as Array<{ action_type: string; value: string }> | undefined) ?? [];
  const hit = RESULT_ACTIONS.map((type) => actions.find((a) => a.action_type === type)).find(Boolean);
  const spendToDate = Number(all?.spend ?? 0) || 0;
  const results = hit ? Number(hit.value) : null;
  return {
    spendToday: Number(t?.spend ?? 0) || 0,
    spendToDate,
    results,
    resultType: hit?.action_type ?? null,
    costPerResult: results ? Math.round((spendToDate / results) * 100) / 100 : null,
  };
}

export function realLiveDeps(db: SupabaseClient): McpLiveDeps {
  const tokens = new Map<string, Promise<string>>();
  const tokenFor = (userId: string) => {
    if (!tokens.has(userId)) tokens.set(userId, resolveServerMetaToken(db, userId).then((r) => r.token));
    return tokens.get(userId)!;
  };
  const ledgerOf = (userId: string, ref: LedgerRef): MetaWriteContext => ({ supabase: db, userId, draftId: ref.draftId, eventId: ref.eventId });
  const batched = async (userId: string, ids: string[], fields: string) => {
    const token = await tokenFor(userId);
    const out = new Map<string, GraphRow>();
    let gets = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const res = await graphGetWithToken<Record<string, GraphRow>>("/", { ids: ids.slice(i, i + 50).join(","), fields }, token);
      gets += 1;
      for (const [k, v] of Object.entries(res ?? {})) if (v && (v as GraphRow).id) out.set(k, v);
    }
    return { rows: out, gets };
  };
  return {
    switches: () => ({
      adsetStatus: adsetStatusWritesEnabled(),
      adStatus: adStatusWritesEnabled(),
      budget: budgetWritesEnabled(),
      treeAdd: treeAddWritesEnabled(),
      targeting: adsetTargetingWritesEnabled(),
    }),
    async readCampaigns(userId, ids) {
      const { rows } = await batched(userId, ids, "name,effective_status,objective,account_id,adsets.limit(200){id,name,effective_status}");
      return rows as unknown as Map<string, GraphCampaign>;
    },
    async readObjects(userId, kind, ids) {
      if (ids.length === 0) return { objects: new Map(), metaGets: 0 };
      const { rows, gets } = await batched(userId, ids, OBJECT_FIELDS[kind]);
      return { objects: new Map([...rows].map(([k, v]) => [k, toObject(kind, v)])), metaGets: gets };
    },
    async readChildren(userId, campaignId) {
      const token = await tokenFor(userId);
      const sets = await graphGetWithToken<{ data?: GraphRow[] }>(`/${campaignId}/adsets`, { fields: OBJECT_FIELDS.adset, limit: "200" }, token);
      const ads = await graphGetWithToken<{ data?: GraphRow[] }>(`/${campaignId}/ads`, { fields: OBJECT_FIELDS.ad, limit: "500" }, token);
      return { adsets: (sets.data ?? []).map((r) => toObject("adset", r)), ads: (ads.data ?? []).map((r) => toObject("ad", r)), metaGets: 2 };
    },
    async readInsights(userId, ids) {
      if (ids.length === 0) return { insights: new Map(), metaGets: 0 };
      const today = await batched(userId, ids, "insights.date_preset(today){spend,actions}");
      const total = await batched(userId, ids, "insights.date_preset(maximum){spend,actions}");
      const insights = new Map<string, LiveInsight>();
      for (const id of ids) insights.set(id, insightOf(today.rows.get(id), total.rows.get(id)));
      return { insights, metaGets: today.gets + total.gets };
    },
    async accountInfo(userId, accountId) {
      const token = await tokenFor(userId);
      const row = await graphGetWithToken<{ currency?: string; timezone_name?: string; business?: { id?: string } }>(`/${accountId}`, { fields: "currency,timezone_name,business" }, token, { maxAttempts: 1 });
      return { currency: row?.currency ?? null, timezone: row?.timezone_name ?? null, businessId: row?.business?.id ?? null };
    },
    async setStatus({ userId, kind, id, status, ledger, key }) {
      const token = await tokenFor(userId);
      const post = (objectId: string, s: string) => graphPostWithToken(`/${objectId}`, { status: s }, token).then(() => undefined);
      const ctx = ledgerOf(userId, ledger);
      if (kind === "campaign") await writeCampaignStatus({ ledger: ctx, graph: { postCampaignStatus: post }, campaignId: id, status, key });
      else if (kind === "adset") await writeAdSetStatus({ ledger: ctx, graph: { postAdSetStatus: post }, adsetId: id, status, key });
      else await writeAdStatus({ ledger: ctx, graph: { post }, adId: id, status, key });
    },
    async setBudget({ userId, kind, id, field, minor, expectedMinor, liveMinor, ledger, key }) {
      const token = await tokenFor(userId);
      await writeBudget({
        ledger: ledgerOf(userId, ledger),
        graph: { postBudget: (objectId, f, m) => graphPostWithToken(`/${objectId}`, { [f]: m }, token).then(() => undefined) },
        kind,
        objectId: id,
        field,
        minor,
        expectedMinor,
        liveMinor,
        key,
      });
    },
    async moveBudget({ userId, fromAdsetId, toAdsetId, deltaMinor, campaignId, ledger, key, previous }) {
      const token = await tokenFor(userId);
      const out = await moveAdSetDailyBudget(
        {
          async readAdSet(adsetId) {
            const r = await graphGetWithToken<GraphRow>(`/${adsetId}`, { fields: "id,campaign_id,status,effective_status,name,daily_budget" }, token, { maxAttempts: 1 });
            if (!r?.id) return null;
            return { id: String(r.id), campaignId: str(r.campaign_id), effectiveStatus: str(r.effective_status), status: str(r.status), name: str(r.name), dailyBudget: int(r.daily_budget) };
          },
          async updateAdSetDailyBudget(adsetId, minor) {
            await graphPostWithToken(`/${adsetId}`, { daily_budget: minor }, token);
          },
        },
        ledgerOf(userId, ledger),
        { key, fromAdsetId, toAdsetId, deltaMinor, campaignIds: [campaignId], previous: previous ?? null },
      );
      return { state: out.state, stop: out.stop, written: out.result.written ?? [], plan: out.result.plan };
    },
    async rename({ userId, kind, id, name, ledger, key }) {
      const token = await tokenFor(userId);
      await writeObjectName({ ledger: ledgerOf(userId, ledger), graph: { postName: (objectId, n) => graphPostWithToken(`/${objectId}`, { name: n }, token).then(() => undefined) }, kind, objectId: id, name, key });
    },
    async bulkAttach({ userId, body }) {
      const req = new NextRequest(new URL("http://localhost/api/meta/bulk-attach-ads"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const res = await bulkAttachAs(req, { supabase: db as never, user: { id: userId } });
      return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
    },
    async adsetAudience({ userId, body }) {
      const req = new Request("http://localhost/api/meta/adset-audience", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const res = await adsetAudienceAs(req, { supabase: db as never, user: { id: userId } });
      return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
    },
    async runningStudies(userId, businessId) {
      const token = await tokenFor(userId);
      const res = await graphGetWithToken<{ data?: Parameters<typeof campaignsInRunningStudies>[0] extends ReadonlyArray<infer S> ? S[] : never }>(
        `/${businessId}/ad_studies`,
        { fields: "id,end_time,cells{campaigns{id}}", limit: "100" },
        token,
        { maxAttempts: 1 },
      );
      return campaignsInRunningStudies(res?.data ?? [], new Date());
    },
    async createStudy({ userId, businessId, study, ledger, key }) {
      const payload = studyPayload({ name: study.name, campaignA: study.campaignA, campaignB: study.campaignB, start: new Date(study.start), end: new Date(study.end) });
      const token = await tokenFor(userId);
      return writeAdStudy({
        ledger: ledgerOf(userId, ledger),
        graph: { createAdStudy: (b, p) => graphPostWithToken<{ id: string }>(`/${b}/ad_studies`, p, token).then((r) => r.id) },
        businessId,
        payload,
        key,
      });
    },
  };
}
