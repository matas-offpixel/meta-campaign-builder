/**
 * TF5's benchmark (docs/design-record/2026-11-18-creative-testing-6.html): the
 * show's main-campaign cost per result, on the test's own result event, over
 * the test's own days (the London day its ad set starts to the read).
 *
 * The main campaign is every campaign of the show that delivered on those days,
 * except the show's test campaigns ({code} · Tests and the 17 Nov round's,
 * TT8), the Purchase campaign ("[code] {event} - Purchase") and Retargeting
 * ("{code} · Retargeting", or the older "[code] Retargeting"). With more than
 * one, their summed spend ÷ their summed results. No results on those days:
 * no benchmark, and TF2 decides alone.
 *
 * Read from ad_daily_insights rows (the same rows TF1 and the best ad read).
 * Pure: the read job passes the rows in.
 */

import { resultsOf, type AdDay } from "./approve.ts";
import { isShowTestCampaign } from "./tests-campaign.ts";
import type { ResultEvent } from "./words.ts";

/** A Purchase campaign: "[P26-BDAY] Puzzle - 27 Dec - Purchase". */
const PURCHASE = /\s-\sPurchase$/i;
/** Retargeting: "P26-BDAY · Retargeting", "[P26-BDAY] Retargeting". */
const RETARGETING = /(^|[\s·\]])Retargeting$/i;

/** Whether a campaign of the show counts towards its benchmark (TF5). */
export function isBenchmarkCampaign(name: string | null | undefined, eventCode: string): boolean {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return false;
  if (isShowTestCampaign(trimmed, eventCode)) return false;
  return !PURCHASE.test(trimmed) && !RETARGETING.test(trimmed);
}

export type ShowBenchmark = { cost: number | null; spend: number; results: number };

/**
 * The benchmark over [fromDay, toDay] (YYYY-MM-DD, London days, inclusive):
 * summed spend ÷ summed results of the show's main campaigns on the result.
 */
export function showBenchmark(rows: readonly Pick<AdDay, "date" | "campaign_name" | "spend" | "landing_page_views" | "registrations" | "actions">[], input: { eventCode: string; result: ResultEvent; fromDay: string; toDay: string }): ShowBenchmark {
  let spend = 0;
  let results = 0;
  for (const row of rows) {
    if (row.date < input.fromDay || row.date > input.toDay) continue;
    if (!isBenchmarkCampaign(row.campaign_name, input.eventCode)) continue;
    spend += Number(row.spend) || 0;
    results += resultsOf(row, input.result);
  }
  spend = Math.round(spend * 100) / 100;
  return { cost: results > 0 ? Math.round((spend / results) * 10000) / 10000 : null, spend, results };
}
