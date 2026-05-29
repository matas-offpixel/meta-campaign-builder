/**
 * components/dashboard/clients/spend-vs-budget-bar.tsx
 *
 * Tightened Spend vs Budget reconciliation (visual-overhaul PR). One big
 * horizontal bar — Spent fill within the Allocated track — with a
 * "required to sell out" divider and a red overshoot segment when the
 * required spend exceeds the allocated budget. Below: three stat tiles
 * with benchmark chips. The dropped detail rows (days since first spend,
 * £/day) live in `title` tooltips, keeping this a pure server component.
 *
 * Reads only `VenueSpendReconciliation` (canonical) — no new data.
 */

import type {
  VenueCptProjection,
  VenueSpendReconciliation,
} from "@/lib/dashboard/venue-canonical-funnel";
import { getFunnelBenchmarks } from "@/lib/dashboard/benchmarks";
import {
  deltaFraction,
  inverseTone,
  toneColors,
} from "@/lib/dashboard/pacing-presentation";
import { BenchmarkChip, TargetChip } from "../pacing/benchmark-chip";

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
const NUM = new Intl.NumberFormat("en-GB");

export function SpendVsBudgetBar({
  reconciliation: r,
  daysToEvent,
  cptProjection,
}: {
  reconciliation: VenueSpendReconciliation;
  daysToEvent: number | null;
  /**
   * CPT-at-sellout + budget-anchor stats (Workstream D). Optional so
   * legacy callers compile; the projection block only renders when a
   * current CPT is known.
   */
  cptProjection?: VenueCptProjection | null;
}) {
  const bench = getFunnelBenchmarks();
  const requiredTotal =
    r.requiredPerDay != null && daysToEvent != null && daysToEvent > 0
      ? r.spent + r.requiredPerDay * daysToEvent
      : null;

  const scaleMax = Math.max(
    r.allocated ?? 0,
    requiredTotal ?? 0,
    r.spent,
    1,
  );
  const spentPct = (r.spent / scaleMax) * 100;
  const allocatedPct = r.allocated != null ? (r.allocated / scaleMax) * 100 : null;
  const requiredPct =
    requiredTotal != null ? (requiredTotal / scaleMax) * 100 : null;
  const overshoot =
    r.allocated != null && requiredTotal != null && requiredTotal > r.allocated;

  return (
    <article
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      data-testid="funnel-pacing-spend-reconciliation"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Spend vs Budget
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            Reconciliation
          </h3>
        </div>
        {overshoot && r.warningAmount != null ? (
          <TargetChip
            tone="below"
            label={`+${GBP0.format(Math.round(r.warningAmount))} additional needed`}
          />
        ) : r.warning === "pace_covered" ? (
          <TargetChip tone="above" label="Budget covers required pace" />
        ) : null}
      </div>

      {/* Big stacked bar */}
      <div
        className="relative h-7 w-full overflow-hidden rounded-lg bg-muted"
        title={
          r.daysSinceFirstSpend != null
            ? `${r.daysSinceFirstSpend} days since first spend · ${r.spentPerDay != null ? GBP0.format(Math.round(r.spentPerDay)) + "/day" : ""}`
            : undefined
        }
      >
        {/* spent fill */}
        <div
          className="relative h-full bg-foreground/80"
          style={{ width: `${Math.min(100, spentPct)}%` }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
          {spentPct > 22 && (
            <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-medium tabular-nums text-background">
              Spent {GBP0.format(Math.round(r.spent))}
            </span>
          )}
        </div>
        {/* overshoot segment (required beyond allocated) */}
        {overshoot && allocatedPct != null && requiredPct != null && (
          <div
            className="absolute top-0 h-full bg-red-500/70"
            style={{
              left: `${allocatedPct}%`,
              width: `${Math.min(100, requiredPct) - allocatedPct}%`,
            }}
            aria-hidden
          />
        )}
        {/* allocated end marker */}
        {allocatedPct != null && (
          <div
            className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-foreground"
            style={{ left: `${Math.min(100, allocatedPct)}%` }}
            title={`Allocated ${GBP0.format(Math.round(r.allocated ?? 0))}`}
          />
        )}
        {/* required-to-sellout divider */}
        {requiredPct != null && (
          <div
            className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 border-l-2 border-dotted border-foreground/80 bg-transparent"
            style={{ left: `${Math.min(100, requiredPct)}%` }}
            title={`Required to sell out ${GBP0.format(Math.round(requiredTotal ?? 0))}`}
          />
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{GBP0.format(0)}</span>
        <span>
          {r.allocated != null
            ? `Allocated ${GBP0.format(Math.round(r.allocated))}`
            : "No budget set"}
          {requiredTotal != null ? " · ┊ required to sell out" : ""}
        </span>
      </div>

      {/* 3 stat tiles */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatTile
          label="Live CPT"
          value={
            r.liveCostPerTicket == null
              ? "—"
              : GBP2.format(r.liveCostPerTicket)
          }
          chip={
            r.liveCostPerTicket != null ? (
              <BenchmarkChip
                tone={inverseTone(
                  r.liveCostPerTicket,
                  bench.benchmarkCostPerTicket,
                )}
                delta={deltaFraction(
                  bench.benchmarkCostPerTicket,
                  r.liveCostPerTicket,
                )}
              />
            ) : null
          }
        />
        <StatTile
          label="Required / day"
          value={
            r.requiredPerDay == null
              ? "—"
              : GBP0.format(Math.round(r.requiredPerDay))
          }
          chip={
            r.spentPerDay != null && r.requiredPerDay != null ? (
              <TargetChip
                label={`${GBP0.format(Math.round(r.spentPerDay))}/day now`}
              />
            ) : null
          }
        />
        <StatTile
          label="Days remaining"
          value={
            daysToEvent == null
              ? "—"
              : daysToEvent < 0
                ? "Past"
                : NUM.format(daysToEvent)
          }
          chip={null}
        />
      </div>

      {cptProjection && cptProjection.currentCostPerTicket != null ? (
        <CptProjectionPanel projection={cptProjection} />
      ) : null}
    </article>
  );
}

/**
 * CPT-at-sellout + budget-anchor surfacing (Workstream D of the WC26
 * reconciliation). Three derived read-outs framing whether the venue's
 * current efficiency fits its implicit £/ticket budget anchor. All
 * values come from the canonical funnel — no new data.
 */
function CptProjectionPanel({ projection: p }: { projection: VenueCptProjection }) {
  const headroom = p.budgetHeadroomPerTicket;
  const headroomTotal = p.budgetHeadroomTotal;
  const tone = p.headroomTone ?? "neutral";
  const c = toneColors(tone);

  const headroomCopy = (() => {
    if (headroom == null || headroomTotal == null) return null;
    if (headroom >= 0) {
      return `Under budget by ${GBP2.format(headroom)}/ticket · ${GBP0.format(
        Math.round(headroomTotal),
      )} total headroom available`;
    }
    return `Over budget by ${GBP2.format(Math.abs(headroom))}/ticket · need to drop CPT by ${GBP0.format(
      Math.round(Math.abs(headroomTotal)),
    )} to fit`;
  })();

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        CPT projection
      </p>
      <dl className="mt-2 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            CPT at sellout
            <span className="ml-1 text-[11px] text-muted-foreground/70">
              (at current efficiency)
            </span>
          </dt>
          <dd className="font-heading tabular-nums">
            {p.costPerTicketAtSellout == null
              ? "—"
              : GBP2.format(p.costPerTicketAtSellout)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">Budget anchor</dt>
          <dd className="font-heading tabular-nums">
            {p.budgetAnchorCostPerTicket == null
              ? "—"
              : `${GBP2.format(p.budgetAnchorCostPerTicket)} / ticket`}
          </dd>
        </div>
      </dl>
      {headroomCopy ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 text-[13px] font-medium ${c.chipBg} ${c.chipText}`}
          role="status"
        >
          {headroomCopy}
        </p>
      ) : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  chip,
}: {
  label: string;
  value: string;
  chip: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex items-start justify-between gap-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
      </div>
      <p className="mt-1 font-heading text-xl tracking-wide tabular-nums">
        {value}
      </p>
      {chip ? <div className="mt-1.5">{chip}</div> : null}
    </div>
  );
}
