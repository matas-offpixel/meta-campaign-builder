/**
 * components/dashboard/clients/pacing-verdict-card.tsx
 *
 * Pacing Verdict Card (visual-overhaul PR) — replaces the old "Backward
 * Read" table with a single big actionable verdict + a 4-tile stat row.
 * Pure server component; reads canonical funnel + the pacing-summary row.
 */

import type { VenueCanonicalFunnel } from "@/lib/dashboard/venue-canonical-funnel";
import type { VenuePacingRow } from "@/lib/dashboard/venue-pacing-summary";
import {
  toneColors,
  verdictPresentation,
} from "@/lib/dashboard/pacing-presentation";
import { TargetChip } from "../pacing/benchmark-chip";

const NUM = new Intl.NumberFormat("en-GB");
const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function eventDateLabel(daysToEvent: number | null): string {
  if (daysToEvent == null) return "the event date";
  const d = new Date(Date.now() + daysToEvent * 86_400_000);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function headline(row: VenuePacingRow, funnel: VenueCanonicalFunnel): string {
  const days = row.daysToEvent;
  if (row.verdict === "under_pacing") {
    const amount = funnel.spendReconciliation.warningAmount;
    if (amount != null && days != null && days > 0) {
      return `Need to add ${GBP0.format(Math.round(amount))} over the next ${days} days to hit capacity.`;
    }
    return "Spend is behind the pace required to sell out by event date.";
  }
  if (row.verdict === "over_pacing") {
    const over =
      row.spentPerDay != null && row.requiredPerDay != null
        ? row.spentPerDay - row.requiredPerDay
        : null;
    return over != null
      ? `Currently outspending required by ${GBP0.format(Math.round(over))}/day — consider tapering to ${GBP0.format(Math.round(row.requiredPerDay ?? 0))}/day to optimise CPT.`
      : "Outspending the required pace — consider tapering to optimise CPT.";
  }
  if (row.verdict === "on_track") {
    return `Projected to sell out around ${eventDateLabel(days)} at the current pace.`;
  }
  if (row.verdict === "sold_out") return "Capacity reached — campaign complete.";
  if (row.verdict === "event_passed") return "Event date has passed.";
  return "Not enough data to compute a pacing verdict yet.";
}

export function PacingVerdictCard({
  funnel,
  row,
}: {
  funnel: VenueCanonicalFunnel;
  row: VenuePacingRow;
}) {
  const v = verdictPresentation(row.verdict);
  const c = toneColors(v.tone);
  const achieved = funnel.backwardRead.achievedDailyPace;

  return (
    <article
      className={`rounded-xl border ${c.border} ${c.surface} p-5 shadow-sm sm:p-6`}
      data-testid="funnel-pacing-verdict"
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none" aria-hidden>
          {v.emoji}
        </span>
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${c.chipText}`}>
            {v.short}
          </p>
          <p className="mt-1 text-lg font-medium leading-snug">
            {headline(row, funnel)}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <VerdictStat
          label="Days to event"
          value={
            row.daysToEvent == null
              ? "—"
              : row.daysToEvent < 0
                ? "Past"
                : NUM.format(row.daysToEvent)
          }
        />
        <VerdictStat
          label="Tickets remaining"
          value={NUM.format(funnel.backwardRead.ticketsRemaining)}
        />
        <VerdictStat
          label="Required / day"
          value={
            row.requiredPerDay == null
              ? "—"
              : GBP0.format(Math.round(row.requiredPerDay))
          }
          chip={
            row.requiredPerDay != null ? (
              <TargetChip tone={v.tone} label="to sell out" />
            ) : null
          }
        />
        <VerdictStat
          label="Actual 14d avg / day"
          value={
            row.spentPerDay == null
              ? "—"
              : GBP0.format(Math.round(row.spentPerDay))
          }
          chip={
            achieved != null ? (
              <TargetChip label={`${NUM.format(Math.round(achieved))} tix/day`} />
            ) : null
          }
        />
      </div>
    </article>
  );
}

function VerdictStat({
  label,
  value,
  chip,
}: {
  label: string;
  value: string;
  chip?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-xl tracking-wide tabular-nums">
        {value}
      </p>
      {chip ? <div className="mt-1.5">{chip}</div> : null}
    </div>
  );
}
