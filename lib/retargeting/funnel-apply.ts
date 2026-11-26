/**
 * The funnel's create path (docs/design-record/2026-11-26-retargeting-funnel.html,
 * RF1–RF5, RF8), shared by the panel's Accept (lib/onsale-refresh/apply.ts)
 * and the connector's create_retargeting tool.
 * It is RT1's Purchase create path with budgets on the ad sets
 * (lib/retargeting/apply.ts's helpers), re-ruled:
 *
 *   1. the custom conversion (own-domain path only), reused by name;
 *   2. "{code} · Retargeting", paused, no campaign budget;
 *   3. RF2's audiences, each stored on the event before the next so a
 *      re-run reuses it (through `createAudience`, Job 2's path); one the
 *      builder can't make yet is left out and its tier builds without it;
 *   4. Cold, Warm and Hot, paused, each its share's daily budget, its
 *      includes and leave-outs (a launched_ad_sets row each);
 *   5. the ads: the show's live creatives, the same in every tier, with
 *      the show's current copy;
 *   live only (RF4: a paused build moves nothing):
 *   6. the show's ceiling on the change in its total (`checkCeiling`,
 *      Job 3's; a full take leaves the total the same);
 *   7. the prospecting budgets lowered, largest first, each only from the
 *      budget it was planned at (the giving side first, so spend never goes
 *      up mid-build);
 *   8. the ad sets, then the campaign, switched on;
 *   9. each stretch step a scheduled budget change (`scheduleChange`, M3b's
 *      scheduled changes): the prospecting side at 00:00 London, the tiers
 *      at 00:05, on the step's day.
 *
 * Gates, all before any write: the deployment's apply gate with the Live
 * arm (RT16's retargetingGates), ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED,
 * OFFPIXEL_META_AUDIENCE_WRITES_ENABLED; a live build also the budget write
 * gate (ENABLE_OPTIMISATION_WRITES).
 *
 * Every Meta write is on meta_write_idempotency keyed on the event
 * (`rf:{eventId}`), and the progress is on the show's retargeting_builds
 * row (migration 275), so a re-run — from the panel or Claude — never makes
 * a second campaign, ad set, ad or budget change. Meta and the three seams
 * are passed in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCampaignPayload } from "../meta/campaign.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { applyEnabled, audienceWritesEnabledFrom, retargetingGates, applyGates } from "../onsale-refresh/apply-gates.ts";
import { campaignCreateEnabled, customConversionCreateEnabled, reuseAd, type ReusedCreative } from "../onsale-refresh/apply-purchase.ts";
import { isOptimisationWritesEnabledFromEnv } from "../optimisation/gates.ts";
import { widerAdSetPayload, widerCampaignFields, locationOf, RT_AUDIENCE_BUILDING, RT_AUDIENCE_SMALL, RT_AUDIENCES_OFF, RT_CONVERSION_OFF, RT_CREATE_OFF, tierAdSetPayload, type RetargetingMeta } from "./apply.ts";
import { audiencesToMake, funnelAdSetName, funnelSpecs, FUNNEL_TIERS, FUNNEL_TIER_LABEL, type FunnelAudience, type FunnelSources, type FunnelStretch, type FunnelTier, type TakeLine, type TierMinor } from "./funnel.ts";
import type { FunnelStepPlan } from "./funnel-plan.ts";
import { advantageOff, geoExpansionOff, widerAdSetName, type Interest, type LookalikeAudience, type WiderAdSetKey, type WiderStep } from "./show-campaigns.ts";

type Db = Pick<SupabaseClient, "from">;

/** What a Create line (or plan_retargeting) builds; stored as the line's write. */
export type FunnelBuild = {
  kind: "retargeting_funnel_create";
  eventId: string;
  eventCode: string;
  campaignName: string;
  path: "platform" | "own_domain";
  pixelId: string;
  customConversion: { name: string; domain: string } | null;
  sources: FunnelSources;
  startDay: string;
  endDay: string;
  plan: {
    stretch: FunnelStretch;
    share: number;
    showDailyMinor: number;
    targetMinor: number;
    totalMinor: number;
    tiers: TierMinor;
    take: TakeLine[];
    steps: FunnelStepPlan[];
  };
  ads: { adId: string; name: string }[];
  geoFromAdsetId: string | null;
  videoCampaignIds: string[];
  draftId: string | null;
  adAccountId: string | null;
  campaignIds: string[];
  /**
   * STAGED (two-campaign record): "{code} · Wider", folding the show's
   * prospecting (Matas, 26 Nov), one CBO lifetime budget. Absent = Retargeting
   * alone (#1396).
   */
  wider?: {
    campaignName: string;
    dailyMinor: number;
    lifetimeMinor: number;
    daysLeft: number;
    adSets: { key: WiderAdSetKey; interests: Interest[]; suggestionKeys: string[]; lookalikes: LookalikeAudience[]; excludeKeys: string[] }[];
    steps: WiderStep[];
  } | null;
};

/** What the audience seam makes: a funnel audience, or (Wider) a 1 % lookalike of an audience already made. */
export type MakeAudience = Exclude<FunnelAudience, { kind: "list" }> | (LookalikeAudience & { originId: string });

export type FunnelMeta = Pick<RetargetingMeta, "readAd" | "createCreativeFromPost" | "createCampaign" | "createAdSet" | "createAd" | "updateCampaign" | "setAdSetActive" | "findCustomConversion" | "createCustomConversion" | "readAdSetTargeting" | "audienceState" | "listShowVideos"> & {
  /** GET /{id}?fields=daily_budget: an ad set's or a campaign's daily budget now, minor units; null when it has none. */
  readDailyBudget(kind: "adset" | "campaign", id: string): Promise<number | null>;
  /** POST /{id} { daily_budget }: the app's budget write for one ad set or campaign budget. */
  setDailyBudget(kind: "adset" | "campaign", id: string, minor: number): Promise<void>;
};

/** One budget change at a later time (M3b's scheduled changes, migration 271). */
export type ScheduledStep = { objectKind: "adset" | "campaign"; objectId: string; objectName: string; field: "daily_budget" | "lifetime_budget"; amountMinor: number; expectedMinor: number; runAt: string; raisesSpend: boolean; key: string };

export type FunnelSeams = {
  /** Job 2's audience create: make (or reuse) one audience. Null = the builder can't make this kind yet. */
  createAudience(aud: MakeAudience, name: string, adAccountId: string): Promise<{ metaAudienceId: string } | null>;
  /** M3b's scheduled change (Job 1 switches it on). Returns the row's id. */
  scheduleChange(step: ScheduledStep): Promise<{ id: string }>;
  /**
   * The show's ceiling (#1397, the per-show ceiling) on the change: Retargeting's daily
   * budgets and Wider's lifetime as new spend, each lowered prospecting budget as it would be
   * after. before / after are the show's money a day, for the log. Throws a plain refusal.
   */
  checkCeiling(change: { eventId: string; code: string; beforeMinor: number; afterMinor: number; retargetingDailyMinor: number; take: readonly TakeLine[]; wider: { name: string; lifetimeMinor: number } | null; endDay: string }): Promise<void>;
};

export type FunnelDeps = FunnelSeams & {
  db: Db;
  env: Record<string, string | undefined>;
  meta: FunnelMeta;
  owner: { userId: string; clientId: string | null; eventId: string; launchRunId: string };
  source: "panel" | "connector";
};

export type FunnelProgress = {
  customConversionId?: string;
  campaignId?: string;
  audiences?: Record<string, string>;
  /** Audiences the builder couldn't make yet (their tier built without them). */
  notMade?: string[];
  adSets?: Partial<Record<FunnelTier, { id: string; dailyMinor: number }>>;
  ads?: string[];
  /** The prospecting budgets lowered (live only). */
  moved?: { id: string; kind: "adset" | "campaign"; name?: string; beforeMinor: number; afterMinor: number }[];
  active?: boolean;
  scheduled?: string[];
  /** Each tier ad set's settings as Meta holds them after create (Matas's 26 Nov item 2): location expansion off, Advantage+ off. */
  readBack?: { adsetId: string; name: string; geoOff: boolean; advantageOff: boolean; /** false when Meta couldn't be read. */ read?: boolean }[];
  /** STAGED: the Wider campaign's ids. */
  wider?: { campaignId?: string; adSets?: Partial<Record<WiderAdSetKey, { id: string }>>; ads?: string[] };
};

export type FunnelOutcome = {
  state: "applied" | "failed";
  /** A plain sentence (no raw Meta error); the caller adds its own ending. */
  reason: string | null;
  progress: FunnelProgress;
  /** The raw reason for the log, never for Claude. */
  error?: string;
  step?: string;
};

/**
 * The create path's sentences: the 17 Nov record's where one fits (switched
 * off, audiences off, still building, too small); the rest PENDING DESIGN.
 */
export const RF_APPLY_WORDS = {
  switchedOff: RT_CREATE_OFF,
  audiencesOff: RT_AUDIENCES_OFF,
  conversionOff: RT_CONVERSION_OFF,
  // PENDING DESIGN

  moneyOff: "Moving budget between ad sets is switched off on this deployment, so it can only be made paused.",
  nothingToBuild: "There's nothing to build: no tier has an audience.",
  noAccount: "The show's ad account isn't known, so nothing can be made in it.",
  passed: "The show has passed.",
  building: RT_AUDIENCE_BUILDING,
  tooSmall: RT_AUDIENCE_SMALL,
  // PENDING DESIGN
  adUnread: (name: string) => `The ad it reuses (${name}) can't be read.`,
  budgetChanged: (name: string) => `${name}'s budget changed in Ads Manager since the plan.`,
  switchOn: "Built and paused, not switched on. A retry switches it on.",
} as const;

export const BUILDS_TABLE = "retargeting_builds";

export async function loadFunnelProgress(db: Db, eventId: string): Promise<{ progress: FunnelProgress; mode: "paused" | "live" | null } | null> {
  const res = await db.from(BUILDS_TABLE).select("progress, mode, state").eq("event_id", eventId).maybeSingle();
  if (res.error) throw new Error(`retargeting_builds: ${res.error.message}`);
  const row = res.data as { progress: FunnelProgress | null; mode: "paused" | "live" | null } | null;
  return row ? { progress: row.progress ?? {}, mode: row.mode } : null;
}

async function saveProgress(deps: FunnelDeps, build: FunnelBuild, progress: FunnelProgress, extra: { mode?: "paused" | "live"; state: "building" | "paused" | "live" | "failed" }): Promise<void> {
  const res = await deps.db.from(BUILDS_TABLE).upsert(
    {
      event_id: build.eventId,
      user_id: deps.owner.userId,
      campaign_name: build.campaignName,
      meta_campaign_id: progress.campaignId ?? null,
      ad_account_id: build.adAccountId,
      draft_id: build.draftId,
      ...(extra.mode ? { mode: extra.mode } : {}),
      state: extra.state,
      progress,
      build,
      source: deps.source,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id" },
  );
  if (res.error) throw new Error(`retargeting_builds store: ${res.error.message}`);
}

async function storedAudiences(db: Db, eventId: string): Promise<Map<string, string>> {
  const res = await db.from("onsale_refresh_audiences").select("part, meta_audience_id").eq("event_id", eventId).eq("kind", "retargeting_campaign").eq("campaign_key", "");
  if (res.error) throw new Error(`onsale_refresh_audiences: ${res.error.message}`);
  return new Map(((res.data ?? []) as { part: string; meta_audience_id: string | null }[]).filter((row) => row.meta_audience_id).map((row) => [row.part, row.meta_audience_id!]));
}

async function storeAudience(db: Db, row: { event_id: string; user_id: string; part: string; meta_audience_id: string; name: string }): Promise<void> {
  const res = await db.from("onsale_refresh_audiences").upsert({ ...row, kind: "retargeting_campaign", campaign_key: "", line_id: null }, { onConflict: "event_id,kind,part,campaign_key" });
  if (res.error) throw new Error(`onsale_refresh_audiences store: ${res.error.message}`);
}

/** PENDING DESIGN: an audience's name in Ads Manager, "{code} · {source and window}" (RT14's form). */
export function funnelAudienceName(code: string, aud: Exclude<FunnelAudience, { kind: "list" }>, pageName?: string | null): string {
  const what =
    aud.kind === "video" ? `Video viewers ${aud.threshold} % · ${aud.retentionDays} days${pageName ? ` · ${pageName}` : ""}`
    : aud.kind === "page_fb" ? `Page engagers · ${aud.retentionDays} days`
    : aud.kind === "page_ig" ? `Instagram engagers · ${aud.retentionDays} days`
    : aud.kind === "followers_fb" ? "Page followers · all time"
    : aud.kind === "followers_ig" ? "Instagram followers · all time"
    : aud.source === "visitors" ? "Show page and ticket-link visitors · 60 days"
    : aud.source === "ticket" ? "Ticket-link visitors · 30 days"
    : aud.source === "checkout" ? `Checkout starters · ${"retentionDays" in aud ? aud.retentionDays : ""} days`
    : `Registrations · ${"retentionDays" in aud ? aud.retentionDays : ""} days`;
  return `${code} · ${what}`;
}

/** London midnight (or minutes after) on a day, as an ISO instant. */
export function londonAt(day: string, minutes = 0): string {
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(guess).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const hours = Number(/GMT([+-]\d+)?/.exec(offset)?.[1] ?? 0);
  return new Date(guess.getTime() - hours * 3_600_000 + minutes * 60_000).toISOString();
}

/** The changes each stretch step makes: prospecting first (00:00), then the tiers (00:05). */
export function stepChanges(build: FunnelBuild, adSets: Partial<Record<FunnelTier, { id: string; dailyMinor: number }>>, widerCampaignId?: string | null): ScheduledStep[] {
  const out: ScheduledStep[] = [];
  // Wider's lifetime budget moves first (00:00), the giving side when retargeting's share rises.
  if (build.wider && widerCampaignId) {
    for (const step of build.wider.steps) {
      if (step.afterMinor === step.beforeMinor) continue;
      out.push({ objectKind: "campaign", objectId: widerCampaignId, objectName: build.wider.campaignName, field: "lifetime_budget", amountMinor: step.afterMinor, expectedMinor: step.beforeMinor, runAt: londonAt(step.day, 0), raisesSpend: step.afterMinor > step.beforeMinor, key: `rf:${build.eventId}:${step.day}:wider` });
    }
  }
  const tierNow: TierMinor = { similar: adSets.similar?.dailyMinor ?? 0, cold: adSets.cold?.dailyMinor ?? 0, warm: adSets.warm?.dailyMinor ?? 0, hot: adSets.hot?.dailyMinor ?? 0 };
  for (const step of build.plan.steps) {
    for (const line of step.prospecting) {
      out.push({ objectKind: line.kind, objectId: line.id, objectName: line.name, field: "daily_budget", amountMinor: line.afterMinor, expectedMinor: line.beforeMinor, runAt: londonAt(step.day, 0), raisesSpend: line.afterMinor > line.beforeMinor, key: `rf:${build.eventId}:${step.day}:${line.id}` });
    }
    for (const tier of FUNNEL_TIERS) {
      const set = adSets[tier];
      if (!set || step.tiers[tier] === tierNow[tier]) continue;
      out.push({ objectKind: "adset", objectId: set.id, objectName: funnelAdSetName(build.eventCode, tier), field: "daily_budget", amountMinor: step.tiers[tier], expectedMinor: tierNow[tier], runAt: londonAt(step.day, 5), raisesSpend: step.tiers[tier] > tierNow[tier], key: `rf:${build.eventId}:${step.day}:${tier}` });
      tierNow[tier] = step.tiers[tier];
    }
  }
  return out;
}

export function funnelGates(env: Record<string, string | undefined>): { create: boolean; audiences: boolean; money: boolean } {
  const gates = retargetingGates(applyGates(env, "live"));
  return { create: applyEnabled(env) && gates.mode === "live" && campaignCreateEnabled(env), audiences: audienceWritesEnabledFrom(env), money: isOptimisationWritesEnabledFromEnv(env) };
}

export async function applyFunnel(deps: FunnelDeps, build: FunnelBuild, ctx: { mode: "paused" | "live"; ledger: MetaWriteContext; plainMetaReason: (err: unknown) => string; today: string }): Promise<FunnelOutcome> {
  const before = await loadFunnelProgress(deps.db, build.eventId);
  const progress: FunnelProgress = { ...(before?.progress ?? {}) };
  const live = ctx.mode === "live";
  const fail = (reason: string, extra: { error?: string; step?: string } = {}): FunnelOutcome => ({ state: "failed", reason, progress, ...extra });
  if (build.kind !== "retargeting_funnel_create" || !build.pixelId || !build.endDay) return fail(RF_APPLY_WORDS.nothingToBuild);
  const gates = funnelGates(deps.env);
  if (!gates.create) return fail(RF_APPLY_WORDS.switchedOff);
  if (!gates.audiences) return fail(RF_APPLY_WORDS.audiencesOff);
  if (live && !gates.money && !progress.active) return fail(RF_APPLY_WORDS.moneyOff);
  if (build.customConversion && !progress.customConversionId && !customConversionCreateEnabled(deps.env)) return fail(RF_APPLY_WORDS.conversionOff);
  if (!build.adAccountId) return fail(RF_APPLY_WORDS.noAccount);
  if (build.endDay < ctx.today) return fail(RF_APPLY_WORDS.passed);
  const adAccountId = build.adAccountId;
  const keyBase = { rf: build.eventId };
  const totalAfter = FUNNEL_TIERS.reduce((sum, tier) => sum + build.plan.tiers[tier], 0);

  // 6 first, before any write: a live build checks the ceiling on the change in the show's total.
  if (live && !progress.active) {
    const taken = build.plan.take.reduce((sum, line) => sum + (line.beforeMinor - line.afterMinor), 0);
    try {
      // With Wider, the show's spend is Retargeting's plus Wider's (the prospecting it folds is paused on Matas's yes first).
      const afterMinor = build.wider ? totalAfter + build.wider.dailyMinor : build.plan.showDailyMinor - taken + totalAfter;
      await deps.checkCeiling({ eventId: build.eventId, code: build.eventCode, beforeMinor: build.plan.showDailyMinor, afterMinor, retargetingDailyMinor: totalAfter, take: build.plan.take, wider: build.wider ? { name: build.wider.campaignName, lifetimeMinor: build.wider.lifetimeMinor } : null, endDay: build.endDay });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), { step: "ceiling" });
    }
    // Each prospecting budget is lowered only from what the plan read.
    if (!progress.moved?.length) {
      for (const line of build.plan.take) {
        try {
          const now = await deps.meta.readDailyBudget(line.kind, line.id);
          if (now !== line.beforeMinor) return fail(RF_APPLY_WORDS.budgetChanged(line.name), { step: "read" });
        } catch (err) {
          return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "read" });
        }
      }
    }
  }

  let sources = build.sources;
  try {
    // RF2's videos: the plan knew which pages ran video; the ids are read now.
    if (sources.videos.length) {
      const read = await deps.meta.listShowVideos(adAccountId, build.videoCampaignIds.length ? build.videoCampaignIds : build.campaignIds);
      // A video with no Page (a dark post) goes under the show's promoter Page, with its explicit ids (READING: the ads ran from it).
      const promoter = sources.accounts.find((row) => row.kind === "promoter" && row.platform === "facebook" && row.access !== false)?.pageId ?? sources.accounts.find((row) => row.platform === "facebook" && row.access !== false)?.pageId ?? null;
      const groups = new Map<string, string[]>();
      for (const group of read) {
        const pageId = group.contextId || promoter;
        if (!pageId) continue;
        groups.set(pageId, [...new Set([...(groups.get(pageId) ?? []), ...group.videoIds])]);
      }
      sources = { ...sources, videos: [...groups].map(([pageId, videoIds]) => ({ pageId, videoIds })) };
    }
  } catch (err) {
    return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "videos" });
  }
  const specs = funnelSpecs(sources);
  if (!specs.length) return fail(RF_APPLY_WORDS.nothingToBuild);

  try {
    // 1. The custom conversion (own-domain path), reused by name.
    if (build.customConversion && !progress.customConversionId) {
      const spec = build.customConversion;
      progress.customConversionId = await withMetaWriteIdempotency(ctx.ledger, "refresh_custom_conversion_create", keyBase, async () => (await deps.meta.findCustomConversion(adAccountId, spec.name)) ?? deps.meta.createCustomConversion(adAccountId, { name: spec.name, pixelId: build.pixelId, domain: spec.domain }), { required: true });
    }
    // 2. The campaign, paused, no budget of its own. One per show, ever.
    if (!progress.campaignId) {
      const payload = buildCampaignPayload({ name: build.campaignName, objective: "purchase", status: "PAUSED" }) as unknown as Record<string, unknown>;
      progress.campaignId = await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_create", keyBase, () => deps.meta.createCampaign(adAccountId, payload), { required: true });
      await saveProgress(deps, build, progress, { state: "building" });
    }
    // 3. The audiences: stored ids reused; lists as uploaded; one the builder can't make yet is left out.
    progress.audiences ??= {};
    const stored = await storedAudiences(deps.db, build.eventId);
    const pageName = (id: string) => sources.accounts.find((row) => row.pageId === id)?.name ?? null;
    const notMade = new Set<string>();
    for (const aud of audiencesToMake(specs)) {
      const have = progress.audiences[aud.key] ?? stored.get(aud.key);
      if (have) {
        progress.audiences[aud.key] = have;
        continue;
      }
      const name = funnelAudienceName(build.eventCode, aud, aud.kind === "video" ? pageName(aud.pageId) : null);
      const made = await deps.createAudience(aud, name, adAccountId);
      if (!made) {
        notMade.add(aud.key);
        continue;
      }
      await storeAudience(deps.db, { event_id: build.eventId, user_id: deps.owner.userId, part: aud.key, meta_audience_id: made.metaAudienceId, name });
      progress.audiences[aud.key] = made.metaAudienceId;
      await saveProgress(deps, build, progress, { state: "building" });
    }
    progress.notMade = [...notMade];
    const idOf = (aud: FunnelAudience) => (aud.kind === "list" ? aud.metaAudienceId : (progress.audiences![aud.key] ?? null));
    for (const id of new Set(Object.values(progress.audiences))) {
      const state = await deps.meta.audienceState(id);
      if (state === "building") return fail(RF_APPLY_WORDS.building, { step: "audience" });
      if (state === "too_small") return fail(RF_APPLY_WORDS.tooSmall, { step: "audience" });
    }
    // 4. Cold, Warm and Hot, paused.
    const location = locationOf(build.geoFromAdsetId ? await deps.meta.readAdSetTargeting(build.geoFromAdsetId) : null);
    progress.adSets ??= {};
    for (const spec of specs) {
      if (progress.adSets[spec.tier]) continue;
      const dailyMinor = build.plan.tiers[spec.tier];
      if (!(dailyMinor > 0)) continue;
      const includeIds = spec.includes.map(idOf).filter((id): id is string => Boolean(id));
      if (!includeIds.length) continue;
      const excludeIds = spec.excludes.map(idOf).filter((id): id is string => Boolean(id));
      const payload = tierAdSetPayload({ code: build.eventCode, tier: spec.tier as never, campaignId: progress.campaignId!, dailyMinor, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.endDay, location, includeIds, excludeIds, name: funnelAdSetName(build.eventCode, spec.tier) });
      const id = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { ...keyBase, tier: spec.tier }, () => deps.meta.createAdSet(adAccountId, payload), { required: true });
      progress.adSets[spec.tier] = { id, dailyMinor };
      await saveProgress(deps, build, progress, { state: "building" });
      await recordTierAdSet(deps, { metaAdsetId: id, campaignId: progress.campaignId!, adAccountId, draftId: ctx.ledger.draftId ?? null, name: String(payload.name), dailyMinor, tier: spec.tier });
    }
    // The read-back: location expansion off and Advantage+ off on every tier, as Meta holds them (reported, never forced).
    progress.readBack = [];
    for (const tier of FUNNEL_TIERS) {
      const set = progress.adSets[tier];
      if (!set) continue;
      const targeting = await deps.meta.readAdSetTargeting(set.id).catch(() => null);
      progress.readBack.push({ adsetId: set.id, name: funnelAdSetName(build.eventCode, tier), geoOff: geoExpansionOff(targeting), advantageOff: advantageOff(targeting), read: targeting != null });
    }
    // 5. The ads: the show's live creatives, the same in every tier, as they run (their copy too).
    const creatives: ReusedCreative[] = [];
    for (const ad of build.ads) {
      const read = await deps.meta.readAd(ad.adId);
      if (!read?.creativeId) return fail(RF_APPLY_WORDS.adUnread(ad.name), { step: "ad" });
      creatives.push({ name: read.name || ad.name, creativeId: read.creativeId, objectStoryId: read.objectStoryId ?? null });
    }
    const adIds = new Set(progress.ads ?? []);
    for (const set of Object.values(progress.adSets)) {
      for (const creative of creatives) adIds.add((await reuseAd(deps.meta, ctx.ledger, { lineId: `rf:${build.eventId}`, adAccountId, adsetId: set!.id, creative })).adId);
    }
    progress.ads = [...adIds];
    if (build.wider) await buildWider(deps, build, progress, { ctx, adAccountId, location, creatives, keyBase });
    await saveProgress(deps, build, progress, { state: live ? "building" : "paused", ...(live ? {} : { mode: "paused" as const }) });
  } catch (err) {
    await saveProgress(deps, build, progress, { state: "failed" }).catch(() => undefined);
    return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "build" });
  }
  // A paused build moves nothing and schedules nothing.
  if (!live) return { state: "applied", reason: null, progress };

  try {
    // 7. Prospecting lowered, the giving side first.
    if (!progress.moved?.length) {
      progress.moved = [];
      for (const line of build.plan.take) {
        await withMetaWriteIdempotency(ctx.ledger, line.kind === "campaign" ? "campaign_budget_update" : "refresh_adset_budget_update", { ...keyBase, id: line.id, daily_budget: line.afterMinor }, async () => {
          await deps.meta.setDailyBudget(line.kind, line.id, line.afterMinor);
          return line.id;
        }, { required: true });
        progress.moved.push({ id: line.id, kind: line.kind, name: line.name, beforeMinor: line.beforeMinor, afterMinor: line.afterMinor });
        await saveProgress(deps, build, progress, { state: "building", mode: "live" });
      }
    }
  } catch (err) {
    await saveProgress(deps, build, progress, { state: "failed" }).catch(() => undefined);
    return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "move" });
  }
  // 8. Switched on: the ad sets, then the campaign.
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
    // Wider's ad sets, then its campaign.
    for (const set of Object.values(progress.wider?.adSets ?? {})) {
      await withMetaWriteIdempotency(ctx.ledger, "adset_status_update", { ...keyBase, adset_id: set!.id, status: "ACTIVE" }, async () => {
        await deps.meta.setAdSetActive(set!.id);
        return set!.id;
      }, { required: true });
    }
    if (progress.wider?.campaignId) {
      await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_status_update", { ...keyBase, campaign_id: progress.wider.campaignId, status: "ACTIVE" }, async () => {
        await deps.meta.updateCampaign(progress.wider!.campaignId!, { status: "ACTIVE" });
        return progress.wider!.campaignId!;
      }, { required: true });
    }
    progress.active = true;
  } catch (err) {
    await saveProgress(deps, build, progress, { state: "failed" }).catch(() => undefined);
    return fail(RF_APPLY_WORDS.switchOn, { error: err instanceof Error ? err.message : String(err), step: "switch_on" });
  }
  // 9. Each stretch step, a scheduled change (the same key is the same row on a re-run).
  const scheduled = new Set(progress.scheduled ?? []);
  try {
    for (const change of stepChanges(build, progress.adSets ?? {}, progress.wider?.campaignId ?? null)) scheduled.add((await deps.scheduleChange(change)).id);
  } catch (err) {
    progress.scheduled = [...scheduled];
    await saveProgress(deps, build, progress, { state: "live", mode: "live" }).catch(() => undefined);
    return { state: "applied", reason: null, progress, error: err instanceof Error ? err.message : String(err), step: "schedule" };
  }
  progress.scheduled = [...scheduled];
  await saveProgress(deps, build, progress, { state: "live", mode: "live" });
  return { state: "applied", reason: null, progress };
}

/**
 * STAGED: "{code} · Wider" — the campaign, paused, with its lifetime budget
 * (CBO); each Wider ad set's lookalikes through the audience seam (one a
 * source; a source the seam can't make yet is left out and its ad set built
 * without it, or not at all when it has nothing); its ad sets, paused,
 * Advantage+ on, suggestions and leave-outs; the same ads; the settings
 * read-back (location expansion). Every write on the ledger, keyed on the event.
 */
async function buildWider(deps: FunnelDeps, build: FunnelBuild, progress: FunnelProgress, args: { ctx: { ledger: MetaWriteContext }; adAccountId: string; location: Record<string, unknown>; creatives: ReusedCreative[]; keyBase: Record<string, unknown> }): Promise<void> {
  const wider = build.wider!;
  const { ctx, adAccountId, keyBase } = args;
  progress.wider ??= {};
  if (!progress.wider.campaignId) {
    const payload = { ...(buildCampaignPayload({ name: wider.campaignName, objective: "purchase", status: "PAUSED" }) as unknown as Record<string, unknown>), ...widerCampaignFields({ lifetimeMinor: wider.lifetimeMinor }) };
    progress.wider.campaignId = await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_create", { ...keyBase, campaign: "wider" }, () => deps.meta.createCampaign(adAccountId, payload), { required: true });
    await saveProgress(deps, build, progress, { state: "building" });
  }
  const idOf = (key: string) => progress.audiences?.[key] ?? (key.startsWith("list:") ? key.slice(5) : null);
  progress.wider.adSets ??= {};
  for (const set of wider.adSets) {
    if (progress.wider.adSets[set.key]) continue;
    const lookalikeIds: string[] = [];
    for (const lal of set.lookalikes) {
      const have = progress.audiences?.[lal.key];
      if (have) {
        lookalikeIds.push(have);
        continue;
      }
      const originId = idOf(lal.originKey);
      if (!originId) continue;
      // PENDING DESIGN: a lookalike's name in Ads Manager.
      const name = `${build.eventCode} · Lookalike 1 % GB · ${lal.originKey}`;
      const made = await deps.createAudience({ ...lal, originId }, name, adAccountId);
      if (!made) continue;
      await storeAudience(deps.db, { event_id: build.eventId, user_id: deps.owner.userId, part: lal.key, meta_audience_id: made.metaAudienceId, name });
      progress.audiences = { ...(progress.audiences ?? {}), [lal.key]: made.metaAudienceId };
      lookalikeIds.push(made.metaAudienceId);
    }
    const suggestionIds = [...set.suggestionKeys.map(idOf).filter((id): id is string => Boolean(id)), ...lookalikeIds];
    if (set.key !== "broad" && !suggestionIds.length && !set.interests.length) continue;
    const excludeIds = set.excludeKeys.map(idOf).filter((id): id is string => Boolean(id));
    const payload = widerAdSetPayload({ name: widerAdSetName(build.eventCode, set.key), campaignId: progress.wider.campaignId!, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.endDay, location: args.location, interests: set.interests, suggestionIds, excludeIds });
    const id = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { ...keyBase, wider: set.key }, () => deps.meta.createAdSet(adAccountId, payload), { required: true });
    progress.wider.adSets[set.key] = { id };
    await saveProgress(deps, build, progress, { state: "building" });
  }
  const adIds = new Set(progress.wider.ads ?? []);
  for (const set of Object.values(progress.wider.adSets)) {
    for (const creative of args.creatives) adIds.add((await reuseAd(deps.meta, ctx.ledger, { lineId: `rf:${build.eventId}:wider`, adAccountId, adsetId: set!.id, creative })).adId);
  }
  progress.wider.ads = [...adIds];
  for (const [key, set] of Object.entries(progress.wider.adSets)) {
    const targeting = await deps.meta.readAdSetTargeting(set!.id).catch(() => null);
    // Wider keeps Advantage+ on; only location expansion is read back.
    progress.readBack = [...(progress.readBack ?? []).filter((row) => row.adsetId !== set!.id), { adsetId: set!.id, name: widerAdSetName(build.eventCode, key as WiderAdSetKey), geoOff: geoExpansionOff(targeting), advantageOff: true, read: targeting != null }];
  }
}

/** HR3: each tier ad set recorded like a launch (launched_ad_sets). Never throws. */
async function recordTierAdSet(deps: FunnelDeps, row: { metaAdsetId: string; campaignId: string; adAccountId: string; draftId: string | null; name: string; dailyMinor: number; tier: FunnelTier }): Promise<void> {
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
        launch_note: `Retargeting · ${FUNNEL_TIER_LABEL[row.tier]}`,
        descriptor_source: "launch",
      },
      { onConflict: "meta_adset_id" },
    );
    if (res.error) console.error("[retargeting] launched_ad_sets upsert failed", { meta_adset_id: row.metaAdsetId, error: res.error.message });
  } catch (err) {
    console.error("[retargeting] launched_ad_sets upsert failed", { meta_adset_id: row.metaAdsetId, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * The audience builder's draft fields for a funnel audience: the subtypes it
 * already makes (website_pixel, video_views at 75 % or 95 %,
 * page_engagement_fb / _ig, page_followers_fb / _ig). Followers carry no
 * window (Meta requires retention 0; the builder sends it).
 */
export function funnelAudienceDraft(aud: Exclude<FunnelAudience, { kind: "list" }>): { subtype: "website_pixel" | "video_views" | "page_engagement_fb" | "page_engagement_ig" | "page_followers_fb" | "page_followers_ig"; retentionDays: number; sourceId: string; sourceMeta: Record<string, unknown> } {
  if (aud.kind === "pixel_url") return { subtype: "website_pixel", retentionDays: aud.retentionDays, sourceId: aud.pixelId, sourceMeta: { subtype: "website_pixel", pixelEvent: "PageView", urlContains: aud.urlContains } };
  if (aud.kind === "pixel_event") return { subtype: "website_pixel", retentionDays: aud.retentionDays, sourceId: aud.pixelId, sourceMeta: { subtype: "website_pixel", pixelEvent: aud.pixelEvent, urlContains: aud.urlContains } };
  if (aud.kind === "video") return { subtype: "video_views", retentionDays: aud.retentionDays, sourceId: aud.videoIds.join(","), sourceMeta: { subtype: "video_views", threshold: aud.threshold, videoIds: aud.videoIds, contextId: aud.pageId } };
  if (aud.kind === "page_fb" || aud.kind === "page_ig") {
    const subtype = aud.kind === "page_fb" ? "page_engagement_fb" : "page_engagement_ig";
    return { subtype, retentionDays: aud.retentionDays, sourceId: aud.pageIds.join(","), sourceMeta: { subtype, pageIds: aud.pageIds } };
  }
  const subtype = aud.kind === "followers_fb" ? "page_followers_fb" : "page_followers_ig";
  return { subtype, retentionDays: 0, sourceId: aud.pageIds.join(","), sourceMeta: { subtype, pageIds: aud.pageIds } };
}
