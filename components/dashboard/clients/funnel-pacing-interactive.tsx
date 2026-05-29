"use client";

/**
 * components/dashboard/clients/funnel-pacing-interactive.tsx
 *
 * The interactive heart of the Funnel Pacing tab (visual-overhaul PR).
 * Holds the spend-scrubber state and drives BOTH the funnel stage bars
 * and the forward-projection chart from it, so dragging the scrubber
 * re-renders all four stage bars and the current-pace line live.
 *
 * Pure presentation over the canonical funnel already on the page. The
 * scrubber projects funnel volumes forward via the shared, tested
 * `projectFunnelVolumes` helper — no new queries, no new model.
 *
 * SSR-safe: the scrubber position is read from a localStorage-backed
 * external store whose server snapshot is the deterministic default
 * (current pace), so there is no hydration mismatch.
 */

import { useMemo, useSyncExternalStore } from "react";

import type { VenueCanonicalFunnel } from "@/lib/dashboard/venue-canonical-funnel";
import {
  projectFunnelVolumes,
  type ProjectedStageVolume,
} from "@/lib/dashboard/venue-pacing-summary";
import {
  deltaFraction,
  pacingTone,
  toneColors,
  type PacingTone,
} from "@/lib/dashboard/pacing-presentation";
import { BenchmarkChip } from "../pacing/benchmark-chip";
import { FunnelProjectionChart } from "./funnel-projection-chart";

const NUM = new Intl.NumberFormat("en-GB");
const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const PCT1 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// ── numeric localStorage store (scrubber position) ────────────────────────
const numCache = new Map<string, number>();
const numListeners = new Map<string, Set<() => void>>();

function readNum(key: string, fallback: number): number {
  if (numCache.has(key)) return numCache.get(key)!;
  try {
    const v = window.localStorage.getItem(key);
    if (v != null) {
      const n = Number(v);
      if (Number.isFinite(n)) {
        numCache.set(key, n);
        return n;
      }
    }
  } catch {
    /* unavailable */
  }
  numCache.set(key, fallback);
  return fallback;
}
function setNum(key: string, next: number) {
  numCache.set(key, next);
  try {
    window.localStorage.setItem(key, String(next));
  } catch {
    /* ignore */
  }
  numListeners.get(key)?.forEach((l) => l());
}
function subscribeNum(key: string, cb: () => void) {
  let set = numListeners.get(key);
  if (!set) {
    set = new Set();
    numListeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

const STAGE_META: Record<
  ProjectedStageVolume["key"],
  { metric: string; edge: string }
> = {
  reach: { metric: "Reach", edge: "Reach → Click" },
  clicks: { metric: "Clicks", edge: "Click → LPV" },
  lpv: { metric: "LPV", edge: "LPV → Ticket" },
  purchases: { metric: "Purchases", edge: "Sold of capacity" },
};

export function FunnelPacingInteractive({
  pacing,
  eventCode,
  eventDate,
}: {
  pacing: VenueCanonicalFunnel;
  eventCode: string;
  eventDate: string | null;
}) {
  const sr = pacing.spendReconciliation;
  const days = pacing.backwardRead.daysToEvent ?? 0;
  const ticketsRemaining = pacing.backwardRead.ticketsRemaining;
  const benchmarkCpt = pacing.slidingScale.benchmarkCostPerTicket;

  const currentDaily = sr.spentPerDay ?? 0;
  const requiredDaily = sr.requiredPerDay;
  const suggestedDaily =
    days > 0 ? (ticketsRemaining * benchmarkCpt) / days : null;

  // Scrubber range: 0 → comfortably past the most demanding preset.
  const maxSensible = Math.max(
    50,
    Math.ceil(
      (Math.max(
        currentDaily,
        requiredDaily ?? 0,
        suggestedDaily ?? 0,
      ) *
        2) /
        10,
    ) * 10,
  );
  const defaultPos = Math.round(currentDaily > 0 ? currentDaily : (requiredDaily ?? maxSensible / 2));

  const storageKey = `funnel-scrubber-pos-${eventCode}`;
  const scrubberDaily = useSyncExternalStore(
    (cb) => subscribeNum(storageKey, cb),
    () => readNum(storageKey, defaultPos),
    () => defaultPos,
  );
  const clampedDaily = Math.min(maxSensible, Math.max(0, scrubberDaily));

  const projection = useMemo(
    () => projectFunnelVolumes(pacing, clampedDaily),
    [pacing, clampedDaily],
  );
  const currentProjection = useMemo(
    () => projectFunnelVolumes(pacing, currentDaily),
    [pacing, currentDaily],
  );

  const interactive = days > 0 && ticketsRemaining > 0;

  // Scrubber delta read-out (vs current pace).
  const additionalVsCurrent = (clampedDaily - currentDaily) * days;
  const ticketsVsCurrent =
    projection.projectedTickets - currentProjection.projectedTickets;
  const cpt = sr.liveCostPerTicket ?? benchmarkCpt;
  const daysToSelloutAt = (daily: number): number | null => {
    if (daily <= 0 || cpt <= 0 || ticketsRemaining <= 0) return null;
    return (ticketsRemaining * cpt) / daily;
  };
  const selloutAtScrubber = daysToSelloutAt(clampedDaily);
  const selloutEarlyDays =
    selloutAtScrubber != null && days > 0
      ? Math.round(days - selloutAtScrubber)
      : null;

  // Budget context for the scrubber (Task 3): total spend at the chosen pace
  // and where the allocated budget sits on the £/day axis. The daily rate
  // that exactly exhausts the remaining budget over the remaining days is the
  // ceiling beyond which the projected total overshoots allocated.
  const allocated = sr.allocated;
  const totalAtPace = clampedDaily * days + sr.spent;
  const budgetCeilingDaily =
    allocated != null && sr.remaining != null && days > 0
      ? Math.max(0, sr.remaining / days)
      : null;
  const overAllocated = allocated != null && totalAtPace > allocated;
  const overBy = allocated != null ? totalAtPace - allocated : 0;

  return (
    <article
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      data-testid="funnel-pacing-stage-bars"
    >
      <div className="mb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Funnel
        </p>
        <h3 className="mt-1 font-heading text-xl tracking-wide">
          Stage performance
        </h3>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Bars fill to the capacity-derived target; the tick marks
          today&apos;s position. Drag the scrubber to project forward at a
          chosen daily spend.
        </p>
      </div>

      {/* Scrubber — sits above the stage bars so spend context comes first */}
      {interactive ? (
        <div className="mb-6 border-b border-border pb-5" data-testid="funnel-pacing-scrubber">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm">
              At{" "}
              <span className="font-semibold tabular-nums">
                {GBP0.format(Math.round(clampedDaily))}/day
              </span>
              , projected to sell{" "}
              <span className="font-semibold tabular-nums">
                {NUM.format(Math.round(projection.projectedTickets))}
              </span>{" "}
              tickets by event date{" "}
              <span className="text-muted-foreground">
                ({Math.round(projection.projectedSoldFraction * 100)}% of
                capacity)
              </span>
            </p>
          </div>

          <p
            className={`mt-1 text-xs tabular-nums ${overAllocated ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
          >
            Total spend at this pace:{" "}
            <span className="font-semibold">
              {GBP0.format(Math.round(totalAtPace))}
            </span>{" "}
            over {NUM.format(days)} day{days === 1 ? "" : "s"} remaining
            {overAllocated
              ? ` — +${GBP0.format(Math.round(overBy))} over allocated budget`
              : allocated != null
                ? ` (within ${GBP0.format(Math.round(allocated))} allocated)`
                : ""}
          </p>

          <ScrubberTrack
            value={clampedDaily}
            max={maxSensible}
            onChange={(v) => setNum(storageKey, v)}
            currentDaily={currentDaily}
            requiredDaily={requiredDaily}
            suggestedDaily={suggestedDaily}
            budgetCeilingDaily={budgetCeilingDaily}
          />

          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {additionalVsCurrent >= 0 ? "+" : ""}
            {GBP0.format(Math.round(additionalVsCurrent))} additional spend
            {" = "}
            {ticketsVsCurrent >= 0 ? "+" : ""}
            {NUM.format(Math.round(ticketsVsCurrent))} projected tickets
            {selloutEarlyDays != null && selloutEarlyDays > 0
              ? ` = sellout ${selloutEarlyDays} day${selloutEarlyDays === 1 ? "" : "s"} early`
              : selloutAtScrubber == null
                ? ""
                : " = short of sellout"}
          </p>
        </div>
      ) : null}

      {/* Stage bars — below the scrubber so dragging shows impact immediately */}
      <div className="space-y-3" data-testid="funnel-stage-bar-list">
        {projection.stages.map((stage, i) => {
          const canonical = pacing.stages.find((s) => s.key === stage.key)!;
          const next = projection.stages[i + 1];
          return (
            <StageBar
              key={stage.key}
              stage={stage}
              conversionRate={canonical.conversionRate}
              conversionBenchmark={canonical.conversionBenchmark}
              showConnector={next != null}
            />
          );
        })}
      </div>

      {/* Forward projection chart (shares the scrubber position) */}
      <div className="mt-6">
        <FunnelProjectionChart
          capacity={pacing.metrics.capacity}
          ticketsSold={pacing.metrics.purchases}
          spent={sr.spent}
          allocated={sr.allocated}
          spentPerDay={sr.spentPerDay}
          liveCostPerTicket={sr.liveCostPerTicket}
          benchmarkCostPerTicket={benchmarkCpt}
          daysToEvent={pacing.backwardRead.daysToEvent}
          daysSinceFirstSpend={sr.daysSinceFirstSpend}
          eventDate={eventDate}
          warning={sr.warning}
          warningAmount={sr.warningAmount}
          eventCode={eventCode}
          projectedDailyOverride={interactive ? clampedDaily : null}
        />
      </div>
    </article>
  );
}

function StageBar({
  stage,
  conversionRate,
  conversionBenchmark,
  showConnector,
}: {
  stage: ProjectedStageVolume;
  conversionRate: number | null;
  conversionBenchmark: number | null;
  showConnector: boolean;
}) {
  const meta = STAGE_META[stage.key];
  const tone: PacingTone =
    conversionBenchmark != null
      ? pacingTone(conversionRate, conversionBenchmark)
      : "neutral";
  const c = toneColors(tone);

  const projectedFill =
    stage.target > 0 && stage.projected != null
      ? Math.max(0, Math.min(1, stage.projected / stage.target))
      : 0;
  const currentFill =
    stage.target > 0 && stage.current != null
      ? Math.max(0, Math.min(1, stage.current / stage.target))
      : 0;

  const delta =
    conversionBenchmark != null
      ? deltaFraction(conversionRate, conversionBenchmark)
      : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{meta.metric}</p>
          <p className="text-[11px] tabular-nums text-muted-foreground">
            {stage.current == null ? "—" : NUM.format(Math.round(stage.current))}
            {" / "}
            {NUM.format(stage.target)} target
          </p>
        </div>
        {conversionBenchmark != null ? (
          <BenchmarkChip tone={tone} delta={delta} />
        ) : (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {stage.target > 0 && stage.current != null
              ? `${Math.round((stage.current / stage.target) * 100)}% sold`
              : "—"}
          </span>
        )}
      </div>

      <div
        className="relative mt-1.5 h-4 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(projectedFill * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${meta.metric}: ${Math.round(projectedFill * 100)}% of target`}
      >
        {/* projected fill (animates with scrubber) */}
        <div
          className={`relative h-full rounded-full ${c.bar} transition-[width] duration-200 ease-out`}
          style={{ width: `${projectedFill * 100}%` }}
        >
          <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/25 to-transparent" />
        </div>
        {/* today tick */}
        {currentFill > 0 && (
          <div
            className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-foreground/70"
            style={{ left: `${currentFill * 100}%` }}
            aria-hidden
            title="Today"
          />
        )}
      </div>

      {/* conversion connector to next stage */}
      {showConnector && conversionBenchmark != null && (
        <div className="ml-3 flex items-center gap-2 pt-1.5">
          <span className="text-muted-foreground" aria-hidden>
            ↳
          </span>
          <span className="rounded-full border border-border bg-surface/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {meta.edge}:{" "}
            {conversionRate == null ? "—" : PCT1.format(conversionRate)}{" "}
            <span className="opacity-70">
              (bm {PCT1.format(conversionBenchmark)})
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function ScrubberTrack({
  value,
  max,
  onChange,
  currentDaily,
  requiredDaily,
  suggestedDaily,
  budgetCeilingDaily,
}: {
  value: number;
  max: number;
  onChange: (v: number) => void;
  currentDaily: number;
  requiredDaily: number | null;
  suggestedDaily: number | null;
  /** Daily rate at which projected total spend hits the allocated budget. */
  budgetCeilingDaily: number | null;
}) {
  // Clickable position markers replace the old preset chips: the marker's
  // position is the single source of the value, so the redundant "£X/day"
  // chip is gone (the required-per-day figure lives on the Spend vs Budget
  // card). Clicking a label snaps the scrubber to that pace.
  const presets: { label: string; value: number | null }[] = [
    { label: "Current", value: currentDaily > 0 ? currentDaily : null },
    { label: "Required", value: requiredDaily },
    { label: "Suggested", value: suggestedDaily },
  ];
  const ceilingPct =
    budgetCeilingDaily != null && budgetCeilingDaily <= max
      ? (budgetCeilingDaily / max) * 100
      : null;
  return (
    <div className="mt-3">
      <div className="relative">
        {/* allocated-budget ceiling marker (Task 3) */}
        {ceilingPct != null && (
          <div
            className="pointer-events-none absolute -top-1 bottom-0 z-10 w-0.5 -translate-x-1/2 border-l-2 border-dashed border-red-500/70"
            style={{ left: `${ceilingPct}%` }}
            aria-hidden
            title={`Allocated budget ceiling ≈ ${GBP0.format(Math.round(budgetCeilingDaily!))}/day at this horizon`}
          />
        )}
        <input
          type="range"
          min={0}
          max={max}
          step={Math.max(1, Math.round(max / 200))}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Projected daily spend"
          className="w-full cursor-pointer accent-foreground"
        />
        {/* clickable position markers (snap to pace) — bg-card/90 backdrop
            prevents the vertical guide line from making labels unreadable */}
        <div className="relative mt-1 h-4">
          {presets.map((p) =>
            p.value != null && p.value <= max ? (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange(Math.round(p.value!))}
                className="absolute -translate-x-1/2 rounded bg-card/90 px-0.5 text-[9px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                style={{ left: `${(p.value / max) * 100}%` }}
                title={`Snap to ${p.label} pace`}
              >
                {p.label}
              </button>
            ) : null,
          )}
          {ceilingPct != null && (
            <span
              className="absolute -translate-x-1/2 rounded bg-card/90 px-0.5 text-[9px] uppercase tracking-wide text-red-500/80"
              style={{ left: `${ceilingPct}%` }}
            >
              Budget
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
