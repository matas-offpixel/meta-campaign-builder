/**
 * Apply for the lines that make a new ad set (design's P3 ruling): an
 * interest cluster brought back, and a missing standing default
 * (retargeting, the registrations lookalike).
 *
 * Never an edit: the new ad set is a copy of the campaign's best delivering
 * ad set with only the audience changed, made through the launch path's
 * ad-set create, live; its ads reuse the creative ids of that ad set's
 * delivering ads (at most 6, no uploads).
 *
 * A default's audiences come from the existing audience builder (pixel
 * URL and event rules, the video-viewer preset, a lookalike), pixel and
 * video sources only — registrations are the page's own signup event on
 * the pixel, never an uploaded list. Each id is stored on the event
 * (onsale_refresh_audiences, migration 237) before anything else runs, so
 * a retry reuses it and never builds a second audience. An audience Meta
 * is still building fails the line with the ruled sentence; Retry later.
 *
 * Budget, read again here: under a campaign budget the new set shares it;
 * with ad-set budgets it takes the copied set's daily budget from plan
 * headroom, else from the campaign's highest cost-per-result delivering
 * ad set (the giving side is written first, inside the 20 % cap, through
 * the optimisation budget write's gate), else it isn't made.
 *
 * Every Meta write is on meta_write_idempotency, keyed on the line. Meta,
 * the builder and the interest check are passed in: this file imports
 * only the ledger from lib/meta, and tests run on fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import {
  ALL_INTERESTS_RETIRED,
  AUDIENCE_BUILDING,
  AUDIENCE_TOO_SMALL,
  COPIED_FIELDS,
  LOOKALIKE_RATIO,
  MAX_REUSED_CREATIVES,
  NO_BUDGET_TO_START,
  RETENTION,
  VIDEO_THRESHOLD,
  appliedNewAdSet,
  audienceOnlyTargeting,
  clusterTargeting,
  decideFunding,
  newAdSetName,
  partialNewAdSet,
  weeklyMoved,
  type Funding,
  type Giver,
  type NewAdSetSource,
} from "./new-adset.ts";

type Db = Pick<SupabaseClient, "from">;

/** One audience the builder makes or reuses. Pixel and video sources, and a lookalike of one: never a customer list. */
export type AudienceSpec =
  | { part: "landing" | "ticket" | "registrations"; subtype: "website_pixel"; name: string; pixelId: string; pixelEvent: string; urlContains: string[]; retentionDays: number }
  | { part: "video"; subtype: "video_views"; name: string; campaignIds: string[]; threshold: 75; retentionDays: number }
  | { part: "lookalike"; subtype: "lookalike"; name: string; originAudienceId: string; ratio: number; country: string };

export type AudienceState = "ready" | "building" | "too_small";

export type NewAdSetDeps = {
  db: Db;
  env: Record<string, string | undefined>;
  meta: {
    /** GET /{adset}: targeting, campaign_id, budgets, status and the COPIED_FIELDS. */
    readAdSetForCopy(adsetId: string): Promise<Record<string, unknown> | null>;
    /** GET /{campaign}: a campaign budget (CBO) when either is set. */
    readCampaignBudget(campaignId: string): Promise<{ daily: number | null; lifetime: number | null }>;
    /** GET /{adset}/ads: each ad's name, creative id and effective status. */
    listAdsForCopy(adsetId: string): Promise<{ id: string; name: string; creativeId: string | null; effectiveStatus: string | null }[]>;
    readAdSet(adsetId: string): Promise<{ id: string; campaignId: string | null; dailyBudget?: number | null } | null>;
    /** The launch path's ad-set create: POST /act_{id}/adsets. Returns the id. */
    createAdSet(adAccountId: string, payload: Record<string, unknown>): Promise<string>;
    createAd(adAccountId: string, ad: { name: string; adset_id: string; creative: { creative_id: string }; status: "ACTIVE" }): Promise<string>;
    updateAdSetDailyBudget(adsetId: string, dailyBudgetMinor: number): Promise<void>;
    /** The launch path's interest check (sanitiseInterests): what Meta still offers, and the names it retired. */
    checkInterests(interests: readonly { id: string; name: string }[]): Promise<{ valid: { id: string; name: string }[]; retired: string[] }>;
    /** An audience's state on Meta (operation_status). */
    audienceState(audienceId: string): Promise<AudienceState>;
  };
  /** The existing audience builder: make the audience, or reuse one with the same rule on the account. Null = nothing to build from (no campaign videos). */
  ensureAudience(spec: AudienceSpec, adAccountId: string): Promise<{ metaAudienceId: string; reused: boolean } | null>;
  plan: { budget: number | null; spend: number; today: string; eventDate: string | null; appliedMovesGbp: number };
};

export type NewAdSetLine = {
  id: string;
  kind: "bring_back_audience" | "missing_default";
  write: Record<string, unknown> | null;
  applied_result: Record<string, unknown> | null;
};

type Outcome = { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> };

const DELIVERING = new Set(["ACTIVE", "LEARNING", "LEARNING_LIMITED"]);
const MIN_DAILY_MINOR = 100;

export const MOVES_SWITCHED_OFF = "Meta didn't take this — moving budget is switched off on this deployment, so nothing was made.";
export const COPY_GONE = "The ad set it copies isn't delivering any more, so nothing was made.";
export const NO_PIXEL = "The copied ad set carries no pixel, so there's no audience to build.";
export const LIFETIME_COPY = "The ad set it copies runs on a lifetime budget, so there's no daily budget to give the new one.";

function plain(err: unknown, fallback: (err: unknown) => string): string {
  const text = String((err as { message?: unknown })?.message ?? err ?? "").toLowerCase();
  if (text.includes("still being") || text.includes("populat") || text.includes("not ready") || text.includes("being created")) return AUDIENCE_BUILDING;
  if (text.includes("too small")) return AUDIENCE_TOO_SMALL;
  return fallback(err);
}

/** The builder's name for each audience part: `[{CODE}] … {n}d` (lookalike: the builder's lookalike name). */
export function audienceName(code: string | null, part: AudienceSpec["part"], signupEvent: string | null, country: string): string {
  const prefix = `[${code ?? "event"}]`;
  if (part === "landing") return `${prefix} landing page ${RETENTION.landing}d`;
  if (part === "ticket") return `${prefix} ticket link ${RETENTION.ticket}d`;
  if (part === "video") return `${prefix} ${VIDEO_THRESHOLD}% video views ${RETENTION.video}d`;
  if (part === "registrations") return `${prefix} ${signupEvent ?? "registrations"} ${RETENTION.registrations}d`;
  return `${prefix} Registrations lookalike 1% ${country}`;
}

/** URL fragments for the builder's `i_contains` filter: host and path, no scheme or query. */
export function urlFragment(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

async function storedRows(db: Db, eventId: string, kind: string): Promise<{ part: string; campaign_key: string; meta_audience_id: string | null; meta_adset_id: string | null }[]> {
  const res = await db.from("onsale_refresh_audiences").select("part, campaign_key, meta_audience_id, meta_adset_id").eq("event_id", eventId).eq("kind", kind);
  if (res.error) throw new Error(`onsale_refresh_audiences: ${res.error.message}`);
  return (res.data ?? []) as { part: string; campaign_key: string; meta_audience_id: string | null; meta_adset_id: string | null }[];
}

async function store(db: Db, row: { event_id: string; user_id: string; kind: string; part: string; campaign_key: string; meta_audience_id?: string | null; meta_adset_id?: string | null; name?: string | null; line_id: string }): Promise<void> {
  const res = await db.from("onsale_refresh_audiences").upsert(row, { onConflict: "event_id,kind,part,campaign_key" });
  if (res.error) throw new Error(`onsale_refresh_audiences store: ${res.error.message}`);
}

/**
 * The default's audiences: each stored id reused, each missing one made by
 * the builder and stored before the next. Retargeting: landing page,
 * ticket link, video viewers, registrations. Lookalike: the registrations
 * seed, then the 1 % lookalike of it.
 */
async function ensureDefaultAudiences(deps: NewAdSetDeps, args: { eventId: string; userId: string; lineId: string; adAccountId: string; source: Exclude<NewAdSetSource, "cluster">; write: Record<string, unknown>; pixelId: string | null; campaignIds: string[] }): Promise<{ ids: string[]; made: string[] }> {
  const code = typeof args.write.eventCode === "string" ? args.write.eventCode : null;
  const signupEvent = typeof args.write.signupEvent === "string" ? args.write.signupEvent : null;
  const country = typeof args.write.country === "string" ? args.write.country : "GB";
  const stored = new Map((await storedRows(deps.db, args.eventId, args.source)).filter((row) => row.campaign_key === "" && row.meta_audience_id).map((row) => [row.part, row.meta_audience_id!]));
  const ids: string[] = [];
  const made: string[] = [];
  const ensure = async (spec: AudienceSpec): Promise<string | null> => {
    const have = stored.get(spec.part);
    if (have) return have;
    const built = await deps.ensureAudience(spec, args.adAccountId);
    if (!built) {
      if (spec.part === "video") return null; // the campaign has no videos yet: the audience goes without that source
      throw new Error(`The audience builder made no ${spec.part} audience.`);
    }
    const metaAudienceId = built.metaAudienceId;
    await store(deps.db, { event_id: args.eventId, user_id: args.userId, kind: args.source, part: spec.part, campaign_key: "", meta_audience_id: metaAudienceId, name: spec.name, line_id: args.lineId });
    stored.set(spec.part, metaAudienceId);
    made.push(spec.part);
    return metaAudienceId;
  };
  const push = (id: string | null) => {
    if (id) ids.push(id);
  };
  const pixel = (part: "landing" | "ticket" | "registrations", pixelEvent: string, urlContains: string[], retentionDays: number): AudienceSpec => ({ part, subtype: "website_pixel", name: audienceName(code, part, signupEvent, country), pixelId: args.pixelId!, pixelEvent, urlContains, retentionDays });
  if (args.source === "retargeting") {
    const landing = urlFragment(args.write.landingUrl as string | null);
    const ticket = urlFragment(args.write.ticketUrl as string | null);
    if (landing && args.pixelId) push(await ensure(pixel("landing", "PageView", [landing], RETENTION.landing)));
    if (ticket && args.pixelId) push(await ensure(pixel("ticket", "PageView", [ticket], RETENTION.ticket)));
    push(await ensure({ part: "video", subtype: "video_views", name: audienceName(code, "video", signupEvent, country), campaignIds: args.campaignIds, threshold: VIDEO_THRESHOLD, retentionDays: RETENTION.video }));
    if (signupEvent && args.pixelId) push(await ensure(pixel("registrations", signupEvent, [], RETENTION.registrations)));
    if (!ids.length) throw new Error(NO_PIXEL);
    return { ids, made };
  }
  if (!signupEvent || !args.pixelId) throw new Error(NO_PIXEL);
  const seed = (await ensure(pixel("registrations", signupEvent, [], RETENTION.registrations)))!;
  push(await ensure({ part: "lookalike", subtype: "lookalike", name: audienceName(code, "lookalike", signupEvent, country), originAudienceId: seed, ratio: LOOKALIKE_RATIO, country }));
  return { ids, made };
}

export async function applyNewAdSet(
  deps: NewAdSetDeps,
  line: NewAdSetLine,
  ctx: { eventId: string; userId: string; campaignKey: string; ledger: MetaWriteContext; adAccountId: string; campaignIds: string[]; plainMetaReason: (err: unknown) => string },
): Promise<Outcome> {
  const write = line.write ?? {};
  const source: NewAdSetSource = line.kind === "missing_default" ? (write.source === "registrations_lookalike" ? "registrations_lookalike" : "retargeting") : "cluster";
  const copyFrom = write.copyFrom as { adsetId?: string } | null;
  const previous = (line.applied_result ?? {}) as Record<string, unknown>;
  const fail = (reason: string, result: Record<string, unknown> = {}): Outcome => ({ state: "failed", reason, result: { ...result, source } });
  if (!copyFrom?.adsetId) return fail(COPY_GONE);

  // The ad set it copies: still in this campaign, still delivering.
  const src = await deps.meta.readAdSetForCopy(copyFrom.adsetId);
  const srcCampaign = typeof src?.campaign_id === "string" ? src.campaign_id : null;
  if (!src || !srcCampaign || !ctx.campaignIds.includes(srcCampaign) || !DELIVERING.has(String(src.effective_status ?? ""))) return fail(COPY_GONE);
  const promoted = (src.promoted_object ?? {}) as { pixel_id?: string };
  const pixelId = promoted.pixel_id ? String(promoted.pixel_id) : null;

  // Money (design's ruling): CBO shares; ABO from headroom, else a move from the giver inside the cap.
  const campaignBudget = await deps.meta.readCampaignBudget(srcCampaign);
  const cbo = campaignBudget.daily != null || campaignBudget.lifetime != null;
  let funding: Funding = { mode: "cbo" };
  let dailyMinor: number | null = null;
  if (!cbo) {
    dailyMinor = Number(src.daily_budget) || null;
    if (!dailyMinor) return fail(LIFETIME_COPY);
    funding = (previous.funding as Funding | undefined) ?? decideFunding({ budgetLevel: "ad_set", dailyGbp: dailyMinor / 100, budget: deps.plan.budget, spend: deps.plan.spend, today: deps.plan.today, eventDate: deps.plan.eventDate, appliedMovesGbp: deps.plan.appliedMovesGbp, giver: (write.giver as Giver | null) ?? null });
    if (funding.mode === "none") return fail(NO_BUDGET_TO_START);
    if (funding.mode === "move" && deps.env.ENABLE_OPTIMISATION_WRITES !== "1") return fail(MOVES_SWITCHED_OFF);
  }
  const base = { funding, movedWeeklyGbp: weeklyMoved(funding), copiedFrom: copyFrom.adsetId };

  // A cluster: the interests Meta still offers. None left, and the line fails.
  let interests: { id: string; name: string }[] = [];
  let retired: string[] = [];
  if (source === "cluster") {
    const checked = await deps.meta.checkInterests((write.interests as { id: string; name: string }[] | undefined) ?? []);
    interests = checked.valid;
    retired = checked.retired;
    if (!interests.length) return fail(ALL_INTERESTS_RETIRED, { ...base, retired });
  }

  // A default: its audiences (stored ids reused), and each one ready on Meta.
  let audienceIds: string[] = [];
  if (source !== "cluster") {
    try {
      const made = await ensureDefaultAudiences(deps, { eventId: ctx.eventId, userId: ctx.userId, lineId: line.id, adAccountId: ctx.adAccountId, source, write, pixelId, campaignIds: ctx.campaignIds });
      audienceIds = made.ids;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(message === NO_PIXEL ? NO_PIXEL : plain(err, ctx.plainMetaReason), { ...base, error: message, step: "audience" });
    }
    for (const id of audienceIds) {
      const state = await deps.meta.audienceState(id);
      if (state === "building") return fail(AUDIENCE_BUILDING, { ...base, audienceIds });
      if (state === "too_small") return fail(AUDIENCE_TOO_SMALL, { ...base, audienceIds });
    }
  }

  // The giving side first, so spend is never above plan mid-way; a retry never takes it twice.
  let giverPlan = previous.giverPlan as { adsetId: string; before: number; after: number } | undefined;
  if (funding.mode === "move" && dailyMinor) {
    const giver = await deps.meta.readAdSet(funding.fromAdsetId);
    if (!giver?.campaignId || !ctx.campaignIds.includes(giver.campaignId) || giver.dailyBudget == null) return fail(NO_BUDGET_TO_START, { ...base, audienceIds });
    giverPlan ??= { adsetId: funding.fromAdsetId, before: giver.dailyBudget, after: giver.dailyBudget - dailyMinor };
    if (giverPlan.after < MIN_DAILY_MINOR) return fail(NO_BUDGET_TO_START, { ...base, audienceIds, giverPlan });
    if (giver.dailyBudget !== giverPlan.after) {
      if (giver.dailyBudget !== giverPlan.before) return fail("The budget changed in Ads Manager since the proposal, so nothing was made.", { ...base, audienceIds, giverPlan });
      try {
        await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_budget_update", { line_id: line.id, adset_id: giverPlan.adsetId, daily_budget: giverPlan.after }, async () => {
          await deps.meta.updateAdSetDailyBudget(giverPlan!.adsetId, giverPlan!.after);
          return giverPlan!.adsetId;
        }, { required: true });
      } catch (err) {
        return fail(ctx.plainMetaReason(err), { ...base, audienceIds, giverPlan, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // The new ad set: a copy with only the audience changed, live.
  const targeting = source === "cluster" ? clusterTargeting((src.targeting ?? {}) as Record<string, unknown>, interests) : audienceOnlyTargeting((src.targeting ?? {}) as Record<string, unknown>, audienceIds);
  const payload: Record<string, unknown> = { name: newAdSetName(source, (write.eventCode as string | null) ?? null, write.clusterName as string | undefined), campaign_id: srcCampaign, targeting, status: "ACTIVE" };
  for (const field of COPIED_FIELDS) if (src[field] != null) payload[field] = src[field];
  if (cbo) delete payload.bid_strategy;
  else payload.daily_budget = dailyMinor;
  let adsetId: string;
  try {
    adsetId = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { line_id: line.id }, () => deps.meta.createAdSet(ctx.adAccountId, payload), { required: true });
  } catch (err) {
    return fail(plain(err, ctx.plainMetaReason), { ...base, audienceIds, giverPlan, error: err instanceof Error ? err.message : String(err), step: "adset" });
  }
  const storedKey = source === "cluster" ? `${ctx.campaignKey}::${String(write.clusterId ?? "")}` : ctx.campaignKey;
  await store(deps.db, { event_id: ctx.eventId, user_id: ctx.userId, kind: source, part: "adset", campaign_key: storedKey, meta_adset_id: adsetId, name: String(payload.name), line_id: line.id });

  // Its ads: the copied set's delivering ads' creatives, at most 6, no uploads.
  const ads = (await deps.meta.listAdsForCopy(copyFrom.adsetId)).filter((ad) => ad.creativeId && DELIVERING.has(ad.effectiveStatus ?? "")).slice(0, MAX_REUSED_CREATIVES);
  const adIds: { adId: string; creativeId: string }[] = [];
  const failures: { creativeId: string; error: string; reason: string }[] = [];
  for (const ad of ads) {
    try {
      const adId = await withMetaWriteIdempotency(ctx.ledger, "refresh_ad_create", { line_id: line.id, adset_id: adsetId, creative_id: ad.creativeId }, () => deps.meta.createAd(ctx.adAccountId, { name: ad.name, adset_id: adsetId, creative: { creative_id: ad.creativeId! }, status: "ACTIVE" }), { required: true });
      adIds.push({ adId, creativeId: ad.creativeId! });
    } catch (err) {
      failures.push({ creativeId: ad.creativeId!, error: err instanceof Error ? err.message : String(err), reason: ctx.plainMetaReason(err) });
    }
  }
  const result = { ...base, adsetId, adIds, audienceIds, retired, giverPlan, interests: interests.length };
  if (failures.length) return { state: "failed", reason: partialNewAdSet(adIds.length, ads.length, failures[0]!.reason), result: { ...result, failures, error: failures[0]!.error, source } };
  return { state: "applied", reason: appliedNewAdSet(source, adIds.length, retired), result: { ...result, source } };
}
