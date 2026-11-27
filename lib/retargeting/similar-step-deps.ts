/**
 * lib/retargeting/similar-step-deps.ts — the 08:00 read's Similar step
 * (Matas, 27 Nov: "Yes, at the next step"), wired for the cron.
 *
 * When a show's page group is confirmed (or its audience grows past Meta's
 * minimum) after its two campaigns were built, the read adds the Similar ad
 * set at the next stretch step through funnel-apply.ts addSimilarAtStep: the
 * create path's own gates (the apply gate with the Live arm, campaign create,
 * audience writes, the budget write), its calls, every write on
 * meta_write_idempotency. It acts as the event's owner, with the token the
 * read's RT13 rule rewrite uses (refreshTokenFor: the agency token, else the
 * owner's own user_facebook_tokens token; never a client's). Audiences go
 * through the Audience Builder (createAudienceDraft, createMetaCustomAudience)
 * on the service-role client, as the connector's audience tools do. Later
 * steps: Cold's waiting row is re-sized in place and Similar's rows added
 * (scheduled_meta_changes, migration 271) under the build's own chat yes.
 *
 * Server only.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { checkAudienceReadiness, createMetaAd, createMetaAdSet, graphGetWithToken, graphPostWithToken } from "@/lib/meta/client";
import type { MetaAdSetPayload } from "@/lib/meta/adset";
import { fetchAudienceMultiCampaignVideos } from "@/lib/audiences/sources";
import { createAudienceDraft } from "@/lib/db/meta-custom-audiences";
import { createMetaCustomAudience } from "@/lib/meta/audience-write";
import { insertScheduled } from "@/lib/mcp/live/scheduled";
import { plainMetaReason } from "@/lib/onsale-refresh/apply";

import { groupVideosKeepingUnpaged } from "./audiences";
import { addSimilarAtStep, funnelAudienceDraft, type FunnelBuild, type FunnelMeta, type FunnelProgress, type SimilarStepOutcome } from "./funnel-apply";
import type { PageGroup } from "./funnel";
import { refreshTokenFor } from "./rule-rewrite";
import { fill } from "./funnel-words";

const noSeedGrants = async (_db: unknown, sourceIds: string[]) => ({ remediated: [] as string[], skipped: sourceIds.map((sourceId) => ({ sourceId, reason: "seed grants are off for the read" })) });

const act = (id: string) => (id.startsWith("act_") ? id : `act_${id}`);

/** The create path's Meta calls, as the event owner (the same calls the panel's Accept and the connector make). */
export function funnelMetaWithToken(token: string): FunnelMeta {
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
    // A destination (Matas, 27 Nov): the source creative read, and a new one made with the link and URL parameters.
    async readCreative(creativeId) {
      return graphGetWithToken<Record<string, unknown>>(`/${creativeId}`, { fields: "name,object_story_spec,asset_feed_spec,url_tags,object_story_id" }, token, { maxAttempts: 1 });
    },
    async createCreative(adAccountId, payload) {
      return (await graphPostWithToken<{ id: string }>(`/${act(adAccountId)}/adcreatives`, payload, token)).id;
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
    async createCustomConversion() {
      throw new Error("The Similar step never makes a custom conversion.");
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

/** The read's Similar step for the cron (runRetargetingRead's `similarStep`). */
/** The step's own refusals are the rt.similar.fail.* rows (no owner, no token, no draft), the {reason} in rt.similar.back.failed; the create path's refusals stay full sentences. */
export function similarStepFor(db: SupabaseClient, env: Record<string, string | undefined>) {
  return async (args: { event: { id: string; client_id: string | null }; build: FunnelBuild; pageGroup: PageGroup; day: string }): Promise<SimilarStepOutcome> => {
    const owner = await db.from("events").select("user_id").eq("id", args.event.id).maybeSingle();
    const userId = (owner.data as { user_id?: string } | null)?.user_id ?? null;
    // A refusal before the create path runs: kept on the build (its share stays in Cold, and the panel and Claude say why).
    const refuse = async (reason: string): Promise<SimilarStepOutcome> => {
      const row = await db.from("retargeting_builds").select("progress").eq("event_id", args.event.id).maybeSingle();
      const progress = { ...(((row.data as { progress?: FunnelProgress } | null)?.progress) ?? {}), similarRefused: { day: args.day, reason } };
      await db.from("retargeting_builds").update({ progress, updated_at: new Date().toISOString() }).eq("event_id", args.event.id);
      return { state: "failed", reason, progress };
    };
    if (!userId) return refuse(fill("rt.similar.fail.owner"));
    const token = await refreshTokenFor(db, userId);
    if (!token) return refuse(fill("rt.similar.fail.token"));
    if (!args.build.draftId) return refuse(fill("rt.similar.fail.draft"));
    // The build's own chat yes, as its scheduled steps carry it.
    const yes = await db.from("scheduled_meta_changes").select("approval_asked, approval_answer").eq("user_id", userId).eq("event_id", args.event.id).like("call_key", `rf:${args.event.id}:%`).limit(1).maybeSingle();
    const approval = (yes.data as { approval_asked?: string; approval_answer?: string } | null) ?? null;
    const clientId = args.event.client_id;
    return addSimilarAtStep(
      {
        db,
        env,
        meta: funnelMetaWithToken(token),
        owner: { userId, clientId, eventId: args.event.id, launchRunId: crypto.randomUUID() },
        source: "panel",
        async createAudience(aud, name, adAccountId) {
          if (aud.kind === "lookalike" || !clientId) return null;
          const spec = funnelAudienceDraft(aud);
          const draft = await createAudienceDraft({ userId, clientId, eventId: args.event.id, name, funnelStage: "retargeting", audienceSubtype: spec.subtype, retentionDays: spec.retentionDays, sourceId: spec.sourceId, sourceMeta: spec.sourceMeta as never, metaAdAccountId: adAccountId }, db as never);
          // Seed grants off, as the connector's audience tools have them.
          const made = await createMetaCustomAudience(draft.id, { userId, supabase: db as never, rows: db as never, remediateSeeds: noSeedGrants });
          return made.metaAudienceId ? { metaAudienceId: made.metaAudienceId } : null;
        },
        async scheduleChange(step) {
          if (!approval?.approval_asked || !approval.approval_answer) throw new Error("no stored chat yes for the build's steps");
          const row = await insertScheduled(db, {
            user_id: userId,
            event_id: args.event.id,
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
            ledger_draft_id: args.build.draftId!,
            call_key: step.key,
            approval_asked: approval.approval_asked,
            approval_answer: approval.approval_answer,
          });
          return { id: row.id };
        },
        async updateScheduled(key, change) {
          const res = await db
            .from("scheduled_meta_changes")
            .update({ amount_minor: change.amountMinor, expected_minor: change.expectedMinor, raises_spend: change.raisesSpend })
            .eq("user_id", userId)
            .eq("call_key", key)
            .eq("status", "scheduled")
            .select("id");
          return !res.error && (res.data ?? []).length > 0;
        },
      },
      { build: args.build, pageGroup: args.pageGroup, today: args.day, ledger: { supabase: db, userId, draftId: args.build.draftId, eventId: args.event.id }, plainMetaReason },
    );
  };
}
