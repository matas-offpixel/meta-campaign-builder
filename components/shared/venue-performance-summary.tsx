"use client";

import type { ReactNode } from "react";

import { fmtCurrencyCompact } from "@/lib/dashboard/format";

/**
 * components/shared/venue-performance-summary.tsx
 *
 * Single source of truth for the 4-card "Performance summary" grid used
 * across three surfaces:
 *
 *   1. Standalone venue full report
 *      (components/share/venue-full-report.tsx)
 *   2. Dashboard inline expanded venue card
 *      (components/share/client-portal-venue-table.tsx)
 *   3. Per-event Reporting tab (future — event-report-view.tsx when migrated)
 *
 * Props are normalised scalars so each surface computes its own domain
 * values and passes them in. The component owns only layout + null
 * handling + format helpers — no domain logic lives here.
 *
 * Slot props allow each surface to inject surface-specific widgets into
 * the Paid Media and Tickets cards without forking the component:
 *   - `dailySpendTrackerSlot` — daily budget tracker rows (venue full
 *     report uses VenuePaidMediaDailySpendTracker; client portal uses
 *     LazyVenueDailyBudget + pacing lines)
 *   - `pacingSlot` — pacing line(s) shown below ticket revenue
 */

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

function fmtNum(n: number): string {
  return NUM.format(n);
}
function fmtMoney(n: number): string {
  return GBP2.format(n);
}

export interface VenuePerformanceSummaryProps {
  /** Total marketing budget = paidMediaAllocated + additionalSpend. */
  totalMarketing: number | null;
  /** Paid media budget allocated (from event plan). */
  paidMediaAllocated: number | null;
  /** Additional / non-paid spend (influencer fees, OOH, etc.). */
  additionalSpend: number | null;
  /** Paid media spend to date (from ad platform rollups). */
  paidMediaSpent: number | null;
  /** Remaining paid media budget = paidMediaAllocated − paidMediaSpent. */
  paidMediaRemaining?: number | null;
  /** % of paid media budget used (0–100). */
  paidMediaUsedPct: number | null;

  /** Total ticket capacity across all linked events. */
  ticketsCapacity: number | null;
  /** Latest reported tickets sold. */
  ticketsSold: number | null;
  /** Sell-through % (0–100). */
  ticketsSellThroughPct: number | null;
  /** Latest ticket revenue. */
  ticketRevenue: number | null;

  /** Latest Mailchimp subscriber count for this venue's tag. */
  mailchimpRegistrations: number | null;
  /** Total spend ÷ mailchimpRegistrations. */
  costPerRegistration: number | null;
  /** Human-readable tag name shown as a footnote on the Registrations card. */
  mailchimpTag?: string | null;

  /**
   * Injected into the Paid Media card below the spent/allocated rows.
   * Venue full report passes <VenuePaidMediaDailySpendTracker />;
   * client portal passes <LazyVenueDailyBudget /> + pacing lines.
   */
  dailySpendTrackerSlot?: ReactNode;

  /**
   * Injected into the Tickets card below the revenue line.
   * Client portal passes its "Pacing: N tickets/day · £X/day" line.
   */
  pacingSlot?: ReactNode;

  /** Optional section title. Defaults to "Performance summary". */
  title?: string;
}

export function VenuePerformanceSummary({
  totalMarketing,
  paidMediaAllocated,
  additionalSpend,
  paidMediaSpent,
  paidMediaRemaining,
  paidMediaUsedPct,
  ticketsCapacity,
  ticketsSold,
  ticketsSellThroughPct,
  ticketRevenue,
  mailchimpRegistrations,
  costPerRegistration,
  mailchimpTag,
  dailySpendTrackerSlot,
  pacingSlot,
  title = "Performance summary",
}: VenuePerformanceSummaryProps) {
  return (
    <section className="space-y-3" data-testid="venue-performance-summary">
      <h2 className="font-heading text-base tracking-wide text-foreground">
        {title}
      </h2>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        {/* ── Total marketing ─────────────────────────────────────── */}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Total marketing
          </p>
          <p className="mt-3 font-heading text-xl tracking-wide tabular-nums text-foreground">
            {totalMarketing != null && totalMarketing > 0 ? (
              <>
                {fmtCurrencyCompact(totalMarketing)}
                {paidMediaAllocated != null && additionalSpend != null && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    · {fmtCurrencyCompact(paidMediaAllocated)} Paid media +{" "}
                    {fmtCurrencyCompact(additionalSpend)} Additional
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </p>
          {/* Spend-to-date footnote — client portal surfaces this; full report omits it. */}
          {paidMediaSpent != null && paidMediaSpent > 0 && totalMarketing != null ? (
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              Total spend to date: {fmtMoney(paidMediaSpent)}
            </p>
          ) : null}
        </div>

        {/* ── Paid media ──────────────────────────────────────────── */}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Paid media
          </p>
          <div className="mt-3 space-y-1 text-foreground">
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {paidMediaAllocated != null && paidMediaAllocated > 0 ? (
                <>
                  {fmtCurrencyCompact(paidMediaAllocated)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    Allocated
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {paidMediaSpent != null && paidMediaSpent > 0 ? (
                <>
                  {fmtCurrencyCompact(paidMediaSpent)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    Spent
                    {paidMediaUsedPct != null
                      ? ` (${paidMediaUsedPct.toFixed(0)}%)`
                      : ""}
                  </span>
                  {paidMediaRemaining != null ? (
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      ({fmtCurrencyCompact(paidMediaRemaining)} remaining)
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
          {/* Surface-specific daily budget tracker or pacing widget. */}
          {dailySpendTrackerSlot}
        </div>

        {/* ── Tickets ─────────────────────────────────────────────── */}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tickets
          </p>
          <div className="mt-3 space-y-2 text-foreground">
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {ticketsSold != null ? (
                ticketsCapacity != null ? (
                  <>
                    {fmtNum(ticketsSold)} / {fmtNum(ticketsCapacity)} sold
                    {ticketsSellThroughPct != null ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        ({ticketsSellThroughPct.toFixed(1)}%)
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>{fmtNum(ticketsSold)} sold</>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Revenue:</span>{" "}
              {ticketRevenue != null && ticketRevenue > 0
                ? fmtMoney(ticketRevenue)
                : "—"}
            </p>
            {/* Surface-specific pacing line. */}
            {pacingSlot}
          </div>
        </div>

        {/* ── Registrations ───────────────────────────────────────── */}
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Registrations
          </p>
          <div className="mt-3 space-y-2 text-foreground">
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {mailchimpRegistrations != null ? (
                <>{fmtNum(mailchimpRegistrations)}</>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            {costPerRegistration != null ? (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {fmtMoney(costPerRegistration)} cost per reg
              </p>
            ) : mailchimpRegistrations === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                0 registrations
              </p>
            ) : null}
            {mailchimpTag ? (
              <p className="text-[10px] text-muted-foreground/70">
                · Tagged: {mailchimpTag}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
