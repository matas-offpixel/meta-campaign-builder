/**
 * GAQL for the campaign-grain insights cron. Every field here was run
 * read-only against the Ironworks account on API v23 (8 Oct 2026).
 * geographic_view, not user_location_view: it carries location_type
 * (presence vs interest), which user_location_view does not.
 */

export type Window = { since: string; until: string };

const between = (w: Window) => `segments.date BETWEEN '${w.since}' AND '${w.until}'`;

/** Every channel type, every status: a removed campaign still spent on the days it ran. */
export function campaignDailyQuery(w: Window): string {
  return `SELECT segments.date, campaign.resource_name, campaign.name, campaign.advertising_channel_type, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.video_trueview_views, metrics.video_trueview_view_rate, metrics.trueview_average_cpv, metrics.search_impression_share FROM campaign WHERE ${between(w)}`;
}

export function searchTermsQuery(w: Window): string {
  return `SELECT segments.date, campaign.resource_name, ad_group.resource_name, search_term_view.search_term, segments.search_term_match_type, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE ${between(w)}`;
}

export function locationQuery(w: Window): string {
  return `SELECT segments.date, campaign.resource_name, geographic_view.country_criterion_id, geographic_view.location_type, metrics.clicks, metrics.impressions, metrics.cost_micros FROM geographic_view WHERE ${between(w)}`;
}

export const CONVERSION_ACTIONS_QUERY =
  "SELECT conversion_action.resource_name, conversion_action.status, conversion_action.type FROM conversion_action WHERE conversion_action.status = 'ENABLED'";
