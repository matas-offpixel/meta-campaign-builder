import { Info, Settings } from "lucide-react";

import type {
  StageStatus,
  VenueCanonicalFunnel,
  VenueCanonicalFunnelStage,
} from "@/lib/dashboard/venue-canonical-funnel";

const NUM = new Intl.NumberFormat("en-GB");
const PCT_1DP = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

/**
 * Venue-scope funnel pacing view (PR-B of issue #467).
 *
 * Renders the canonical funnel struct produced by
 * `buildVenueCanonicalFunnel`. Reach / Clicks / LPV / Purchases bar
 * numerators read from the same lifetime cache + tier_channel_sales
 * values the Performance tab's Stats Grid uses — guaranteed by
 * shared input + a pure helper. The two surfaces cannot disagree.
 *
 * Status model: conversion-rate-vs-benchmark. ON TRACK when the
 * event's rate from this stage to the next is ≥ the benchmark for
 * that edge (14 / 50 / 5). Purchases is the terminal stage and uses
 * the backward-read under-pacing check instead.
 *
 * Additional sections (per the issue #467 spec):
 *   - Sliding scale (forward read): extra tickets × benchmark CPT
 *     and × live CPT.
 *   - Backward read: days to event, required vs achieved pace,
 *     under-pacing flag.
 */
export function FunnelPacingVenueView({
  pacing,
  venueLabel,
}: {
  pacing: VenueCanonicalFunnel;
  venueLabel: string;
}) {
  return (
    <section className="space-y-5">
      <Header venueLabel={venueLabel} />
      <div className="space-y-4">
        {pacing.stages.map((stage) => (
          <FunnelStageCardCanonical key={stage.key} stage={stage} />
        ))}
      </div>
      <SlidingScaleCard slidingScale={pacing.slidingScale} />
      <BackwardReadCard backward={pacing.backwardRead} />
    </section>
  );
}

function Header({ venueLabel }: { venueLabel: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Funnel Pacing
          </p>
          <h2 className="mt-1 font-heading text-2xl tracking-wide">
            {venueLabel}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Capacity-derived targets · benchmark conversion rates 14% /
            50% / 5%. Reads the same canonical values as the Performance
            tab so the two surfaces can never disagree.
          </p>
        </div>
        <button
          type="button"
          title="Manual benchmark override will be enabled in the next iteration."
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
      </div>
    </div>
  );
}

function FunnelStageCardCanonical({
  stage,
}: {
  stage: VenueCanonicalFunnelStage;
}) {
  const fillPct =
    stage.pacingPct == null
      ? 0
      : Math.min(100, Math.max(0, stage.pacingPct));
  return (
    <article
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-testid={`funnel-pacing-stage-${stage.key}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {stage.label}
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            {stage.metricLabel}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {stage.description}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClass(
            stage.status,
          )}`}
        >
          {statusLabel(stage.status)}
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm">
            <span className="font-semibold tabular-nums">
              {stage.actual == null ? "—" : NUM.format(stage.actual)}
            </span>
            {" / "}
            <span className="font-semibold tabular-nums">
              {NUM.format(stage.target)}
            </span>{" "}
            {stage.metricLabel.toLowerCase()}
            {stage.pacingPct != null && (
              <span className="text-muted-foreground">
                {" "}
                ({Math.round(stage.pacingPct)}% of target)
              </span>
            )}
          </p>
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${barClass(stage.status)}`}
              style={{ width: `${fillPct}%` }}
            />
            <div className="absolute right-0 top-0 h-full w-px bg-foreground/60" />
          </div>
        </div>
        {stage.conversionBenchmark != null && (
          <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
            <p className="text-muted-foreground">
              {conversionEdgeLabel(stage.key)}
            </p>
            <p className="mt-1 font-medium tabular-nums">
              {stage.conversionRate == null
                ? "—"
                : PCT_1DP.format(stage.conversionRate)}{" "}
              <span className="text-muted-foreground">
                / {PCT_1DP.format(stage.conversionBenchmark)} benchmark
              </span>
            </p>
          </div>
        )}
      </div>
    </article>
  );
}

function SlidingScaleCard({
  slidingScale,
}: {
  slidingScale: VenueCanonicalFunnel["slidingScale"];
}) {
  return (
    <article
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-testid="funnel-pacing-sliding-scale"
    >
      <div className="flex items-start gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Sliding scale
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            Forward read
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            How much spend to reach capacity — at benchmark conversion
            and at this event&apos;s actual conversion.
          </p>
        </div>
        <button
          type="button"
          className="ml-1 inline-flex rounded p-0.5 text-muted-foreground hover:text-foreground"
          title="Extra tickets needed × cost-per-ticket. Live CPT = spend / purchases so far. Benchmark CPT derived from £0.12 CPC × 40 clicks per ticket."
          aria-label="About sliding scale"
        >
          <Info className="h-3 w-3 shrink-0" strokeWidth={2} />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Extra tickets to capacity"
          value={NUM.format(slidingScale.extraTicketsToCapacity)}
          testid="funnel-pacing-extra-tickets"
        />
        <Stat
          label="Add spend (at benchmark)"
          value={GBP.format(slidingScale.additionalSpendAtBenchmark)}
          sub={`${GBP.format(slidingScale.benchmarkCostPerTicket)} per ticket`}
          testid="funnel-pacing-add-spend-benchmark"
        />
        <Stat
          label="Add spend (live conversion)"
          value={
            slidingScale.additionalSpendAtLiveConversion == null
              ? "—"
              : GBP.format(slidingScale.additionalSpendAtLiveConversion)
          }
          sub={
            slidingScale.liveCostPerTicket == null
              ? "Awaiting first purchase"
              : `${GBP.format(slidingScale.liveCostPerTicket)} per ticket (live)`
          }
          testid="funnel-pacing-add-spend-live"
        />
      </div>
    </article>
  );
}

function BackwardReadCard({
  backward,
}: {
  backward: VenueCanonicalFunnel["backwardRead"];
}) {
  return (
    <article
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-testid="funnel-pacing-backward-read"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Pacing
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            Backward read
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tickets per day needed to sell out by event date, vs the
            rolling 14-day average actual pace.
          </p>
        </div>
        {backward.underPacing ? (
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-medium text-red-800">
            ⚠ Under-pacing — consider raising paid budget
          </span>
        ) : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Days to event"
          value={
            backward.daysToEvent == null
              ? "—"
              : backward.daysToEvent < 0
                ? "Past"
                : NUM.format(backward.daysToEvent)
          }
          testid="funnel-pacing-days-to-event"
        />
        <Stat
          label="Tickets remaining"
          value={NUM.format(backward.ticketsRemaining)}
          testid="funnel-pacing-tickets-remaining"
        />
        <Stat
          label="Required / day"
          value={
            backward.requiredDailyPace == null
              ? "—"
              : NUM.format(Math.round(backward.requiredDailyPace))
          }
          testid="funnel-pacing-required-pace"
        />
        <Stat
          label="Achieved / day (14d)"
          value={
            backward.achievedDailyPace == null
              ? "—"
              : NUM.format(Math.round(backward.achievedDailyPace))
          }
          testid="funnel-pacing-achieved-pace"
        />
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  sub,
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  testid?: string;
}) {
  return (
    <div
      className="rounded-md border border-border bg-card p-3"
      data-testid={testid}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <p className="mt-1 font-heading text-lg tracking-wide tabular-nums">
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </p>
      ) : null}
    </div>
  );
}

function statusLabel(status: StageStatus): string {
  if (status === "on_track") return "🟢 ON TRACK";
  if (status === "off_track") return "🔴 OFF TRACK";
  return "⚪ UNKNOWN";
}

function statusClass(status: StageStatus): string {
  if (status === "on_track") return "bg-green-100 text-green-800";
  if (status === "off_track") return "bg-red-100 text-red-800";
  return "bg-muted text-muted-foreground";
}

function barClass(status: StageStatus): string {
  if (status === "on_track") return "bg-green-500";
  if (status === "off_track") return "bg-red-500";
  return "bg-muted-foreground/40";
}

function conversionEdgeLabel(key: VenueCanonicalFunnelStage["key"]): string {
  if (key === "reach") return "Reach → Click";
  if (key === "clicks") return "Click → LPV";
  if (key === "lpv") return "LPV → Ticket";
  return "";
}
