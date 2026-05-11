import type { ClientWideTotals } from "@/lib/db/client-dashboard-aggregations";

interface Props {
  clientName: string;
  /** Active-only totals — shown as headline values. */
  totals: ClientWideTotals;
  /** Past-group totals — shown as muted breakdown subtext when non-zero. */
  pastTotals?: ClientWideTotals;
  /** Cancelled-group totals — shown as muted breakdown subtext when non-zero. */
  cancelledTotals?: ClientWideTotals;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-GB");

function formatGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
}

function formatNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return NUM.format(n);
}

function formatRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function roasClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n >= 3) return "text-success";
  if (n < 1) return "text-destructive";
  return "text-foreground";
}

/**
 * Client-wide topline block. Renders only when the client spans 2+
 * venue groups — a single-venue client already has its numbers on
 * the one card below and the topline would be a redundant repeat.
 *
 * Always lifetime. The per-venue cards keep their own timeframe pill
 * for drill-down; the topline deliberately stays pinned to lifetime
 * so operators can reconcile "this week vs. lifetime" in one glance
 * without a second control to adjust.
 */
export function ClientWideTopline({ clientName, totals, pastTotals, cancelledTotals }: Props) {
  const hasPast = (pastTotals?.venueGroups ?? 0) > 0;
  const hasCancelled = (cancelledTotals?.venueGroups ?? 0) > 0;
  const hasBreakdown = hasPast || hasCancelled;
  return (
    <section className="overflow-hidden rounded-md border-2 border-foreground bg-card shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border bg-foreground px-4 py-3 text-background">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-background/70">
            {clientName} · Client dashboard
          </p>
          <p className="mt-1 text-sm text-background/85">
            <span className="font-semibold text-background">
              {formatNumber(totals.venueGroups)}
            </span>{" "}
            {totals.venueGroups === 1 ? "venue" : "venues"}{" "}
            · <span className="font-semibold text-background">
              {formatNumber(totals.events)}
            </span>{" "}
            {totals.events === 1 ? "event" : "events"}{" "}
            · <span className="font-semibold text-background">
              {formatNumber(totals.ticketsSold)}
            </span>{" "}
            tickets sold to date
            {totals.ticketRevenue !== null && (
              <>
                {" "}· <span className="font-semibold text-background">
                  {formatGBP(totals.ticketRevenue)}
                </span>{" "}
                total revenue
              </>
            )}
          </p>
        </div>
      </header>
      {/* Stat grid — 7 cards lifetime. Budget + Spend pair leads so
          operators read "what was planned" before "what was spent".
          Wraps to 2 rows on narrow viewports (sm:grid-cols-4 → 2×4
          minus one empty cell, then a short 3-card row). */}
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 lg:grid-cols-7">
        <Stat
          label="Marketing budget"
          value={formatGBP(totals.marketingBudget)}
        />
        <Stat
          label="Marketing spend"
          value={formatGBP(totals.marketingSpend)}
        />
        <Stat label="Ad spend" value={formatGBP(totals.adSpend)} />
        <Stat label="Total spend" value={formatGBP(totals.totalSpend)} />
        <Stat label="Tickets sold" value={formatNumber(totals.ticketsSold)} />
        <Stat
          label="Ticket revenue"
          value={formatGBP(totals.ticketRevenue)}
        />
        <Stat
          label="ROAS"
          value={formatRoas(totals.roas)}
          valueClassName={roasClass(totals.roas)}
        />
      </div>
      <footer className="flex flex-wrap items-baseline gap-3 border-t border-border bg-muted px-4 py-2.5 text-xs text-muted-foreground">
        <span>
          Pre-reg:{" "}
          <span className="font-semibold text-foreground">
            {formatGBP(totals.preregSpend)}
          </span>
        </span>
        {totals.additionalSpend > 0 && (
          <>
            <span className="text-muted-foreground/60" aria-hidden="true">·</span>
            <span>
              Other marketing:{" "}
              <span className="font-semibold text-foreground">
                {formatGBP(totals.additionalSpend)}
              </span>
            </span>
          </>
        )}
        <span className="text-muted-foreground/60" aria-hidden="true">·</span>
        <span>
          CPT:{" "}
          <span className="font-semibold text-foreground">
            {formatGBP(totals.cpt, 2)}
          </span>
        </span>
        {totals.sellThroughPct !== null && totals.capacity !== null && (
          <>
            <span className="text-muted-foreground/60" aria-hidden="true">·</span>
            <span>
              <span className="font-semibold text-foreground">
                {totals.sellThroughPct.toFixed(1)}%
              </span>{" "}
              sell-through across {formatNumber(totals.capacity)} capacity
            </span>
          </>
        )}
      </footer>
      {/* Breakdown subtext — only rendered when past or cancelled groups exist.
          Shows muted per-bucket spend so operators can reconcile the headline
          "active" figure against the full-portfolio total at a glance.
          Cancelled spend is labelled "unrecoverable" because it was paid to Meta
          regardless of refunds and represents a real sunk cost. */}
      {hasBreakdown && (
        <div className="border-t border-border/50 bg-muted/50 px-4 py-2 text-[11px] text-muted-foreground/70">
          <span className="font-medium text-muted-foreground">
            Marketing spend breakdown:
          </span>
          {" "}
          <span className="font-semibold text-foreground/80">
            {formatGBP(totals.marketingSpend)}
          </span>{" "}active
          {hasPast && (
            <>
              {" · "}
              <span className="font-semibold text-foreground/60">
                {formatGBP(pastTotals!.marketingSpend)}
              </span>{" "}past
            </>
          )}
          {hasCancelled && (
            <>
              {" · "}
              <span className="font-semibold text-destructive/70">
                {formatGBP(cancelledTotals!.marketingSpend)}
              </span>{" "}cancelled (unrecoverable)
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-heading text-xl tabular-nums ${valueClassName ?? "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}
