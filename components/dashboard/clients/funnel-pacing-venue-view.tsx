/**
 * components/dashboard/clients/funnel-pacing-venue-view.tsx
 *
 * Venue-scope Funnel Pacing view — visual-overhaul redesign.
 *
 * Top-to-bottom:
 *   1. Hero Status Bar      — tickets / spend / countdown / verdict
 *   2. Daily Spend Tracker  — trailing-14-day mini-bar (the missing piece)
 *   3. Stage performance    — funnel stage bars + interactive scrubber +
 *                             upgraded forward-projection chart (all share
 *                             the scrubber position so dragging re-renders
 *                             the bars and the current-pace line live)
 *   4. Spend vs Budget      — tightened reconciliation bar
 *   5. Pacing Verdict Card  — single actionable verdict + stat row
 *
 * Reads the canonical funnel struct produced by
 * `buildVenueCanonicalFunnel` (single source of truth, shared with the
 * Performance tab). The pacing-summary `row` is derived here once and
 * threaded into the hero + verdict so the verdict matches the canonical
 * `warning` field by construction.
 *
 * The removed "Settings" box, intro paragraph, Funnel Health strip,
 * sliding-scale card and backward-read table are folded into the chips,
 * tracker, scrubber and verdict card above.
 */

import type { VenueCanonicalFunnel } from "@/lib/dashboard/venue-canonical-funnel";
import { buildVenuePacingRow } from "@/lib/dashboard/venue-pacing-summary";
import { SpendVsBudgetBar } from "./spend-vs-budget-bar";
import { FunnelPacingInteractive } from "./funnel-pacing-interactive";
import { DailySpendTracker } from "./daily-spend-tracker";
import { HeroStatusBar } from "../pacing/hero-status-bar";
import { PacingVerdictCard } from "./pacing-verdict-card";

export function FunnelPacingVenueView({
  pacing,
  venueLabel,
  clientId,
  eventCode,
  eventDate,
}: {
  pacing: VenueCanonicalFunnel;
  venueLabel: string;
  /** Used by the Daily Spend Tracker to read the live Meta daily budget. */
  clientId: string;
  eventCode: string;
  /**
   * Resolved venue event date (the same value the page passed into
   * `buildVenueCanonicalFunnel`). Drives the projection chart's date
   * labels and x-axis window. `null` when no upcoming fixture date.
   */
  eventDate: string | null;
}) {
  const row = buildVenuePacingRow({
    funnel: pacing,
    eventCode,
    label: venueLabel,
    // Self-reference: the view is already on this venue's Funnel Pacing tab.
    href: `/clients/${clientId}/venues/${encodeURIComponent(eventCode)}?tab=pacing`,
  });

  return (
    <section className="space-y-5">
      <HeroStatusBar
        venueLabel={venueLabel}
        row={row}
        clientId={clientId}
        eventCode={eventCode}
      />

      <DailySpendTracker
        series={pacing.dailySpendSeries}
        requiredPerDay={pacing.spendReconciliation.requiredPerDay}
        remaining={pacing.spendReconciliation.remaining}
        daysToEvent={pacing.backwardRead.daysToEvent}
        clientId={clientId}
        eventCode={eventCode}
      />

      <FunnelPacingInteractive
        pacing={pacing}
        eventCode={eventCode}
        eventDate={eventDate}
      />

      <SpendVsBudgetBar
        reconciliation={pacing.spendReconciliation}
        daysToEvent={pacing.backwardRead.daysToEvent}
      />

      <PacingVerdictCard funnel={pacing} row={row} />
    </section>
  );
}
