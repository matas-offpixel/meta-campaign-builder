"use client";

import { useMemo } from "react";

import {
  sumAdditionalSpendAmounts,
} from "@/lib/db/additional-spend-sum";
import { paidSpendOf } from "@/lib/dashboard/paid-spend";
import type { TimelineRow } from "@/lib/db/event-daily-timeline";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * Collapsed Performance summary for the event reporting block.
 * Row 1: spend + tickets + CPT + revenue + capacity + sell-through + pacing.
 * Row 2 (pacing): capacity, sell-through, tickets/day, spend/day — when row 1
 * would be too wide we still keep two logical header rows in one table.
 */

interface EventLike {
  budget_marketing: number | null;
  meta_spend_cached: number | null;
  prereg_spend: number | null;
  general_sale_at: string | null;
  capacity?: number | null;
  event_date?: string | null;
  kind?: string | null;
}

export interface PerformanceSummaryTimeframe {
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  /** Meta `totals.spend` for the selected preset (insights). */
  metaSpend: number | null;
  /** Optional non-Meta platform spend already present on the report page. */
  additionalPlatformSpend?: number | null;
  /** Rollup window sum from insights resolver; may be null. */
  ticketsInWindow: number | null;
}

interface Props {
  event: EventLike;
  timeline: TimelineRow[];
  /** Mirrors the Meta timeframe pill — drives sell-through + windowed spend. */
  timeframe: PerformanceSummaryTimeframe;
  /** All additional_spend_entries rows for this event (client-fetched or SSR). */
  additionalSpendEntries: ReadonlyArray<{ date: string; amount: number }>;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

function fmtGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
}
function fmtInt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return NUM.format(Math.round(n));
}
function fmtPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}
function fmtChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${NUM.format(n)}`;
}
function fmtRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function fmtCptChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return GBP2.format(0);
  const abs = GBP2.format(Math.abs(n));
  return n > 0 ? `+${abs}` : `−${abs}`;
}

function cptChangeClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n < 0) return "text-emerald-600 font-semibold dark:text-emerald-400";
  if (n > 0) return "text-amber-600 font-semibold dark:text-amber-400";
  return "text-foreground";
}

function roasClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n >= 3) return "text-emerald-600 font-semibold dark:text-emerald-400";
  if (n < 1) return "text-red-600 font-semibold dark:text-red-400";
  return "text-foreground";
}

function windowDaySet(
  datePreset: DatePreset,
  customRange: CustomDateRange | undefined,
): Set<string> | null {
  const days = resolvePresetToDays(datePreset, customRange);
  if (days === null) return null;
  return new Set(days);
}

function lookbackCutoff(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function sumTicketsTimeline(
  timeline: TimelineRow[],
  window: Set<string> | null,
): number {
  let t = 0;
  for (const r of timeline) {
    if (window != null && !window.has(r.date)) continue;
    if (r.tickets_sold != null) t += Number(r.tickets_sold);
  }
  return t;
}

function sumSpendTimeline(
  timeline: TimelineRow[],
  window: Set<string> | null,
): number {
  let t = 0;
  for (const r of timeline) {
    if (window != null && !window.has(r.date)) continue;
    t += paidSpendOf(r);
  }
  return t;
}

function sumTikTokSpendTimeline(
  timeline: TimelineRow[],
  window: Set<string> | null,
): number {
  let t = 0;
  for (const r of timeline) {
    if (window != null && !window.has(r.date)) continue;
    if (r.tiktok_spend != null) t += Number(r.tiktok_spend);
  }
  return t;
}

function fullDaysUntilEventUtc(eventDateYmd: string | null | undefined): number | null {
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

export function EventSummaryHeader({
  event,
  timeline,
  timeframe,
  additionalSpendEntries,
}: Props) {
  const m = useMemo(
    () =>
      computeMetrics(event, timeline, timeframe, additionalSpendEntries),
    [event, timeline, timeframe, additionalSpendEntries],
  );

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-border px-4 py-3">
        <h2 className="font-heading text-base tracking-wide">
          Performance summary
        </h2>
        <div className="flex flex-wrap items-baseline gap-3 text-xs text-muted-foreground">
          {m.adBudget !== null && (
            <span>
              Ad Budget:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {fmtGBP(m.adBudget)}
              </span>
            </span>
          )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad spend</th>
              <th className="px-3 py-2.5 text-right">Other spend</th>
              <th className="px-3 py-2.5 text-right">Total spend</th>
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">Tickets</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">Prev</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">Δ Tickets</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">CPT</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">CPT Prev</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">Δ CPT</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">Revenue</th>
              ) : null}
              {!m.isBrandCampaign ? (
                <th className="px-3 py-2.5 text-right">ROAS</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-background text-foreground">
              <td className="px-3 py-2.5 font-medium tabular-nums">
                {fmtGBP(m.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                {fmtGBP(m.metaSpendWindow)}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                {fmtGBP(m.otherSpendWindow)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {fmtGBP(m.totalSpendWindow)}
              </td>
              {!m.isBrandCampaign ? (
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {fmtInt(m.ticketsWindow)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {fmtInt(m.ticketsPrev)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                  {fmtChange(m.ticketsChange)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {fmtGBP(m.cpt, 2)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {fmtGBP(m.cptPrev, 2)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td
                  className={`px-3 py-2.5 text-right tabular-nums ${cptChangeClass(m.cptChange)}`}
                >
                  {fmtCptChange(m.cptChange)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                  {fmtGBP(m.ticketRevenue)}
                </td>
              ) : null}
              {!m.isBrandCampaign ? (
                <td
                  className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}
                >
                  {fmtRoas(m.roas)}
                </td>
              ) : null}
            </tr>
          </tbody>
          {!m.isBrandCampaign ? (
            <thead>
            <tr className="bg-muted/20 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5" colSpan={4}>
                Pacing
              </th>
              <th className="px-3 py-2.5 text-right">Capacity</th>
              <th className="px-3 py-2.5 text-right">Sell-through</th>
              <th className="px-3 py-2.5 text-right" colSpan={2}>
                Tickets needed/day
              </th>
              <th className="px-3 py-2.5 text-right" colSpan={4}>
                Spend needed/day
              </th>
              <th className="px-3 py-2.5 text-right" colSpan={2} />
            </tr>
            </thead>
          ) : null}
          {!m.isBrandCampaign ? (
            <tbody>
            <tr className="border-t border-border bg-background text-foreground">
              <td className="px-3 py-2.5 text-muted-foreground" colSpan={4}>
                Based on lifetime running CPT for spend/day estimate.
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                {fmtInt(m.capacity)}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                {fmtPct(m.sellThroughPct)}
              </td>
              <td
                className="px-3 py-2.5 text-right font-semibold tabular-nums"
                colSpan={2}
              >
                {fmtInt(m.ticketsNeededPerDay)}
              </td>
              <td
                className="px-3 py-2.5 text-right font-semibold tabular-nums"
                colSpan={4}
              >
                {fmtGBP(m.spendNeededPerDay)}
              </td>
              <td className="px-3 py-2.5" colSpan={2} />
            </tr>
            </tbody>
          ) : null}
        </table>
      </div>
      {!m.isBrandCampaign ? (
        <p className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          CRM signup totals will replace Meta Regs when connected — Meta remains
          the fallback.
        </p>
      ) : null}
    </section>
  );
}

interface Metrics {
  adBudget: number | null;
  prereg: number | null;
  metaSpendWindow: number | null;
  otherSpendWindow: number;
  totalSpendWindow: number;
  ticketsWindow: number | null;
  ticketsPrev: number | null;
  ticketsChange: number | null;
  cpt: number | null;
  cptPrev: number | null;
  cptChange: number | null;
  ticketRevenue: number | null;
  roas: number | null;
  capacity: number | null;
  sellThroughPct: number | null;
  ticketsNeededPerDay: number | null;
  spendNeededPerDay: number | null;
  isBrandCampaign: boolean;
}

function computeMetrics(
  event: EventLike,
  timeline: TimelineRow[],
  timeframe: PerformanceSummaryTimeframe,
  additionalSpendEntries: ReadonlyArray<{ date: string; amount: number }>,
): Metrics {
  const window = windowDaySet(timeframe.datePreset, timeframe.customRange);
  const isBrandCampaign = event.kind === "brand_campaign";
  const cutoff = lookbackCutoff();

  let liveSpendAll = 0;
  let hasSpend = false;
  let ticketsAll = 0;
  let ticketsPrev = 0;
  let revenueAll = 0;
  let hasRevenue = false;
  let hasPrev = false;
  for (const r of timeline) {
    const paidSpend = paidSpendOf(r);
    if (paidSpend > 0 || r.ad_spend != null || r.tiktok_spend != null) {
      liveSpendAll += paidSpend;
      hasSpend = true;
    }
    if (r.tickets_sold != null) {
      ticketsAll += Number(r.tickets_sold);
      if (r.date < cutoff) {
        ticketsPrev += Number(r.tickets_sold);
        hasPrev = true;
      }
    }
    if (r.revenue != null) {
      revenueAll += Number(r.revenue);
      hasRevenue = true;
    }
  }

  const adBudget = event.budget_marketing;
  const prereg =
    event.prereg_spend != null ? Number(event.prereg_spend) : null;
  const tiktokLifetime = sumTikTokSpendTimeline(timeline, null);
  const metaLifetime =
    event.meta_spend_cached != null
      ? Number(event.meta_spend_cached) + tiktokLifetime
      : hasSpend
        ? liveSpendAll
        : null;

  let metaWindow: number | null = timeframe.metaSpend;
  if (metaWindow !== null) {
    metaWindow +=
      sumTikTokSpendTimeline(timeline, window) +
      Number(timeframe.additionalPlatformSpend ?? 0);
  }
  if (metaWindow === null) {
    metaWindow =
      window === null
        ? metaLifetime
        : sumSpendTimeline(timeline, window);
  }

  const otherLifetime = sumAdditionalSpendAmounts(additionalSpendEntries, null);
  const otherWindow = sumAdditionalSpendAmounts(
    additionalSpendEntries,
    window,
  );

  let ticketsWindow: number | null = timeframe.ticketsInWindow;
  if (ticketsWindow === null) {
    ticketsWindow =
      window === null
        ? ticketsAll
        : sumTicketsTimeline(timeline, window);
  }

  const revenueWindow =
    window === null
      ? hasRevenue
        ? revenueAll
        : null
      : (() => {
          let t = 0;
          let any = false;
          for (const r of timeline) {
            if (!window.has(r.date)) continue;
            if (r.revenue != null) {
              any = true;
              t += Number(r.revenue);
            }
          }
          return any ? t : 0;
        })();

  const pre = prereg ?? 0;
  const metaW = metaWindow ?? 0;
  const totalSpendWindow = pre + metaW + otherWindow;

  const cpt =
    totalSpendWindow > 0 && (ticketsWindow ?? 0) > 0
      ? totalSpendWindow / (ticketsWindow as number)
      : null;

  const totalForPrevCpt =
    metaLifetime != null || prereg != null
      ? (metaLifetime ?? 0) + (prereg ?? 0) + otherLifetime
      : null;
  const cptPrev =
    totalForPrevCpt != null &&
    totalForPrevCpt > 0 &&
    hasPrev &&
    ticketsPrev > 0
      ? totalForPrevCpt / ticketsPrev
      : null;
  const cptChange = cpt != null && cptPrev != null ? cpt - cptPrev : null;

  const roas =
    revenueWindow != null && totalSpendWindow > 0
      ? revenueWindow / totalSpendWindow
      : null;

  const capacity =
    event.capacity != null && event.capacity > 0 ? event.capacity : null;
  const ticketsForSellthrough =
    window === null ? ticketsAll : (ticketsWindow ?? 0);
  const sellThroughPct =
    capacity != null && ticketsForSellthrough >= 0
      ? (ticketsForSellthrough / capacity) * 100
      : null;

  const daysRem = fullDaysUntilEventUtc(event.event_date);
  const toGo =
    capacity != null ? Math.max(0, capacity - ticketsAll) : null;
  const ticketsNeededPerDay =
    daysRem != null && toGo != null && toGo > 0
      ? Math.ceil(toGo / daysRem)
      : null;

  const runningTotalSpend =
    (prereg ?? 0) +
    (metaLifetime ?? 0) +
    otherLifetime;
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

  return {
    adBudget,
    prereg,
    metaSpendWindow: metaWindow,
    otherSpendWindow: otherWindow,
    totalSpendWindow,
    ticketsWindow,
    ticketsPrev: hasPrev ? ticketsPrev : null,
    ticketsChange:
      window === null && hasPrev ? ticketsAll - ticketsPrev : null,
    cpt,
    cptPrev,
    cptChange,
    ticketRevenue: revenueWindow,
    roas,
    capacity,
    sellThroughPct,
    ticketsNeededPerDay,
    spendNeededPerDay,
    isBrandCampaign,
  };
}
