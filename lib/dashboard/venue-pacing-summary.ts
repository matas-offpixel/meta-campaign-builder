/**
 * lib/dashboard/venue-pacing-summary.ts
 *
 * Pure derivation layer that turns a `VenueCanonicalFunnel` into the
 * presentation row shapes consumed by:
 *   - Workstream B: Today dashboard per-client pacing alerts
 *   - Workstream C: client dashboard "Pacing" + "Performance vs
 *     Allocation" toggle views
 *
 * NO React, NO data access. Callers build the canonical funnels (via
 * the existing `buildVenueCanonicalFunnel`) and pass them in. This keeps
 * the verdict/issue/efficiency logic in one tested place so the three
 * surfaces never disagree on a venue's status — same single-source
 * contract the funnel data layer already enforces.
 */

import {
  deltaFraction,
  pacingTone,
  type PacingTone,
  type PacingVerdict,
} from "./pacing-presentation.ts";
import { getFunnelBenchmarks } from "./benchmarks.ts";
import type {
  VenueCanonicalFunnel,
  VenueCanonicalFunnelStage,
} from "./venue-canonical-funnel.ts";

/** Over-pacing trips when daily spend exceeds required by this fraction. */
const OVER_PACE_FACTOR = 1.1;
/** Behind-pace (amber) trips when daily spend falls below required by this fraction. */
const BEHIND_PACE_FACTOR = 0.8;
/** Efficiency "balanced" band: |tickets% − spend%| ≤ this → amber. */
const EFFICIENCY_BALANCED_BAND = 0.03;

export interface VenuePacingFunnelSegment {
  key: "reach" | "clicks" | "lpv" | "purchases";
  /** Edge label e.g. "Reach → Click", or "Sold" for the ticket segment. */
  label: string;
  /** Actual conversion rate (or sold% for the ticket segment). `null` on cache miss. */
  actualRate: number | null;
  /** Benchmark rate for the edge. `null` for the ticket segment (uses sold-through). */
  benchmarkRate: number | null;
  /** Fill fraction [0..1] for the segment bar (actual / target proportion). */
  fillFraction: number;
  tone: PacingTone;
}

export interface VenuePacingRow {
  eventCode: string;
  /** Display label (series label or venue name). */
  label: string;
  capacity: number;
  ticketsSold: number;
  /** sold / capacity, clamped [0..1]. */
  soldFraction: number;
  spent: number;
  allocated: number | null;
  /** spent / allocated, clamped [0..1]. `null` when allocated unknown. */
  spendFraction: number | null;
  /**
   * Efficiency = soldFraction − spendFraction. Positive → selling faster
   * than spending (efficient). `null` when allocated unknown.
   */
  efficiency: number | null;
  efficiencyTone: PacingTone;
  daysToEvent: number | null;
  requiredPerDay: number | null;
  spentPerDay: number | null;
  liveCostPerTicket: number | null;
  verdict: PacingVerdict;
  /** The four funnel segments for the horizontal funnel bar (Workstream C Pacing). */
  segments: VenuePacingFunnelSegment[];
  /** Deep-link to this venue's Funnel Pacing tab. */
  href: string;
}

export interface BuildVenuePacingRowInput {
  funnel: VenueCanonicalFunnel;
  eventCode: string;
  label: string;
  /** Pre-built deep link to the venue's Funnel Pacing tab. */
  href: string;
}

/** Clamp to [0,1]. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Derive the venue verdict. Primary signal is the canonical
 * `spendReconciliation.warning` (so the hero verdict matches it); the
 * backward-read under-pace flag is the fallback when no budget is set.
 */
export function deriveVenueVerdict(funnel: VenueCanonicalFunnel): PacingVerdict {
  const { backwardRead, spendReconciliation: sr } = funnel;
  if (backwardRead.ticketsRemaining <= 0) return "sold_out";
  if (backwardRead.daysToEvent != null && backwardRead.daysToEvent <= 0) {
    return "event_passed";
  }
  if (funnel.metrics.capacity <= 0) return "no_data";

  if (sr.warning === "additional_needed") return "under_pacing";
  if (sr.warning === "pace_covered") {
    if (
      sr.spentPerDay != null &&
      sr.requiredPerDay != null &&
      sr.requiredPerDay > 0 &&
      sr.spentPerDay > sr.requiredPerDay * OVER_PACE_FACTOR
    ) {
      return "over_pacing";
    }
    return "on_track";
  }
  // No budget set / suppressed warning → lean on the ticket-pace flag.
  if (backwardRead.underPacing) return "under_pacing";
  return "on_track";
}

function buildSegments(
  funnel: VenueCanonicalFunnel,
): VenuePacingFunnelSegment[] {
  const stageByKey = new Map<string, VenueCanonicalFunnelStage>();
  for (const s of funnel.stages) stageByKey.set(s.key, s);

  const segs: VenuePacingFunnelSegment[] = [];
  for (const key of ["reach", "clicks", "lpv"] as const) {
    const stage = stageByKey.get(key);
    if (!stage) continue;
    const tone = pacingTone(stage.conversionRate, stage.conversionBenchmark);
    // Fill fraction = actual rate / benchmark, capped at 1 for the bar.
    const fill =
      stage.conversionRate != null && stage.conversionBenchmark
        ? clamp01(stage.conversionRate / stage.conversionBenchmark)
        : 0;
    segs.push({
      key,
      label:
        key === "reach"
          ? "Reach → Click"
          : key === "clicks"
            ? "Click → LPV"
            : "LPV → Ticket",
      actualRate: stage.conversionRate,
      benchmarkRate: stage.conversionBenchmark,
      fillFraction: fill,
      tone,
    });
  }
  // Ticket segment: sold-through against capacity. Tone reflects the
  // overall verdict (under-pace = red, on-track/ahead = emerald).
  const soldFraction = clamp01(
    funnel.metrics.capacity > 0
      ? funnel.metrics.purchases / funnel.metrics.capacity
      : 0,
  );
  const verdict = deriveVenueVerdict(funnel);
  const ticketTone: PacingTone =
    verdict === "under_pacing"
      ? "below"
      : verdict === "over_pacing"
        ? "within"
        : verdict === "no_data" || verdict === "event_passed"
          ? "neutral"
          : "above";
  segs.push({
    key: "purchases",
    label: "Sold",
    actualRate: soldFraction,
    benchmarkRate: null,
    fillFraction: soldFraction,
    tone: ticketTone,
  });
  return segs;
}

/**
 * Efficiency tone: emerald when selling faster than spending, red when
 * spending faster than selling, amber when balanced within ±3%.
 */
function efficiencyTone(efficiency: number | null): PacingTone {
  if (efficiency == null) return "neutral";
  if (efficiency > EFFICIENCY_BALANCED_BAND) return "above";
  if (efficiency < -EFFICIENCY_BALANCED_BAND) return "below";
  return "within";
}

export function buildVenuePacingRow(
  input: BuildVenuePacingRowInput,
): VenuePacingRow {
  const { funnel } = input;
  const capacity = funnel.metrics.capacity;
  const ticketsSold = funnel.metrics.purchases;
  const soldFraction = clamp01(capacity > 0 ? ticketsSold / capacity : 0);
  const spent = funnel.spendReconciliation.spent;
  const allocated = funnel.spendReconciliation.allocated;
  const spendFraction =
    allocated != null && allocated > 0 ? clamp01(spent / allocated) : null;
  const efficiency =
    spendFraction != null ? soldFraction - spendFraction : null;

  return {
    eventCode: input.eventCode,
    label: input.label,
    capacity,
    ticketsSold,
    soldFraction,
    spent,
    allocated,
    spendFraction,
    efficiency,
    efficiencyTone: efficiencyTone(efficiency),
    daysToEvent: funnel.backwardRead.daysToEvent,
    requiredPerDay: funnel.spendReconciliation.requiredPerDay,
    spentPerDay: funnel.spendReconciliation.spentPerDay,
    liveCostPerTicket: funnel.spendReconciliation.liveCostPerTicket,
    verdict: deriveVenueVerdict(funnel),
    segments: buildSegments(funnel),
    href: input.href,
  };
}

// ── Client-level alerts (Workstream B) ────────────────────────────────────

export type AlertSeverity = "red" | "amber";

export interface PacingIssue {
  severity: AlertSeverity;
  /** Stable id for keys. */
  id: string;
  /** One-line message (no emoji — the renderer adds it from severity). */
  message: string;
  /** Deep-link to the relevant venue's Funnel Pacing tab. */
  href: string;
}

export interface ClientPacingAlert {
  clientId: string;
  clientName: string;
  /** Overall pill: red if any red issue, amber if any amber, else emerald. */
  severity: AlertSeverity | "ok";
  issues: PacingIssue[];
  /** Deep-link to the client's dashboard. */
  href: string;
}

const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const PCT0 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0,
});

/**
 * Derive the pacing issues for a single venue row. Returns 0+ issues,
 * red first. Sold-out / event-passed venues yield none (not actionable).
 */
export function deriveVenueIssues(row: VenuePacingRow): PacingIssue[] {
  if (row.verdict === "sold_out" || row.verdict === "event_passed") return [];
  const issues: PacingIssue[] = [];

  // Red — under budget to hit capacity by event date.
  const funnelWarn = row.requiredPerDay != null && row.spentPerDay != null;
  if (
    row.verdict === "under_pacing" &&
    row.allocated != null &&
    row.requiredPerDay != null &&
    row.daysToEvent != null &&
    row.daysToEvent > 0
  ) {
    // Recommended uplift: required − current daily, floored at +£1/day.
    const uplift = Math.max(
      0,
      (row.requiredPerDay ?? 0) - (row.spentPerDay ?? 0),
    );
    const upliftCopy =
      uplift > 0 ? ` — recommend +${GBP0.format(Math.round(uplift))}/day` : "";
    issues.push({
      severity: "red",
      id: `${row.eventCode}-under`,
      message: `${row.label}: under-pacing${upliftCopy}`,
      href: row.href,
    });
  }

  // Defensive: future "ahead_of_pace" maps to over-pacing amber.
  if (row.verdict === "over_pacing" && row.spentPerDay != null && row.requiredPerDay != null) {
    const over = Math.max(0, row.spentPerDay - row.requiredPerDay);
    issues.push({
      severity: "amber",
      id: `${row.eventCode}-over`,
      message: `${row.label}: over-pacing by ${GBP0.format(Math.round(over))}/day — consider tapering`,
      href: row.href,
    });
  }

  // Amber — any funnel conversion rate >10% below benchmark.
  for (const seg of row.segments) {
    if (seg.key === "purchases") continue;
    if (seg.actualRate == null || seg.benchmarkRate == null) continue;
    if (seg.tone === "below") {
      issues.push({
        severity: "amber",
        id: `${row.eventCode}-${seg.key}`,
        message: `${row.label}: ${seg.label} ${PCT0.format(seg.actualRate)} vs ${PCT0.format(seg.benchmarkRate)} benchmark`,
        href: row.href,
      });
    }
  }

  // Amber — behind required pace (current daily < 80% of required).
  // Approximation of the spec's "3+ days behind" (we only have the
  // current-day snapshot here; flagged in PR for a follow-up that
  // reads the rolling window).
  if (
    funnelWarn &&
    row.verdict !== "under_pacing" &&
    row.requiredPerDay! > 0 &&
    row.spentPerDay! < row.requiredPerDay! * BEHIND_PACE_FACTOR
  ) {
    issues.push({
      severity: "amber",
      id: `${row.eventCode}-behind`,
      message: `${row.label}: spend behind required pace`,
      href: row.href,
    });
  }

  // Red issues first, then amber.
  return issues.sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1,
  );
}

/**
 * Roll venue rows up into a single client alert card. `issues` are
 * sorted red-first across all the client's venues.
 */
export function buildClientPacingAlert(input: {
  clientId: string;
  clientName: string;
  href: string;
  rows: VenuePacingRow[];
}): ClientPacingAlert {
  const issues = input.rows
    .flatMap((r) => deriveVenueIssues(r))
    .sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "red" ? -1 : 1,
    );
  const severity: ClientPacingAlert["severity"] = issues.some(
    (i) => i.severity === "red",
  )
    ? "red"
    : issues.some((i) => i.severity === "amber")
      ? "amber"
      : "ok";
  return {
    clientId: input.clientId,
    clientName: input.clientName,
    severity,
    issues,
    href: input.href,
  };
}

// ── Scrubber projection (Workstream A interactive layer) ──────────────────

export interface ProjectedStageVolume {
  key: "reach" | "clicks" | "lpv" | "purchases";
  /** Actual volume to date (`null` only for cache-miss upstream stages). */
  current: number | null;
  /** Projected volume by event date at the scrubber's £/day. */
  projected: number | null;
  /** Capacity-derived target (denominator). */
  target: number;
}

export interface ScrubberProjection {
  dailySpend: number;
  /** Total additional spend from today to event date. */
  additionalSpend: number;
  /** Projected total tickets by event date (uncapped). */
  projectedTickets: number;
  /** Projected tickets as a fraction of capacity (clamped). */
  projectedSoldFraction: number;
  /** Per-stage projected volumes for the stage bars. */
  stages: ProjectedStageVolume[];
  /** Days the projection runs over. */
  daysToEvent: number;
}

/**
 * Project funnel volumes forward at a hypothetical £/day spend.
 *
 * Additional tickets convert at the event's live CPT (or benchmark CPT
 * pre-launch). Upstream stages scale via the benchmark inverse ratios
 * so the projected funnel holds benchmark shape — the same modelling
 * the projection chart's lines use. Pure; no clamping of the uncapped
 * ticket total so callers can show "sells out N days early".
 */
export function projectFunnelVolumes(
  funnel: VenueCanonicalFunnel,
  dailySpend: number,
): ScrubberProjection {
  const bench = getFunnelBenchmarks();
  const days = Math.max(0, funnel.backwardRead.daysToEvent ?? 0);
  const cpt =
    funnel.spendReconciliation.liveCostPerTicket ??
    bench.benchmarkCostPerTicket;
  const additionalSpend = dailySpend * days;
  const additionalTickets = cpt > 0 ? additionalSpend / cpt : 0;
  const projectedTickets = funnel.metrics.purchases + additionalTickets;

  const additionalLpv = additionalTickets / bench.lpvToTicket;
  const additionalClicks = additionalLpv / bench.clickToLpv;
  const additionalReach = additionalClicks / bench.reachToClick;

  const stageByKey = new Map<string, VenueCanonicalFunnelStage>();
  for (const s of funnel.stages) stageByKey.set(s.key, s);

  const add: Record<string, number> = {
    reach: additionalReach,
    clicks: additionalClicks,
    lpv: additionalLpv,
    purchases: additionalTickets,
  };

  const stages: ProjectedStageVolume[] = (
    ["reach", "clicks", "lpv", "purchases"] as const
  ).map((key) => {
    const stage = stageByKey.get(key)!;
    const current = stage.actual;
    const projected = current == null ? null : current + add[key]!;
    return { key, current, projected, target: stage.target };
  });

  return {
    dailySpend,
    additionalSpend,
    projectedTickets,
    projectedSoldFraction: clamp01(
      funnel.metrics.capacity > 0
        ? projectedTickets / funnel.metrics.capacity
        : 0,
    ),
    stages,
    daysToEvent: days,
  };
}

/** Compute up-to-2-word initials for a client name (logo fallback). */
export function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Default delta fraction helper re-export for row chips. */
export { deltaFraction };
