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
import { type FunnelSpec, type SpecOptions, audiencesToMake, funnelAdSetName, funnelSpecs, FUNNEL_TIERS, FUNNEL_TIER_LABEL, SPLIT_WITH_SIMILAR, splitTotal, type FunnelAudience, type PageGroup, type FunnelSources, type FunnelStretch, type FunnelTier, type TakeLine, type TierMinor } from "./funnel.ts";
import type { FunnelStepPlan } from "./funnel-plan.ts";
import { fill } from "./funnel-words.ts";
import { destinationKey, DESTINATION_WORDS, DestinationRefused, rebuildCreative, type Destination } from "./destination.ts";
import { driveAdForBuild, identityKey, SHOW_CREATIVE_WORDS, sourceIdentity, type ShowCreatives, type ShowIdentity } from "./show-creatives.ts";
import type { AdCreativeDraft } from "../types.ts";
import { genreLabelInSentence, type GenreFamilyKey } from "../learning/genre/families.ts";
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
  /** The tiers' options it was planned with (two campaigns: Similar and its group, Similar lists in Warm; presale). */
  spec?: SpecOptions;
  /** TC7: a presale show — both campaigns optimise on sign-ups (CompleteRegistration). */
  presale?: boolean;
  /** Matas, 27 Nov: every ad's website URL and URL parameters (destination.ts). Absent = the copied ads' own links. */
  destination?: Destination | null;
  /** Matas, 27 Nov: the ads made from Drive files instead of copying the show's live ads (show-creatives.ts). Absent = copied. */
  creatives?: ShowCreatives | null;
  /** Matas, 27 Nov: the Page (and Instagram account) every ad runs from. Absent = the copied ads' own. An ad on a lineup artist's Page keeps it. */
  identity?: ShowIdentity | null;
  /** Matas, 27 Nov: the show's live ads copied beside the Drive ads (one per creative). Absent = every live ad (build.ads) without creatives, none with them. */
  copyAds?: { adId: string; name: string }[] | null;
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
    /** The show day, or the on-sale date for a presale show (TC7). */
    endDay: string;
    adSets: { key: WiderAdSetKey; interests: Interest[]; suggestionKeys: string[]; lookalikes: LookalikeAudience[]; excludeKeys: string[] }[];
    steps: WiderStep[];
    /** Fix 3: the ceiling set its lifetime (`over`: Retargeting alone would pass it); the show has no ceiling. */
    capped?: { ceilingGbp: number; over?: boolean } | null;
    noCeiling?: boolean;
  } | null;
};

/** What the audience seam makes: a funnel audience, or (Wider) a 1 % lookalike of an audience already made. */
export type MakeAudience = Exclude<FunnelAudience, { kind: "list" }> | (LookalikeAudience & { originId: string });

export type FunnelMeta = Pick<RetargetingMeta, "readAd" | "createCreativeFromPost" | "createCampaign" | "createAdSet" | "createAd" | "updateCampaign" | "setAdSetActive" | "findCustomConversion" | "createCustomConversion" | "readAdSetTargeting" | "audienceState" | "listShowVideos"> & {
  /** GET /{id}?fields=daily_budget: an ad set's or a campaign's daily budget now, minor units; null when it has none. */
  readDailyBudget(kind: "adset" | "campaign", id: string): Promise<number | null>;
  /** POST /{id} { daily_budget }: the app's budget write for one ad set or campaign budget. */
  setDailyBudget(kind: "adset" | "campaign", id: string, minor: number): Promise<void>;
  /** A destination: GET /{creative}?fields=name,object_story_spec,asset_feed_spec,url_tags,object_story_id. */
  readCreative?(creativeId: string): Promise<Record<string, unknown> | null>;
  /** A destination: POST /act_{id}/adcreatives with the rebuilt creative. Returns its id. */
  createCreative?(adAccountId: string, payload: Record<string, unknown>): Promise<string>;
  /** Creatives from Drive: the app's creative build for an uploaded ad (buildCreativePayload, per-placement for a pair), then POST /act_{id}/adcreatives. url_tags, when given, replaces the app's own. */
  createDraftCreative?(adAccountId: string, creative: AdCreativeDraft, opts: { urlTags: string | null }): Promise<string>;
};

type PreparedCreative = { name: string; sourceCreativeId: string; objectStoryId: string | null; payload: Record<string, unknown> | null; drive?: { key: string; creative: AdCreativeDraft } };

type CreativeChoice = Pick<FunnelBuild, "ads" | "destination" | "creatives" | "identity" | "copyAds" | "sources">;

/** The copied ads a build makes: the ones it was given, else every live ad without Drive creatives, none with them. */
export function adsToCopy(build: Pick<FunnelBuild, "ads" | "creatives" | "copyAds">): { adId: string; name: string }[] {
  return build.copyAds ?? (build.creatives?.ads.length ? [] : build.ads);
}

/** The lineup artists' Facebook Pages (by id): a copied ad on one keeps it (Matas, 27 Nov: "include the existing artist ads"). */
export function lineupPageIds(sources: Pick<FunnelSources, "accounts"> | null | undefined): Set<string> {
  return new Set((sources?.accounts ?? []).filter((row) => row.kind === "lineup" && row.platform === "facebook").map((row) => row.pageId));
}

/**
 * The show's ads as the build makes them: from Drive (creatives given), or
 * each copied ad's own creative, or, with a destination or another identity,
 * a new creative from it with the link, URL parameters and Page changed
 * (destination.ts). Reads only; a creative that can't take the change refuses
 * the whole build before anything is made.
 */
export async function prepareCreatives(meta: FunnelMeta, build: CreativeChoice): Promise<{ ok: true; creatives: PreparedCreative[] } | { ok: false; reason: string }> {
  const out: PreparedCreative[] = [];
  if (build.creatives?.ads.length) {
    if (!meta.createDraftCreative) return { ok: false, reason: SHOW_CREATIVE_WORDS.uploadFailed(build.creatives.ads.length) };
    for (const ad of build.creatives.ads) out.push({ name: ad.name, sourceCreativeId: "", objectStoryId: null, payload: null, drive: { key: ad.key, creative: driveAdForBuild(ad, { identity: build.identity ?? null, link: build.destination?.link ?? null }) } });
  }
  const identity = build.identity ?? null;
  const artistPages = lineupPageIds(build.sources);
  const seen = new Set<string>();
  for (const ad of adsToCopy(build)) {
    const read = await meta.readAd(ad.adId);
    if (!read?.creativeId) return { ok: false, reason: RF_APPLY_WORDS.adUnread(ad.name) };
    // One ad per creative: the same creative in several ad sets is copied once.
    if (seen.has(read.creativeId)) continue;
    seen.add(read.creativeId);
    const name = read.name || ad.name;
    if (!build.destination && !identity) {
      out.push({ name, sourceCreativeId: read.creativeId, objectStoryId: read.objectStoryId ?? null, payload: null });
      continue;
    }
    const src = meta.readCreative && meta.createCreative ? await meta.readCreative(read.creativeId).catch(() => null) : null;
    if (!src) return { ok: false, reason: DESTINATION_WORDS.unread(name) };
    const own = sourceIdentity(src);
    // An artist ad keeps the lineup artist's Page; every other copied ad goes on identity's.
    const target = identity && !(own.pageId && artistPages.has(own.pageId)) ? identity : null;
    // Only the Page would change and the ad already runs from it (or keeps its own): its own creative, as before.
    if (!build.destination && (!target || (own.pageId === target.pageId && (own.igId ?? null) === (target.igId ?? null)))) {
      out.push({ name, sourceCreativeId: read.creativeId, objectStoryId: read.objectStoryId ?? null, payload: null });
      continue;
    }
    try {
      out.push({ name, sourceCreativeId: read.creativeId, objectStoryId: null, payload: rebuildCreative(src, { destination: build.destination ?? null, identity: target ? { pageId: target.pageId, igId: target.igId } : null }, name) });
    } catch (err) {
      if (err instanceof DestinationRefused) {
        const fromPost = build.destination ? DESTINATION_WORDS.fromPost(name) : SHOW_CREATIVE_WORDS.fromPost(name);
        return { ok: false, reason: err.kind === "from_post" ? fromPost : err.kind === "carousel" ? DESTINATION_WORDS.carousel(name) : DESTINATION_WORDS.unread(name) };
      }
      throw err;
    }
  }
  return { ok: true, creatives: out };
}

/**
 * The creatives the ads use: the source's own, or each new one made once on
 * the ledger (keyed on the show, the source creative or the Drive files, the
 * destination and the identity), so a build asked for again reuses it and its
 * ads, never a second copy.
 */
export async function makeCreatives(meta: FunnelMeta, ledger: MetaWriteContext, build: Pick<FunnelBuild, "eventId" | "destination" | "identity">, adAccountId: string, prepared: readonly PreparedCreative[]): Promise<ReusedCreative[]> {
  const out: ReusedCreative[] = [];
  const withIdentity = build.identity ? { identity: identityKey(build.identity) } : {};
  for (const one of prepared) {
    if (one.drive) {
      const drive = one.drive;
      const id = await withMetaWriteIdempotency(ledger, "refresh_creative_create", { rf: build.eventId, drive_ad: drive.key, destination: destinationKey(build.destination), ...withIdentity }, () => meta.createDraftCreative!(adAccountId, drive.creative, { urlTags: build.destination?.urlTags ?? null }), { required: true });
      out.push({ name: one.name, creativeId: id, objectStoryId: null });
      continue;
    }
    if (!one.payload) {
      out.push({ name: one.name, creativeId: one.sourceCreativeId, objectStoryId: one.objectStoryId });
      continue;
    }
    const payload = one.payload;
    const id = await withMetaWriteIdempotency(ledger, "refresh_creative_create", { rf: build.eventId, source_creative_id: one.sourceCreativeId, destination: destinationKey(build.destination), ...withIdentity }, () => meta.createCreative!(adAccountId, payload), { required: true });
    out.push({ name: one.name, creativeId: id, objectStoryId: null });
  }
  return out;
}

/** One budget change at a later time (M3b's scheduled changes, migration 271). */
export type ScheduledStep = { objectKind: "adset" | "campaign"; objectId: string; objectName: string; field: "daily_budget" | "lifetime_budget"; amountMinor: number; expectedMinor: number; runAt: string; raisesSpend: boolean; key: string };

/**
 * Why an audience source was left out (27 Nov, NX26-RUDIMENTAL): nothing to
 * build it from; Meta (or the app's store) refused it; the app couldn't check
 * Meta for an existing copy, so it wasn't made rather than risk a duplicate;
 * or the create threw. The tier builds without it either way.
 */
export type AudienceSkip = "nothing" | "refused" | "unsure" | "threw";

/** What the audience seam answers: made (or reused), left out with a reason, or null (the builder can't make it yet). */
export type AudienceMade = { metaAudienceId: string } | { skipped: AudienceSkip; error?: string | null } | null;

/** The audience id a seam answer carries, if any. */
export function audienceIdOf(made: AudienceMade): string | null {
  return made && "metaAudienceId" in made && made.metaAudienceId ? made.metaAudienceId : null;
}

/** Meta's error as the log needs it (code, subcode, message, fbtrace_id). Never a token. */
export type MetaErrorDetail = { message: string; code: number | null; subcode: number | null; type: string | null; fbtraceId: string | null };

const scrubToken = (text: string) => text.replace(/access_token=[^&\s"']+/gi, "access_token=REDACTED").replace(/\bEAA[A-Za-z0-9]{20,}/g, "REDACTED");

/** A thrown error's Meta fields: MetaApiError's own, else what a formatted message carries ("(code 100, subcode 33)"). */
export function metaErrorDetail(err: unknown): MetaErrorDetail {
  const e = (err ?? {}) as { message?: unknown; code?: unknown; subcode?: unknown; type?: unknown; fbtraceId?: unknown; fbtrace_id?: unknown };
  const message = scrubToken(String(e.message ?? err ?? "")).replace(/\s+/g, " ").trim().slice(0, 500);
  const num = (value: unknown, pattern: RegExp): number | null => {
    const n = Number(value);
    if (value != null && value !== "" && Number.isFinite(n)) return n;
    const hit = pattern.exec(message);
    return hit ? Number(hit[1]) : null;
  };
  const trace = typeof e.fbtraceId === "string" ? e.fbtraceId : typeof e.fbtrace_id === "string" ? e.fbtrace_id : (/fbtrace_id[ :=]+([A-Za-z0-9_-]+)/.exec(message)?.[1] ?? null);
  return { message, code: num(e.code, /\bcode (\d+)/), subcode: num(e.subcode, /\bsubcode (\d+)/), type: typeof e.type === "string" ? e.type : null, fbtraceId: trace };
}

/** One line per failed or skipped step in the function log: the show, the step, the spec key and Meta's error. No token. */
function logStep(level: "error" | "warn", what: string, build: Pick<FunnelBuild, "eventCode">, step: string, specKey: string | null, err: unknown): MetaErrorDetail | null {
  const detail = err == null ? null : metaErrorDetail(err);
  const line = { code: build.eventCode, step, specKey, ...(detail ? { metaCode: detail.code, metaSubcode: detail.subcode, metaMessage: detail.message, fbtraceId: detail.fbtraceId } : {}) };
  if (level === "error") console.error(`[retargeting] ${what}`, line);
  else console.warn(`[retargeting] ${what}`, line);
  return detail;
}

/** An audience with nothing in it to build from (no videos, no Pages, no pixel rule): skipped before any create. */
export function audienceHasNothing(aud: MakeAudience): boolean {
  if ("originId" in aud) return !aud.originId;
  if (aud.kind === "video") return !aud.videoIds.length || !aud.pageId;
  if (aud.kind === "page_fb" || aud.kind === "page_ig" || aud.kind === "followers_fb" || aud.kind === "followers_ig") return !aud.pageIds.length;
  if (aud.kind === "pixel_url" || aud.kind === "pixel_event") return !aud.pixelId || !aud.urlContains.length;
  return false;
}

/**
 * The app's own ready audience for this show with the same subtype, source
 * and window on this ad account (meta_custom_audiences, a read): the
 * fallback when the build's progress has no id for a source (a run whose
 * store step failed, or create_audiences made it), so it's reused, never
 * made twice. Lookalikes are left to the seam. Null on any read error.
 */
export async function readyAudienceFor(db: Db, eventId: string, adAccountId: string, aud: MakeAudience): Promise<string | null> {
  if ("originId" in aud) return null;
  try {
    const draft = funnelAudienceDraft(aud);
    const bare = adAccountId.replace(/^act_/, "");
    const res = await db.from("meta_custom_audiences").select("meta_audience_id, created_at").eq("event_id", eventId).in("meta_ad_account_id", [bare, `act_${bare}`]).eq("audience_subtype", draft.subtype).eq("source_id", draft.sourceId).eq("retention_days", draft.retentionDays).eq("status", "ready").not("meta_audience_id", "is", null).order("created_at", { ascending: false }).limit(1);
    if (res.error) return null;
    return ((res.data ?? []) as { meta_audience_id: string | null }[])[0]?.meta_audience_id ?? null;
  } catch {
    return null;
  }
}

/** The build's current place, for the log and the mcp_actions summary when a write throws. */
type At = { step: string; key: string | null };

/**
 * One audience through the seam: nothing to build from, a refusal or a throw
 * is a skip (logged with Meta's error), never a failed build.
 */
async function makeOneAudience(deps: Pick<FunnelDeps, "createAudience" | "db">, build: Pick<FunnelBuild, "eventCode" | "eventId">, aud: MakeAudience, name: string, adAccountId: string, at: At): Promise<{ id: string } | { skip: AudienceSkip }> {
  at.step = "audience";
  at.key = aud.key;
  if (audienceHasNothing(aud)) {
    logStep("warn", "audience skipped: nothing to build from", build, "audience", aud.key, null);
    return { skip: "nothing" };
  }
  const prior = await readyAudienceFor(deps.db, build.eventId, adAccountId, aud);
  if (prior) return { id: prior };
  let made: AudienceMade;
  try {
    made = await deps.createAudience(aud, name, adAccountId);
  } catch (err) {
    logStep("warn", "audience create threw; source skipped", build, "audience", aud.key, err);
    return { skip: "threw" };
  }
  const id = audienceIdOf(made);
  if (id) return { id };
  const skip: AudienceSkip = made && "skipped" in made ? made.skipped : "refused";
  logStep("warn", `audience skipped: ${skip}`, build, "audience", aud.key, made && "skipped" in made && made.error ? new Error(made.error) : null);
  return { skip };
}

export type FunnelSeams = {
  /** Job 2's audience create: make (or reuse) one audience. Null = the builder can't make this kind yet; `skipped` = left out, with why. */
  createAudience(aud: MakeAudience, name: string, adAccountId: string): Promise<AudienceMade>;
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
  /** This run's left-out sources (27 Nov): the key, the Ads Manager name it would have had, why. Their tiers built without them. */
  skipped?: { key: string; name: string; reason: AudienceSkip }[];
  adSets?: Partial<Record<FunnelTier, { id: string; dailyMinor: number }>>;
  ads?: string[];
  /** The prospecting budgets lowered (live only). */
  moved?: { id: string; kind: "adset" | "campaign"; name?: string; beforeMinor: number; afterMinor: number }[];
  active?: boolean;
  scheduled?: string[];
  /** Each tier ad set's settings as Meta holds them after create (Matas's 26 Nov item 2): location expansion off, Advantage+ off. */
  readBack?: { adsetId: string; name: string; geoOff: boolean; advantageOff: boolean; /** false when Meta couldn't be read. */ read?: boolean }[];
  /** Two campaigns: Similar skipped at build (its audience under Meta's minimum); its budget went to Cold. */
  similarSkipped?: "too_small";
  /** STAGED: the Wider campaign's ids. */
  wider?: { campaignId?: string; adSets?: Partial<Record<WiderAdSetKey, { id: string }>>; ads?: string[] };
  /** Matas, 27 Nov ("Yes, at the next step"): the stretch step at which the read added Similar after the build. */
  similarAdded?: string;
  /** The last time the read couldn't add Similar at a step: its day and the plain reason (the share stayed in Cold). */
  similarRefused?: { day: string; reason: string };
};

export type FunnelOutcome = {
  state: "applied" | "failed";
  /** A plain sentence (no raw Meta error); the caller adds its own ending. */
  reason: string | null;
  progress: FunnelProgress;
  /** The raw reason for the log, never for Claude. */
  error?: string;
  step?: string;
  /** The spec (audience key, tier, ad set or creative) the failing step was on; null when the step has none. */
  specKey?: string | null;
  /** Meta's error fields for the mcp_actions summary (no token). */
  metaError?: MetaErrorDetail | null;
};

/**
 * The create path's sentences: the 17 Nov record's where one fits (switched
 * off, audiences off, still building, too small); the rest are the 27 Nov
 * list's rt.create.* rows and rt.similar.wait.
 */
export const RF_APPLY_WORDS = {
  switchedOff: RT_CREATE_OFF,
  audiencesOff: RT_AUDIENCES_OFF,
  conversionOff: RT_CONVERSION_OFF,
  moneyOff: fill("rt.create.money_off"),
  nothingToBuild: fill("rt.create.nothing"),
  noAccount: fill("rt.create.no_account"),
  passed: fill("rt.create.passed"),
  building: RT_AUDIENCE_BUILDING,
  tooSmall: RT_AUDIENCE_SMALL,
  similarNotYet: fill("rt.similar.wait"),
  adUnread: (name: string) => fill("rt.create.ad_unread", { name }),
  budgetChanged: (name: string) => fill("rt.create.budget_changed", { name }),
  switchOn: fill("rt.create.switch_on"),
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

/**
 * An audience's name in Ads Manager, before any part number: meta.name.audience
 * ("{code} · {source} · {n} days", the source and window as the tier row says
 * them, engagers split by platform, meta.name.src.*), and the followers'
 * meta.name.followers_* (no window).
 */
export function funnelAudienceName(code: string, aud: Exclude<FunnelAudience, { kind: "list" }>, _pageName?: string | null, genreLabel?: string | null): string {
  const days = "retentionDays" in aud ? aud.retentionDays : 0;
  const named = (source: string) => fill("meta.name.audience", { code, source, n: days });
  if (aud.kind === "followers_fb") return fill("meta.name.followers_fb", { code });
  if (aud.kind === "followers_ig") return fill("meta.name.followers_ig", { code });
  if (aud.kind === "video") return named(`Video viewers ${aud.threshold} %`);
  if (aud.source === "similar_pages") return named(fill("rt.src.page_group", { genre: genreLabel ?? "", n: 0 }).split(" · ")[0]!);
  if (aud.kind === "page_fb") return named(fill("meta.name.src.page_fb"));
  if (aud.kind === "page_ig") return named(fill("meta.name.src.page_ig"));
  if (aud.key.startsWith("rf:signup_visitors")) return named(fill("rt.src.signup_visitors").split(" · ")[0]!);
  if (aud.key.startsWith("rf:show_visitors")) return named(fill("rt.src.show_visitors60").split(" · ")[0]!);
  if (aud.source === "visitors") return named(fill("rt.src.visitors60").split(" · ")[0]!);
  if (aud.source === "ticket") return named(fill("rt.src.ticket30").split(" · ")[0]!);
  if (aud.source === "checkout") return named(fill("rt.src.checkout"));
  return named(fill("rt.src.signups").split(" · ")[0]!);
}

/**
 * Every audience's name in a show, by key: funnelAudienceName, and when one
 * source makes more than one audience (a page group over 5 Pages, a video
 * source per Page, accounts over 5 Pages) meta.name.part, " · {i} of {n}" in
 * the order the plan lists them. Every name is unique within the show.
 * Names only label: an audience already made is found by its key (its rule),
 * never by its name, so a renamed one is reused, not made twice.
 */
export function audienceNames(code: string, specs: readonly FunnelSpec[], genreLabel?: string | null): Map<string, string> {
  const auds = audiencesToMake(specs);
  const base = new Map(auds.map((aud) => [aud.key, funnelAudienceName(code, aud, null, genreLabel)] as const));
  const groups = new Map<string, string[]>();
  for (const aud of auds) groups.set(base.get(aud.key)!, [...(groups.get(base.get(aud.key)!) ?? []), aud.key]);
  const out = new Map<string, string>();
  for (const [name, keys] of groups) keys.forEach((key, index) => out.set(key, keys.length > 1 ? fill("meta.name.part", { name, i: index + 1, n: keys.length }) : name));
  return out;
}

/** "drum & bass": the build's genre as the rows write it. */
function genreOf(from: FunnelBuild | string | null | undefined): string | null {
  const key = typeof from === "string" ? from : (from?.spec?.genreFamily ?? from?.spec?.pageGroup?.genreFamily ?? null);
  if (!key) return null;
  try {
    return genreLabelInSentence(key as GenreFamilyKey);
  } catch {
    return key;
  }
}

/** A lookalike's name in Ads Manager (meta.name.lookalike): its source audience's name without the code, never an internal key. */
export function lookalikeName(code: string, sourceName: string): string {
  const prefix = `${code} · `;
  return fill("meta.name.lookalike", { code, source: sourceName.startsWith(prefix) ? sourceName.slice(prefix.length) : sourceName });
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
  // A step that threw: its plain reason for Claude, and Meta's error with the step and spec key for the log and the summary.
  const failWith = (step: string, specKey: string | null, err: unknown, reason?: string): FunnelOutcome => {
    const metaError = logStep("error", "build step failed", build, step, specKey, err);
    return { state: "failed", reason: reason ?? ctx.plainMetaReason(err), progress, error: metaError?.message ?? String(err), step, specKey, metaError };
  };
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
  // A destination, another Page or Drive creatives: every ad must be buildable before anything is made.
  if (build.destination || build.identity || build.creatives) {
    const pre = await prepareCreatives(deps.meta, build).catch((err): { ok: false; reason: string } => (logStep("error", "build step failed", build, "destination", null, err), { ok: false, reason: ctx.plainMetaReason(err) }));
    if (!pre.ok) return fail(pre.reason, { step: "destination" });
  }
  const totalAfter = FUNNEL_TIERS.reduce((sum, tier) => sum + build.plan.tiers[tier], 0);

  // 6 first, before any write: a live build checks the ceiling on the change in the show's total.
  if (live && !progress.active) {
    const taken = build.plan.take.reduce((sum, line) => sum + (line.beforeMinor - line.afterMinor), 0);
    try {
      // With Wider, the show's spend is Retargeting's plus Wider's (the prospecting it folds is paused on Matas's yes first).
      const afterMinor = build.wider ? totalAfter + build.wider.dailyMinor : build.plan.showDailyMinor - taken + totalAfter;
      await deps.checkCeiling({ eventId: build.eventId, code: build.eventCode, beforeMinor: build.plan.showDailyMinor, afterMinor, retargetingDailyMinor: totalAfter, take: build.plan.take, wider: build.wider ? { name: build.wider.campaignName, lifetimeMinor: build.wider.lifetimeMinor } : null, endDay: build.endDay });
    } catch (err) {
      logStep("warn", "ceiling refused", build, "ceiling", null, null);
      return fail(err instanceof Error ? err.message : String(err), { step: "ceiling" });
    }
    // Each prospecting budget is lowered only from what the plan read.
    if (!progress.moved?.length) {
      for (const line of build.plan.take) {
        try {
          const now = await deps.meta.readDailyBudget(line.kind, line.id);
          if (now !== line.beforeMinor) return fail(RF_APPLY_WORDS.budgetChanged(line.name), { step: "read" });
        } catch (err) {
          return failWith("read", line.id, err);
        }
      }
    }
  }

  let sources = build.sources;
  const videosPlanned = build.sources.videos.length > 0;
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
    return failWith("videos", null, err);
  }
  const specs = funnelSpecs(sources, build.spec);
  if (!specs.length) return fail(RF_APPLY_WORDS.nothingToBuild);
  const skipped: NonNullable<FunnelProgress["skipped"]> = [];
  // The plan had video sources and the read found none with a Page to build from: video viewers are left out, with a line.
  if (videosPlanned && !sources.videos.some((group) => group.videoIds.length)) {
    logStep("warn", "video viewers skipped: no videos left to build from", build, "videos", "rf:video", null);
    skipped.push({ key: "rf:video", name: `${build.eventCode} · Video viewers`, reason: "nothing" });
  }
  const at: At = { step: "build", key: null };

  try {
    // 1. The custom conversion (own-domain path), reused by name.
    if (build.customConversion && !progress.customConversionId) {
      const spec = build.customConversion;
      Object.assign(at, { step: "custom_conversion", key: spec.name });
      progress.customConversionId = await withMetaWriteIdempotency(ctx.ledger, "refresh_custom_conversion_create", keyBase, async () => (await deps.meta.findCustomConversion(adAccountId, spec.name)) ?? deps.meta.createCustomConversion(adAccountId, { name: spec.name, pixelId: build.pixelId, domain: spec.domain }), { required: true });
    }
    // 2. The campaign, paused, no budget of its own. One per show, ever.
    if (!progress.campaignId) {
      Object.assign(at, { step: "campaign", key: build.campaignName });
      const payload = buildCampaignPayload({ name: build.campaignName, objective: "purchase", status: "PAUSED" }) as unknown as Record<string, unknown>;
      progress.campaignId = await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_create", keyBase, () => deps.meta.createCampaign(adAccountId, payload), { required: true });
      await saveProgress(deps, build, progress, { state: "building" });
    }
    // 3. The audiences: stored ids reused; lists as uploaded; one the builder can't make yet is left out.
    progress.audiences ??= {};
    const stored = await storedAudiences(deps.db, build.eventId);
    const names = audienceNames(build.eventCode, specs, genreOf(build));
    const notMade = new Set<string>();
    for (const aud of audiencesToMake(specs)) {
      const have = progress.audiences[aud.key] ?? stored.get(aud.key);
      if (have) {
        progress.audiences[aud.key] = have;
        continue;
      }
      const name = names.get(aud.key) ?? funnelAudienceName(build.eventCode, aud, null, genreOf(build));
      const made = await makeOneAudience(deps, build, aud, name, adAccountId, at);
      if ("skip" in made) {
        notMade.add(aud.key);
        skipped.push({ key: aud.key, name, reason: made.skip });
        continue;
      }
      Object.assign(at, { step: "audience_store", key: aud.key });
      await storeAudience(deps.db, { event_id: build.eventId, user_id: deps.owner.userId, part: aud.key, meta_audience_id: made.id, name });
      progress.audiences[aud.key] = made.id;
      await saveProgress(deps, build, progress, { state: "building" });
    }
    progress.notMade = [...notMade];
    progress.skipped = skipped;
    const idOf = (aud: FunnelAudience) => (aud.kind === "list" ? aud.metaAudienceId : (progress.audiences![aud.key] ?? null));
    // Similar's audiences under Meta's minimum: Similar is skipped and its budget goes to Cold (Matas, 26 Nov); any other audience stops the build as before.
    const similarIds = new Set((specs.find((spec) => spec.tier === "similar")?.includes ?? []).map((aud) => progress.audiences![aud.key]).filter(Boolean));
    let similarSmall = 0;
    for (const id of new Set(Object.values(progress.audiences))) {
      Object.assign(at, { step: "audience_state", key: Object.keys(progress.audiences).find((key) => progress.audiences![key] === id) ?? id });
      const state = await deps.meta.audienceState(id);
      if (state === "building") return fail(RF_APPLY_WORDS.building, { step: "audience" });
      if (state === "too_small" && similarIds.has(id)) similarSmall += 1;
      else if (state === "too_small") return fail(RF_APPLY_WORDS.tooSmall, { step: "audience" });
    }
    const tiersNow: TierMinor = { ...build.plan.tiers };
    if (similarIds.size && similarSmall === similarIds.size && !progress.adSets?.similar) {
      tiersNow.cold += tiersNow.similar;
      tiersNow.similar = 0;
      progress.similarSkipped = "too_small";
    }
    // 4. Cold, Warm and Hot, paused.
    Object.assign(at, { step: "location", key: build.geoFromAdsetId });
    const location = locationOf(build.geoFromAdsetId ? await deps.meta.readAdSetTargeting(build.geoFromAdsetId) : null);
    progress.adSets ??= {};
    for (const spec of specs) {
      if (progress.adSets[spec.tier]) continue;
      const dailyMinor = tiersNow[spec.tier];
      if (!(dailyMinor > 0)) continue;
      const includeIds = spec.includes.map(idOf).filter((id): id is string => Boolean(id));
      if (!includeIds.length) continue;
      const excludeIds = spec.excludes.map(idOf).filter((id): id is string => Boolean(id));
      Object.assign(at, { step: "adset", key: spec.tier });
      const payload = tierAdSetPayload({ presale: build.presale === true, code: build.eventCode, tier: spec.tier as never, campaignId: progress.campaignId!, dailyMinor, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.endDay, location, includeIds, excludeIds, name: funnelAdSetName(build.eventCode, spec.tier) });
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
    // 5. The ads: the show's live creatives (or the Drive ads), the same in every tier, as they run (their copy too).
    Object.assign(at, { step: "creative", key: null });
    const prepared = await prepareCreatives(deps.meta, build);
    if (!prepared.ok) return fail(prepared.reason, { step: "ad" });
    const creatives = await makeCreatives(deps.meta, ctx.ledger, build, adAccountId, prepared.creatives);
    const adIds = new Set(progress.ads ?? []);
    for (const set of Object.values(progress.adSets)) {
      for (const creative of creatives) {
        Object.assign(at, { step: "ad", key: `${set!.id}:${creative.name}` });
        adIds.add((await reuseAd(deps.meta, ctx.ledger, { lineId: `rf:${build.eventId}`, adAccountId, adsetId: set!.id, creative })).adId);
      }
    }
    progress.ads = [...adIds];
    if (build.wider) await buildWider(deps, build, progress, { ctx, adAccountId, location, creatives, keyBase, at, skipped });
    progress.skipped = skipped;
    await saveProgress(deps, build, progress, { state: live ? "building" : "paused", ...(live ? {} : { mode: "paused" as const }) });
  } catch (err) {
    progress.skipped = skipped;
    await saveProgress(deps, build, progress, { state: "failed" }).catch(() => undefined);
    return failWith(at.step, at.key, err);
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
    return failWith("move", null, err);
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
    return failWith("switch_on", null, err, RF_APPLY_WORDS.switchOn);
  }
  // 9. Each stretch step, a scheduled change (the same key is the same row on a re-run).
  const scheduled = new Set(progress.scheduled ?? []);
  try {
    for (const change of stepChanges(build, progress.adSets ?? {}, progress.wider?.campaignId ?? null)) scheduled.add((await deps.scheduleChange(change)).id);
  } catch (err) {
    progress.scheduled = [...scheduled];
    await saveProgress(deps, build, progress, { state: "live", mode: "live" }).catch(() => undefined);
    const metaError = logStep("error", "build step failed", build, "schedule", null, err);
    return { state: "applied", reason: null, progress, error: err instanceof Error ? err.message : String(err), step: "schedule", specKey: null, metaError };
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
async function buildWider(deps: FunnelDeps, build: FunnelBuild, progress: FunnelProgress, args: { ctx: { ledger: MetaWriteContext }; adAccountId: string; location: Record<string, unknown>; creatives: ReusedCreative[]; keyBase: Record<string, unknown>; at: At; skipped: NonNullable<FunnelProgress["skipped"]> }): Promise<void> {
  const wider = build.wider!;
  const { ctx, adAccountId, keyBase, at } = args;
  progress.wider ??= {};
  if (!progress.wider.campaignId) {
    Object.assign(at, { step: "wider_campaign", key: wider.campaignName });
    const payload = { ...(buildCampaignPayload({ name: wider.campaignName, objective: "purchase", status: "PAUSED" }) as unknown as Record<string, unknown>), ...widerCampaignFields({ lifetimeMinor: wider.lifetimeMinor }) };
    progress.wider.campaignId = await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_create", { ...keyBase, campaign: "wider" }, () => deps.meta.createCampaign(adAccountId, payload), { required: true });
    await saveProgress(deps, build, progress, { state: "building" });
  }
  const idOf = (key: string) => progress.audiences?.[key] ?? (key.startsWith("list:") ? key.slice(5) : null);
  // The source audience's name: a list as uploaded, else the funnel audience's own name.
  const originNames = audienceNames(build.eventCode, funnelSpecs(build.sources, build.spec), genreOf(build));
  const originNameOf = (key: string) => build.sources.lists.find((row) => `list:${row.metaAudienceId}` === key)?.name ?? originNames.get(key) ?? key;
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
      const name = lookalikeName(build.eventCode, originNameOf(lal.originKey));
      const made = await makeOneAudience(deps, build, { ...lal, originId }, name, adAccountId, at);
      if ("skip" in made) {
        args.skipped.push({ key: lal.key, name, reason: made.skip });
        continue;
      }
      Object.assign(at, { step: "audience_store", key: lal.key });
      await storeAudience(deps.db, { event_id: build.eventId, user_id: deps.owner.userId, part: lal.key, meta_audience_id: made.id, name });
      progress.audiences = { ...(progress.audiences ?? {}), [lal.key]: made.id };
      lookalikeIds.push(made.id);
    }
    const suggestionIds = [...set.suggestionKeys.map(idOf).filter((id): id is string => Boolean(id)), ...lookalikeIds];
    if (set.key !== "broad" && !suggestionIds.length && !set.interests.length) continue;
    const excludeIds = set.excludeKeys.map(idOf).filter((id): id is string => Boolean(id));
    Object.assign(at, { step: "wider_adset", key: set.key });
    const payload = widerAdSetPayload({ presale: build.presale === true, name: widerAdSetName(build.eventCode, set.key), campaignId: progress.wider.campaignId!, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.wider?.endDay ?? build.endDay, location: args.location, interests: set.interests, suggestionIds, excludeIds });
    const id = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { ...keyBase, wider: set.key }, () => deps.meta.createAdSet(adAccountId, payload), { required: true });
    progress.wider.adSets[set.key] = { id };
    await saveProgress(deps, build, progress, { state: "building" });
  }
  const adIds = new Set(progress.wider.ads ?? []);
  for (const set of Object.values(progress.wider.adSets)) {
    for (const creative of args.creatives) {
      Object.assign(at, { step: "wider_ad", key: `${set!.id}:${creative.name}` });
      adIds.add((await reuseAd(deps.meta, ctx.ledger, { lineId: `rf:${build.eventId}:wider`, adAccountId, adsetId: set!.id, creative })).adId);
    }
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

/** A followers audience's stored retention: the table's CHECK (1–365); the payload sends Meta 0. The same as lib/mcp/audiences/specs.ts's. */
export const FOLLOWER_STORED_RETENTION_DAYS = 365;

/**
 * The audience builder's draft fields for a funnel audience: the subtypes it
 * already makes (website_pixel, video_views at 75 % or 95 %,
 * page_engagement_fb / _ig, page_followers_fb / _ig). Followers carry no
 * window on Meta (retention 0, which the payload builder sends); the row
 * stores 365 for the table's CHECK.
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
  // The row stores 365 (meta_custom_audiences' CHECK is retention_days 1–365; a 0 made NX26-RUDIMENTAL's draft insert throw on 27 Nov, before any POST). Meta is still sent 0 (audience-payload.ts).
  return { subtype, retentionDays: FOLLOWER_STORED_RETENTION_DAYS, sourceId: aud.pageIds.join(","), sourceMeta: { subtype, pageIds: aud.pageIds } };
}


// ─── Similar at the next step (Matas, 27 Nov: "Yes, at the next step") ───────

/** What the read needs to add Similar to a running build: the create path's own calls, and a change to a scheduled step not yet run. */
export type SimilarStepDeps = Pick<FunnelDeps, "db" | "env" | "meta" | "createAudience" | "scheduleChange" | "owner" | "source"> & {
  /** A step not yet run gets new amounts (same row, same key); false when it's no longer waiting. */
  updateScheduled(key: string, change: { amountMinor: number; expectedMinor: number; raisesSpend: boolean }): Promise<boolean>;
};

export type SimilarStepOutcome = { state: "applied" | "failed" | "skipped"; reason: string | null; progress: FunnelProgress; similarMinor?: number; coldMinor?: number; error?: string };

/**
 * A page group confirmed (or grown past Meta's minimum) after the build:
 * at the next stretch step the read adds the Similar ad set and gives it
 * its share back (the step's split with Similar); Cold drops to its own.
 * The create path's gates and calls, every write on the ledger:
 *   1. Similar's engagement audiences (made or reused), ready and big enough;
 *   2. its ad set, paused, Advantage+ off, location expansion off (#1401's
 *      create), the show's ads, read back;
 *   3. Cold lowered to its own share, from the amount this step's scheduled
 *      change set (any other amount waits for the next read);
 *   4. Similar switched on, last. If that fails, Cold is put back and the
 *      paused ad set is left off;
 *   5. each later step's Cold row re-sized and a Similar row added.
 * Money moves between two tiers only, so the show's total is unchanged and
 * no ceiling is read. Any failure leaves the share in Cold and says why.
 */
export async function addSimilarAtStep(deps: SimilarStepDeps, args: { build: FunnelBuild; pageGroup: PageGroup; today: string; ledger: MetaWriteContext; plainMetaReason: (err: unknown) => string }): Promise<SimilarStepOutcome> {
  const { build, today, ledger } = args;
  const before = await loadFunnelProgress(deps.db, build.eventId);
  const progress: FunnelProgress = { ...(before?.progress ?? {}) };
  const skip = (reason: string | null): SimilarStepOutcome => ({ state: "skipped", reason, progress });
  const step = build.plan.steps.find((row) => row.day === today);
  if (!progress.active || progress.adSets?.similar || !build.wider || !build.spec?.twoCampaigns || !step || !args.pageGroup.confirmed) return skip(null);
  const fullDeps = deps as unknown as FunnelDeps;
  const fail = async (reason: string, error?: string): Promise<SimilarStepOutcome> => {
    progress.similarRefused = { day: today, reason };
    await saveProgress(fullDeps, build, progress, { state: "live" }).catch(() => undefined);
    return { state: "failed", reason, progress, ...(error ? { error } : {}) };
  };
  const gates = funnelGates(deps.env);
  if (!gates.create) return fail(RF_APPLY_WORDS.switchedOff);
  if (!gates.audiences) return fail(RF_APPLY_WORDS.audiencesOff);
  if (!gates.money) return fail(RF_APPLY_WORDS.moneyOff);
  const adAccountId = build.adAccountId;
  const cold = progress.adSets?.cold;
  if (!adAccountId || !progress.campaignId || !cold) return fail(RF_APPLY_WORDS.noAccount);
  const similar = funnelSpecs(build.sources, { ...build.spec, pageGroup: args.pageGroup, similarTooSmall: false }).find((spec) => spec.tier === "similar");
  if (!similar) return fail(RF_APPLY_WORDS.nothingToBuild);
  // The step's split with Similar; the other tiers' amounts are the stretch's as scheduled.
  const buildable = FUNNEL_TIERS.filter((tier) => tier === "similar" || (progress.adSets?.[tier]?.id ?? null));
  const split = splitTotal(step.totalMinor, SPLIT_WITH_SIMILAR[step.stretch], { buildable });
  if (!split || !(split.tiers.similar > 0)) return fail(RF_APPLY_WORDS.nothingToBuild);
  const keyBase = { rf: build.eventId, similar_at: today };
  try {
    // 1. Similar's audiences.
    const similarNames = audienceNames(build.eventCode, [similar], genreOf(args.pageGroup.genreFamily));
    progress.audiences ??= {};
    const stored = await storedAudiences(deps.db, build.eventId);
    const ids: string[] = [];
    for (const aud of similar.includes) {
      if (aud.kind === "list") continue;
      let id: string | undefined = progress.audiences[aud.key] ?? stored.get(aud.key);
      if (!id) {
        const name = similarNames.get(aud.key) ?? funnelAudienceName(build.eventCode, aud, null, genreOf(args.pageGroup.genreFamily));
        const made = await makeOneAudience(deps, build, aud, name, adAccountId, { step: "similar_audience", key: aud.key });
        if ("skip" in made) continue;
        id = made.id;
        await storeAudience(deps.db, { event_id: build.eventId, user_id: deps.owner.userId, part: aud.key, meta_audience_id: id, name });
      }
      progress.audiences[aud.key] = id;
      ids.push(id);
    }
    if (!ids.length) return fail(RF_APPLY_WORDS.nothingToBuild);
    let small = 0;
    for (const id of ids) {
      const state = await deps.meta.audienceState(id);
      if (state === "building") return fail(RF_APPLY_WORDS.building);
      if (state === "too_small") small += 1;
    }
    if (small === ids.length) return fail(RF_APPLY_WORDS.tooSmall);
    // Cold must be at the amount this step's scheduled change set (Similar folded in); anything else waits.
    const coldNow = await deps.meta.readDailyBudget("adset", cold.id);
    if (coldNow !== step.tiers.cold) return fail(RF_APPLY_WORDS.similarNotYet);
    // 2. The ad set, paused: it leaves out every other tier's audiences and buyers.
    const similarIds = new Set(ids);
    const excludeIds = [...new Set([...Object.values(progress.audiences).filter((id) => !similarIds.has(id)), ...similar.excludes.flatMap((aud) => (aud.kind === "list" ? [aud.metaAudienceId] : []))])];
    const location = locationOf(build.geoFromAdsetId ? await deps.meta.readAdSetTargeting(build.geoFromAdsetId) : null);
    const payload = tierAdSetPayload({ presale: build.presale === true, code: build.eventCode, tier: "similar" as never, campaignId: progress.campaignId, dailyMinor: split.tiers.similar, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.endDay, location, includeIds: ids, excludeIds, name: funnelAdSetName(build.eventCode, "similar") });
    const adsetId = await withMetaWriteIdempotency(ledger, "refresh_adset_create", { ...keyBase, tier: "similar" }, () => deps.meta.createAdSet(adAccountId, payload), { required: true });
    await recordTierAdSet(fullDeps, { metaAdsetId: adsetId, campaignId: progress.campaignId, adAccountId, draftId: ledger.draftId ?? null, name: String(payload.name), dailyMinor: split.tiers.similar, tier: "similar" });
    const adIds = new Set(progress.ads ?? []);
    // The same creatives as the build's other ad sets (a destination's are on the ledger already, so none is made twice).
    const prepared = await prepareCreatives(deps.meta, build);
    if (!prepared.ok) return fail(prepared.reason);
    for (const creative of await makeCreatives(deps.meta, ledger, build, adAccountId, prepared.creatives)) adIds.add((await reuseAd(deps.meta, ledger, { lineId: `rf:${build.eventId}`, adAccountId, adsetId, creative })).adId);
    progress.ads = [...adIds];
    const targeting = await deps.meta.readAdSetTargeting(adsetId).catch(() => null);
    progress.readBack = [...(progress.readBack ?? []).filter((row) => row.adsetId !== adsetId), { adsetId, name: funnelAdSetName(build.eventCode, "similar"), geoOff: geoExpansionOff(targeting), advantageOff: advantageOff(targeting), read: targeting != null }];
    // 3. Cold to its own share, the giving side first.
    await withMetaWriteIdempotency(ledger, "refresh_adset_budget_update", { ...keyBase, id: cold.id, daily_budget: split.tiers.cold }, async () => {
      await deps.meta.setDailyBudget("adset", cold.id, split.tiers.cold);
      return cold.id;
    }, { required: true });
    // 4. Similar on, last; if it won't go on, Cold gets its share back and Similar stays off.
    try {
      await withMetaWriteIdempotency(ledger, "adset_status_update", { ...keyBase, adset_id: adsetId, status: "ACTIVE" }, async () => {
        await deps.meta.setAdSetActive(adsetId);
        return adsetId;
      }, { required: true });
    } catch (err) {
      await withMetaWriteIdempotency(ledger, "refresh_adset_budget_update", { ...keyBase, id: cold.id, daily_budget: step.tiers.cold, put_back: true }, async () => {
        await deps.meta.setDailyBudget("adset", cold.id, step.tiers.cold);
        return cold.id;
      }, { required: true }).catch(() => undefined);
      return fail(RF_APPLY_WORDS.switchOn, err instanceof Error ? err.message : String(err));
    }
    progress.adSets = { ...progress.adSets, similar: { id: adsetId, dailyMinor: split.tiers.similar }, cold: { id: cold.id, dailyMinor: split.tiers.cold } };
    progress.similarAdded = today;
    delete progress.similarRefused;
    delete progress.similarSkipped;
    await saveProgress(fullDeps, build, progress, { state: "live", mode: "live" });
  } catch (err) {
    return fail(args.plainMetaReason(err), err instanceof Error ? err.message : String(err));
  }
  // 5. The later steps: Cold's row re-sized, Similar's added (both from today's amounts on).
  let coldWas = split.tiers.cold;
  let similarWas = split.tiers.similar;
  for (const later of build.plan.steps.filter((row) => row.day > today)) {
    const next = splitTotal(later.totalMinor, SPLIT_WITH_SIMILAR[later.stretch], { buildable });
    if (!next) continue;
    await deps.updateScheduled(`rf:${build.eventId}:${later.day}:cold`, { amountMinor: next.tiers.cold, expectedMinor: coldWas, raisesSpend: next.tiers.cold > coldWas }).catch(() => false);
    if (next.tiers.similar !== similarWas) {
      const row = await deps.scheduleChange({ objectKind: "adset", objectId: progress.adSets!.similar!.id, objectName: funnelAdSetName(build.eventCode, "similar"), field: "daily_budget", amountMinor: next.tiers.similar, expectedMinor: similarWas, runAt: londonAt(later.day, 5), raisesSpend: next.tiers.similar > similarWas, key: `rf:${build.eventId}:${later.day}:similar` }).catch(() => null);
      if (row) progress.scheduled = [...new Set([...(progress.scheduled ?? []), row.id])];
    }
    coldWas = next.tiers.cold;
    similarWas = next.tiers.similar;
  }
  await saveProgress(fullDeps, build, progress, { state: "live", mode: "live" }).catch(() => undefined);
  return { state: "applied", reason: null, progress, similarMinor: split.tiers.similar, coldMinor: split.tiers.cold };
}
