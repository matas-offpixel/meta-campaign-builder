/**
 * The Retargeting campaign's ad-set helpers, kept from the 17 Nov create path
 * (docs/design-record/2026-11-17-retargeting-campaign.html, RT1, HR1): the
 * Meta calls it needs, the settings every tier shares, and one tier's ad set.
 *
 * The create itself is the funnel's (lib/retargeting/funnel-apply.ts,
 * docs/design-record/2026-11-26-retargeting-funnel.html), which re-rules
 * RT2's tiers, RT4's money and RT17's two arms: one campaign, Cold / Warm /
 * Hot, the money from prospecting. No show was ever built on the 17 Nov
 * path (prod read, 26 Nov: no retargeting proposal, audience or ad set), so
 * its create and the arms' create are removed rather than kept beside it.
 */

import { ADVANTAGE_AUDIENCE_AGE_MAX, advantageAudienceAgeTargeting } from "../meta/adset.ts";
import { showEndTime, type PurchaseMeta } from "../onsale-refresh/apply-purchase.ts";
import { tierAdSetName, type Tier } from "./words.ts";
import { META_INITIATE_CHECKOUT_EVENT } from "../meta/campaign.ts";
import type { OptimisationEvent } from "./optimise-on.ts";

export type RetargetingMeta = Pick<PurchaseMeta, "readCampaignBudget" | "readAd" | "createCreativeFromPost" | "createCampaign" | "createAdSet" | "createAd" | "updateCampaign" | "setAdSetActive" | "findCustomConversion" | "createCustomConversion"> & {
  /** GET /{adset}: its targeting (the tiers copy the location only). */
  readAdSetTargeting(adsetId: string): Promise<Record<string, unknown> | null>;
  /** An audience's state on Meta (operation_status). */
  audienceState(audienceId: string): Promise<"ready" | "building" | "too_small">;
  /** Every video of the show's ads, grouped by the page each one ran from; a video with no page is left out (RT2). */
  listShowVideos(adAccountId: string, campaignIds: string[]): Promise<{ contextId: string; videoIds: string[] }[]>;
};

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
/**
 * What the ad set optimises on: the show's purchase (its custom conversion
 * on an own domain), or for a presale show (TC7: "signing up is the goal")
 * the pixel's CompleteRegistration. `event` is the build's (optimise-on.ts):
 * INITIATED_CHECKOUT is the pixel's own event, never a custom conversion
 * (the Electric group's on-sale default, Matas 27 Nov).
 */
export function promotedObject(args: { pixelId: string; customConversionId: string | null; presale?: boolean; event?: OptimisationEvent }): Record<string, string> {
  if (args.presale || args.event === "COMPLETE_REGISTRATION") return { pixel_id: args.pixelId, custom_event_type: "COMPLETE_REGISTRATION" };
  if (args.event === "INITIATED_CHECKOUT") return { pixel_id: args.pixelId, custom_event_type: META_INITIATE_CHECKOUT_EVENT };
  return args.customConversionId ? { pixel_id: args.pixelId, custom_conversion_id: args.customConversionId } : { pixel_id: args.pixelId, custom_event_type: "PURCHASE" };
}

export function tierAdSetPayload(args: { presale?: boolean; event?: OptimisationEvent; code: string; tier: Tier | string; campaignId: string; dailyMinor: number; pixelId: string; customConversionId: string | null; endDay: string; location: Record<string, unknown>; includeIds: string[]; excludeIds: string[]; name?: string; startTime?: string }): Record<string, unknown> {
  return {
    name: args.name ?? tierAdSetName(args.code, args.tier as Tier),
    // RT17 (ops' option (c)): an arm's ad sets start with the Meta A/B test, so nothing delivers before the split.
    ...(args.startTime ? { start_time: args.startTime } : {}),
    campaign_id: args.campaignId,
    status: "PAUSED",
    daily_budget: args.dailyMinor,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    promoted_object: promotedObject(args),
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









/**
 * STAGED (two-campaign record, pending design): one "{code} · Wider" ad set.
 * Advantage+ audience on, with #1387's age (lib/meta/adset.ts
 * advantageAudienceAgeTargeting: 18–65, no age suggestion), interests and
 * custom audiences as suggestions, buyers / Hot / Warm left out, the
 * location of the show's on-sale ad sets. Its money is the campaign's
 * lifetime budget, so the ad set carries none. Location expansion off is the
 * shared create's (createMetaAdSet → withGeoExpansionOff, #1401); it isn't set here.
 */
export function widerAdSetPayload(args: { presale?: boolean; event?: OptimisationEvent; name: string; campaignId: string; pixelId: string; customConversionId: string | null; endDay: string; location: Record<string, unknown>; interests: { id: string; name: string }[]; suggestionIds: string[]; excludeIds: string[] }): Record<string, unknown> {
  return {
    name: args.name,
    campaign_id: args.campaignId,
    status: "PAUSED",
    optimization_goal: "OFFSITE_CONVERSIONS",
    billing_event: "IMPRESSIONS",
    promoted_object: promotedObject(args),
    attribution_spec: TIER_ATTRIBUTION,
    end_time: showEndTime(args.endDay),
    targeting: {
      ...args.location,
      ...advantageAudienceAgeTargeting(18, ADVANTAGE_AUDIENCE_AGE_MAX),
      ...(args.interests.length ? { flexible_spec: [{ interests: args.interests.map((row) => ({ id: row.id, name: row.name })) }] } : {}),
      ...(args.suggestionIds.length ? { custom_audiences: args.suggestionIds.map((id) => ({ id })) } : {}),
      ...(args.excludeIds.length ? { excluded_custom_audiences: args.excludeIds.map((id) => ({ id })) } : {}),
    },
  };
}

/**
 * STAGED: "{code} · Wider", its lifetime budget on the campaign (READING: one
 * budget Meta spreads across the four ad sets). No stop_time: it's read-only
 * on Marketing API v21.0; the end Meta keeps is each ad set's end_time.
 */
export function widerCampaignFields(args: { lifetimeMinor: number }): Record<string, unknown> {
  return { lifetime_budget: args.lifetimeMinor, bid_strategy: "LOWEST_COST_WITHOUT_CAP" };
}
