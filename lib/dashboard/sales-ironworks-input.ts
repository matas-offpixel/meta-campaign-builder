/**
 * lib/dashboard/sales-ironworks-input.ts
 *
 * PH6's frame input (BR1 / BR1S): Ironworks, a client with an undated brand
 * campaign (IRWOHD, "Brand Awareness (Always-On)"), as the sales calc's own
 * loader read it from prod on 16 Nov (reads only), with "today" fixed at
 * 25 Oct 2026: the day after the brand campaign's last spend, while
 * Appetite (31 Oct) and Charlotte de Witte (1 Nov) are still on sale. So the
 * client view carries the brand campaign's whole £22,553.07 (Meta
 * £18,910.30, TikTok £3,642.77) beside two live shows.
 *
 * Ironworks has no ticket counts and no CIRQLIN signups stored, so cost per
 * ticket reads "—" with or without brand spend. Show names and figures
 * only. Rows are tuples (see the JSON's note). Relative imports only.
 */

import data from "./sales-ironworks-input.json" with { type: "json" };
import type { BrandCampaignInput, MetaCampaignDay, SalesCalcInput, ShowInput } from "./sales-calc/types.ts";

type Raw = {
  client: { id: string; name: string };
  today: string;
  shows: ShowInput[];
  brandCampaigns: BrandCampaignInput[];
  campaigns: [string, string][];
  meta: [number, string, number, number, number, number, number][];
  rollups: [number, string, number | null, number | null, number | null, number][];
  google: [number, string, number, string | null][];
  overrides: { meta: Record<string, string>; google: Record<string, string> };
};

const raw = data as unknown as Raw;
const ids = [...raw.shows.map((s) => s.eventId), ...raw.brandCampaigns.map((b) => b.eventId)];
const codes = [...raw.shows.map((s) => s.code), ...raw.brandCampaigns.map((b) => b.code)];

export const IRONWORKS_INPUT: SalesCalcInput = {
  client: raw.client,
  today: raw.today,
  shows: raw.shows,
  brandCampaigns: raw.brandCampaigns,
  metaCampaignDays: raw.meta.map(
    ([c, day, spend, linkClicks, landingPageViews, initiateCheckouts, addsToCart]): MetaCampaignDay => ({
      campaignId: raw.campaigns[c][0],
      campaignName: raw.campaigns[c][1],
      day,
      spend,
      linkClicks,
      landingPageViews,
      initiateCheckouts,
      addsToCart,
    }),
  ),
  googleCampaignDays: raw.google.map(([e, day, spend, campaignId]) => ({ eventCode: codes[e], day, spend, campaignId })),
  rollups: raw.rollups.map(([e, day, meta, tiktok, google, synced]) => ({
    eventId: ids[e],
    day,
    meta,
    tiktok,
    google,
    metaSynced: (synced & 1) !== 0,
    tiktokSynced: (synced & 2) !== 0,
    googleSynced: (synced & 4) !== 0,
  })),
  signups: [],
  library: [],
  overrides: raw.overrides,
};

/** The same client without its brand campaign: the calc as it was before PH6. */
export const IRONWORKS_INPUT_NO_BRAND: SalesCalcInput = { ...IRONWORKS_INPUT, brandCampaigns: [] };
