/**
 * lib/dashboard/objective-budget/objectives.ts
 *
 * E6: spend and results by objective × channel, for a show or a client,
 * over any period. Pure.
 *
 * Objective:
 *   - Meta, per ad set, by what the ad set optimises for
 *     (ad_daily_insights.optimization_goal, migration 187; the first
 *     non-null of each field across the ad set's days), not the campaign
 *     objective (design fix (a) on #1256):
 *       Complete Registration or Lead promoted event, or LEAD_GENERATION
 *         → Registration (leads are the result of a lead ad set);
 *       LANDING_PAGE_VIEWS, LINK_CLICKS → Traffic, even under a sales
 *         campaign;
 *       a conversion goal (OFFSITE_CONVERSIONS) for Purchase or Initiated
 *         Checkout, or VALUE (purchase value) → Purchase;
 *       reach, impressions, video and engagement goals → Awareness &
 *         engagement;
 *       any other goal, or a conversion goal whose event is another one
 *         (OTHER is a custom conversion) or isn't stored → none of the
 *         four: "Objective not stored", counted in `unmapped`.
 *     With no goal stored, the campaign objective decides, through the
 *     shared mapping (`phaseFromMetaObjective`, then
 *     `mapMetaObjectiveToInternal`), and those ad-days are counted in
 *     `goalMissing` so it's never silent.
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
 * Result is the objective's own metric, and cost per result is labelled
 * for it (fix (d)): registrations (leads for a lead ad set), £ / signup;
 * purchases, £ / purchase; landing page views, £ / landing page view
 * (Google: clicks, £ / click, it has no landing page view). Awareness
 * reach is "—" with no cost: ad_daily_insights keeps reach per ad per
 * day, and summing it counts people twice; campaign-level reach isn't
 * stored. ROAS is on Purchase rows only, and "—" until purchase value is
 * stored (ad_daily_insights keeps action counts, not action_values).
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
  COST_LABEL,
  type MetaClassification,
  type MetaObjectiveBasis,
  type ObjectiveRow,
  type ResultMetric,
} from "./types.ts";

const CHANNEL_LABEL: Record<Channel, string> = { meta: "Meta", tiktok: "TikTok", google: "Google" };
const EPSILON = 0.005;

export interface MetaAdSetObjective {
  objective: Objective | null;
  /** A lead ad set's result is leads, not registrations. */
  lead: boolean;
  /** What the objective was read from: the goal, or (no goal stored) the campaign objective. */
  basis: MetaObjectiveBasis;
  /** When a stored goal maps to none of the four: what it was ("OFFSITE_CONVERSIONS / OTHER"). */
  unmapped: string | null;
}

const TRAFFIC_GOALS: ReadonlySet<string> = new Set(["LANDING_PAGE_VIEWS", "LINK_CLICKS"]);
const PURCHASE_EVENTS: ReadonlySet<string> = new Set(["PURCHASE", "INITIATED_CHECKOUT"]);
const AWARENESS_GOALS: ReadonlySet<string> = new Set([
  "REACH",
  "IMPRESSIONS",
  "AD_RECALL_LIFT",
  "THRUPLAY",
  "VIDEO_VIEWS",
  "TWO_SECOND_CONTINUOUS_VIDEO_VIEWS",
  "POST_ENGAGEMENT",
  "PAGE_LIKES",
  "EVENT_RESPONSES",
  "ENGAGED_USERS",
  "PROFILE_VISIT",
]);

/** The shared mapping, from the campaign objective: used only when no goal is stored. */
function fromCampaignObjective(fields: { campaignObjective: string | null; optimizationGoal: string | null; promotedEvent: string | null }): Objective | null {
  const phase = phaseFromMetaObjective(fields);
  if (phase == null) return null;
  if (phase === "presale") return "registration";
  switch (mapMetaObjectiveToInternal(fields.campaignObjective, fields.promotedEvent)) {
    case "purchase":
    case "initiate_checkout":
      return "purchase";
    case "traffic":
      return "traffic";
    case "awareness":
    case "engagement":
      return "awareness_engagement";
    case "registration":
      return "registration";
    default:
      return null;
  }
}

/** Meta objective for one ad set's fields: by what it optimises for. */
export function metaObjective(fields: { campaignObjective: string | null; optimizationGoal: string | null; promotedEvent: string | null }): MetaAdSetObjective {
  const event = (fields.promotedEvent ?? "").trim().toUpperCase();
  const goal = (fields.optimizationGoal ?? "").trim().toUpperCase();
  const lead = event === "LEAD" || goal === "LEAD_GENERATION";
  if (!goal) return { objective: fromCampaignObjective(fields), lead, basis: "campaign_objective", unmapped: null };
  const by = (objective: Objective | null): MetaAdSetObjective => ({
    objective,
    lead,
    basis: "optimization_goal",
    unmapped: objective == null ? (event ? `${goal} / ${event}` : goal) : null,
  });
  if (event === "COMPLETE_REGISTRATION" || lead) return by("registration");
  if (TRAFFIC_GOALS.has(goal)) return by("traffic");
  if (goal === "VALUE") return by("purchase");
  if (goal === "OFFSITE_CONVERSIONS") return by(PURCHASE_EVENTS.has(event) ? "purchase" : null);
  if (AWARENESS_GOALS.has(goal)) return by("awareness_engagement");
  return by(null);
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
  clicks: number | null;
  landingPageViews: number | null;
  result: number | null;
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
  reach: "campaign-level reach isn't stored; ad_daily_insights.reach is per ad per day, and summing it counts people twice",
};

const REACH_NOT_STORED = "campaign-level reach isn't stored; summing ad-day reach counts people twice";

function spendSource(o: Objective | null, c: Channel): string {
  if (o != null) {
    return c === "meta"
      ? "ad_daily_insights.spend, campaigns mapped to the show (override, link, [CODE]), by the ad set's optimisation goal"
      : "google_ads_daily_snapshots.cost_micros, campaigns mapped by override or [CODE]";
  }
  if (c === "tiktok") return "event_daily_rollups.tiktok_spend (D12); no stored TikTok snapshot carries the campaign objective";
  if (c === "meta") return "D12 Meta spend with no ad-level row in ad_daily_insights (the rollup's larger figure), or an ad set whose optimisation goal is none of the four";
  return "D12 Google spend with no campaign row in google_ads_daily_snapshots, or a channel type other than Search or Video";
}

function figure(value: number | null, source: string): Figure {
  return { value, source };
}

export function emptyMetaClassification(): MetaClassification {
  return {
    byGoal: { adDays: 0, spend: 0 },
    goalMissing: { adDays: 0, spend: 0, byObjective: { registration: 0, purchase: 0, traffic: 0, awareness_engagement: 0, none: 0 } },
    unmapped: { adDays: 0, spend: 0, what: [] },
  };
}

/**
 * Objective × channel rows for the scope's events over the period, and
 * what each Meta ad-day was classified from. `paid` is
 * `paidDays(input, period.to)`.
 */
export function objectiveRows(
  input: ObjectiveBudgetInput,
  paid: PaidDays,
  eventIds: ReadonlySet<string>,
  from: string | null,
  to: string,
): { rows: ObjectiveRow[]; metaClassification: MetaClassification } {
  const acc = new Map<string, Acc>();
  const accOf = (o: Objective | null, c: Channel): Acc => {
    const k = key(o, c);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { objective: o, channel: c, spend: 0, impressions: null, clicks: null, landingPageViews: null, result: null }));
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
  const cls = emptyMetaClassification();
  const unmappedWhat = new Set<string>();

  const adSets = metaObjectiveByAdSet(input.metaAdDays);
  for (const r of input.metaAdDays) {
    if (!inPeriod(r.day, from, to)) continue;
    const owner = paid.metaOwner.get(r.campaignId);
    if (!owner || !eventIds.has(owner.eventId)) continue;
    const resolved = r.adSetId
      ? adSets.get(r.adSetId) ?? metaObjective({ campaignObjective: null, optimizationGoal: null, promotedEvent: null })
      : metaObjective({ campaignObjective: r.campaignObjective, optimizationGoal: r.optimizationGoal, promotedEvent: r.promotedEvent });
    if (resolved.basis === "campaign_objective") {
      cls.goalMissing.adDays += 1;
      cls.goalMissing.spend += r.spend;
      cls.goalMissing.byObjective[resolved.objective ?? "none"] += r.spend;
    } else {
      cls.byGoal.adDays += 1;
      cls.byGoal.spend += r.spend;
      if (resolved.unmapped) {
        cls.unmapped.adDays += 1;
        cls.unmapped.spend += r.spend;
        unmappedWhat.add(resolved.unmapped);
      }
    }
    const a = accOf(resolved.objective, "meta");
    a.spend += r.spend;
    a.impressions = add(a.impressions, r.impressions);
    a.clicks = add(a.clicks, r.linkClicks);
    a.landingPageViews = add(a.landingPageViews, r.landingPageViews);
    if (resolved.objective === "registration") a.result = add(a.result, resolved.lead ? r.leads : r.registrations);
    else if (resolved.objective === "purchase") a.result = add(a.result, r.purchases);
    else if (resolved.objective === "traffic") a.result = add(a.result, r.landingPageViews);
    explainedOf(owner.eventId, r.day).meta += r.spend;
  }
  cls.unmapped.what = [...unmappedWhat].sort();

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
  const rows = [...acc.values()]
    .filter((a) => a.spend > EPSILON || (a.result ?? 0) > 0)
    .sort((x, y) => order(x.objective) - order(y.objective) || CHANNELS.indexOf(x.channel) - CHANNELS.indexOf(y.channel))
    .map((a) => toRow(a, total));
  return { rows, metaClassification: cls };
}

function toRow(a: Acc, total: number): ObjectiveRow {
  const metric = a.objective ? RESULT_METRIC[a.objective][a.channel] : null;
  const label = a.objective ? OBJECTIVE_LABEL[a.objective] : NOT_STORED_LABEL;
  const measured = a.objective != null;
  const result =
    metric === "reach"
      ? figure(null, RESULT_SOURCE.reach)
      : metric != null
        ? figure(a.result ?? 0, RESULT_SOURCE[metric])
        : figure(null, resultGap(a));
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
    reach: figure(null, a.channel === "meta" ? REACH_NOT_STORED : "not stored for this channel"),
    clicks: figure(measured ? a.clicks : null, a.channel === "meta" ? "ad_daily_insights.link_clicks" : "google_ads_daily_snapshots.clicks"),
    landingPageViews: figure(measured && a.channel === "meta" ? a.landingPageViews : null, a.channel === "meta" ? "ad_daily_insights.landing_page_views" : "not stored for this channel"),
    resultMetric: metric,
    result,
    costPerResult: cost,
    costLabel: metric != null && metric !== "reach" ? COST_LABEL[metric] : null,
    roas:
      a.objective === "purchase"
        ? figure(null, "— until purchase value is stored: ad_daily_insights keeps action counts, not action_values")
        : null,
  };
}

function resultGap(a: Acc): string {
  if (a.objective == null) return "no objective, so no result";
  if (a.channel === "google" && a.objective === "awareness_engagement") return "Google reach isn't stored";
  return `no ${OBJECTIVE_LABEL[a.objective]} result stored for ${CHANNEL_LABEL[a.channel]}`;
}
