/**
 * The show's one test campaign, "{code} · Tests" (Matas, 17 Nov). Every test (an A/B
 * copy test, artist cards, the creative tests' Video and Statics) is an ad set inside
 * it, each with its own daily budget, so Meta can't move money between tests. The
 * campaign never carries a budget. A second test reuses the campaign: it is found by
 * its exact name on the show's ad account, never made twice.
 *
 * Both the A/B copy test (lib/meta/copy-test-campaign.ts) and the creative tests
 * (lib/creative-tests/approve.ts) match the campaign through findTestsCampaign.
 */

import { buildCampaignPayload } from "../meta/campaign.ts";
import type { CampaignObjective } from "../types.ts";
import { testsCampaignName } from "./words.ts";

export type CampaignRow = {
  id: string;
  name: string;
  status?: string | null;
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
};

const budget = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** True when the campaign is exactly the show's "{code} · Tests" (trimmed; nothing else matches). */
export function isTestsCampaign(name: string | null | undefined, eventCode: string): boolean {
  return (name ?? "").trim() === testsCampaignName(eventCode.trim());
}

/** True when the campaign holds a budget of its own (CBO). A Tests campaign never may. */
export function hasCampaignBudget(row: Pick<CampaignRow, "daily_budget" | "lifetime_budget">): boolean {
  return budget(row.daily_budget) > 0 || budget(row.lifetime_budget) > 0;
}

export class TestsCampaignProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestsCampaignProblem";
  }
}

/**
 * The show's Tests campaign among the ad account's campaigns, or null when there is
 * none yet. Deleted or archived campaigns are skipped. Two live matches, or a match
 * with a campaign budget, is a problem the caller must stop on: never pick one.
 */
export function findTestsCampaign(rows: readonly CampaignRow[], eventCode: string): CampaignRow | null {
  const matches = rows.filter((row) => isTestsCampaign(row.name, eventCode) && row.status !== "DELETED" && row.status !== "ARCHIVED");
  if (matches.length > 1) throw new TestsCampaignProblem(`${testsCampaignName(eventCode)} exists ${matches.length} times (${matches.map((m) => m.id).join(", ")}); nothing was made`);
  const found = matches[0] ?? null;
  if (found && hasCampaignBudget(found)) throw new TestsCampaignProblem(`${testsCampaignName(eventCode)} (${found.id}) has a campaign budget; tests need ad-set budgets, so nothing was made`);
  return found;
}

/** A new Tests campaign: no campaign budget (ad-set budgets, no sharing), the given objective and status. */
export function testsCampaignPayload(eventCode: string, input: { objective?: CampaignObjective; status: "ACTIVE" | "PAUSED" }): Record<string, unknown> {
  const payload = buildCampaignPayload({ name: testsCampaignName(eventCode), objective: input.objective ?? "purchase", status: input.status }) as unknown as Record<string, unknown>;
  if ("daily_budget" in payload || "lifetime_budget" in payload) throw new Error("A Tests campaign never carries a campaign budget");
  return payload;
}
