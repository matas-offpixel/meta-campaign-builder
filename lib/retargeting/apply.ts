/**
 * The Retargeting campaign's create path (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT2, RT4, HR1, HR3). The Purchase campaign's create path
 * (lib/onsale-refresh/apply-purchase.ts) with budgets on the ad sets:
 *
 *   1. the custom conversion (own-domain path only), reused by name;
 *   2. the campaign, paused: OUTCOME_SALES, no campaign budget (budgets on
 *      each tier, `is_adset_budget_sharing_enabled: false`);
 *   3. the tier audiences (RT2), each stored on the event before the next
 *      so a retry reuses it; lists are used as uploaded;
 *   4. the three tier ad sets, paused: a daily budget each, the tier's
 *      includes and excludes, 7-day click + 1-day view, Advantage+
 *      audience and audience expansion off, Facebook Feed plus Instagram
 *      Feed, Stories and Reels, the location of the show's on-sale ad sets,
 *      ending 23:59 London on the show day; a launched_ad_sets row each;
 *   5. the ads: the on-sale campaigns' live creatives, the same in every tier;
 *   6. the main campaign's lifetime budget, lowered (only when money moves);
 *   7. the ad sets, then the campaign, switched on.
 *
 * Gates, all before any write: the Purchase create's (campaign create; the
 * deployment's apply gate and the Live arm are the caller's) plus the
 * audience-write gate; a move also needs the lifetime-budget gate and an
 * own-domain conversion its own gate. Nothing launches without Matas's
 * Accept and Apply, and nothing is active before step 7.
 *
 * Every Meta write goes through meta_write_idempotency keyed on the line,
 * and the campaign's id is stored on the line from step 2, so a retry never
 * makes a second campaign. Meta and the audience builder are passed in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCampaignPayload } from "../meta/campaign.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { campaignCreateEnabled, customConversionCreateEnabled, lifetimeBudgetWritesEnabled, reuseAd, showEndTime, type PurchaseMeta, type ReusedCreative } from "../onsale-refresh/apply-purchase.ts";
import { audienceWritesEnabledFrom } from "../onsale-refresh/apply-gates.ts";
import { campaignFloor, floorBracket } from "../onsale-refresh/purchase-campaign.ts";
import { tierAudienceName, tierSpecs, type TierAudience } from "./audiences.ts";
import { daysToShow, isShare, RT4, type Share } from "./budget.ts";
import type { RetargetingBuild } from "./plan.ts";
import { pence, pounds, tierAdSetName, type Tier } from "./words.ts";

type Db = Pick<SupabaseClient, "from">;

export type RetargetingMeta = Pick<PurchaseMeta, "readCampaignBudget" | "readAd" | "createCreativeFromPost" | "createCampaign" | "createAdSet" | "createAd" | "updateCampaign" | "setAdSetActive" | "findCustomConversion" | "createCustomConversion"> & {
  /** GET /{adset}: its targeting (the tiers copy the location only). */
  readAdSetTargeting(adsetId: string): Promise<Record<string, unknown> | null>;
  /** An audience's state on Meta (operation_status). */
  audienceState(audienceId: string): Promise<"ready" | "building" | "too_small">;
  /** Every video of the show's ads, by the page it ran from (the audience builder's campaign walk). */
  listShowVideos(adAccountId: string, campaignIds: string[]): Promise<{ contextId: string; videoIds: string[] }[]>;
};

export type RetargetingDeps = {
  db: Db;
  env: Record<string, string | undefined>;
  meta: RetargetingMeta;
  /** The audience builder: make (or reuse) one tier audience. Null = nothing to build from. */
  ensureAudience(aud: Exclude<TierAudience, { kind: "list" }>, name: string, adAccountId: string): Promise<{ metaAudienceId: string } | null>;
  /** R5 at apply time. */
  plan: { budget: number | null; spend: number; today: string; appliedMovesGbp: number };
  /** The main campaign's spend to date now, £. */
  mainSpentNow: number;
  /** For launched_ad_sets. */
  owner: { userId: string; clientId: string | null; eventId: string; launchRunId: string };
};

export type RetargetingLine = { id: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null };

export type RetargetingProgress = {
  customConversionId?: string;
  campaignId?: string;
  /** Audience key → Meta id. */
  audiences?: Record<string, string>;
  adSets?: Partial<Record<Tier, { id: string; dailyMinor: number }>>;
  ads?: string[];
  main?: { before: number; after: number; moved: number };
  share?: Share;
  holdMinor?: number;
  active?: boolean;
};

type Outcome = { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> };

export const RT_CREATE_OFF = "Making the Retargeting campaign is switched off on this deployment, so nothing was built.";
export const RT_AUDIENCES_OFF = "Making audiences is switched off on this deployment, so nothing was built.";
export const RT_MOVE_OFF = "Moving budget out of the main campaign is switched off on this deployment, so nothing was built.";
export const RT_CONVERSION_OFF = "Making the show's custom conversion is switched off on this deployment, so nothing was built.";
export const RT_AUDIENCE_BUILDING = "Meta is still building an audience. Retry in an hour.";
export const RT_AUDIENCE_SMALL = "An audience is too small for Meta to deliver to yet.";

/** RT1 / audit §3.1: the settings every tier shares. */
export const TIER_ATTRIBUTION = [
  { event_type: "CLICK_THROUGH", window_days: 7 },
  { event_type: "VIEW_THROUGH", window_days: 1 },
] as const;

/** The location of the show's on-sale ad set, nothing else of its targeting. */
export function locationOf(targeting: Record<string, unknown> | null): Record<string, unknown> {
  const geo = targeting?.geo_locations;
  return geo && typeof geo === "object" ? { geo_locations: geo } : { geo_locations: { countries: ["GB"] } };
}

/** RT1: one tier's ad set. */
export function tierAdSetPayload(args: { code: string; tier: Tier; campaignId: string; dailyMinor: number; pixelId: string; customConversionId: string | null; endDay: string; location: Record<string, unknown>; includeIds: string[]; excludeIds: string[] }): Record<string, unknown> {
  return {
    name: tierAdSetName(args.code, args.tier),
    campaign_id: args.campaignId,
    status: "PAUSED",
    daily_budget: args.dailyMinor,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    promoted_object: args.customConversionId ? { pixel_id: args.pixelId, custom_conversion_id: args.customConversionId } : { pixel_id: args.pixelId, custom_event_type: "PURCHASE" },
    attribution_spec: TIER_ATTRIBUTION,
    end_time: showEndTime(args.endDay),
    targeting: {
      ...args.location,
      custom_audiences: args.includeIds.map((id) => ({ id })),
      ...(args.excludeIds.length ? { excluded_custom_audiences: args.excludeIds.map((id) => ({ id })) } : {}),
      publisher_platforms: ["facebook", "instagram"],
      facebook_positions: ["feed"],
      instagram_positions: ["stream", "story", "reels"],
      device_platforms: ["mobile", "desktop"],
      targeting_automation: { advantage_audience: 0 },
      targeting_relaxation_types: { custom_audience: 0, lookalike: 0 },
    },
  };
}

function priorProgress(line: RetargetingLine): RetargetingProgress {
  const result = line.applied_result ?? {};
  const own = result.retargeting as RetargetingProgress | undefined;
  const previous = (result.previous as Record<string, unknown> | undefined)?.retargeting as RetargetingProgress | undefined;
  return { ...(previous ?? {}), ...(own ?? {}) };
}

async function storeProgress(db: Db, lineId: string, progress: RetargetingProgress): Promise<void> {
  await db.from("onsale_refresh_lines").update({ applied_result: { retargeting: progress } }).eq("id", lineId);
}

async function storeAudience(db: Db, row: { event_id: string; user_id: string; part: string; meta_audience_id: string; name: string; line_id: string }): Promise<void> {
  const res = await db.from("onsale_refresh_audiences").upsert({ ...row, kind: "retargeting_campaign", campaign_key: "" }, { onConflict: "event_id,kind,part,campaign_key" });
  if (res.error) throw new Error(`onsale_refresh_audiences store: ${res.error.message}`);
}

async function storedAudiences(db: Db, eventId: string): Promise<Map<string, string>> {
  const res = await db.from("onsale_refresh_audiences").select("part, meta_audience_id").eq("event_id", eventId).eq("kind", "retargeting_campaign").eq("campaign_key", "");
  if (res.error) throw new Error(`onsale_refresh_audiences: ${res.error.message}`);
  return new Map(((res.data ?? []) as { part: string; meta_audience_id: string | null }[]).filter((row) => row.meta_audience_id).map((row) => [row.part, row.meta_audience_id!]));
}

function made(progress: RetargetingProgress): string {
  const parts: string[] = [];
  if (progress.campaignId) parts.push("the campaign");
  const audiences = Object.keys(progress.audiences ?? {}).length;
  if (audiences) parts.push(`${audiences} audience${audiences === 1 ? "" : "s"}`);
  const sets = Object.keys(progress.adSets ?? {}).length;
  if (sets) parts.push(`${sets} ad set${sets === 1 ? "" : "s"}`);
  const ads = progress.ads?.length ?? 0;
  if (ads) parts.push(`${ads} ad${ads === 1 ? "" : "s"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

/** Failed before anything went live (the Purchase create's PC5 words). */
export function failedBeforeLive(reason: string, progress: RetargetingProgress): string {
  const what = made(progress);
  const said = reason.replace(/\.$/, "");
  return what ? `${said}. Created paused: ${what}.` : `${said}.`;
}

/** Applied ("Applied · " is the panel's). */
export function appliedText(args: { tiers: number; ads: number; totalMinor: number; share: number; endDay: string }): string {
  return `live · ${args.tiers} tier${args.tiers === 1 ? "" : "s"} · ${args.ads} ad${args.ads === 1 ? "" : "s"} · ${pence(args.totalMinor, { minor: true })} a day (${args.share} %) to the show`;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function applyRetargetingCampaign(deps: RetargetingDeps, line: RetargetingLine, ctx: { ledger: MetaWriteContext; adAccountId: string; plainMetaReason: (err: unknown) => string }): Promise<Outcome> {
  const build = (line.write ?? {}) as unknown as RetargetingBuild;
  const progress = priorProgress(line);
  const fail = (reason: string, extra: Record<string, unknown> = {}): Outcome => ({ state: "failed", reason: failedBeforeLive(reason, progress), result: { retargeting: progress, ...extra } });
  if (build.kind !== "retargeting_campaign_create" || !build.endDay || !build.pixelId || !build.sources || !build.byShare) return { state: "failed", reason: "The line has nothing to build.", result: {} };

  // The gates, all before any write.
  if (!campaignCreateEnabled(deps.env)) return fail(RT_CREATE_OFF);
  if (!audienceWritesEnabledFrom(deps.env)) return fail(RT_AUDIENCES_OFF);
  if (build.customConversion && !progress.customConversionId && !customConversionCreateEnabled(deps.env)) return fail(RT_CONVERSION_OFF);

  const share: Share = progress.share ?? (isShare(build.share) ? build.share : build.defaultShare ?? RT4.defaultShare);
  const budgets = build.byShare[String(share)];
  if (!budgets) return fail("The picked share has no budgets");
  const days = Math.max(0, daysToShow(deps.plan.today, build.endDay));
  if (days < 1) return fail("The show has passed, so nothing was built");
  const holdMinor = progress.holdMinor ?? budgets.totalMinor * days;
  const hold = holdMinor / 100;
  const headroom = round2(Math.min(hold, budgets.headroom));
  const move = round2(hold - headroom);
  const short = build.main?.short ?? "the main campaign";
  if (move > 0 && !progress.main && !lifetimeBudgetWritesEnabled(deps.env)) return fail(RT_MOVE_OFF);

  // R5 again, on live figures, before anything is made.
  if (!progress.campaignId) {
    let mainLifetime: number | null = null;
    if (build.main?.campaignId) {
      try {
        const live = await deps.meta.readCampaignBudget(build.main.campaignId);
        mainLifetime = live.lifetime == null ? null : live.lifetime / 100;
      } catch (err) {
        return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "read" });
      }
    }
    const capBase = deps.plan.budget != null ? Math.max(0, deps.plan.budget - deps.plan.spend) : mainLifetime == null ? null : Math.max(0, mainLifetime - deps.mainSpentNow);
    if (capBase == null) return fail(`${short} has no lifetime budget to move from`);
    const cap = round2(capBase * RT4.capShare - deps.plan.appliedMovesGbp);
    if (hold > cap + 1e-9) return fail(`${pounds(hold)} is over this refresh's 20 % cap (${pounds(Math.max(0, cap))} free)`);
    if (move > 0) {
      if (mainLifetime == null) return fail(`${short} has no lifetime budget to move from`);
      if (build.main?.lifetimeGbp != null && Math.abs(mainLifetime - build.main.lifetimeGbp) > 0.005) return fail(`${short}'s budget changed in Ads Manager since the proposal`);
      const floor = campaignFloor(deps.mainSpentNow, build.main?.last7Daily ?? 0);
      if (mainLifetime - move < floor.floor - 1e-9) return fail(`${short} would go under ${pounds(floor.floor)} ${floorBracket(floor)}`);
    }
  }
  progress.share = share;
  progress.holdMinor = holdMinor;

  const keyBase = { line_id: line.id };
  // Mid's videos: the proposal knew only that the show's ads have video; the list is read now.
  let sources = build.sources;
  if (sources.videos.length && budgets.tiers.mid > 0) {
    try {
      sources = { ...sources, videos: await deps.meta.listShowVideos(ctx.adAccountId, build.videoCampaignIds ?? build.campaignIds ?? []) };
    } catch (err) {
      return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "videos" });
    }
  }
  const specs = tierSpecs(sources).filter((spec) => budgets.tiers[spec.tier] > 0);
  if (!specs.length) return fail("No tier has an audience to build");
  try {
    // 1. The custom conversion (own-domain path), reused by name.
    if (build.customConversion && !progress.customConversionId) {
      const spec = build.customConversion;
      progress.customConversionId = await withMetaWriteIdempotency(ctx.ledger, "refresh_custom_conversion_create", keyBase, async () => (await deps.meta.findCustomConversion(ctx.adAccountId, spec.name)) ?? deps.meta.createCustomConversion(ctx.adAccountId, { name: spec.name, pixelId: build.pixelId, domain: spec.domain }), { required: true });
    }
    // 2. The campaign, paused, with no budget of its own. One per line, ever.
    if (!progress.campaignId) {
      const payload = buildCampaignPayload({ name: build.campaignName, objective: "purchase", status: "PAUSED" }) as unknown as Record<string, unknown>;
      progress.campaignId = await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_create", keyBase, () => deps.meta.createCampaign(ctx.adAccountId, payload), { required: true });
      await storeProgress(deps.db, line.id, progress);
    }
    // 3. The audiences: stored ids reused, lists as uploaded.
    progress.audiences ??= {};
    const stored = await storedAudiences(deps.db, deps.owner.eventId);
    const ensure = async (aud: TierAudience): Promise<string | null> => {
      if (aud.kind === "list") return aud.metaAudienceId;
      const have = progress.audiences![aud.key] ?? stored.get(aud.key);
      if (have) {
        progress.audiences![aud.key] = have;
        return have;
      }
      const name = tierAudienceName(build.eventCode, aud);
      const built = await deps.ensureAudience(aud, name, ctx.adAccountId);
      if (!built) return null;
      await storeAudience(deps.db, { event_id: deps.owner.eventId, user_id: deps.owner.userId, part: aud.key, meta_audience_id: built.metaAudienceId, name, line_id: line.id });
      progress.audiences![aud.key] = built.metaAudienceId;
      await storeProgress(deps.db, line.id, progress);
      return built.metaAudienceId;
    };
    const ids = new Map<string, string>();
    for (const spec of specs) for (const aud of [...spec.includes, ...spec.excludes]) {
      if (ids.has(aud.key)) continue;
      const id = await ensure(aud);
      if (id) ids.set(aud.key, id);
    }
    for (const [key, id] of Object.entries(progress.audiences)) {
      if (!ids.has(key)) continue;
      const state = await deps.meta.audienceState(id);
      if (state === "building") return fail(RT_AUDIENCE_BUILDING, { step: "audience" });
      if (state === "too_small") return fail(RT_AUDIENCE_SMALL, { step: "audience" });
    }
    // 4. The tier ad sets, paused.
    const location = locationOf(build.geoFromAdsetId ? await deps.meta.readAdSetTargeting(build.geoFromAdsetId) : null);
    progress.adSets ??= {};
    for (const spec of specs) {
      if (progress.adSets[spec.tier]) continue;
      const includeIds = spec.includes.map((aud) => ids.get(aud.key)).filter((id): id is string => Boolean(id));
      if (!includeIds.length) continue;
      const excludeIds = spec.excludes.map((aud) => ids.get(aud.key)).filter((id): id is string => Boolean(id));
      const dailyMinor = budgets.tiers[spec.tier];
      const payload = tierAdSetPayload({ code: build.eventCode, tier: spec.tier, campaignId: progress.campaignId!, dailyMinor, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.endDay, location, includeIds, excludeIds });
      const id = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { ...keyBase, tier: spec.tier }, () => deps.meta.createAdSet(ctx.adAccountId, payload), { required: true });
      progress.adSets[spec.tier] = { id, dailyMinor };
      await storeProgress(deps.db, line.id, progress);
      await recordTierAdSet(deps, { metaAdsetId: id, campaignId: progress.campaignId!, adAccountId: ctx.adAccountId, draftId: ctx.ledger.draftId ?? null, name: String(payload.name), dailyMinor, tier: spec.tier });
    }
    // 5. The ads: the on-sale campaigns' live creatives, the same in every tier.
    const creatives: ReusedCreative[] = [];
    for (const ad of build.ads ?? []) {
      const live = await deps.meta.readAd(ad.adId);
      if (!live?.creativeId) return fail(`The ad it reuses (${ad.name}) can't be read`, { step: "ad" });
      creatives.push({ name: live.name || ad.name, creativeId: live.creativeId, objectStoryId: live.objectStoryId ?? null });
    }
    const adIds = new Set(progress.ads ?? []);
    for (const set of Object.values(progress.adSets)) {
      for (const creative of creatives) adIds.add((await reuseAd(deps.meta, ctx.ledger, { lineId: line.id, adAccountId: ctx.adAccountId, adsetId: set!.id, creative })).adId);
    }
    progress.ads = [...adIds];
    // 6. The main campaign's lifetime budget, lowered — only when money moves.
    if (move > 0 && !progress.main && build.main?.campaignId) {
      const live = await deps.meta.readCampaignBudget(build.main.campaignId);
      const before = (live.lifetime ?? 0) / 100;
      const after = round2(before - move);
      await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_lifetime_budget_update", { ...keyBase, campaign_id: build.main.campaignId, lifetime_budget: Math.round(after * 100) }, async () => {
        await deps.meta.updateCampaign(build.main!.campaignId!, { lifetime_budget: Math.round(after * 100) });
        return build.main!.campaignId!;
      }, { required: true });
      progress.main = { before, after, moved: move };
      await storeProgress(deps.db, line.id, progress);
    }
  } catch (err) {
    return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err) });
  }
  // 7. Switched on: the ad sets, then the campaign.
  try {
    for (const set of Object.values(progress.adSets ?? {})) {
      await withMetaWriteIdempotency(ctx.ledger, "adset_status_update", { ...keyBase, adset_id: set!.id, status: "ACTIVE" }, async () => {
        await deps.meta.setAdSetActive(set!.id);
        return set!.id;
      }, { required: true });
    }
    await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_status_update", { ...keyBase, campaign_id: progress.campaignId, status: "ACTIVE" }, async () => {
      await deps.meta.updateCampaign(progress.campaignId!, { status: "ACTIVE" });
      return progress.campaignId!;
    }, { required: true });
  } catch (err) {
    return { state: "failed", reason: `built and paused, not switched on: ${ctx.plainMetaReason(err)}. Retry switches it on.`, result: { retargeting: progress, error: err instanceof Error ? err.message : String(err), step: "switch_on" } };
  }
  progress.active = true;
  return { state: "applied", reason: appliedText({ tiers: Object.keys(progress.adSets ?? {}).length, ads: build.ads?.length ?? 0, totalMinor: budgets.totalMinor, share, endDay: build.endDay }), result: { retargeting: progress } };
}

/** HR3: each tier ad set is recorded like a launch (launched_ad_sets), so the learning loop joins its ads to the show. Never throws. */
async function recordTierAdSet(deps: RetargetingDeps, row: { metaAdsetId: string; campaignId: string; adAccountId: string; draftId: string | null; name: string; dailyMinor: number; tier: Tier }): Promise<void> {
  try {
    const res = await deps.db.from("launched_ad_sets").upsert(
      {
        meta_adset_id: row.metaAdsetId,
        meta_campaign_id: row.campaignId,
        ad_account_id: row.adAccountId,
        draft_id: row.draftId,
        user_id: deps.owner.userId,
        client_id: deps.owner.clientId,
        event_id: deps.owner.eventId,
        launch_run_id: deps.owner.launchRunId,
        channel: "meta",
        source_type: "custom_group",
        source_name: row.name,
        objective: "purchase",
        phase_at_launch: "on_sale",
        initial_daily_budget_pence: row.dailyMinor,
        launch_note: `Retargeting · ${row.tier}`,
        descriptor_source: "launch",
      },
      { onConflict: "meta_adset_id" },
    );
    if (res.error) console.error("[retargeting] launched_ad_sets upsert failed", { meta_adset_id: row.metaAdsetId, error: res.error.message });
  } catch (err) {
    console.error("[retargeting] launched_ad_sets upsert failed", { meta_adset_id: row.metaAdsetId, error: err instanceof Error ? err.message : String(err) });
  }
}
