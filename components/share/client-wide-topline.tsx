import type { ClientWideTotals } from "@/lib/db/client-dashboard-aggregations";

interface Props {
  clientName: string;
  totals: ClientWideTotals;
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
export function ClientWideTopline({ clientName, totals }: Props) {
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
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
        <Stat label="Total spend" value={formatGBP(totals.totalSpend)} />
        <Stat label="Ad spend" value={formatGBP(totals.adSpend)} />
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
