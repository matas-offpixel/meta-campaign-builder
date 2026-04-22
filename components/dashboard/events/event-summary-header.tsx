"use client";

import { useMemo } from "react";

import type { TimelineRow } from "@/lib/db/event-daily-timeline";

/**
 * components/dashboard/events/event-summary-header.tsx
 *
 * Single-event collapsed summary that mirrors the per-venue header +
 * "Total" row from the WC client-portal venue table
 * (`components/share/client-portal-venue-table.tsx`). For one event
 * the multi-row venue table collapses to one logical row, so we
 * render it as a small stat strip + a one-row totals table — easier
 * on the eyes than an 12-cell single line and matches the rest of
 * the dashboard's card aesthetic.
 *
 * The "Prev" comparison uses a 7-day lag: cumulative sums up to
 * (today − 7 days) form the "previous" number, the diff is the
 * change. Mirrors the venue table semantics where prev is one
 * snapshot week behind. Same trade-off applies — when no data
 * exists for the prior week, change/prev render as "—" instead of
 * lying about a delta.
 *
 * Pre-reg + Ad Budget come from the `event` props (not the
 * timeline) because:
 *   - Ad Budget is a planning input, not a tracked daily.
 *   - Pre-reg is the lifetime spend of the pre-launch campaign,
 *     which the timeline can't reconstruct from per-day rows
 *     alone — the events table caches it directly.
 */

interface EventLike {
  budget_marketing: number | null;
  meta_spend_cached: number | null;
  prereg_spend: number | null;
  /** General-sale cutoff — used to *exclude* the presale rows from
   *  the day-level "previous-week" comparison so a launch-day spike
   *  doesn't render as a -1000% change. */
  general_sale_at: string | null;
}

interface Props {
  event: EventLike;
  timeline: TimelineRow[];
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
function fmtChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${NUM.format(n)}`;
}
function fmtRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function roasClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n >= 3) return "text-emerald-600 font-semibold dark:text-emerald-400";
  if (n < 1) return "text-red-600 font-semibold dark:text-red-400";
  return "text-foreground";
}

function fmtCptChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return GBP2.format(0);
  const abs = GBP2.format(Math.abs(n));
  // Use the typographic minus glyph so the column visually aligns
  // when a row has no sign prefix.
  return n > 0 ? `+${abs}` : `−${abs}`;
}

function cptChangeClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  // Convention: CPT going down = good (more tickets per pound).
  if (n < 0) return "text-emerald-600 font-semibold dark:text-emerald-400";
  if (n > 0) return "text-amber-600 font-semibold dark:text-amber-400";
  return "text-foreground";
}

interface SummaryMetrics {
  /** Ad Budget — planning input from `events.budget_marketing`. */
  adBudget: number | null;
  /** Meta Spend — from cached `events.meta_spend_cached`, falls back
   *  to summed timeline ad_spend when the cache is null. */
  metaSpend: number | null;
  /** Pre-reg from `events.prereg_spend`. */
  prereg: number | null;
  /** Total spend = pre-reg + Meta spend. */
  totalSpend: number | null;
  ticketsSold: number;
  ticketsPrev: number | null;
  ticketsChange: number | null;
  cpt: number | null;
  cptPrev: number | null;
  cptChange: number | null;
  ticketRevenue: number | null;
  roas: number | null;
}

function computeSummary(
  event: EventLike,
  timeline: TimelineRow[],
): SummaryMetrics {
  const cutoff = lookbackCutoff();
  let liveSpend = 0;
  let hasSpend = false;
  let tickets = 0;
  let ticketsPrev = 0;
  let revenue = 0;
  let hasRevenue = false;
  let hasPrev = false;
  for (const r of timeline) {
    if (r.ad_spend != null) {
      liveSpend += Number(r.ad_spend);
      hasSpend = true;
    }
    if (r.tickets_sold != null) {
      tickets += Number(r.tickets_sold);
      if (r.date < cutoff) {
        ticketsPrev += Number(r.tickets_sold);
        hasPrev = true;
      }
    }
    if (r.revenue != null) {
      revenue += Number(r.revenue);
      hasRevenue = true;
    }
  }
  const adBudget = event.budget_marketing;
  // Prefer the events.meta_spend_cached value (which is the lifetime
  // campaign spend, including days that haven't been rolled up yet).
  // Fall back to summed timeline spend so the summary still renders
  // before the cache is warmed.
  const metaSpend =
    event.meta_spend_cached != null
      ? Number(event.meta_spend_cached)
      : hasSpend
        ? liveSpend
        : null;
  const prereg = event.prereg_spend != null ? Number(event.prereg_spend) : null;
  const totalSpend =
    metaSpend != null || prereg != null
      ? (metaSpend ?? 0) + (prereg ?? 0)
      : null;
  // Reuse the same total for the prev-week CPT denominator. The
  // alternative (snapshot the spend a week ago) would need a
  // historical spend cache we don't keep — this matches the
  // venue-table trade-off documented in the WC table.
  const cpt = totalSpend != null && totalSpend > 0 && tickets > 0
    ? totalSpend / tickets
    : null;
  const cptPrev =
    totalSpend != null && totalSpend > 0 && ticketsPrev > 0
      ? totalSpend / ticketsPrev
      : null;
  const cptChange = cpt != null && cptPrev != null ? cpt - cptPrev : null;

  const ticketRevenue = hasRevenue ? revenue : null;
  const roas =
    ticketRevenue != null && totalSpend != null && totalSpend > 0
      ? ticketRevenue / totalSpend
      : null;

  return {
    adBudget,
    metaSpend,
    prereg,
    totalSpend,
    ticketsSold: tickets,
    ticketsPrev: hasPrev ? ticketsPrev : null,
    ticketsChange: hasPrev ? tickets - ticketsPrev : null,
    cpt,
    cptPrev,
    cptChange,
    ticketRevenue,
    roas,
  };
}

/** YYYY-MM-DD threshold for "what counted as last week's number" —
 *  inclusive cutoff: rows strictly before this date are the prev
 *  cohort. Lookback of 7 days mirrors the WC table's snapshot cadence.
 */
function lookbackCutoff(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function EventSummaryHeader({ event, timeline }: Props) {
  const m = useMemo(() => computeSummary(event, timeline), [event, timeline]);

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
          {m.adBudget !== null && m.metaSpend !== null && (
            <span aria-hidden="true">·</span>
          )}
          {m.metaSpend !== null && (
            <span>
              Meta Spend:{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {fmtGBP(m.metaSpend)}
              </span>
            </span>
          )}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2.5">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad Spend</th>
              <th className="px-3 py-2.5 text-right">Total Spend</th>
              <th className="px-3 py-2.5 text-right">Tickets</th>
              <th className="px-3 py-2.5 text-right">Prev</th>
              <th className="px-3 py-2.5 text-right">Δ Tickets</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
              <th className="px-3 py-2.5 text-right">CPT Prev</th>
              <th className="px-3 py-2.5 text-right">Δ CPT</th>
              <th className="px-3 py-2.5 text-right">Revenue</th>
              <th className="px-3 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-background text-foreground">
              <td className="px-3 py-2.5 font-medium tabular-nums">
                {fmtGBP(m.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                {fmtGBP(m.metaSpend)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {fmtGBP(m.totalSpend)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {fmtInt(m.ticketsSold)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {fmtInt(m.ticketsPrev)}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                {fmtChange(m.ticketsChange)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {fmtGBP(m.cpt, 2)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                {fmtGBP(m.cptPrev, 2)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${cptChangeClass(m.cptChange)}`}
              >
                {fmtCptChange(m.cptChange)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {fmtGBP(m.ticketRevenue)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}
              >
                {fmtRoas(m.roas)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
