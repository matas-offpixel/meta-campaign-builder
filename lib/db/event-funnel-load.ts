import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildEventFunnelView,
  type EventFunnelInput,
  type EventFunnelView,
} from "@/lib/dashboard/event-funnel";

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lifetime funnel inputs for one event. Rollup columns are summed;
 * signups are a head count; snapshot sources are distinct labels
 * (per-day winning source is not on event_daily_rollups).
 */
export async function loadEventFunnelInput(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventFunnelInput> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const sums = {
    metaReach: 0,
    metaImpressions: 0,
    metaClicks: 0,
    metaSpend: 0,
    tiktokReach: 0,
    tiktokImpressions: 0,
    tiktokClicks: 0,
    tiktokSpend: 0,
    googleImpressions: 0,
    googleClicks: 0,
    googleSpend: 0,
    metaReportedLpv: 0,
    purchases: 0,
  };

  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("event_daily_rollups")
      .select(
        "meta_reach, meta_impressions, link_clicks, ad_spend, tiktok_reach, tiktok_impressions, tiktok_clicks, tiktok_spend, google_ads_impressions, google_ads_clicks, google_ads_spend, landing_page_views, tickets_sold",
      )
      .eq("event_id", eventId)
      .range(from, from + 999);
    if (error) {
      console.warn("[event-funnel] rollup page failed", error.message);
      break;
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of page) {
      sums.metaReach += num(row.meta_reach);
      sums.metaImpressions += num(row.meta_impressions);
      sums.metaClicks += num(row.link_clicks);
      sums.metaSpend += num(row.ad_spend);
      sums.tiktokReach += num(row.tiktok_reach);
      sums.tiktokImpressions += num(row.tiktok_impressions);
      sums.tiktokClicks += num(row.tiktok_clicks);
      sums.tiktokSpend += num(row.tiktok_spend);
      sums.googleImpressions += num(row.google_ads_impressions);
      sums.googleClicks += num(row.google_ads_clicks);
      sums.googleSpend += num(row.google_ads_spend);
      sums.metaReportedLpv += num(row.landing_page_views);
      sums.purchases += num(row.tickets_sold);
    }
    if (page.length < 1000) break;
  }

  const signupRes = await sb
    .from("event_signups")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("deleted_at", null);

  // First-party LPV at read time — same pattern as signups. No
  // event_daily_rollups.lp_views column: the helper already does a
  // lifetime COUNT for the first-party middle, and rollup-sync does
  // not own this pipe.
  const lpvRes = await sb
    .from("lp_page_views")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);
  const firstPartyLpv = lpvRes.error ? null : Number(lpvRes.count ?? 0);
  if (lpvRes.error) {
    console.warn("[event-funnel] lp_page_views count failed", lpvRes.error.message);
  }

  const sources = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("ticket_sales_snapshots")
      .select("source")
      .eq("event_id", eventId)
      .range(from, from + 999);
    if (error) {
      console.warn("[event-funnel] snapshot page failed", error.message);
      break;
    }
    const page = (data ?? []) as Array<{ source: string | null }>;
    for (const row of page) {
      if (row.source) sources.add(row.source);
    }
    if (page.length < 1000) break;
  }

  return {
    ...sums,
    signupCount: Number(signupRes.count ?? 0),
    firstPartyLpv,
    snapshotSources: [...sources],
  };
}

export async function loadEventFunnelView(
  supabase: SupabaseClient,
  eventId: string,
): Promise<EventFunnelView> {
  return buildEventFunnelView(await loadEventFunnelInput(supabase, eventId));
}
