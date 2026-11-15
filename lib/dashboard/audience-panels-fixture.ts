/**
 * lib/dashboard/audience-panels-fixture.ts
 *
 * Frames-only fixtures for the HE1 + HE3 panels. Figures only, no person
 * and no staff name.
 *
 *   - Who we reached: NX26-LOCKLEAD's real figures from the HE1 dry run
 *     (scripts/backfill-audience-breakdowns.mts --event NX26-LOCKLEAD,
 *     1 Sep–14 Nov, read 15 Nov, nothing written), and the campaigns' own
 *     counts from ad_daily_insights for the same three campaigns and days
 *     (£1,569.52, 498 signups, 25 purchases). So the totals line reads
 *     "… so these add to 500 signups; the campaigns count 498." (HI1's
 *     acceptance).
 *   - Direct-to-fan: Electric's real figures from the HE3 dry run in #1243
 *     (15 Nov): Bird's whole workspace (52 WhatsApp sends) and Mailchimp's
 *     NX Newcastle audience (229 sends; the dry run read that one audience
 *     of five). The sends are the six the dry run printed, with their names
 *     as Bird and Mailchimp hold them (read 15 Nov by a re-run of the
 *     same dry run, nothing written). Since the positive-match rules
 *     (migration 248), "Azyr - presale live v2" is NX26-AZYR's (it went to
 *     the show's CQ list and its opt-in tiers), so the whole-list row is
 *     "Locklead- Announcement" (2 Nov, the NX Loves master tag, same
 *     audience). Electric's WhatsApp rate
 *     isn't set, which is the PI5 state.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { AudienceBreakdowns, MetaRegionFigures, MetaSegmentFigures, TikTokSegmentFigures } from "../audience-breakdowns/read.ts";
import type { BroadcastStat, ChannelTotals, D2CStatsSummary } from "../d2c/stats-ingest/summary.ts";
import { modelFromSummary, type D2CSurface, type DirectToFanModel } from "./direct-to-fan.ts";
import { buildWhoWeReached, type CampaignTotals, type WhoWeReachedModel } from "./who-we-reached.ts";

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function meta(segment: string, spend: number, impressions: number, clicks: number, linkClicks: number, signups: number, purchases: number, revenue: number, totalImpressions: number): MetaSegmentFigures {
  return {
    segment,
    spend,
    impressions,
    impressionShare: ratio(impressions, totalImpressions),
    clicks,
    linkClicks,
    ctr: ratio(linkClicks, impressions),
    signups,
    costPerSignup: signups > 0 ? spend / signups : null,
    purchases,
    costPerPurchase: purchases > 0 ? spend / purchases : null,
    revenue,
  };
}

function region(segment: string, spend: number, impressions: number, clicks: number, linkClicks: number, total: number): MetaRegionFigures {
  return { segment, spend, impressions, impressionShare: ratio(impressions, total), clicks, linkClicks, ctr: ratio(linkClicks, impressions) };
}

function tiktok(segment: string, spend: number, impressions: number, clicks: number, total: number): TikTokSegmentFigures {
  return { segment, spend, impressions, impressionShare: ratio(impressions, total), clicks, ctr: ratio(clicks, impressions) };
}

const META_IMPR = 323_362;
const REGION_IMPR = 323_403;
const TIKTOK_IMPR = 88_268;

/** NX26-LOCKLEAD, HE1 dry run of 15 Nov (1 Sep–14 Nov). */
export const LOCKLEAD_AUDIENCE: AudienceBreakdowns = {
  meta: {
    byAge: [
      meta("18-24", 1071.72, 223_662, 3531, 2514, 364, 20, 1063.03, META_IMPR),
      meta("25-34", 411.49, 84_740, 1532, 1044, 116, 5, 240.55, META_IMPR),
      meta("35-44", 78.68, 13_843, 329, 218, 17, 0, 0, META_IMPR),
      meta("45-54", 7.19, 1040, 33, 20, 2, 0, 0, META_IMPR),
      meta("Unknown", 0.46, 77, 2, 2, 1, 0, 0, META_IMPR),
    ],
    byGender: [
      meta("female", 545.89, 110_773, 1742, 1153, 138, 8, 371.83, META_IMPR),
      meta("male", 1004.21, 209_012, 3607, 2595, 358, 17, 931.75, META_IMPR),
      meta("unknown", 19.44, 3577, 78, 50, 4, 0, 0, META_IMPR),
    ],
    byAgeGender: [],
    byRegion: [
      region("England", 1560.11, 321_157, 5403, 3779, REGION_IMPR),
      region("Scotland", 9.4, 2242, 25, 14, REGION_IMPR),
      region("Unknown", 0.03, 4, 0, 0, REGION_IMPR),
    ],
    total: meta("All", 1569.54, META_IMPR, 5427, 3798, 500, 25, 1303.58, META_IMPR),
    firstDay: "2026-10-29",
    lastDay: "2026-11-14",
    campaigns: 3,
  },
  tiktok: {
    byAge: [
      tiktok("18-24", 73.61, 55_425, 163, TIKTOK_IMPR),
      tiktok("25-34", 39.84, 28_347, 81, TIKTOK_IMPR),
      tiktok("35-44", 5.53, 4496, 17, TIKTOK_IMPR),
    ],
    byGender: [
      tiktok("female", 73.05, 57_843, 163, TIKTOK_IMPR),
      tiktok("male", 45.93, 30_406, 98, TIKTOK_IMPR),
      tiktok("unknown", 0, 19, 0, TIKTOK_IMPR),
    ],
    byAgeGender: [],
    byNation: [tiktok("England", 118.98, TIKTOK_IMPR, 261, TIKTOK_IMPR)],
    total: tiktok("All", 118.98, TIKTOK_IMPR, 261, TIKTOK_IMPR),
    firstDay: "2026-10-29",
    lastDay: "2026-11-04",
    campaigns: 2,
  },
};

/** ad_daily_insights for the same three campaigns, 29 Oct–14 Nov (read 15 Nov). */
export const LOCKLEAD_CAMPAIGNS: CampaignTotals = { spend: 1569.52, signups: 498, purchases: 25 };

export function locklead(): WhoWeReachedModel {
  return buildWhoWeReached(LOCKLEAD_AUDIENCE, LOCKLEAD_CAMPAIGNS, "Locklead");
}

function channel(
  group: ChannelTotals["group"],
  broadcasts: number,
  sent: number,
  delivered: number,
  readOrOpens: number,
  clicked: number,
): ChannelTotals {
  const email = group.startsWith("email");
  return {
    group,
    broadcasts,
    sent,
    delivered,
    read: email ? null : readOrOpens,
    readRate: email ? null : ratio(readOrOpens, delivered),
    opens: email ? readOrOpens : null,
    openRate: email ? ratio(readOrOpens, delivered) : null,
    opensEstimated: false,
    clicked,
    clickRate: ratio(clicked, delivered),
    cost: null,
    costPerClick: null,
  };
}

const SHOWS: Record<string, string> = {
  "show-robbiedoherty": "Robbie Doherty",
  "show-kream": "Kream",
  "show-locklead": "Locklead",
  "show-azyr": "AZYR b2b Partiboi69",
};

function send(
  id: string,
  name: string,
  day: string,
  channelId: "whatsapp" | "email",
  eventId: string | null,
  sent: number,
  delivered: number,
  readOrOpens: number,
  clicked: number,
): BroadcastStat {
  const email = channelId === "email";
  return {
    id,
    provider: email ? "mailchimp" : "bird",
    channel: channelId,
    audienceKind: "marketing",
    attribution: eventId ? "show" : "client",
    eventId,
    name,
    sentAt: `${day}T12:00:00Z`,
    sent,
    delivered,
    read: email ? null : readOrOpens,
    readRate: email ? null : ratio(readOrOpens, delivered),
    opens: email ? { opens: readOrOpens, rate: ratio(readOrOpens, delivered), estimated: false } : null,
    clicked,
    clickRate: ratio(clicked, delivered),
    cost: null,
    costPerClick: null,
  };
}

/** Electric, HE3 dry run of 15 Nov (#1243). */
export const ELECTRIC_D2C: D2CStatsSummary = {
  currency: "GBP",
  ratePerMessage: null,
  openRatio: null,
  channels: [
    channel("whatsapp", 52, 46_544, 42_696, 24_706, 814),
    channel("email_marketing", 226, 0, 2_611_690, 289_476, 13_513),
    channel("email_ticket_holder", 3, 0, 1863, 453, 20),
  ],
  broadcasts: [
    send("bird-1", "ROBBIE DOHERTY — LINEUP ANNOUNCE + 2 WEEKS", "2026-11-13", "whatsapp", "show-robbiedoherty", 685, 640, 227, 22),
    send("mc-1", "Robbie Doherty — NX Loves-Newcastle-27.11.26 — Lineup Announce (13 Nov 17:00)", "2026-11-13", "email", "show-robbiedoherty", 572, 572, 17, 0),
    send("bird-2", "Kream lineup", "2026-11-12", "whatsapp", "show-kream", 589, 525, 275, 26),
    send("bird-3", "Locklead - presale reminder", "2026-11-05", "whatsapp", "show-locklead", 627, 585, 331, 68),
    send("mc-2", "Locklead- Announcement", "2026-11-02", "email", null, 19_789, 19_715, 571, 54),
    send("bird-4", "Azyr - presale live v2", "2026-10-23", "whatsapp", "show-azyr", 1750, 1571, 545, 47),
    send("bird-5", "Kream presale", "2026-10-23", "whatsapp", "show-kream", 591, 539, 323, 113),
  ],
};

/**
 * 52 Bird sends (34 show, 18 not tied to a show, none whole-list) and 229
 * Mailchimp sends on the NX Newcastle audience (19 show, 196 whole list or
 * the NX Loves master tag, 14 not tied), by the positive-match rules
 * (migration 248), from a read-only dry run on 15 Nov.
 */
export const ELECTRIC_SEND_COUNT = { sends: 281, wholeList: 196 };

export function electric(surface: D2CSurface): DirectToFanModel {
  return modelFromSummary(
    ELECTRIC_D2C,
    { kind: "client", label: "Electric Group" },
    { surface, showName: (id) => SHOWS[id] ?? "—", rateHref: "/clients/electric?tab=d2c" },
    0,
    ELECTRIC_SEND_COUNT,
  );
}
