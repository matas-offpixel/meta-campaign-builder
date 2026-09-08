/**
 * TikTok findings that are knowable the moment TikTok holds a share of
 * the daily budget — before copy, before a prepared draft, before launch
 * preflight walks the tree.
 *
 * Messages are operator-facing. The launch preflight still runs; these
 * issues supersede the late budget-floor / empty-event wording when both
 * fire for the same cause.
 */

import {
  tikTokBudgetFloorUnverified,
  tikTokDailyBudgetMinimum,
} from "../tiktok/write/mapping.ts";
import type { PlanAdapterName } from "./types.ts";

export interface TikTokEarlyIssue {
  adapter: PlanAdapterName;
  id: string;
  field: string;
  message: string;
  blocking: boolean;
}

export const OPERATOR_CLOCK_ZONE = "Europe/London";

const CONVERSION_OBJECTIVES = new Set(["CONVERSIONS", "LEAD_GENERATION"]);

const SMALL_COUNT = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

export interface TikTokEarlyInput {
  tiktokDaily: number;
  currency: string | null;
  timezone: string | null;
  objective: string | null;
  pixelName: string | null;
  pixelId: string | null;
  /**
   * `undefined` = events not loaded. `[]` = loaded and empty (the pixel
   * has not fired). A non-empty list means there is something to choose.
   */
  pixelEvents?: readonly unknown[];
  adGroupCount: number | null;
  adGroupBudgets?: readonly number[] | null;
  now?: Date;
}

export function isTikTokConversionObjective(
  objective: string | null | undefined,
): boolean {
  return CONVERSION_OBJECTIVES.has((objective ?? "").trim());
}

export function formatTikTokMoney(currency: string, amount: number): string {
  const code = currency.trim().toUpperCase() || "unknown";
  const body = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (code === "GBP") return `£${body}`;
  if (code === "EUR") return `€${body}`;
  if (code === "USD") return `$${body}`;
  return `${body} ${code}`;
}

export function tikTokPixelNotFiredMessage(pixelName: string): string {
  const name = pixelName.trim() || "This pixel";
  return `${name} has not fired yet — TikTok cannot optimise for a conversion until it does. Install it on the landing page, or run Traffic for now.`;
}

export function tikTokUnverifiedFloorMessage(currency: string): string {
  const code = currency.trim().toUpperCase() || "unknown";
  return `no TikTok minimum is documented for ${code} — preflight is not checking the amount`;
}

export function tikTokDailyFloorMessage(input: {
  currency: string;
  dailyMin: number;
  tiktokDaily: number;
  adGroupCount: number | null;
}): string {
  const floor = formatTikTokMoney(input.currency, input.dailyMin);
  const given = formatTikTokMoney(input.currency, input.tiktokDaily);
  const count = input.adGroupCount != null && input.adGroupCount > 1
    ? input.adGroupCount
    : null;
  if (count == null) {
    return `TikTok needs at least ${floor} a day — this plan gives it ${given}. Raise TikTok's share, or set it to 0.`;
  }
  const needed = formatTikTokMoney(input.currency, input.dailyMin * count);
  const countWord = SMALL_COUNT[count] ?? String(count);
  return `TikTok needs at least ${floor} a day each — ${countWord} ad groups needs ${needed}. This plan gives it ${given}. Raise TikTok's share, or set it to 0.`;
}

function zoneOffsetMs(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      read("year"),
      read("month") - 1,
      read("day"),
      read("hour"),
      read("minute"),
      read("second"),
    );
    if (!Number.isFinite(asUtc)) return null;
    return asUtc - at.getTime();
  } catch {
    return null;
  }
}

function londonCalendarDate(at: Date): { day: number; month: string } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: OPERATOR_CLOCK_ZONE,
      day: "numeric",
      month: "short",
    }).formatToParts(at);
    const day = Number(parts.find((part) => part.type === "day")?.value);
    const month = parts.find((part) => part.type === "month")?.value;
    if (!Number.isFinite(day) || !month) return null;
    return { day, month };
  } catch {
    return null;
  }
}

function nextOffsetAlignment(
  advertiserZone: string,
  at: Date,
): Date | null {
  const startAdv = zoneOffsetMs(advertiserZone, at);
  const startLon = zoneOffsetMs(OPERATOR_CLOCK_ZONE, at);
  if (startAdv == null || startLon == null || startAdv === startLon) {
    return null;
  }
  const dayMs = 86_400_000;
  for (let i = 1; i <= 400; i += 1) {
    const candidate = new Date(at.getTime() + i * dayMs);
    const adv = zoneOffsetMs(advertiserZone, candidate);
    const lon = zoneOffsetMs(OPERATOR_CLOCK_ZONE, candidate);
    if (adv != null && lon != null && adv === lon) return candidate;
  }
  return null;
}

export function tikTokAdvertiserClockDiffersFromLondon(
  timeZone: string | null | undefined,
  at: Date = new Date(),
): boolean {
  const zone = timeZone?.trim();
  if (!zone) return false;
  const adv = zoneOffsetMs(zone, at);
  const lon = zoneOffsetMs(OPERATOR_CLOCK_ZONE, at);
  if (adv == null || lon == null) return zone !== OPERATOR_CLOCK_ZONE;
  return adv !== lon;
}

/**
 * Label for TikTok schedule times. No conversion — the mapper already
 * treats the numbers as the advertiser wall clock.
 */
export function tikTokAdvertiserClockLabel(
  timeZone: string,
  at: Date = new Date(),
): string {
  const zone = timeZone.trim();
  const head = `times are the advertiser's clock (${zone})`;
  const adv = zoneOffsetMs(zone, at);
  const lon = zoneOffsetMs(OPERATOR_CLOCK_ZONE, at);
  if (adv == null || lon == null || adv === lon) return head;

  const hours = Math.round(Math.abs(adv - lon) / 3_600_000);
  const hourWord = hours === 1 ? "an hour" : `${hours} hours`;
  const relation = adv < lon ? "behind" : "ahead of";
  const until = nextOffsetAlignment(zone, at);
  const untilDate = until ? londonCalendarDate(until) : null;
  if (!untilDate) {
    return `${head} — ${hourWord} ${relation} London`;
  }
  return `${head} — ${hourWord} ${relation} London until ${untilDate.day} ${untilDate.month}`;
}

export function collectTikTokEarlyIssues(
  input: TikTokEarlyInput,
): TikTokEarlyIssue[] {
  if (!(input.tiktokDaily > 0)) return [];

  const issues: TikTokEarlyIssue[] = [];
  const currency = (input.currency ?? "").trim() || null;
  const dailyMin = tikTokDailyBudgetMinimum(currency);

  if (tikTokBudgetFloorUnverified(currency)) {
    issues.push({
      adapter: "tiktok",
      id: "tiktok:early:budget-currency",
      field: "currency",
      message: tikTokUnverifiedFloorMessage(currency ?? "unknown"),
      blocking: false,
    });
  } else if (dailyMin != null && currency) {
    const count =
      input.adGroupCount != null && input.adGroupCount > 0
        ? input.adGroupCount
        : 1;
    const groupShort = (input.adGroupBudgets ?? []).some(
      (budget) => Number.isFinite(budget) && budget < dailyMin,
    );
    const shareShort = input.tiktokDaily < dailyMin * count;
    if (shareShort || groupShort) {
      issues.push({
        adapter: "tiktok",
        id: "tiktok:early:budget-floor",
        field: "budget",
        message: tikTokDailyFloorMessage({
          currency,
          dailyMin,
          tiktokDaily: input.tiktokDaily,
          adGroupCount: count > 1 ? count : null,
        }),
        blocking: true,
      });
    }
  }

  if (
    isTikTokConversionObjective(input.objective) &&
    input.pixelId &&
    input.pixelEvents !== undefined &&
    input.pixelEvents.length === 0
  ) {
    issues.push({
      adapter: "tiktok",
      id: "tiktok:early:pixel-events",
      field: "pixel_id",
      message: tikTokPixelNotFiredMessage(input.pixelName ?? ""),
      blocking: true,
    });
  }

  const zone = input.timezone?.trim();
  const now = input.now ?? new Date();
  if (zone && tikTokAdvertiserClockDiffersFromLondon(zone, now)) {
    issues.push({
      adapter: "tiktok",
      id: "tiktok:early:advertiser-clock",
      field: "timezone",
      message: tikTokAdvertiserClockLabel(zone, now),
      blocking: false,
    });
  }

  return issues;
}

export function tikTokLaunchIssueSupersededByEarly(
  launch: { id: string; message: string },
  early: readonly TikTokEarlyIssue[],
): boolean {
  const ids = new Set(early.map((issue) => issue.id));
  if (ids.has("tiktok:early:budget-floor")) {
    if (launch.id === "budget-minimum") return true;
    if (launch.id.startsWith("adgroup-budget-floor-")) return true;
    if (
      launch.id.startsWith("adgroup-budget-") &&
      /below TikTok|minimum/i.test(launch.message)
    ) {
      return true;
    }
  }
  if (ids.has("tiktok:early:pixel-events") && launch.id === "optimisation-event") {
    return true;
  }
  if (
    ids.has("tiktok:early:budget-currency") &&
    launch.id === "budget-currency"
  ) {
    return true;
  }
  return false;
}
