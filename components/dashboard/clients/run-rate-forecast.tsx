/**
 * components/dashboard/clients/run-rate-forecast.tsx
 *
 * Run Rate Forecast (Workstream C of the WC26 reconciliation).
 *
 * Sales-rate projection mirroring the Excel cross-reference: a single
 * horizontal capacity bar with markers for current sold, the straight-
 * line baseline projection, and four capacity-uplift surge scenarios
 * (+15 / +25 / +35 / +50%). Below the bar, a readout chip per scenario
 * with its "+N tickets vs baseline" delta and sell-through %.
 *
 * Pure server component — all numbers come from `pacing.runRate`
 * (canonical funnel), no new data and no client interactivity. Tooltips
 * use native `title` so it stays SSR-safe.
 *
 * Reads the Northbeam visual language shared by the other pacing cards
 * (border-border / bg-card / font-heading / tabular-nums chips).
 */

import type { VenueRunRateForecast } from "@/lib/dashboard/venue-canonical-funnel";

const NUM = new Intl.NumberFormat("en-GB");
const PCT0 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0,
});
const DEC1 = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

/** Deepening tints for the four surge scenarios (Tailwind opacity steps). */
const SURGE_TINTS = [
  "bg-foreground/15",
  "bg-foreground/25",
  "bg-foreground/35",
  "bg-foreground/50",
] as const;

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function RunRateForecast({
  runRate,
  capacity,
  currentSold,
}: {
  runRate: VenueRunRateForecast;
  capacity: number;
  /** Current tickets sold — the solid anchor marker on the bar. */
  currentSold: number;
}) {
  const hasCapacity = capacity > 0;
  const soldPct = hasCapacity ? clampPct((currentSold / capacity) * 100) : 0;
  const baselinePct =
    hasCapacity && runRate.baselineProjected != null
      ? clampPct((runRate.baselineProjected / capacity) * 100)
      : null;

  const subtitle = (() => {
    if (runRate.avgDailySalesToDate == null) {
      return "Awaiting first sales — projection unavailable.";
    }
    const rate = `${DEC1.format(runRate.avgDailySalesToDate)} tickets/day`;
    const elapsed =
      runRate.daysElapsed != null ? `over ${runRate.daysElapsed}d` : "";
    const remaining =
      runRate.daysRemaining != null
        ? ` · ${NUM.format(runRate.daysRemaining)}d remaining`
        : "";
    return `Running at ${rate} ${elapsed}${remaining}`.trim();
  })();

  return (
    <article
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      data-testid="funnel-pacing-run-rate"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Run Rate Forecast
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            Projected sell-through
          </h3>
        </div>
        <p className="text-[12px] text-muted-foreground">{subtitle}</p>
      </div>

      {/* Capacity bar: 0 → capacity, with sold fill + projection markers. */}
      <div
        className="relative h-9 w-full overflow-hidden rounded-lg bg-muted"
        role="img"
        aria-label={
          baselinePct != null
            ? `Current sold ${NUM.format(currentSold)} of ${NUM.format(
                capacity,
              )}. Baseline projected ${NUM.format(
                runRate.baselineProjected ?? 0,
              )}.`
            : `Current sold ${NUM.format(currentSold)} of ${NUM.format(
                capacity,
              )}.`
        }
      >
        {/* Surge overlays (lightest → deepest), each from baseline up to
            the scenario projection. Rendered behind the sold fill. */}
        {baselinePct != null &&
          runRate.surge.map((s, i) => {
            if (s.sellThroughFraction == null) return null;
            const sPct = clampPct(s.sellThroughFraction * 100);
            if (sPct <= baselinePct) return null;
            return (
              <div
                key={s.uplift}
                className={`absolute top-0 h-full ${SURGE_TINTS[i] ?? "bg-foreground/20"}`}
                style={{ left: `${baselinePct}%`, width: `${sPct - baselinePct}%` }}
                title={`+${PCT0.format(s.uplift)} surge → ${NUM.format(
                  s.projected,
                )} tickets (${
                  s.sellThroughFraction != null
                    ? PCT0.format(s.sellThroughFraction)
                    : "—"
                } of capacity)`}
                aria-hidden
              />
            );
          })}

        {/* Current sold fill (solid). */}
        <div
          className="relative h-full bg-foreground/85"
          style={{ width: `${soldPct}%` }}
          title={`Sold ${NUM.format(currentSold)} (${
            hasCapacity ? PCT0.format(currentSold / capacity) : "—"
          } of capacity)`}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
          {soldPct > 18 && (
            <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-medium tabular-nums text-background">
              Sold {NUM.format(currentSold)}
            </span>
          )}
        </div>

        {/* Baseline projected divider (dashed). */}
        {baselinePct != null && (
          <div
            className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 border-l-2 border-dashed border-foreground"
            style={{ left: `${baselinePct}%` }}
            title={`Baseline projected ${NUM.format(
              runRate.baselineProjected ?? 0,
            )} (${
              runRate.baselineSellThroughFraction != null
                ? PCT0.format(runRate.baselineSellThroughFraction)
                : "—"
            } of capacity)`}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>0</span>
        <span>Capacity {NUM.format(capacity)}</span>
      </div>

      {/* Readout chips: baseline + four surge scenarios. */}
      {baselinePct != null ? (
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <ReadoutChip
            label="Baseline"
            tickets={runRate.baselineProjected ?? 0}
            delta={null}
            sellThrough={runRate.baselineSellThroughFraction}
            emphasis
          />
          {runRate.surge.map((s) => (
            <ReadoutChip
              key={s.uplift}
              label={`+${PCT0.format(s.uplift)}`}
              tickets={s.projected}
              delta={s.deltaVsBaseline}
              sellThrough={s.sellThroughFraction}
            />
          ))}
        </div>
      ) : (
        <p className="mt-5 text-[13px] text-muted-foreground">
          Projection unlocks once the first sales and an event date are
          recorded.
        </p>
      )}
    </article>
  );
}

function ReadoutChip({
  label,
  tickets,
  delta,
  sellThrough,
  emphasis = false,
}: {
  label: string;
  tickets: number;
  /** "+N tickets" vs baseline; null for the baseline chip itself. */
  delta: number | null;
  sellThrough: number | null;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        emphasis ? "border-foreground/30 bg-surface/60" : "border-border bg-surface/40"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-lg tracking-wide tabular-nums">
        {NUM.format(tickets)}
      </p>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {sellThrough != null ? PCT0.format(sellThrough) : "—"} of cap
        {delta != null && delta > 0 ? (
          <span className="ml-1 text-foreground/70">
            +{NUM.format(delta)}
          </span>
        ) : null}
      </p>
    </div>
  );
}
