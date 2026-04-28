import { sumAdditionalSpendAmounts } from "@/lib/db/additional-spend-sum";
import { paidSpendOf } from "./paid-spend.ts";
import type { TimelineRow } from "@/lib/db/event-daily-timeline";

/** Whole calendar days from today (UTC) until event date; null if past or missing. */
export function fullDaysUntilEventUtc(
  eventDateYmd: string | null | undefined,
): number | null {
  if (!eventDateYmd) return null;
  const end = new Date(`${eventDateYmd}T00:00:00Z`);
  if (!Number.isFinite(end.getTime())) return null;
  const t0 = new Date();
  const start = new Date(
    Date.UTC(t0.getUTCFullYear(), t0.getUTCMonth(), t0.getUTCDate()),
  );
  const ms = end.getTime() - start.getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return null;
  return days;
}

export interface SellOutPacingResult {
  ticketsNeededPerDay: number | null;
  spendNeededPerDay: number | null;
}

export interface SellOutPacingInput {
  capacity: number | null | undefined;
  eventDate: string | null | undefined;
  preregSpend: number | null | undefined;
  metaSpendCached: number | null | undefined;
  timeline: TimelineRow[];
  additionalSpendEntries: ReadonlyArray<{ date: string; amount: number }>;
}

/**
 * Tickets/day + spend/day to sell out — same construction as
 * EventSummaryHeader pacing row (lifetime rollups + running CPT).
 */
export function computeSellOutPacing(
  input: SellOutPacingInput,
): SellOutPacingResult {
  let liveSpendAll = 0;
  let tiktokSpendAll = 0;
  let hasSpend = false;
  let ticketsAll = 0;
  for (const r of input.timeline) {
    const paidSpend = paidSpendOf(r);
    if (paidSpend > 0 || r.ad_spend != null || r.tiktok_spend != null) {
      liveSpendAll += paidSpend;
      hasSpend = true;
    }
    if (r.tiktok_spend != null) tiktokSpendAll += Number(r.tiktok_spend);
    if (r.tickets_sold != null) ticketsAll += Number(r.tickets_sold);
  }

  const prereg =
    input.preregSpend != null ? Number(input.preregSpend) : null;
  const metaLifetime =
    input.metaSpendCached != null
      ? Number(input.metaSpendCached) + tiktokSpendAll
      : hasSpend
        ? liveSpendAll
        : null;
  const otherLifetime = sumAdditionalSpendAmounts(
    input.additionalSpendEntries,
    null,
  );

  const capacity =
    input.capacity != null && input.capacity > 0 ? input.capacity : null;
  const daysRem = fullDaysUntilEventUtc(input.eventDate);
  const toGo =
    capacity != null ? Math.max(0, capacity - ticketsAll) : null;
  const ticketsNeededPerDay =
    daysRem != null && toGo != null && toGo > 0
      ? Math.ceil(toGo / daysRem)
      : null;

  const runningTotalSpend =
    (prereg ?? 0) + (metaLifetime ?? 0) + otherLifetime;
  const runningCpt =
    ticketsAll > 0 && runningTotalSpend > 0
      ? runningTotalSpend / ticketsAll
      : null;
  const spendNeededPerDay =
    ticketsNeededPerDay != null &&
    runningCpt != null &&
    runningCpt > 0
      ? Math.round(ticketsNeededPerDay * runningCpt)
      : null;

  return { ticketsNeededPerDay, spendNeededPerDay };
}
