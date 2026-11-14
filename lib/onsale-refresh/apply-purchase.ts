/**
 * P4 PR B — the Purchase campaign's create path (docs/design-record/2026-11-14-purchase-campaigns.html,
 * PC3, PC5's Purchase campaign words, HP3). Behind its own gate, default off:
 * ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED must be exactly "1". Step 5 (a move
 * out of the main campaign) also needs ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED,
 * and step 1 (own-domain path) ONSALE_REFRESH_CUSTOM_CONVERSION_CREATE_ENABLED.
 * A gate that is off fails the line before any write.
 *
 * The six steps, all or nothing for spend:
 *   1. the custom conversion (own-domain path only), reused if one with its name exists;
 *   2. the campaign, paused: OUTCOME_SALES, CBO lifetime (the launch path's buildCampaignPayload);
 *   3. the ad sets, paused: each pick's source copied exactly (targeting, attribution, schedule),
 *      with the Purchase promoted object, no budget of its own, ending 23:59 London on the show's date;
 *   4. the ads: the reused ads' creatives, in each copy;
 *   5. the main campaign's lifetime budget, lowered (only when money moves);
 *   6. the ad sets, then the campaign, set active.
 * A failed step leaves everything made so far paused; the main campaign's
 * budget changes only at step 5, and nothing is active before step 6.
 * Retry picks up from the failed step: every write goes through
 * meta_write_idempotency keyed on the line, and the campaign's id is stored
 * on the line from step 2, so a second campaign is never made.
 *
 * Draft ownership: the Purchase campaign belongs to the line, and the line to
 * the main campaign's draft. The ledger is keyed on that draft and every step
 * checks it (campaignGuard, in apply.ts); no draft row is made for the new
 * campaign. The plan (the 20 % cap) and the main campaign's floor are checked
 * again here, against live figures.
 *
 * Meta is passed in (the apply route wires the real calls), so this file
 * never imports lib/meta/client.ts and tests run on fakes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCampaignPayload } from "../meta/campaign.ts";
import { MetaWriteLedgerRequiredError, withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { campaignFloor, daysInclusive, floorBracket, money, PC, type PurchaseBuild } from "./purchase-campaign.ts";
import { dayMonth } from "./schedule.ts";

type Db = Pick<SupabaseClient, "from">;

export const CAMPAIGN_CREATE_ENV = "ONSALE_REFRESH_CAMPAIGN_CREATE_ENABLED";
export const LIFETIME_BUDGET_ENV = "ONSALE_REFRESH_LIFETIME_BUDGET_WRITES_ENABLED";
export const CUSTOM_CONVERSION_ENV = "ONSALE_REFRESH_CUSTOM_CONVERSION_CREATE_ENABLED";

export const campaignCreateEnabled = (env: Record<string, string | undefined>) => env[CAMPAIGN_CREATE_ENV] === "1";
export const lifetimeBudgetWritesEnabled = (env: Record<string, string | undefined>) => env[LIFETIME_BUDGET_ENV] === "1";
export const customConversionCreateEnabled = (env: Record<string, string | undefined>) => env[CUSTOM_CONVERSION_ENV] === "1";

export type PurchaseMeta = {
  /** GET /{adset}: targeting and the fields a copy keeps. */
  readAdSetForCopy(adsetId: string): Promise<Record<string, unknown> | null>;
  /** GET /{campaign}: daily_budget, lifetime_budget, in minor units. */
  readCampaignBudget(campaignId: string): Promise<{ daily: number | null; lifetime: number | null }>;
  /** GET /{ad}: its name, creative id and effective status. */
  readAd(adId: string): Promise<{ id: string; name: string; creativeId: string | null; effectiveStatus: string | null; /** PC9's fallback: the creative's post. */ objectStoryId?: string | null } | null>;
  /** PC9's one fallback: a new creative from the source creative's post (POST /act_{id}/adcreatives { object_story_id }). Returns the id. */
  createCreativeFromPost(adAccountId: string, spec: { name: string; objectStoryId: string }): Promise<string>;
  /** POST /act_{id}/campaigns. Returns the id. */
  createCampaign(adAccountId: string, payload: Record<string, unknown>): Promise<string>;
  /** POST /act_{id}/adsets. Returns the id. */
  createAdSet(adAccountId: string, payload: Record<string, unknown>): Promise<string>;
  createAd(adAccountId: string, ad: { name: string; adset_id: string; creative: { creative_id: string }; status: "ACTIVE" }): Promise<string>;
  /** POST /{campaign} with a lifetime_budget (minor units) or a status. */
  updateCampaign(campaignId: string, fields: { lifetime_budget?: number; status?: "ACTIVE" }): Promise<void>;
  /** POST /{adset} { status: ACTIVE }. */
  setAdSetActive(adsetId: string): Promise<void>;
  /** The account's custom conversions edge (read): the id of one with this name, or null. */
  findCustomConversion(adAccountId: string, name: string): Promise<string | null>;
  /** The account's custom conversions edge (create, wired by the apply route): Purchase on the pixel, on the domain. Returns the id. */
  createCustomConversion(adAccountId: string, spec: { name: string; pixelId: string; domain: string }): Promise<string>;
};

export type PurchaseDeps = {
  db: Db;
  env: Record<string, string | undefined>;
  meta: PurchaseMeta;
  /** R5 at apply time: the event's budget, its spend to date, and the moves already applied in this refresh. */
  plan: { budget: number | null; spend: number; today: string; appliedMovesGbp: number };
  /** The main campaign's spend to date now (ad_daily_insights), £. */
  mainSpentNow: number;
};

export type PurchaseLine = { id: string; write: Record<string, unknown> | null; applied_result: Record<string, unknown> | null };

/** What the line has done so far, kept on applied_result.purchase for Retry and PC6. */
export type PurchaseProgress = {
  customConversionId?: string;
  campaignId?: string;
  /** Source ad set id → the copy's id, its pick and its name (PC6 reads the pick). */
  adSets?: Record<string, { id: string; role: string; name: string }>;
  ads?: string[];
  /** PC9: each ad's path — the source creative ("creative_id") or a new creative from its post ("post"). The ledger keeps it too. */
  adPaths?: Record<string, "creative_id" | "post">;
  main?: { before: number; after: number; moved: number };
  active?: boolean;
  rate?: number;
  lifetime?: number;
  headroom?: number;
};

type Outcome = { state: "applied" | "failed"; reason: string | null; result: Record<string, unknown> };

export const CREATE_SWITCHED_OFF = "Making a Purchase campaign is switched off on this deployment, so nothing was built.";
export const MOVE_SWITCHED_OFF = "Moving budget out of the main campaign is switched off on this deployment, so nothing was built.";
export const CONVERSION_SWITCHED_OFF = "Making the show's custom conversion is switched off on this deployment, so nothing was built.";

/** 23:59 London on the show's date, as Meta takes it (ISO with the offset). */
export function showEndTime(day: string): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(noon).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offset.match(/GMT([+-]\d+)?/);
  const hours = match?.[1] ? Number(match[1]) : 0;
  const sign = hours < 0 ? "-" : "+";
  return `${day}T23:59:00${sign}${String(Math.abs(hours)).padStart(2, "0")}00`;
}

/** The fields a Purchase copy keeps from its source: audiences, exclusions, placements, age, location (targeting) and schedule. */
export const PURCHASE_COPIED_FIELDS = ["billing_event", "attribution_spec", "destination_type", "pacing_type", "adset_schedule"] as const;

/** PC3: the copy's payload — its source exactly, with the Purchase promoted object, no budget (CBO), paused, ending on the show. */
export function purchaseAdSetPayload(src: Record<string, unknown>, args: { campaignId: string; pixelId: string; customConversionId: string | null; endDay: string; name: string }): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: `${args.name} · Purchase`,
    campaign_id: args.campaignId,
    targeting: src.targeting ?? {},
    status: "PAUSED",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    promoted_object: args.customConversionId ? { pixel_id: args.pixelId, custom_conversion_id: args.customConversionId } : { pixel_id: args.pixelId, custom_event_type: "PURCHASE" },
    end_time: showEndTime(args.endDay),
  };
  for (const field of PURCHASE_COPIED_FIELDS) if (src[field] != null) payload[field] = src[field];
  return payload;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

function made(progress: PurchaseProgress): string {
  const parts: string[] = [];
  if (progress.campaignId) parts.push("the campaign");
  const sets = Object.keys(progress.adSets ?? {}).length;
  if (sets) parts.push(`${sets} ad set${sets === 1 ? "" : "s"}`);
  const ads = progress.ads?.length ?? 0;
  if (ads) parts.push(`${ads} ad${ads === 1 ? "" : "s"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

/** PC5: failed before anything went live. */
export function failedBeforeLive(reason: string, progress: PurchaseProgress, mainShort: string): string {
  const what = made(progress);
  return what ? `${reason}. Created paused: ${what}. ${mainShort}'s budget is unchanged.` : `${reason}. ${mainShort}'s budget is unchanged.`;
}

/** PC5: failed at step 6 — made, not switched on. */
export function failedAtSwitchOn(reason: string, moved: number, mainShort: string): string {
  return moved > 0 ? `built and paused, not switched on: ${reason}. ${mainShort} already gave ${money(moved)}. Retry switches it on.` : `built and paused, not switched on: ${reason}. Retry switches it on.`;
}

/** PC5: applied ("Applied · " is the panel's). */
export function appliedText(args: { adSets: number; ads: number; rate: number; lifetime: number; endDay: string; headroom: number; moved: number; mainShort: string }): string {
  return `live · ${args.adSets} ad set${args.adSets === 1 ? "" : "s"} · ${args.ads} ad${args.ads === 1 ? "" : "s"} · £${args.rate} a day, ${money(args.lifetime)} lifetime to ${dayMonth(args.endDay)} (${money(args.headroom)} from plan headroom + ${money(args.moved)} from ${args.mainShort})`;
}

/** Retry carries the earlier attempt on applied_result.previous; the progress may sit on either. */
function priorProgress(line: PurchaseLine): PurchaseProgress {
  const result = line.applied_result ?? {};
  const own = result.purchase as PurchaseProgress | undefined;
  const previous = (result.previous as Record<string, unknown> | undefined)?.purchase as PurchaseProgress | undefined;
  return { ...(previous ?? {}), ...(own ?? {}) };
}

async function storeProgress(db: Db, lineId: string, progress: PurchaseProgress): Promise<void> {
  // HP3: the campaign's id is on the line from step 2 (and each copy's pick from step 3), whatever happens next.
  await db.from("onsale_refresh_lines").update({ applied_result: { purchase: progress } }).eq("id", lineId);
}

export async function applyPurchaseCampaign(deps: PurchaseDeps, line: PurchaseLine, ctx: { ledger: MetaWriteContext; adAccountId: string; plainMetaReason: (err: unknown) => string }): Promise<Outcome> {
  const write = line.write ?? {};
  const build = write as unknown as PurchaseBuild & { kind?: string; dailyGbp?: number };
  const progress: PurchaseProgress = priorProgress(line);
  const short = build.mainShort ?? "the main campaign";
  const fail = (reason: string, extra: Record<string, unknown> = {}): Outcome => ({ state: "failed", reason: failedBeforeLive(reason, progress, short), result: { purchase: progress, ...extra } });
  if (write.kind !== "purchase_campaign_create" || !build.endDay || !build.pixelId || !Array.isArray(build.picks) || !build.picks.length) {
    return { state: "failed", reason: "The line has nothing to build.", result: {} };
  }

  // The gates, all before any write.
  if (!campaignCreateEnabled(deps.env)) return fail(CREATE_SWITCHED_OFF);
  if (build.customConversion && !progress.customConversionId && !customConversionCreateEnabled(deps.env)) return fail(CONVERSION_SWITCHED_OFF);

  // The rate Matas picked (or the card's default), and the lifetime from today (Apply) to the show, both included.
  const rate = progress.rate ?? (build.dailyGbp === 10 || build.dailyGbp === 5 ? build.dailyGbp : build.defaultRate);
  const days = Math.max(0, daysInclusive(deps.plan.today, build.endDay));
  const lifetime = progress.lifetime ?? rate * days;
  const proposed = build.funding?.find((row) => row.rate === rate);
  const headroom = progress.headroom ?? round2(Math.min(lifetime, proposed?.headroom ?? 0));
  const move = round2(lifetime - headroom);
  if (move > 0 && !progress.main && !lifetimeBudgetWritesEnabled(deps.env)) return fail(MOVE_SWITCHED_OFF);
  if (days < 1) return fail("The show has passed, so nothing was built");

  // The plan and the floor, again, on live figures (before anything is made; a Retry past step 5 doesn't recheck money already moved).
  if (!progress.main) {
    let mainLifetime: number | null = null;
    if (build.mainCampaignId) {
      try {
        const live = await deps.meta.readCampaignBudget(build.mainCampaignId);
        mainLifetime = live.lifetime == null ? null : live.lifetime / 100;
      } catch (err) {
        return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err), step: "read" });
      }
    }
    const capBase = deps.plan.budget != null ? Math.max(0, deps.plan.budget - deps.plan.spend) : mainLifetime == null ? null : Math.max(0, mainLifetime - deps.mainSpentNow);
    if (capBase == null) return fail(`${short} has no lifetime budget to move from`);
    const cap = round2(capBase * PC.capShare - deps.plan.appliedMovesGbp);
    if (lifetime > cap + 1e-9) return fail(`${money(lifetime)} is over this refresh's 20 % cap (${money(Math.max(0, cap))} free)`);
    if (move > 0) {
      if (mainLifetime == null) return fail(`${short} has no lifetime budget to move from`);
      if (build.mainLifetimeGbp != null && Math.abs(mainLifetime - build.mainLifetimeGbp) > 0.005) return fail(`${short}'s budget changed in Ads Manager since the proposal`);
      // PC7: the larger of spend + 3 days and Meta's 1.1 × spend, on live spend.
      const floor = campaignFloor(deps.mainSpentNow, build.mainLast7Daily ?? 0);
      if (mainLifetime - move < floor.floor - 1e-9) return fail(`${short} would go under ${money(floor.floor)} ${floorBracket(floor)}`);
    }
  }
  progress.rate = rate;
  progress.lifetime = lifetime;
  progress.headroom = headroom;

  const keyBase = { line_id: line.id };
  try {
    // 1. The custom conversion (own-domain path), reused by name.
    if (build.customConversion && !progress.customConversionId) {
      const spec = build.customConversion;
      progress.customConversionId = await withMetaWriteIdempotency(ctx.ledger, "refresh_custom_conversion_create", keyBase, async () => (await deps.meta.findCustomConversion(ctx.adAccountId, spec.name)) ?? deps.meta.createCustomConversion(ctx.adAccountId, { name: spec.name, pixelId: build.pixelId, domain: spec.domain }), { required: true });
    }
    // 2. The campaign, paused. One per line, ever.
    if (!progress.campaignId) {
      const payload = buildCampaignPayload({ name: build.campaignName, objective: "purchase", status: "PAUSED", budget: { level: "campaign", type: "lifetime", amountMajor: lifetime } }) as unknown as Record<string, unknown>;
      progress.campaignId = await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_create", keyBase, () => deps.meta.createCampaign(ctx.adAccountId, payload), { required: true });
      await storeProgress(deps.db, line.id, progress);
    }
    // 3. The ad sets, paused: each pick's source, exactly.
    progress.adSets ??= {};
    for (const pick of build.picks) {
      if (progress.adSets[pick.adsetId]) continue;
      const src = await deps.meta.readAdSetForCopy(pick.adsetId);
      if (!src) return fail(`The ad set it copies (${pick.name}) can't be read`, { step: "adset" });
      const payload = purchaseAdSetPayload(src, { campaignId: progress.campaignId, pixelId: build.pixelId, customConversionId: progress.customConversionId ?? null, endDay: build.endDay, name: pick.name });
      const id = await withMetaWriteIdempotency(ctx.ledger, "refresh_adset_create", { ...keyBase, source: pick.adsetId }, () => deps.meta.createAdSet(ctx.adAccountId, payload), { required: true });
      progress.adSets[pick.adsetId] = { id, role: pick.role, name: String(payload.name) };
      await storeProgress(deps.db, line.id, progress);
    }
    // 4. The ads: each reused ad's creative, in each copy (PC9: the creative id, else one new creative from the same post).
    const creatives: ReusedCreative[] = [];
    for (const ad of build.ads ?? []) {
      const live = await deps.meta.readAd(ad.adId);
      if (!live?.creativeId) return fail(`The ad it reuses (${ad.name}) can't be read`, { step: "ad" });
      creatives.push({ name: live.name || ad.name, creativeId: live.creativeId, objectStoryId: live.objectStoryId ?? null });
    }
    const adIds = new Set(progress.ads ?? []);
    progress.adPaths ??= {};
    for (const copy of Object.values(progress.adSets)) {
      for (const creative of creatives) {
        const made = await reuseAd(deps.meta, ctx.ledger, { lineId: line.id, adAccountId: ctx.adAccountId, adsetId: copy.id, creative });
        adIds.add(made.adId);
        progress.adPaths[made.adId] = made.path;
      }
    }
    progress.ads = [...adIds];
    // 5. The main campaign's lifetime budget, lowered — only when money moves.
    if (move > 0 && !progress.main) {
      const live = await deps.meta.readCampaignBudget(build.mainCampaignId!);
      const before = (live.lifetime ?? 0) / 100;
      const after = round2(before - move);
      await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_lifetime_budget_update", { ...keyBase, campaign_id: build.mainCampaignId, lifetime_budget: Math.round(after * 100) }, async () => {
        await deps.meta.updateCampaign(build.mainCampaignId!, { lifetime_budget: Math.round(after * 100) });
        return build.mainCampaignId!;
      }, { required: true });
      progress.main = { before, after, moved: move };
      await storeProgress(deps.db, line.id, progress);
    }
  } catch (err) {
    return fail(ctx.plainMetaReason(err), { error: err instanceof Error ? err.message : String(err) });
  }
  // 6. Switched on: the ad sets, then the campaign.
  try {
    for (const copy of Object.values(progress.adSets ?? {})) {
      await withMetaWriteIdempotency(ctx.ledger, "adset_status_update", { ...keyBase, adset_id: copy.id, status: "ACTIVE" }, async () => {
        await deps.meta.setAdSetActive(copy.id);
        return copy.id;
      }, { required: true });
    }
    await withMetaWriteIdempotency(ctx.ledger, "refresh_campaign_status_update", { ...keyBase, campaign_id: progress.campaignId, status: "ACTIVE" }, async () => {
      await deps.meta.updateCampaign(progress.campaignId!, { status: "ACTIVE" });
      return progress.campaignId!;
    }, { required: true });
  } catch (err) {
    return { state: "failed", reason: failedAtSwitchOn(ctx.plainMetaReason(err), progress.main?.moved ?? 0, short), result: { purchase: progress, error: err instanceof Error ? err.message : String(err), step: "switch_on" } };
  }
  progress.active = true;
  return {
    state: "applied",
    reason: appliedText({ adSets: Object.keys(progress.adSets ?? {}).length, ads: build.ads?.length ?? 0, rate, lifetime, endDay: build.endDay, headroom, moved: progress.main?.moved ?? 0, mainShort: short }),
    result: { purchase: progress },
  };
}

export type ReusedCreative = { name: string; creativeId: string; objectStoryId: string | null };

/**
 * PC9 (docs/design-record/2026-11-14-purchase-campaigns-2.html): reuse a
 * source ad in an ad set. First by its creative_id (the creative belongs to
 * the account and carries the same post); if Meta refuses, one fallback: a
 * new creative from the source creative's effective_object_story_id (the
 * same post, so likes and comments carry over), then the ad. If both fail,
 * the fallback's error is thrown and step 4 fails. Nothing is rebuilt from
 * the creative's parts. The path is in each ledger payload, per ad.
 */
export async function reuseAd(meta: Pick<PurchaseMeta, "createAd" | "createCreativeFromPost">, ledger: MetaWriteContext, args: { lineId: string; adAccountId: string; adsetId: string; creative: ReusedCreative }): Promise<{ adId: string; path: "creative_id" | "post"; creativeId: string }> {
  const { creative } = args;
  try {
    const adId = await withMetaWriteIdempotency(ledger, "refresh_ad_create", { line_id: args.lineId, adset_id: args.adsetId, creative_id: creative.creativeId, path: "creative_id" }, () => meta.createAd(args.adAccountId, { name: creative.name, adset_id: args.adsetId, creative: { creative_id: creative.creativeId }, status: "ACTIVE" }), { required: true });
    return { adId, path: "creative_id", creativeId: creative.creativeId };
  } catch (refused) {
    if (refused instanceof MetaWriteLedgerRequiredError || !creative.objectStoryId) throw refused;
  }
  const fromPost = await withMetaWriteIdempotency(ledger, "refresh_creative_create", { line_id: args.lineId, source_creative_id: creative.creativeId, object_story_id: creative.objectStoryId }, () => meta.createCreativeFromPost(args.adAccountId, { name: creative.name, objectStoryId: creative.objectStoryId! }), { required: true });
  const adId = await withMetaWriteIdempotency(ledger, "refresh_ad_create", { line_id: args.lineId, adset_id: args.adsetId, creative_id: fromPost, path: "post" }, () => meta.createAd(args.adAccountId, { name: creative.name, adset_id: args.adsetId, creative: { creative_id: fromPost }, status: "ACTIVE" }), { required: true });
  return { adId, path: "post", creativeId: fromPost };
}

/** The main campaign's spend to date (ad_daily_insights), paged by a unique key. */
export async function campaignSpendGbp(db: Db, campaignId: string): Promise<number> {
  let total = 0;
  const seen = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const page = await db.from("ad_daily_insights").select("meta_ad_id, date, spend").eq("meta_campaign_id", campaignId).order("date", { ascending: true }).order("meta_ad_id", { ascending: true }).range(from, from + 999);
    if (page.error) throw new Error(page.error.message);
    const rows = (page.data ?? []) as { meta_ad_id: string; date: string; spend: number | string }[];
    for (const row of rows) {
      const key = `${row.meta_ad_id}|${row.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += num(row.spend);
    }
    if (rows.length < 1000) break;
  }
  return round2(total);
}
