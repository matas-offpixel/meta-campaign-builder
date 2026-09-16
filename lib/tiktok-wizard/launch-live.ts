import { formatTikTokMoney } from "../plan/tiktok-early.ts";
import {
  resolveTikTokAdGroupBudget,
  tikTokScheduledDays,
} from "../tiktok/write/mapping.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "./review.ts";

const NAIVE_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

const MONTHS_EN_GB = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function isTikTokLaunchPaused(
  draft: Pick<TikTokCampaignDraft, "launchPaused">,
): boolean {
  return draft.launchPaused === true;
}

/**
 * Success copy for a published draft. Absent on a published row means the
 * old paused writer. Absent on an unpublished draft means live.
 */
export function tikTokLaunchWasDeliveredPaused(
  draft: Pick<TikTokCampaignDraft, "launchPaused" | "publishedIds">,
): boolean {
  if (draft.launchPaused === true) return true;
  if (draft.launchPaused === false) return false;
  return Boolean(draft.publishedIds?.campaignId);
}

export function tikTokLaunchButtonLabel(paused: boolean): string {
  return paused ? "Launch paused on TikTok" : "Launch live on TikTok";
}

export function tikTokLaunchPausedConfirmMessage(): string {
  return "Nothing will deliver until this campaign is enabled in Ads Manager.";
}

export function tikTokLaunchLiveSuccessDescription(input: {
  scheduleStartAt: string | null;
  timezone: string | null;
}): string {
  const start = formatTikTokLaunchClock(input.scheduleStartAt, input.timezone);
  if (!start) {
    return "Campaign created live on TikTok. Delivery starts at the schedule start.";
  }
  return `Campaign created live on TikTok. Delivery starts ${start}.`;
}

export function tikTokLaunchPausedSuccessDescription(): string {
  return "Campaign created paused on TikTok. Nothing will deliver until it is enabled in Ads Manager.";
}

export function tikTokLaunchConfirmMessage(
  draft: TikTokCampaignDraft,
  opts?: { advertiserName?: string | null },
): string {
  if (isTikTokLaunchPaused(draft)) return tikTokLaunchPausedConfirmMessage();
  return tikTokLaunchLiveConfirmMessage(draft, opts);
}

export function tikTokLaunchLiveConfirmMessage(
  draft: TikTokCampaignDraft,
  opts?: { advertiserName?: string | null },
): string {
  const facts = tikTokLaunchLiveFacts(draft, opts);
  const start = facts.startClock
    ? `starting ${facts.startClock}`
    : "starting at the schedule start";
  const counts = `${plural(facts.adGroupCount, "ad group")} and ${plural(facts.adCount, "ad")} start delivering at the start time.`;
  if (facts.ceiling != null && facts.days != null) {
    const mode =
      facts.budgetMode === "DAILY" && facts.dailyBudget != null
        ? ` (${formatTikTokMoney(facts.currency, facts.dailyBudget)} daily)`
        : facts.budgetMode === "LIFETIME"
          ? " (lifetime)"
          : "";
    return `Up to ${formatTikTokMoney(facts.currency, facts.ceiling)} over ${plural(facts.days, "day")}${mode} on ${facts.advertiser}, ${start}. ${counts}`;
  }
  if (facts.dailyBudget != null && facts.budgetMode === "DAILY") {
    return `${formatTikTokMoney(facts.currency, facts.dailyBudget)} daily on ${facts.advertiser}, ${start}. ${counts}`;
  }
  return `Launch live on ${facts.advertiser}, ${start}. ${counts}`;
}

export function tikTokLaunchLiveFacts(
  draft: TikTokCampaignDraft,
  opts?: { advertiserName?: string | null },
): {
  advertiser: string;
  advertiserId: string;
  currency: string;
  budgetMode: "DAILY" | "LIFETIME";
  dailyBudget: number | null;
  days: number | null;
  ceiling: number | null;
  startClock: string | null;
  timezone: string | null;
  adGroupCount: number;
  adCount: number;
} {
  const adGroups = suggestTikTokAdGroups(draft);
  const dailyBudget = sumAdGroupBudgets(draft, adGroups);
  const days = tikTokScheduledDays(
    draft.budgetSchedule.scheduleStartAt,
    draft.budgetSchedule.scheduleEndAt,
  );
  const budgetMode = draft.budgetSchedule.budgetMode;
  const ceiling =
    dailyBudget == null
      ? null
      : budgetMode === "DAILY" && days != null
        ? dailyBudget * days
        : budgetMode === "LIFETIME"
          ? dailyBudget
          : null;
  const timezone = draft.accountSetup.timezone;
  const advertiserId = draft.accountSetup.advertiserId?.trim() ?? "";
  return {
    advertiser: formatAdvertiser(opts?.advertiserName, draft, advertiserId),
    advertiserId,
    currency: (draft.accountSetup.currency ?? "").trim().toUpperCase() || "GBP",
    budgetMode,
    dailyBudget,
    days,
    ceiling,
    startClock: formatTikTokLaunchClock(
      draft.budgetSchedule.scheduleStartAt,
      timezone,
    ),
    timezone,
    adGroupCount: adGroups.length,
    adCount: assignedCreativeCount(draft, adGroups),
  };
}

export function formatTikTokLaunchClock(
  value: string | null,
  timeZone: string | null,
): string | null {
  if (!value?.trim()) return null;
  const match = NAIVE_DATETIME.exec(value.trim());
  const zone = timeZone?.trim() || null;
  if (match) {
    const day = Number(match[3]);
    const month = Number(match[2]);
    const hour = match[4];
    const minute = match[5];
    const monthName = MONTHS_EN_GB[month - 1];
    if (!monthName) return null;
    return zone
      ? `${day} ${monthName} ${hour}:${minute} ${zone}`
      : `${day} ${monthName} ${hour}:${minute}`;
  }
  return zone ? `${value.trim()} ${zone}` : value.trim();
}

function sumAdGroupBudgets(
  draft: TikTokCampaignDraft,
  adGroups: TikTokCampaignDraft["budgetSchedule"]["adGroups"],
): number | null {
  let total = 0;
  let any = false;
  for (const adGroup of adGroups) {
    const budget = resolveTikTokAdGroupBudget(draft, adGroup);
    if (budget == null) continue;
    total += budget;
    any = true;
  }
  return any ? total : null;
}

function assignedCreativeCount(
  draft: TikTokCampaignDraft,
  adGroups: TikTokCampaignDraft["budgetSchedule"]["adGroups"],
): number {
  let count = 0;
  for (const adGroup of adGroups) {
    const ids = draft.creativeAssignments.byAdGroupId[adGroup.id] ?? [];
    for (const id of ids) {
      if (draft.creatives.items.some((item) => item.id === id)) count += 1;
    }
  }
  return count;
}

function formatAdvertiser(
  advertiserName: string | null | undefined,
  draft: TikTokCampaignDraft,
  advertiserId: string,
): string {
  const name =
    advertiserName?.trim() ||
    draft.accountSetup.identityDisplayName?.trim() ||
    "";
  if (name && advertiserId) return `${name} (${advertiserId})`;
  if (name) return name;
  if (advertiserId) return `advertiser ${advertiserId}`;
  return "this advertiser";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
