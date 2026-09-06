import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdjustWindowReads } from "./adjust-face.ts";

export type { AdjustWindowReads };

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Plan-window reads for ADJUST. Signups are Meta's `meta_regs` (canon G1);
 * cost per signup is spend ÷ meta_regs. TikTok/Google signup results are
 * not-yet — those channels contribute spend share only.
 */
export async function loadAdjustReads(
  supabase: SupabaseClient,
  input: {
    eventId: string;
    sinceDate?: string | null;
    campaignId?: string | null;
  },
): Promise<AdjustWindowReads> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let spend = 0;
  let metaRegs = 0;
  let metaPurchases = 0;
  let tickets = 0;
  let reach = 0;
  let clicks = 0;
  let landingPageViews = 0;
  let metaSpend = 0;
  let tiktokSpend = 0;
  let googleSpend = 0;
  const dailyCostPerSignup: number[] = [];

  for (let from = 0; ; from += 1000) {
    let query = sb
      .from("event_daily_rollups")
      .select(
        "date, ad_spend, tiktok_spend, google_ads_spend, meta_regs, meta_purchases, tickets_sold, meta_reach, link_clicks, landing_page_views",
      )
      .eq("event_id", input.eventId)
      .order("date", { ascending: true });
    if (input.sinceDate) query = query.gte("date", input.sinceDate);
    const { data, error } = await query.range(from, from + 999);
    if (error) {
      console.warn("[adjust-reads] rollup page failed", error.message);
      break;
    }
    const page = (data ?? []) as Array<Record<string, unknown>>;
    for (const row of page) {
      const dayMetaSpend = num(row.ad_spend);
      const dayTiktok = num(row.tiktok_spend);
      const dayGoogle = num(row.google_ads_spend);
      const dayRegs = num(row.meta_regs);
      spend += dayMetaSpend + dayTiktok + dayGoogle;
      metaSpend += dayMetaSpend;
      tiktokSpend += dayTiktok;
      googleSpend += dayGoogle;
      metaRegs += dayRegs;
      metaPurchases += num(row.meta_purchases);
      tickets += num(row.tickets_sold);
      reach += num(row.meta_reach);
      clicks += num(row.link_clicks);
      landingPageViews += num(row.landing_page_views);
      if (dayRegs > 0) dailyCostPerSignup.push(dayMetaSpend / dayRegs);
    }
    if (page.length < 1000) break;
  }

  const lpvRes = await sb
    .from("lp_page_views")
    .select("id", { count: "exact", head: true })
    .eq("event_id", input.eventId);
  const firstPartyLpv = lpvRes.error ? null : Number(lpvRes.count ?? 0);

  let lastCreativeSnapshotAt: string | null = null;
  if (input.campaignId) {
    const { data, error } = await sb
      .from("creative_insight_snapshots")
      .select("snapshot_at")
      .eq("campaign_id", input.campaignId)
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && data?.snapshot_at) {
      lastCreativeSnapshotAt = String(data.snapshot_at);
    }
  }

  return {
    spend,
    metaRegs,
    metaPurchases,
    tickets,
    reach,
    clicks,
    landingPageViews,
    firstPartyLpv,
    dailyCostPerSignup,
    channels: [
      { name: "Meta", spend: metaSpend, results: metaRegs },
      { name: "TikTok", spend: tiktokSpend, results: null },
      { name: "Google", spend: googleSpend, results: null },
    ],
    lastCreativeSnapshotAt,
  };
}
