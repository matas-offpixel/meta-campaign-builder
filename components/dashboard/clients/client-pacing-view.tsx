"use client";

/**
 * components/dashboard/clients/client-pacing-view.tsx
 *
 * Workstream C — "Pacing" view. One horizontal row per venue: a single
 * bar segmented into the four funnel stages (Reach / Click / LPV /
 * Ticket), each sub-segment width = its capacity-derived target share and
 * fill = achieved, coloured by rate-vs-benchmark. Rows sort red → amber →
 * emerald. Click a row → that venue's Funnel Pacing tab.
 *
 * Pure presentation over `VenuePacingRow[]` (serialisable). Hover shows a
 * funnel detail tooltip.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import type { VenuePacingRow } from "@/lib/dashboard/venue-pacing-summary";
import {
  toneColors,
  verdictPresentation,
} from "@/lib/dashboard/pacing-presentation";

const NUM = new Intl.NumberFormat("en-GB");
const PCT0 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0,
});
const PCT1 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

const VERDICT_RANK: Record<string, number> = {
  under_pacing: 0,
  over_pacing: 1,
  on_track: 2,
  sold_out: 3,
  event_passed: 4,
  no_data: 5,
};

export function ClientPacingView({ rows }: { rows: VenuePacingRow[] }) {
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (VERDICT_RANK[a.verdict] ?? 9) - (VERDICT_RANK[b.verdict] ?? 9),
      ),
    [rows],
  );

  if (sorted.length === 0) {
    return <EmptyState />;
  }

  return (
    <section className="space-y-3" data-testid="client-pacing-view">
      <div className="mb-1">
        <h2 className="font-heading text-xl tracking-wide">Funnel pacing by venue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Each bar splits into the four funnel stages. Segment fill shows
          progress to the capacity-derived target; colour shows
          rate-vs-benchmark. Sorted most-at-risk first.
        </p>
      </div>
      {sorted.map((row) => (
        <PacingRow key={row.eventCode} row={row} />
      ))}
    </section>
  );
}

function PacingRow({ row }: { row: VenuePacingRow }) {
  const [hover, setHover] = useState(false);
  const v = verdictPresentation(row.verdict);
  const vc = toneColors(v.tone);

  return (
    <div className="relative">
      <Link
        href={row.href}
        className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span aria-hidden>{v.emoji}</span>
            <span className="font-medium">{row.label}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${vc.chipBg} ${vc.chipText}`}
            >
              {v.short.toLowerCase()}
            </span>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {row.requiredPerDay != null
              ? `${GBP0.format(Math.round(row.requiredPerDay))}/day required`
              : row.verdict === "sold_out"
                ? "sold out"
                : "—"}
          </span>
        </div>

        {/* segmented funnel bar */}
        <div className="mt-3 flex h-7 w-full gap-0.5 overflow-hidden rounded-lg">
          {row.segments.map((seg) => {
            const c = toneColors(seg.tone);
            const widthPct = 100 / row.segments.length;
            return (
              <div
                key={seg.key}
                className="relative h-full bg-muted"
                style={{ width: `${widthPct}%` }}
                title={`${seg.label}`}
              >
                <div
                  className={`absolute inset-y-0 left-0 ${c.bar}`}
                  style={{ width: `${seg.fillFraction * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium tabular-nums text-foreground/80">
                  {seg.benchmarkRate != null && seg.actualRate != null
                    ? PCT0.format(seg.actualRate)
                    : seg.key === "purchases" && seg.actualRate != null
                      ? PCT0.format(seg.actualRate)
                      : "—"}
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-[9px] uppercase tracking-wide text-muted-foreground">
          <span>Reach</span>
          <span>Click</span>
          <span>LPV</span>
          <span>Ticket</span>
        </div>
      </Link>

      {hover ? <RowTooltip row={row} /> : null}
    </div>
  );
}

function RowTooltip({ row }: { row: VenuePacingRow }) {
  return (
    <div className="pointer-events-none absolute left-4 top-full z-20 mt-1 w-64 rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-lg">
      <p className="mb-1 font-medium">{row.label}</p>
      <ul className="space-y-0.5">
        {row.segments.map((seg) => (
          <li key={seg.key} className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="tabular-nums">
              {seg.actualRate == null
                ? "—"
                : seg.benchmarkRate != null
                  ? `${PCT1.format(seg.actualRate)} / ${PCT1.format(seg.benchmarkRate)} bm`
                  : PCT0.format(seg.actualRate)}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 border-t border-border pt-0.5">
          <span className="text-muted-foreground">Sold</span>
          <span className="tabular-nums">
            {NUM.format(row.ticketsSold)} / {NUM.format(row.capacity)}
          </span>
        </li>
        <li className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Days to event</span>
          <span className="tabular-nums">
            {row.daysToEvent == null ? "—" : row.daysToEvent}
          </span>
        </li>
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-16 text-sm text-muted-foreground">
      No active venues to pace for this client.
    </div>
  );
}
