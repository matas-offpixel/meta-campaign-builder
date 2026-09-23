/**
 * One resolution for Google Search push status.
 *
 * `launchPaused` is the operator's choice on the push request. The name
 * matches TikTok's launcher: the route is still "push", and the boolean
 * means "create paused instead of live". Default is live (`false`).
 *
 * Precedence, applied by `resolveGoogleSearchPushStatus` and nowhere else:
 * 1. `launchPaused: true` pauses campaign, ad group, and ad.
 * 2. A campaign the sheet marks PAUSED is created PAUSED even when the
 *    operator chose live. Both stored shapes count:
 *    `bid_adjustments.status_at_launch === "PAUSED"` and
 *    `bid_adjustments.status_at_launch_by_campaign[name] === "PAUSED"`.
 * 3. Everything else follows the operator's choice.
 * 4. An ad group whose name contains `(PAUSED)` is paused. That is a
 *    name convention, not a column — there is no ad-group status field.
 *    In single-campaign mode the same map pauses an ad group whose C-code
 *    matches a source campaign the sheet marked PAUSED.
 *
 * Keywords are not resolved here. They stay ENABLED.
 */

import type { GoogleSearchPlanTree } from "../google-search/types.ts";

export type GoogleSearchEntityStatus = "ENABLED" | "PAUSED";

export function parseGoogleSearchLaunchPaused(
  value: unknown,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: false };
  if (value === true) return { ok: true, value: true };
  if (value === false) return { ok: true, value: false };
  return { ok: false, error: "launchPaused must be a boolean" };
}

/** Explicit override for a past or missing start on a campaign about to go live. */
export function parseGoogleSearchConfirmStart(
  value: unknown,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: false };
  if (value === true) return { ok: true, value: true };
  if (value === false) return { ok: true, value: false };
  return { ok: false, error: "confirmStart must be a boolean" };
}

const C_CODE = /\bc(\d+)\b/i;
const PAUSED_IN_NAME = /\(PAUSED\)/i;

export function sheetMarksCampaignPaused(
  campaignName: string,
  bidAdjustments: Record<string, unknown> | null | undefined,
): boolean {
  if (!bidAdjustments) return false;
  if (bidAdjustments.status_at_launch === "PAUSED") return true;
  const mapped = launchStatusByCampaign(bidAdjustments);
  return mapped?.[campaignName] === "PAUSED";
}

/**
 * Name-convention read. Not a schema field.
 * True when the ad group name itself contains `(PAUSED)`, or when
 * single-campaign mode stored a PAUSED source campaign on
 * `status_at_launch_by_campaign` and this ad group's C-code is that source.
 */
export function sheetMarksAdGroupPaused(
  adGroupName: string,
  bidAdjustments: Record<string, unknown> | null | undefined,
): boolean {
  if (PAUSED_IN_NAME.test(adGroupName)) return true;
  const mapped = launchStatusByCampaign(bidAdjustments);
  if (!mapped) return false;
  for (const [sourceName, status] of Object.entries(mapped)) {
    if (status !== "PAUSED") continue;
    if (adGroupBelongsToSource(adGroupName, sourceName)) return true;
  }
  return false;
}

export function resolveGoogleSearchPushStatus(args: {
  launchPaused: boolean;
  level: "campaign" | "ad_group" | "ad";
  campaignName: string;
  bidAdjustments: Record<string, unknown> | null | undefined;
  adGroupName?: string | null;
}): GoogleSearchEntityStatus {
  if (args.launchPaused) return "PAUSED";
  if (args.level === "campaign") {
    return sheetMarksCampaignPaused(args.campaignName, args.bidAdjustments)
      ? "PAUSED"
      : "ENABLED";
  }
  if (args.adGroupName && sheetMarksAdGroupPaused(args.adGroupName, args.bidAdjustments)) {
    return "PAUSED";
  }
  return "ENABLED";
}

/** A campaign, ad group, and ad that will actually deliver after this push. */
export function googleSearchEntityWillServe(args: {
  launchPaused: boolean;
  level: "campaign" | "ad_group" | "ad";
  campaignName: string;
  bidAdjustments: Record<string, unknown> | null | undefined;
  adGroupName?: string | null;
}): boolean {
  if (args.launchPaused) return false;
  if (sheetMarksCampaignPaused(args.campaignName, args.bidAdjustments)) return false;
  if (args.level !== "campaign" && args.adGroupName) {
    if (sheetMarksAdGroupPaused(args.adGroupName, args.bidAdjustments)) return false;
  }
  return true;
}

export interface GoogleSearchStartBlock {
  campaignName: string;
  /** ISO date, or null when the sheet and the plan both omit a start. */
  start: string | null;
  kind: "past" | "absent";
}

export function googleSearchLondonToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function googleSearchLiveStartBlocks(args: {
  campaigns: Array<{ name: string; bid_adjustments: Record<string, unknown> }>;
  dateRange: { since: string; until: string } | null | undefined;
  launchPaused: boolean;
  today?: string;
}): GoogleSearchStartBlock[] {
  const today = args.today ?? googleSearchLondonToday();
  const blocks: GoogleSearchStartBlock[] = [];
  for (const campaign of args.campaigns) {
    const willServe = googleSearchEntityWillServe({
      launchPaused: args.launchPaused,
      level: "campaign",
      campaignName: campaign.name,
      bidAdjustments: campaign.bid_adjustments,
    });
    if (!willServe) continue;
    const start = campaignStartDate(campaign.bid_adjustments, args.dateRange);
    if (!start) {
      blocks.push({ campaignName: campaign.name, start: null, kind: "absent" });
    } else if (start < today) {
      blocks.push({ campaignName: campaign.name, start, kind: "past" });
    }
  }
  return blocks;
}

export function formatGoogleSearchStartBlocks(blocks: GoogleSearchStartBlock[]): string {
  const lines = blocks.map((block) => {
    const name = campaignLabel(block.campaignName);
    if (block.kind === "absent") return `${name} has no start date.`;
    return `${name} starts ${block.start}, which is in the past.`;
  });
  return `${lines.join(" ")} A live push spends from the moment it returns. Fix the start date, or confirm to push live anyway.`;
}

export interface GoogleSearchServingUrlBlock {
  campaignName: string;
  adGroupName: string;
}

/** RSAs that would deliver with no final URL. Paused campaigns and paused ad groups are not included. */
export function googleSearchServingRsasMissingUrl(
  tree: Pick<GoogleSearchPlanTree, "campaigns">,
  launchPaused: boolean,
): GoogleSearchServingUrlBlock[] {
  const blocks: GoogleSearchServingUrlBlock[] = [];
  for (const campaign of tree.campaigns) {
    for (const adGroup of campaign.ad_groups) {
      const willServe = googleSearchEntityWillServe({
        launchPaused,
        level: "ad",
        campaignName: campaign.name,
        bidAdjustments: campaign.bid_adjustments,
        adGroupName: adGroup.name,
      });
      if (!willServe) continue;
      for (const rsa of adGroup.rsas) {
        if (rsa.pushed_resource_name) continue;
        if (!(rsa.final_url ?? "").trim()) {
          blocks.push({ campaignName: campaign.name, adGroupName: adGroup.name });
          break;
        }
      }
    }
  }
  return blocks;
}

export function formatGoogleSearchServingUrlBlocks(
  blocks: GoogleSearchServingUrlBlock[],
): string {
  const names = blocks.map(
    (block) => `${campaignLabel(block.campaignName)} → ${block.adGroupName}`,
  );
  return `These ads would go live with no final URL: ${names.join("; ")}. Set a final URL before pushing.`;
}

/**
 * The sentence the Push panel shows before the operator commits.
 * Counts are everything that will be created. Paused campaigns are named.
 */
export function describeGoogleSearchPush(
  tree: Pick<GoogleSearchPlanTree, "campaigns">,
  launchPaused: boolean,
): string {
  const sheetPaused: string[] = [];
  const namePausedAdGroups: string[] = [];
  let liveCampaigns = 0;
  let adGroups = 0;
  let ads = 0;
  let keywords = 0;

  for (const campaign of tree.campaigns) {
    const campaignPaused =
      resolveGoogleSearchPushStatus({
        launchPaused,
        level: "campaign",
        campaignName: campaign.name,
        bidAdjustments: campaign.bid_adjustments,
      }) === "PAUSED";
    if (campaignPaused && !launchPaused) sheetPaused.push(campaignLabel(campaign.name));
    else if (!campaignPaused) liveCampaigns += 1;

    for (const adGroup of campaign.ad_groups) {
      adGroups += 1;
      ads += adGroup.rsas.length;
      keywords += adGroup.keywords.length;
      if (launchPaused || campaignPaused) continue;
      if (PAUSED_IN_NAME.test(adGroup.name)) {
        namePausedAdGroups.push(adGroup.name.replace(PAUSED_IN_NAME, "").trim());
      }
    }
  }

  const counts = `${plural(adGroups, "ad group")}, ${plural(ads, "ad")}, ${plural(keywords, "keyword")}`;
  if (tree.campaigns.length === 0) {
    return "Push will create 0 campaigns. Nothing will serve.";
  }

  const allPaused = launchPaused || sheetPaused.length === tree.campaigns.length;
  if (allPaused) {
    const why = launchPaused
      ? ""
      : ` (${sheetPaused.join(", ")} — marked Paused in the sheet)`;
    return `Push will create ${plural(tree.campaigns.length, "campaign")} paused${why}, ${counts}. Nothing will serve until it is enabled in Google Ads.`;
  }

  const pausedClause =
    sheetPaused.length > 0
      ? ` and ${sheetPaused.length} paused (${sheetPaused.join(", ")} — marked Paused in the sheet)`
      : "";
  const adGroupClause =
    namePausedAdGroups.length > 0
      ? ` (${namePausedAdGroups.length} paused: ${namePausedAdGroups.join(", ")} — name contains (PAUSED))`
      : "";
  const liveWord = liveCampaigns === 1 ? "campaign" : "campaigns";
  return `Push will create ${liveCampaigns} ${liveWord} live${pausedClause}, ${plural(adGroups, "ad group")}${adGroupClause}, ${plural(ads, "ad")}, ${plural(keywords, "keyword")}. Ads begin serving immediately.`;
}

function launchStatusByCampaign(
  bidAdjustments: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!bidAdjustments) return null;
  const value = bidAdjustments.status_at_launch_by_campaign;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function adGroupBelongsToSource(adGroupName: string, sourceName: string): boolean {
  const sourceCode = cCodeDigits(sourceName);
  if (sourceCode && new RegExp(`^c${sourceCode}\\b`, "i").test(adGroupName.trim())) {
    return true;
  }
  return adGroupName === sourceName || adGroupName.startsWith(`${sourceName} – `);
}

function cCodeDigits(name: string): string | null {
  const match = C_CODE.exec(name.trim());
  return match ? match[1] : null;
}

function campaignStartDate(
  bidAdjustments: Record<string, unknown> | null | undefined,
  dateRange: { since: string; until: string } | null | undefined,
): string | null {
  const fromCampaign = isoDate(bidAdjustments?.start);
  if (fromCampaign) return fromCampaign;
  return isoDate(dateRange?.since);
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1] : null;
}

export function campaignLabel(name: string): string {
  const match = /\bC\d+\b.*/i.exec(name);
  return match ? match[0] : name;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
