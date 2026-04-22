"use client";

import Link from "next/link";
import { useMemo } from "react";
import { TrendingUp } from "lucide-react";

/**
 * components/dashboard/events/ticket-pacing-card.tsx
 *
 * Renders an at-a-glance line chart of `ticket_sales_snapshots` for
 * one event. Sits BELOW the existing `tickets-sold-panel` inside the
 * Meta sub-panel of the event Reporting tab — additional visibility,
 * never a replacement for the authoritative count source (plan ▸
 * manual override).
 *
 * Disagreement handling: when the latest snapshot diverges from the
 * plan figure by more than 5% we surface a subtle warning line. The
 * card never overwrites or auto-syncs — Matas decides.
 *
 * Why a hand-rolled SVG and not `recharts`: `recharts` isn't in the
 * bundle and the global rule is "no new dependencies without
 * approval". A flat SVG line + capacity guide is sufficient for a
 * pacing read; if richer charts are wanted later, lifting to a real
 * chart lib is a focused change.
 */

export interface PacingSnapshot {
  snapshot_at: string;
  tickets_sold: number;
}

interface Props {
  snapshots: PacingSnapshot[];
  capacity: number | null;
  /** Latest plan-side cumulative tickets sold. Drives the disagreement warning. */
  planLatest: number | null;
  /** Used to deep-link the empty-state CTA back to the client's ticketing settings. */
  clientId: string;
}

const CHART_W = 640;
const CHART_H = 160;
const PADDING = { top: 12, right: 16, bottom: 24, left: 40 };
const DISAGREE_THRESHOLD = 0.05;

export function TicketPacingCard({
  snapshots,
  capacity,
  planLatest,
  clientId,
}: Props) {
  if (snapshots.length === 0) {
    return (
      <section className="rounded-md border border-border bg-card p-5">
        <Header title="Ticket pacing" subtitle={null} />
        <EmptyState clientId={clientId} />
      </section>
    );
  }

  const latest = snapshots[snapshots.length - 1];
  const latestSold = latest.tickets_sold;
  const sellThroughPct =
    capacity && capacity > 0 ? (latestSold / capacity) * 100 : null;

  const disagreement = computeDisagreement(latestSold, planLatest);

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <Header
        title="Ticket pacing"
        subtitle={`Latest snapshot ${formatTimestamp(latest.snapshot_at)}`}
      />

      <div className="mt-4">
        <PacingChart snapshots={snapshots} capacity={capacity} />
      </div>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Tickets sold (latest snapshot)</span>{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatInt(latestSold)}
            {capacity != null && (
              <span className="text-muted-foreground">
                {" / "}
                {formatInt(capacity)}
              </span>
            )}
          </span>
        </div>
        {sellThroughPct != null && (
          <div className="text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {sellThroughPct.toFixed(1)}%
            </span>{" "}
            sell-through
          </div>
        )}
      </div>

      {disagreement && (
        <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          Latest snapshot: {formatInt(disagreement.snapshotValue)} — plan says{" "}
          {formatInt(disagreement.planValue)} ({disagreement.deltaPct.toFixed(1)}%
          difference). The plan figure is still authoritative; review the snapshot
          source if this looks wrong.
        </p>
      )}
    </section>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

function Header({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <TrendingUp className="mt-0.5 h-4 w-4 text-muted-foreground" />
      <div className="min-w-0">
        <h3 className="font-heading text-base tracking-wide">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function EmptyState({ clientId }: { clientId: string }) {
  return (
    <div className="mt-4 rounded-md border border-dashed border-border bg-muted/20 p-6 text-center">
      <p className="text-sm font-medium">No ticket data yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Connect Eventbrite (or another supported provider) on the client&apos;s
        settings page and the nightly sync will start collecting snapshots.
      </p>
      <Link
        href={`/clients/${clientId}/settings?tab=ticketing`}
        className="mt-3 inline-flex items-center text-xs font-medium text-foreground underline-offset-2 hover:underline"
      >
        Open ticketing settings →
      </Link>
    </div>
  );
}

function PacingChart({
  snapshots,
  capacity,
}: {
  snapshots: PacingSnapshot[];
  capacity: number | null;
}) {
  const points = useMemo(
    () =>
      snapshots
        .map((s) => ({
          x: new Date(s.snapshot_at).getTime(),
          y: s.tickets_sold,
        }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    [snapshots],
  );

  if (points.length === 0) return null;

  const xMin = points[0].x;
  const xMax = points[points.length - 1].x;
  const xSpan = Math.max(1, xMax - xMin);
  const yValues = points.map((p) => p.y);
  const yMaxData = Math.max(...yValues);
  // Cap the y-axis at the plan capacity when present so the
  // capacity guide actually appears on-chart even when sales are
  // well below it; otherwise scale to data with a small headroom.
  const yMax =
    capacity != null && capacity > 0
      ? Math.max(capacity, yMaxData)
      : yMaxData * 1.05 || 1;
  const innerW = CHART_W - PADDING.left - PADDING.right;
  const innerH = CHART_H - PADDING.top - PADDING.bottom;

  const xScale = (x: number) =>
    PADDING.left + ((x - xMin) / xSpan) * innerW;
  const yScale = (y: number) =>
    PADDING.top + innerH - (y / yMax) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.x)} ${yScale(p.y)}`)
    .join(" ");

  // Y-axis ticks: 0, half, full
  const yTicks = [0, yMax / 2, yMax];
  // X-axis ticks: first, midpoint, last (when more than one point)
  const xTicks =
    points.length === 1
      ? [points[0].x]
      : [xMin, xMin + xSpan / 2, xMax];

  const capacityY = capacity != null && capacity > 0 ? yScale(capacity) : null;

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="none"
      className="h-40 w-full"
      role="img"
      aria-label="Ticket sales pacing"
    >
      {/* Y-axis grid + labels */}
      {yTicks.map((t, i) => (
        <g key={`y-${i}`}>
          <line
            x1={PADDING.left}
            x2={CHART_W - PADDING.right}
            y1={yScale(t)}
            y2={yScale(t)}
            stroke="currentColor"
            strokeOpacity={0.08}
          />
          <text
            x={PADDING.left - 6}
            y={yScale(t)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-current text-[9px] text-muted-foreground"
          >
            {formatInt(Math.round(t))}
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {xTicks.map((t, i) => (
        <text
          key={`x-${i}`}
          x={xScale(t)}
          y={CHART_H - 6}
          textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
          className="fill-current text-[9px] text-muted-foreground"
        >
          {formatTickDate(t)}
        </text>
      ))}

      {/* Capacity reference line */}
      {capacityY != null && (
        <g>
          <line
            x1={PADDING.left}
            x2={CHART_W - PADDING.right}
            y1={capacityY}
            y2={capacityY}
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeDasharray="4 4"
          />
          <text
            x={CHART_W - PADDING.right - 4}
            y={capacityY - 3}
            textAnchor="end"
            className="fill-current text-[9px] text-muted-foreground"
          >
            Capacity
          </text>
        </g>
      )}

      {/* Pacing line */}
      <path
        d={pathD}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="text-foreground"
      />

      {/* Endpoints — small dots so a single snapshot is still visible */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xScale(p.x)}
          cy={yScale(p.y)}
          r={i === points.length - 1 ? 3 : 1.5}
          className="fill-current text-foreground"
        />
      ))}
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeDisagreement(
  snapshotValue: number,
  planValue: number | null,
): { snapshotValue: number; planValue: number; deltaPct: number } | null {
  if (planValue == null) return null;
  if (planValue <= 0) return null;
  const delta = Math.abs(snapshotValue - planValue) / planValue;
  if (delta <= DISAGREE_THRESHOLD) return null;
  return {
    snapshotValue,
    planValue,
    deltaPct: delta * 100,
  };
}

function formatInt(v: number): string {
  return Math.round(v).toLocaleString("en-GB");
}

const TIMESTAMP_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return TIMESTAMP_FMT.format(d);
}

const TICK_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

function formatTickDate(ms: number): string {
  return TICK_FMT.format(new Date(ms));
}
