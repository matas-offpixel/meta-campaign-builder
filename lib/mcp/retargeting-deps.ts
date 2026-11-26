/**
 * lib/mcp/retargeting-deps.ts — the real McpRetargetingDeps (M3c) for the
 * route: a pinned seam like meta-deps.ts. Not walked by the guard test; a
 * test pins exactly what it imports.
 *
 *   - read: the Retargeting campaign's 08:00 read (runRetargetingRead) as a
 *     dry run — force, dryRun: Meta GETs (the operator's token, as the live
 *     reads use) and database reads; it writes no proposal and rewrites no
 *     rule.
 *   - create: the funnel's create path (applyFunnel) for one show with the
 *     app's own Meta calls — the on-sale refresh Apply's (createMetaAdSet,
 *     createMetaAd, graphPostWithToken for campaigns, budgets and status,
 *     checkAudienceReadiness, fetchAudienceMultiCampaignVideos) — and the
 *     three seams, each the code Jobs 1–3 landed:
 *       createAudience → the audience tools' create (#1400,
 *         lib/mcp/audience-deps.ts realAudienceDeps().createAudience: the
 *         Audience Builder's draft and create), lookalikes GB at 1 % as its
 *         specs make them (LOOKALIKE_SPEC);
 *       scheduleChange → M3b's scheduled changes (#1398, insertScheduled,
 *         migration 271) with this create's chat yes;
 *       checkCeiling → the per-show ceiling (#1397, checkShowCeiling, migration
 *         274): Retargeting's daily budgets and Wider's lifetime as new spend,
 *         lowered prospecting as it would be after.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAudienceReadiness, createMetaAd, createMetaAdSet, graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import type { MetaAdSetPayload } from "@/lib/meta/adset";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchAudienceMultiCampaignVideos } from "@/lib/audiences/sources";
import { buildMetaAdsManagerCampaignUrl } from "@/lib/notify/ads-manager-url";
import { plainMetaReason } from "@/lib/onsale-refresh/apply";
import { runRetargetingRead } from "@/lib/retargeting/runner";
import { groupVideosKeepingUnpaged } from "@/lib/retargeting/audiences";
import { applyFunnel, funnelAudienceDraft, type FunnelMeta } from "@/lib/retargeting/funnel-apply";
import { insertScheduled } from "./live/scheduled";
import { checkShowCeiling } from "./meta/show-ceiling";
import { realAudienceDeps } from "./audience-deps";
import { realLiveDeps } from "./meta-deps";
import { LOOKALIKE_SPEC } from "./audiences/specs";
import type { McpRetargetingDeps } from "./retargeting/types";

/** Meta's own words never reach Claude: the refresh's plain reasons for the known cases, else one sentence (PENDING DESIGN). */
export function claudeMetaReason(err: unknown): string {
  const plain = plainMetaReason(err);
  const known = ["the video is still processing", "it's limiting calls", "the Facebook connection has expired", "permissions don't allow it", "as many ads as Meta allows"];
  return known.some((part) => plain.includes(part)) ? plain : "Meta didn't take this.";
}

const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

function funnelMetaFor(token: string): FunnelMeta {
  return {
    async readAd(adId) {
      const ad = await graphGetWithToken<{ id: string; name?: string; effective_status?: string; creative?: { id?: string; effective_object_story_id?: string } }>(`/${adId}`, { fields: "id,name,effective_status,creative{id,effective_object_story_id}" }, token, { maxAttempts: 1 });
      return ad?.id ? { id: ad.id, name: ad.name ?? ad.id, creativeId: ad.creative?.id ?? null, effectiveStatus: ad.effective_status ?? null, objectStoryId: ad.creative?.effective_object_story_id ?? null } : null;
    },
    async createCreativeFromPost(adAccountId, spec) {
      return (await graphPostWithToken<{ id: string }>(`/${act(adAccountId)}/adcreatives`, { name: spec.name, object_story_id: spec.objectStoryId }, token)).id;
    },
    async createCampaign(adAccountId, payload) {
      return (await graphPostWithToken<{ id: string }>(`/${act(adAccountId)}/campaigns`, payload, token)).id;
    },
    async createAdSet(adAccountId, payload) {
      return (await createMetaAdSet(adAccountId, payload as unknown as MetaAdSetPayload, token)).id;
    },
    async createAd(adAccountId, ad) {
      return (await createMetaAd(adAccountId, ad, token)).id;
    },
    async updateCampaign(campaignId, fields) {
      await graphPostWithToken(`/${campaignId}`, fields, token);
    },
    async setAdSetActive(adsetId) {
      await graphPostWithToken(`/${adsetId}`, { status: "ACTIVE" }, token);
    },
    async findCustomConversion(adAccountId, name) {
      const res = await graphGetWithToken<{ data?: { id: string; name?: string }[] }>(`/${act(adAccountId)}/customconversions`, { fields: "id,name", limit: "200" }, token, { maxAttempts: 1 });
      return (res.data ?? []).find((row) => row.name === name)?.id ?? null;
    },
    async createCustomConversion(adAccountId, spec) {
      const rule = JSON.stringify({ and: [{ event: { eq: "Purchase" } }, { or: [{ URL: { i_contains: spec.domain } }] }] });
      return (await graphPostWithToken<{ id: string }>(`/${act(adAccountId)}/customconversions`, { name: spec.name, event_source_id: spec.pixelId, custom_event_type: "PURCHASE", rule }, token)).id;
    },
    readAdSetTargeting: (adsetId) => graphGetWithToken<{ targeting?: Record<string, unknown> }>(`/${adsetId}`, { fields: "targeting" }, token, { maxAttempts: 1 }).then((row) => row?.targeting ?? null),
    async audienceState(audienceId) {
      const read = await checkAudienceReadiness(audienceId, token);
      if (!read) return "ready";
      if (read.populating) return "building";
      if (!read.ready && /small/i.test(read.description)) return "too_small";
      return read.ready ? "ready" : "building";
    },
    async listShowVideos(adAccountId, campaignIds) {
      return groupVideosKeepingUnpaged((await fetchAudienceMultiCampaignVideos(adAccountId, campaignIds, token)).videos);
    },
    async readDailyBudget(_kind, id) {
      const row = await graphGetWithToken<{ daily_budget?: string | number }>(`/${id}`, { fields: "daily_budget" }, token, { maxAttempts: 1 });
      const daily = Number(row?.daily_budget);
      return Number.isFinite(daily) && daily > 0 ? daily : null;
    },
    async setDailyBudget(_kind, id, minor) {
      await graphPostWithToken(`/${id}`, { daily_budget: minor }, token);
    },
  };
}

export function realRetargetingDeps(db: SupabaseClient): McpRetargetingDeps {
  const audiences = realAudienceDeps(db);
  const live = realLiveDeps(db);
  const tokenFor = async (userId: string) => (await resolveServerMetaToken(db, userId)).token;
  return {
    async read({ userId, codes, now }) {
      const token = await tokenFor(userId);
      const result = await runRetargetingRead({
        env: process.env,
        db,
        now,
        dryRun: true,
        force: true,
        eventCodes: codes ?? undefined,
        userId,
        graph: token ? { graphGet: (path, params) => graphGetWithToken(path, params, token, { maxAttempts: 1 }), multiGet: (path, params) => graphMultiGetByIds(path, params, token) } : null,
        graphReason: token ? undefined : "no Facebook token",
      });
      if (!("records" in result)) return { records: [], metaGets: 0, skipped: [] };
      return { records: result.records, metaGets: result.metaCalls, skipped: result.skipped };
    },
    async campaignStatuses({ userId, ids }) {
      const token = await tokenFor(userId);
      const out: Record<string, string | null> = {};
      for (let i = 0; i < ids.length; i += 50) {
        const rows = await graphGetWithToken<Record<string, { effective_status?: string }>>("/", { ids: ids.slice(i, i + 50).join(","), fields: "effective_status" }, token, { maxAttempts: 1 });
        for (const id of ids.slice(i, i + 50)) out[id] = rows?.[id]?.effective_status ?? null;
      }
      return out;
    },
    async create({ userId, eventId, clientId, clientName, approval, build, mode, today }) {
      const token = await tokenFor(userId);
      if (!token) throw new Error("no Facebook token");
      const outcome = await applyFunnel(
        {
          db,
          env: process.env,
          meta: funnelMetaFor(token),
          async createAudience(aud, name, adAccountId) {
            if (!clientId) return null;
            const base = { userId, clientId, eventId, name, metaAdAccountId: adAccountId };
            const insert =
              aud.kind === "lookalike"
                ? { ...base, funnelStage: "top_of_funnel" as const, audienceSubtype: "lookalike" as const, retentionDays: 1, sourceId: aud.originId, sourceMeta: { subtype: "lookalike", originAudienceId: aud.originId, ratio: LOOKALIKE_SPEC.ratio, country: LOOKALIKE_SPEC.country, seedName: aud.originKey, seedLocalAudienceId: null, type: "similarity" } }
                : (() => {
                    const spec = funnelAudienceDraft(aud);
                    return { ...base, funnelStage: "retargeting" as const, audienceSubtype: spec.subtype, retentionDays: spec.retentionDays, sourceId: spec.sourceId, sourceMeta: spec.sourceMeta };
                  })();
            const made = await audiences.createAudience({ userId, insert: insert as never });
            // A source under Meta's minimum, or a refused create: left out, and its tier or ad set built without it.
            return !made.failed && made.metaAudienceId ? { metaAudienceId: made.metaAudienceId } : null;
          },
          async scheduleChange(step) {
            const row = await insertScheduled(db, {
              user_id: userId,
              event_id: eventId,
              client_id: clientId,
              kind: "set_budget",
              object_kind: step.objectKind,
              object_id: step.objectId,
              object_name: step.objectName,
              field: step.field,
              amount_minor: step.amountMinor,
              expected_minor: step.expectedMinor,
              currency: "GBP",
              raises_spend: step.raisesSpend,
              run_at: step.runAt,
              ledger_draft_id: build.draftId!,
              call_key: step.key,
              approval_asked: approval.asked,
              approval_answer: approval.answer,
            });
            return { id: row.id };
          },
          async checkCeiling(change) {
            await checkShowCeiling({
              db,
              live,
              userId,
              event: { id: change.eventId, code: change.code },
              change: {
                starts: true,
                objects: change.take.map((line) => ({ kind: line.kind, id: line.id, dailyMinor: line.afterMinor })),
                added: [
                  { label: `${change.code} · Retargeting`, dailyGbp: change.retargetingDailyMinor / 100, end: change.endDay },
                  ...(change.wider ? [{ label: change.wider.name, lifetimeGbp: change.wider.lifetimeMinor / 100, end: change.endDay }] : []),
                ],
              },
              now: new Date(),
            });
          },
          owner: { userId, clientId, eventId, launchRunId: `mcp:${eventId}` },
          source: "connector",
        },
        build,
        { mode, ledger: { supabase: db, userId, draftId: build.draftId!, eventId }, plainMetaReason: claudeMetaReason, today },
      );
      const adsManager = outcome.progress.campaignId && build.adAccountId ? buildMetaAdsManagerCampaignUrl(build.adAccountId, outcome.progress.campaignId) : null;
      return { outcome, adsManager };
    },
  };
}
