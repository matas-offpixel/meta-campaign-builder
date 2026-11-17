/**
 * The show's one test campaign, "{code} · Tests" (Matas, 17 Nov). Every test (an A/B
 * copy test, artist cards, the creative tests' Video and Statics) is an ad set inside
 * it, each with its own daily budget, so Meta can't move money between tests. The
 * campaign never carries a budget. A second test reuses the campaign: it is found by
 * its exact name on the show's ad account, never made twice. Each test's ad set ends
 * at 23:59 London, four days after the London day it starts.
 *
 * The one helper both the A/B copy test (lib/meta/copy-test-campaign.ts) and the
 * creative tests (lib/creative-tests/approve.ts) match the campaign through. Pure: no
 * server imports (lib/meta/campaign.ts is payload-only), so node --test and scripts
 * can import it.
 */

import { buildCampaignPayload } from "../meta/campaign.ts";
import type { CampaignObjective } from "../types.ts";
import { TF1 } from "./budget.ts";
import { testsCampaignName } from "./words.ts";

export { testsCampaignName };

/**
 * A row of GET /act_{id}/campaigns (or GET /{campaign}). Either status field is read:
 * effective_status when it's there, else status.
 */
export type CampaignRow = {
  id: string;
  name: string;
  status?: string | null;
  effective_status?: string | null;
  created_time?: string | null;
  daily_budget?: string | number | null;
  lifetime_budget?: string | number | null;
};

const budget = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Campaign statuses that are never reused (and that a stored id is made again from). */
export const GONE_STATUSES: readonly string[] = ["DELETED", "ARCHIVED"];

/** True when a campaign's status says it's deleted or archived. */
export function isGoneCampaign(row: Pick<CampaignRow, "status" | "effective_status"> | null | undefined): boolean {
  const status = String(row?.effective_status ?? row?.status ?? "").toUpperCase();
  return GONE_STATUSES.includes(status);
}

/** True when the campaign is exactly the show's "{code} · Tests" (trimmed; nothing else matches). */
export function isTestsCampaign(name: string | null | undefined, eventCode: string): boolean {
  return (name ?? "").trim() === testsCampaignName(eventCode.trim());
}

/**
 * The 17 Nov round's own test campaigns, made before the one Tests campaign (Matas: "This
 * round stays as built"). Exact names, so a main campaign that only mentions them doesn't match.
 */
export const ROUND_TEST_CAMPAIGN_SUFFIXES: readonly string[] = ["AB copy test", "Artist cards test"];

/**
 * True for any of the show's test campaigns: "{code} · Tests", and this round's
 * "{code} · AB copy test" and "{code} · Artist cards test". Their spend is never a main
 * campaign's (TF1's current daily spend, the best ad).
 */
export function isShowTestCampaign(name: string | null | undefined, eventCode: string): boolean {
  if (isTestsCampaign(name, eventCode)) return true;
  const trimmed = (name ?? "").trim();
  const code = eventCode.trim();
  return ROUND_TEST_CAMPAIGN_SUFFIXES.some((suffix) => trimmed === `${code} · ${suffix}`);
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
 * none yet. Pass the event's own ad account's campaigns: the name has no account in it.
 * Deleted or archived campaigns are skipped. Two live matches, or a match with a
 * campaign budget, is a problem the caller must stop on: never pick one.
 */
export function findTestsCampaign(rows: readonly CampaignRow[], eventCode: string): CampaignRow | null {
  const matches = rows.filter((row) => isTestsCampaign(row.name, eventCode) && !isGoneCampaign(row));
  if (matches.length > 1) throw new TestsCampaignProblem(`${testsCampaignName(eventCode)} is in Ads Manager ${matches.length} times (${matches.map((m) => m.id).join(", ")}). Keep one and archive the rest. Nothing was made.`);
  const found = matches[0] ?? null;
  if (found && hasCampaignBudget(found)) throw new TestsCampaignProblem(`${testsCampaignName(eventCode)} has a campaign budget, and tests need budgets on their ad sets. Remove the campaign budget in Ads Manager. Nothing was made.`);
  return found;
}

/**
 * A new Tests campaign: no campaign budget (ad-set budgets, no sharing) and the given
 * status. `objective` is the app's (default purchase → OUTCOME_SALES); `metaObjective`,
 * when given, is a Meta objective copied as it is (the creative tests copy the main
 * campaign's).
 */
export function testsCampaignPayload(eventCode: string, input: { objective?: CampaignObjective; metaObjective?: string | null; status: "ACTIVE" | "PAUSED" }): Record<string, unknown> {
  const payload = buildCampaignPayload({ name: testsCampaignName(eventCode), objective: input.objective ?? "purchase", status: input.status }) as unknown as Record<string, unknown>;
  if (input.metaObjective) payload.objective = input.metaObjective;
  if ("daily_budget" in payload || "lifetime_budget" in payload || payload.is_adset_budget_sharing_enabled !== false) throw new Error("A Tests campaign never carries a campaign budget");
  return payload;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "{d Mon}" of an instant's London calendar day: "24 Nov", "3 Sep" (no leading zero). */
export function londonDayLabel(at: Date | string): string {
  const day = londonDay(typeof at === "string" ? new Date(at) : at);
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

/**
 * A test ad set's name in the show's Tests campaign (design, 17 Nov, TT8):
 * "{code} · Tests · {label} · {d Mon}", e.g. "P26-BDAY · Tests · Statics · 24 Nov", the
 * date the London day the ad set is made. `taken` is the campaign's ad set names: a
 * second one with the same label on the same day gets " · 2", a third " · 3".
 * The creative tests' labels are "Video" and "Statics".
 */
export function testsAdSetName(eventCode: string, label: string, createdAt: Date | string, taken: readonly string[] = []): string {
  const base = `${testsCampaignName(eventCode.trim())} · ${label} · ${londonDayLabel(createdAt)}`;
  const names = new Set(taken.map((name) => name.trim()));
  if (!names.has(base)) return base;
  for (let n = 2; ; n += 1) if (!names.has(`${base} · ${n}`)) return `${base} · ${n}`;
}

/** How many days a test's ad set runs (TF1's hold). */
export const TEST_AD_SET_DAYS = TF1.holdDays;

/** London's calendar date of an instant, YYYY-MM-DD. */
export function londonDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 23:59 London on a day, with that day's offset, as Meta takes it ("2026-11-21T23:59:00+0000"). */
export function londonEndOfDay(day: string): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", timeZoneName: "shortOffset" }).formatToParts(noon).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const hours = Number(offset.match(/GMT([+-]\d+)?/)?.[1] ?? 0);
  return `${day}T23:59:00${hours < 0 ? "-" : "+"}${String(Math.abs(hours)).padStart(2, "0")}00`;
}

/** A test ad set's end_time: 23:59 London, four days after the London day it starts. */
export function testAdSetEndTime(start: Date | string, days = TEST_AD_SET_DAYS): string {
  const at = typeof start === "string" ? new Date(start) : start;
  if (!Number.isFinite(at.getTime())) throw new Error(`Not a start time: ${String(start)}`);
  return londonEndOfDay(addDays(londonDay(at), days));
}
