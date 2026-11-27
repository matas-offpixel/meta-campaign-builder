/**
 * lib/retargeting/show-insights.ts — the ad-days of the shows a connector read
 * asks for, in place of every ad-day in `ad_daily_insights`
 * (onsale-refresh/load.ts loadInsights). Matas, 27 Nov: plan_retargeting timed
 * out from the connector on prod; it spent minutes paging the whole table
 * before it read a single show.
 *
 * The same rows the full load gives these shows, never fewer: an ad-day
 * belongs to an event by resolveAdContext (its launched ad, else its launched
 * ad set, else the [CODE] in its campaign name), so the rows that can resolve
 * to one of these shows are the ones whose ad or ad set is launched for it, or
 * whose campaign name holds its code. Those are read here, every date (spend
 * to date is all-time), paged in (date, meta_ad_id) order at 1,000 and deduped;
 * rowsForEvent and the purchase read still decide with the full context index,
 * so a superset row that resolves elsewhere is dropped as before. RT17's
 * layout-test arms ("{code} · Retargeting · A/B · A|B", read across every show
 * in a test) are read too.
 *
 * Relative imports only (node:test).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAdContextIndex, type AdContextIndex } from "../learning/ad-facts.ts";
import { loadAll, type RawInsights } from "../onsale-refresh/load.ts";

type Db = Pick<SupabaseClient, "from">;
type InsightRow = RawInsights["rows"][number];

/** loadInsights' columns, unchanged. */
const COLUMNS = "meta_ad_id, meta_adset_id, meta_campaign_id, ad_account_id, date, ad_name, adset_name, campaign_name, spend, landing_page_views, purchases, actions, promoted_event, optimization_goal, video_plays_3s";
const ORDER = ["date", "meta_ad_id"] as const;
const CHUNK = 100;

/**
 * A code as an ILIKE pattern that matches every campaign name holding "[CODE]":
 * a dash may be any dash (campaignMatchesBracketedEventCode reads en and em
 * dashes and the minus sign as "-"), so it's `_`; LIKE's own `%`, `_` and `\`
 * in a code are `_` too. A superset of the bracketed match, never a subset.
 */
export function codePattern(code: string): string {
  return `%[${code.trim().replace(/[-–—−%_\\]/g, "_")}]%`;
}

/** The ad and ad set ids the context index ties to these events. */
export function launchedIdsFor(context: AdContextIndex, eventIds: ReadonlySet<string>): { adIds: string[]; adSetIds: string[] } {
  const of = (map: AdContextIndex["launchedAds"]) => [...map].filter(([, link]) => link.eventId && eventIds.has(link.eventId)).map(([id]) => id);
  return { adIds: of(context.launchedAds), adSetIds: of(context.launchedAdSets) };
}

const chunks = <T,>(rows: readonly T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, i * size + size));

/** The ad-days these shows can own, with the full context index (every launched ad and ad set). */
export async function loadShowInsights(db: Db, events: readonly { id: string; event_code: string | null }[], context?: AdContextIndex): Promise<RawInsights> {
  const index = context ?? (await loadAdContextIndex(db));
  if (!events.length) return { rows: [], context: index };
  const { adIds, adSetIds } = launchedIdsFor(index, new Set(events.map((event) => event.id)));
  const codes = [...new Set(events.map((event) => event.event_code?.trim()).filter((code): code is string => Boolean(code)))];
  const read = (filter: NonNullable<Parameters<typeof loadAll>[4]>) => loadAll<InsightRow>(db as never, "ad_daily_insights", COLUMNS, ORDER, filter);
  const parts = await Promise.all([
    ...chunks(adIds, CHUNK).map((part) => read((q) => q.in("meta_ad_id", part))),
    ...chunks(adSetIds, CHUNK).map((part) => read((q) => q.in("meta_adset_id", part))),
    ...codes.map((code) => read((q) => q.ilike("campaign_name", codePattern(code)))),
    read((q) => q.ilike("campaign_name", "% · Retargeting · A/B · %")),
  ]);
  const seen = new Map<string, InsightRow>();
  for (const row of parts.flat()) seen.set(`${row.date}|${row.meta_ad_id}`, row);
  const rows = [...seen.values()].sort((a, b) => (a.date === b.date ? (a.meta_ad_id < b.meta_ad_id ? -1 : a.meta_ad_id > b.meta_ad_id ? 1 : 0) : a.date < b.date ? -1 : 1));
  return { rows, context: index };
}
