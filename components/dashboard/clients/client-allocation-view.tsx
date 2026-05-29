"use client";

/**
 * components/dashboard/clients/client-allocation-view.tsx
 *
 * Workstream C — "Performance vs Allocation" view. One row per venue with
 * two overlaid horizontal bars: tickets sold as % of capacity (top,
 * lighter) over spend deployed as % of allocated (bottom, darker). An
 * efficiency chip on the right flags whether the venue is selling faster
 * than it's spending. Sorted efficiency-descending by default, with a
 * sort toggle (Efficiency / Sales% / Spend%).
 *
 * Pure presentation over `VenuePacingRow[]`. Click a row → that venue's
 * Funnel Pacing tab.
 */

import Link from "next/link";
import { useMemo, useState } from "react";

import type { VenuePacingRow } from "@/lib/dashboard/venue-pacing-summary";
import { formatDeltaPct, toneColors } from "@/lib/dashboard/pacing-presentation";
import { OverlayBars } from "../pacing/gradient-bar";

const NUM = new Intl.NumberFormat("en-GB");
const PCT0 = new Intl.NumberFormat("en-GB", {
  style: "percent",
  maximumFractionDigits: 0,
});
const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

type SortKey = "efficiency" | "sales" | "spend";

export function ClientAllocationView({ rows }: { rows: VenuePacingRow[] }) {
  const [sort, setSort] = useState<SortKey>("efficiency");

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "sales") return b.soldFraction - a.soldFraction;
      if (sort === "spend")
        return (b.spendFraction ?? -1) - (a.spendFraction ?? -1);
      // efficiency desc; nulls last
      const ea = a.efficiency ?? -Infinity;
      const eb = b.efficiency ?? -Infinity;
      return eb - ea;
    });
    return copy;
  }, [rows, sort]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-16 text-sm text-muted-foreground">
        No active venues with allocation data for this client.
      </div>
    );
  }

  return (
    <section className="space-y-3" data-testid="client-allocation-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl tracking-wide">
            Performance vs allocation
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Tickets sold (% of capacity) over spend deployed (% of
            allocated). Venues selling faster than they spend rank highest.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Sort venues"
          className="inline-flex gap-1 rounded-full border border-border p-0.5"
        >
          {(
            [
              { k: "efficiency", label: "Efficiency" },
              { k: "sales", label: "Sales %" },
              { k: "spend", label: "Spend %" },
            ] as const
          ).map((opt) => {
            const active = sort === opt.k;
            return (
              <button
                key={opt.k}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setSort(opt.k)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {sorted.map((row) => (
        <AllocationRow key={row.eventCode} row={row} />
      ))}
    </section>
  );
}

function AllocationRow({ row }: { row: VenuePacingRow }) {
  const effC = toneColors(row.efficiencyTone);
  const chipLabel =
    row.efficiency == null
      ? "no budget"
      : row.efficiencyTone === "above"
        ? `${formatDeltaPct(row.efficiency)} efficient`
        : row.efficiencyTone === "below"
          ? `${formatDeltaPct(row.efficiency)} behind`
          : "balanced";

  return (
    <Link
      href={row.href}
      className="block rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`${row.label} · ${row.liveCostPerTicket != null ? GBP0.format(Math.round(row.liveCostPerTicket)) + " CPT" : "CPT —"} · ${row.daysToEvent ?? "—"} days to event`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{row.label}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {NUM.format(row.capacity)} cap
          </span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${effC.chipBg} ${effC.chipText}`}
        >
          {chipLabel}
        </span>
      </div>

      <div className="mt-3">
        <OverlayBars
          topFill={row.soldFraction}
          topTone="above"
          topLabel={`${NUM.format(row.ticketsSold)} / ${NUM.format(row.capacity)} (${PCT0.format(row.soldFraction)}) tickets`}
          bottomFill={row.spendFraction ?? 0}
          bottomTone="neutral"
          bottomLabel={
            row.allocated != null
              ? `${GBP0.format(Math.round(row.spent))} / ${GBP0.format(Math.round(row.allocated))} (${PCT0.format(row.spendFraction ?? 0)}) spend`
              : `${GBP0.format(Math.round(row.spent))} spent · no budget set`
          }
        />
      </div>
    </Link>
  );
}
