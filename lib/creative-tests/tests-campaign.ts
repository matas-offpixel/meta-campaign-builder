/**
 * The show's one test campaign, "{code} · Tests" (Matas, 17 Nov):
 *
 *   - one per show, in the event's ad account; every test is its own ad set
 *     inside it (A/B copy, artist cards, Video, Statics), never a new campaign;
 *   - no campaign budget: each ad set carries its own, so Meta can't move
 *     money between tests (`is_adset_budget_sharing_enabled: false`, the
 *     ad-set-level shape of lib/meta/campaign.ts);
 *   - created ACTIVE; Matas switches off anything he refuses;
 *   - each ad set ends four days after it starts.
 *
 * The one name match for every caller (creative tests and the A/B copy test).
 * Pure: no server imports, so node --test runs it and scripts can import it.
 */

import { TF1 } from "./budget.ts";
import { testsCampaignName } from "./words.ts";

export { testsCampaignName };

/** A row of GET /act_{id}/campaigns?fields=id,name,effective_status,created_time,daily_budget,lifetime_budget. */
export type ListedCampaign = {
  id: string;
  name: string;
  effective_status?: string | null;
  created_time?: string | null;
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
};

/** Gone campaigns are never reused. */
const GONE = new Set(["DELETED", "ARCHIVED"]);

/**
 * The show's Tests campaign from an account's campaign listing: the exact
 * name (no other campaign that merely contains it), not deleted or archived,
 * the oldest when there are two (then the lowest id). Null when there's none.
 * Pass a listing of the event's own ad account: the name has no account in it.
 */
export function pickTestsCampaign(campaigns: readonly ListedCampaign[], eventCode: string): ListedCampaign | null {
  const name = testsCampaignName(eventCode.trim());
  const hits = campaigns.filter((c) => c.name?.trim() === name && !GONE.has(String(c.effective_status ?? "").toUpperCase()));
  hits.sort((a, b) => String(a.created_time ?? "").localeCompare(String(b.created_time ?? "")) || a.id.localeCompare(b.id));
  return hits[0] ?? null;
}

/** True when a campaign carries its own budget (CBO), which test ad sets can't sit under. */
export function hasCampaignBudget(campaign: Pick<ListedCampaign, "daily_budget" | "lifetime_budget">): boolean {
  return Number(campaign.daily_budget) > 0 || Number(campaign.lifetime_budget) > 0;
}

/** The Tests campaign's create payload: ACTIVE, no campaign budget, ad-set budgets. */
export function testsCampaignPayload(eventCode: string, objective: string) {
  return {
    name: testsCampaignName(eventCode),
    objective,
    buying_type: "AUCTION" as const,
    status: "ACTIVE" as const,
    special_ad_categories: [] as never[],
    is_adset_budget_sharing_enabled: false as const,
  };
}

/** How long a test ad set runs: its own end, four days after it starts (TF1's hold). */
export const TEST_AD_SET_DAYS = TF1.holdDays;

/** The ad set's end_time: start + 4 days, as an ISO string. */
export function testAdSetEndTime(startIso: string): string {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) throw new Error(`Not a start time: ${startIso}`);
  return new Date(start + TEST_AD_SET_DAYS * 86_400_000).toISOString();
}
