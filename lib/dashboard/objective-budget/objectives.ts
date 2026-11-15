/**
 * lib/dashboard/objective-budget/objectives.ts
 *
 * E6: spend and results by objective × channel, for a show or a client,
 * over any period. Pure.
 *
 * Objective:
 *   - Meta, per ad set, from ad_daily_insights' campaign_objective,
 *     optimization_goal and promoted_event (the first non-null of each
 *     across the ad set's days, as the learning stage reads them), through
 *     `phaseFromMetaObjective`: presale → Registration. On sale →
 *     `mapMetaObjectiveToInternal`, the mapping that function stages
 *     with: purchase / initiate_checkout → Purchase, traffic → Traffic,
 *     awareness / engagement → Awareness & engagement. No answer → not
 *     stored.
 *   - Google, per campaign, from advertising_channel_type: SEARCH →
 *     Traffic, VIDEO → Awareness & engagement. The bidding goal isn't
 *     stored, so a Search campaign bidding for conversions still reads
 *     as Traffic.
 *   - TikTok: no stored snapshot carries the campaign objective (the
 *     rollup is the only per-day TikTok figure), so all TikTok spend is
 *     "Objective not stored".
 *
 * Spend reconciles to D12: per show-day, the part of D12 that no
 * ad-level (Meta) or campaign-level (Google) row explains is its own
 * "Objective not stored" row. Every channel's rows sum to its D12 spend.
 *
 * Result is the objective's own metric: registrations (leads for a lead
 * ad set), purchases, landing page views (Google: clicks, it has no
 * landing page view), reach (Meta's, summed per ad per day, so people
 * are counted more than once; Google reach isn't stored). Cost per
 * result is spend ÷ result. ROAS is on Purchase rows only, and Meta
 * purchase value isn't stored (ad_daily_insights keeps action counts,
 * not action_values), so it reads null with that reason.
 *
 * Relative imports only (node --test).
 */

import { googleOwner } from "../sales-calc/figures.ts";
import { mapMetaObjectiveToInternal } from "../../meta/campaign.ts";
import { phaseFromMetaObjective } from "../../launched-ad-sets/snapshot.ts";
import { inPeriod, type PaidDays } from "./paid.ts";
import {
  CHANNELS,
  NOT_STORED_LABEL,
  OBJECTIVES,
  OBJECTIVE_LABEL,
  type Channel,
  type Figure,
  type MetaAdDay,
  type Objective,
  type ObjectiveBudgetInput,
  type ObjectiveRow,
  type ResultMetric,
} from "./types.ts";

const CHANNEL_LABEL: Record<Channel, string> = { meta: "Meta", tiktok: "TikTok", google: "Google" };
const EPSILON = 0.005;

export interface MetaAdSetObjective {
  objective: Objective | null;
  /** A lead ad set's result is leads, not registrations. */
  lead: boolean;
}

/** Meta objective for one ad set's fields. */
export function metaObjective(fields: { campaignObjective: string | null; optimizationGoal: string | null; promotedEvent: string | null }): MetaAdSetObjective {
  const event = (fields.promotedEvent ?? "").trim().toUpperCase();
  const goal = (fields.optimizationGoal ?? "").trim().toUpperCase();
  const lead = event === "LEAD" || goal === "LEAD_GENERATION";
  const phase = phaseFromMetaObjective(fields);
  if (phase == null) return { objective: null, lead };
  if (phase === "presale") return { objective: "registration", lead };
  const internal = mapMetaObjectiveToInternal(fields.campaignObjective, fields.promotedEvent);
  switch (internal) {
    case "purchase":
    case "initiate_checkout":
      return { objective: "purchase", lead };
    case "traffic":
      return { objective: "traffic", lead };
    case "awareness":
    case "engagement":
      return { objective: "awareness_engagement", lead };
    case "registration":
      return { objective: "registration", lead };
    default:
      return { objective: null, lead };
  }
}

/** Per ad set: the first non-null objective, goal and promoted event across its days, then `metaObjective`. A row with no ad set is read on its own. */
export function metaObjectiveByAdSet(rows: readonly MetaAdDay[]): Map<string, MetaAdSetObjective> {
  const seen = new Map<string, { campaignObjective: string | null; optimizationGoal: string | null; promotedEvent: string | null }>();
  for (const r of rows) {
    if (!r.adSetId) continue;
    const s = seen.get(r.adSetId) ?? { campaignObjective: null, optimizationGoal: null, promotedEvent: null };
    s.campaignObjective ??= r.campaignObjective;
    s.optimizationGoal ??= r.optimizationGoal;
    s.promotedEvent ??= r.promotedEvent;
    seen.set(r.adSetId, s);
  }
  return new Map([...seen].map(([id, f]) => [id, metaObjective(f)]));
}

export function googleObjective(channelType: string | null): Objective | null {
  const t = (channelType ?? "").trim().toUpperCase();
  if (t === "SEARCH") return "traffic";
  if (t === "VIDEO") return "awareness_engagement";
  return null;
}

interface Acc {
  objective: Objective | null;
  channel: Channel;
  spend: number;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  landingPageViews: number | null;
  result: number | null;
  purchaseValue: number | null;
}

const key = (o: Objective | null, c: Channel) => `${o ?? "none"}|${c}`;

function add(a: number | null, b: number): number {
  return (a ?? 0) + b;
}

const RESULT_METRIC: Record<Objective, Record<Channel, ResultMetric | null>> = {
  registration: { meta: "registrations", tiktok: null, google: null },
  purchase: { meta: "purchases", tiktok: null, google: null },
  traffic: { meta: "landing_page_views", tiktok: null, google: "clicks" },
  awareness_engagement: { meta: "reach", tiktok: null, google: null },
};

const RESULT_SOURCE: Record<ResultMetric, string> = {
  registrations: "ad_daily_insights.registrations (leads for a lead ad set)",
  purchases: "ad_daily_insights.purchases",
  landing_page_views: "ad_daily_insights.landing_page_views",
  clicks: "google_ads_daily_snapshots.clicks (Google has no landing page view)",
  reach: "ad_daily_insights.reach, summed per ad per day (people reached on more than one day are counted again)",
};

function spendSource(o: Objective | null, c: Channel): string {
  if (o != null) {
    return c === "meta"
      ? "ad_daily_insights.spend, campaigns mapped to the show (override, link, [CODE])"
      : "google_ads_daily_snapshots.cost_micros, campaigns mapped by override or [CODE]";
  }
  if (c === "tiktok") return "event_daily_rollups.tiktok_spend (D12); no stored TikTok snapshot carries the campaign objective";
  if (c === "meta") return "D12 Meta spend with no ad-level row in ad_daily_insights (the rollup's larger figure)";
  return "D12 Google spend with no campaign row in google_ads_daily_snapshots, or a channel type other than Search or Video";
}

function figure(value: number | null, source: string): Figure {
  return { value, source };
}

/**
 * Objective × channel rows for the scope's events over the period. `paid`
 * is `paidDays(input, period.to)`.
 */
export function objectiveRows(
  input: ObjectiveBudgetInput,
  paid: PaidDays,
  eventIds: ReadonlySet<string>,
  from: string | null,
  to: string,
): ObjectiveRow[] {
  const acc = new Map<string, Acc>();
  const accOf = (o: Objective | null, c: Channel): Acc => {
    const k = key(o, c);
    let a = acc.get(k);
    if (!a) {
      acc.set(
        k,
        (a = {
          objective: o,
          channel: c,
          spend: 0,
          impressions: null,
          reach: null,
          clicks: null,
          landingPageViews: null,
          result: null,
          purchaseValue: null,
        }),
      );
    }
    return a;
  };
  // What each show-day's ad-level rows explain, per channel.
  const explained = new Map<string, { meta: number; google: number }>();
  const explainedOf = (eventId: string, day: string) => {
    const k = `${eventId}|${day}`;
    let e = explained.get(k);
    if (!e) explained.set(k, (e = { meta: 0, google: 0 }));
    return e;
  };

  const adSets = metaObjectiveByAdSet(input.metaAdDays);
  for (const r of input.metaAdDays) {
    if (!inPeriod(r.day, from, to)) continue;
    const owner = paid.metaOwner.get(r.campaignId);
    if (!owner || !eventIds.has(owner.eventId)) continue;
    const resolved = r.adSetId
      ? adSets.get(r.adSetId) ?? { objective: null, lead: false }
      : metaObjective({ campaignObjective: r.campaignObjective, optimizationGoal: r.optimizationGoal, promotedEvent: r.promotedEvent });
    const a = accOf(resolved.objective, "meta");
    a.spend += r.spend;
    a.impressions = add(a.impressions, r.impressions);
    a.reach = add(a.reach, r.reach);
    a.clicks = add(a.clicks, r.linkClicks);
    a.landingPageViews = add(a.landingPageViews, r.landingPageViews);
    if (resolved.objective === "registration") a.result = add(a.result, resolved.lead ? r.leads : r.registrations);
    else if (resolved.objective === "purchase") a.result = add(a.result, r.purchases);
    else if (resolved.objective === "traffic") a.result = add(a.result, r.landingPageViews);
    else if (resolved.objective === "awareness_engagement") a.result = add(a.result, r.reach);
    explainedOf(owner.eventId, r.day).meta += r.spend;
  }

  for (const g of input.googleDays) {
    if (!inPeriod(g.day, from, to)) continue;
    const show = googleOwner(paid.calc, { eventCode: g.eventCode, campaignId: g.campaignId });
    if (!show || !eventIds.has(show.eventId)) continue;
    const objective = googleObjective(g.channelType);
    if (objective == null) continue; // left to the not-stored remainder below
    const a = accOf(objective, "google");
    a.spend += g.spend;
    a.impressions = add(a.impressions, g.impressions);
    a.clicks = add(a.clicks, g.clicks);
    if (objective === "traffic") a.result = add(a.result, g.clicks);
    explainedOf(show.eventId, g.day).google += g.spend;
  }

  // D12 not explained by an ad-level row: Meta's and Google's remainder, and all of TikTok.
  for (const [eventId, days] of paid.byShowDay) {
    if (!eventIds.has(eventId)) continue;
    for (const [day, f] of days) {
      if (!inPeriod(day, from, to)) continue;
      const e = explained.get(`${eventId}|${day}`) ?? { meta: 0, google: 0 };
      const metaRest = f.meta - e.meta;
      const googleRest = f.google - e.google;
      if (metaRest > EPSILON) accOf(null, "meta").spend += metaRest;
      if (googleRest > EPSILON) accOf(null, "google").spend += googleRest;
      if (f.tiktok > EPSILON) accOf(null, "tiktok").spend += f.tiktok;
    }
  }

  let total = 0;
  for (const a of acc.values()) total += a.spend;

  const order = (o: Objective | null) => (o == null ? OBJECTIVES.length : OBJECTIVES.indexOf(o));
  return [...acc.values()]
    .filter((a) => a.spend > EPSILON || (a.result ?? 0) > 0)
    .sort((x, y) => order(x.objective) - order(y.objective) || CHANNELS.indexOf(x.channel) - CHANNELS.indexOf(y.channel))
    .map((a) => toRow(a, total));
}

function toRow(a: Acc, total: number): ObjectiveRow {
  const metric = a.objective ? RESULT_METRIC[a.objective][a.channel] : null;
  const label = a.objective ? OBJECTIVE_LABEL[a.objective] : NOT_STORED_LABEL;
  const measured = a.objective != null;
  const result = metric != null ? figure(a.result ?? 0, RESULT_SOURCE[metric]) : figure(null, resultGap(a));
  const cost =
    result.value != null && result.value > 0
      ? figure(a.spend / result.value, "spend ÷ result")
      : figure(null, result.value == null ? "no result to divide by" : "no results in the period");
  return {
    objective: a.objective,
    label,
    channel: a.channel,
    spend: figure(a.spend, spendSource(a.objective, a.channel)),
    shareOfSpend: figure(total > 0 ? a.spend / total : null, "row spend ÷ the scope's D12 paid spend in the period"),
    impressions: figure(measured ? a.impressions : null, measured ? `${CHANNEL_LABEL[a.channel]} impressions` : "not stored for this spend"),
    reach: figure(
      measured && a.channel === "meta" ? a.reach : null,
      a.channel === "meta" && measured ? RESULT_SOURCE.reach : "not stored for this channel",
    ),
    clicks: figure(measured ? a.clicks : null, a.channel === "meta" ? "ad_daily_insights.link_clicks" : "google_ads_daily_snapshots.clicks"),
    landingPageViews: figure(measured && a.channel === "meta" ? a.landingPageViews : null, a.channel === "meta" ? "ad_daily_insights.landing_page_views" : "not stored for this channel"),
    resultMetric: metric,
    result,
    costPerResult: cost,
    roas:
      a.objective === "purchase"
        ? figure(null, "Meta purchase value isn't stored: ad_daily_insights keeps action counts, not action_values")
        : null,
  };
}

function resultGap(a: Acc): string {
  if (a.objective == null) return "no objective, so no result";
  if (a.channel === "google" && a.objective === "awareness_engagement") return "Google reach isn't stored";
  return `no ${OBJECTIVE_LABEL[a.objective]} result stored for ${CHANNEL_LABEL[a.channel]}`;
}
