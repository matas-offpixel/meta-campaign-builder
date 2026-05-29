/**
 * components/dashboard/pacing/hero-status-bar.tsx
 *
 * Full-width hero status bar for the Funnel Pacing tab. Four segments —
 * tickets sold, spend deployed, days to event, pacing verdict — each
 * with a large hero number, a faint bar fill behind, and a floating
 * benchmark-vs-actual chip top-right.
 *
 * Pure presentation server component. All values derive from the
 * canonical funnel + the pacing-summary row passed in.
 */

import {
  inverseTone,
  toneColors,
  verdictPresentation,
  type PacingTone,
} from "@/lib/dashboard/pacing-presentation";
import { getFunnelBenchmarks } from "@/lib/dashboard/benchmarks";
import type { VenuePacingRow } from "@/lib/dashboard/venue-pacing-summary";
import { BenchmarkChip, TargetChip } from "./benchmark-chip";
import { HeroDailyBudgetReadout } from "./hero-daily-budget-readout";

const NUM = new Intl.NumberFormat("en-GB");
const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const PCT0 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0,
});

export function HeroStatusBar({
  venueLabel,
  row,
  clientId,
  eventCode,
}: {
  venueLabel: string;
  row: VenuePacingRow;
  /** For the live Meta daily-budget readout in the Days-to-event segment. */
  clientId: string;
  eventCode: string;
}) {
  const bench = getFunnelBenchmarks();
  const verdict = verdictPresentation(row.verdict);
  const ticketsRemaining = Math.max(0, row.capacity - row.ticketsSold);

  return (
    <section
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      data-testid="funnel-pacing-hero"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Funnel Pacing
          </p>
          <h2 className="mt-0.5 font-heading text-2xl tracking-wide">
            {venueLabel}
          </h2>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Benchmarks {PCT0.format(bench.reachToClick)} /{" "}
          {PCT0.format(bench.clickToLpv)} / {PCT0.format(bench.lpvToTicket)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Tickets sold */}
        <HeroSegment
          label="Tickets sold"
          hero={NUM.format(row.ticketsSold)}
          sub={`${NUM.format(ticketsRemaining)} remaining of ${NUM.format(row.capacity)}`}
          fill={row.soldFraction}
          tone={
            row.verdict === "under_pacing"
              ? "below"
              : row.verdict === "over_pacing"
                ? "within"
                : "above"
          }
          chip={
            <BenchmarkChip
              tone={
                row.verdict === "under_pacing"
                  ? "below"
                  : row.verdict === "over_pacing"
                    ? "within"
                    : "above"
              }
              delta={null}
              label={`${PCT0.format(row.soldFraction)} sold`}
            />
          }
        />

        {/* Spend deployed */}
        <HeroSegment
          label="Spend deployed"
          hero={GBP0.format(Math.round(row.spent))}
          sub={
            row.allocated != null
              ? `of ${GBP0.format(Math.round(row.allocated))}`
              : "no budget set"
          }
          fill={row.spendFraction ?? 0}
          tone="neutral"
          chip={
            row.spendFraction != null ? (
              <TargetChip
                label={`${PCT0.format(row.spendFraction)} deployed`}
              />
            ) : null
          }
        />

        {/* Days to event */}
        <HeroSegment
          label="Days to event"
          hero={
            row.daysToEvent == null
              ? "—"
              : row.daysToEvent < 0
                ? "Past"
                : NUM.format(row.daysToEvent)
          }
          sub={
            <HeroDailyBudgetReadout
              clientId={clientId}
              eventCode={eventCode}
              requiredPerDay={row.requiredPerDay}
            />
          }
          fill={0}
          tone="neutral"
          chip={
            row.liveCostPerTicket != null ? (
              <BenchmarkChip
                tone={inverseTone(
                  row.liveCostPerTicket,
                  bench.benchmarkCostPerTicket,
                )}
                delta={null}
                label={`${GBP2.format(row.liveCostPerTicket)} CPT`}
              />
            ) : null
          }
        />

        {/* Pacing verdict */}
        <HeroSegment
          label="Pacing verdict"
          hero={`${verdict.emoji}`}
          heroClassName="text-[40px] leading-none"
          sub={verdict.short}
          fill={0}
          tone={verdict.tone}
          chip={
            <TargetChip tone={verdict.tone} label={verdictChipLabel(row)} />
          }
        />
      </div>
    </section>
  );
}

function verdictChipLabel(row: VenuePacingRow): string {
  if (row.verdict === "under_pacing" && row.requiredPerDay != null) {
    return `${GBP0.format(Math.round(row.requiredPerDay))}/day to recover`;
  }
  if (row.verdict === "sold_out") return "capacity reached";
  if (row.verdict === "over_pacing") return "consider tapering";
  if (row.verdict === "on_track") return "on benchmark";
  return "—";
}

function HeroSegment({
  label,
  hero,
  heroClassName = "",
  sub,
  fill,
  tone,
  chip,
}: {
  label: string;
  hero: string;
  heroClassName?: string;
  sub: React.ReactNode;
  fill: number;
  tone: PacingTone;
  chip: React.ReactNode;
}) {
  const c = toneColors(tone);
  const fillPct = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface/40 p-4">
      {/* faint bar fill behind */}
      {fillPct > 0 && (
        <div
          className={`absolute inset-y-0 left-0 ${c.surface}`}
          style={{ width: `${fillPct}%` }}
          aria-hidden
        />
      )}
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {chip}
        </div>
        <p
          className={`mt-2 font-heading tabular-nums tracking-wide ${heroClassName || "text-[32px] leading-none"}`}
        >
          {hero}
        </p>
        {typeof sub === "string" ? (
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {sub}
          </p>
        ) : (
          sub
        )}
      </div>
    </div>
  );
}
