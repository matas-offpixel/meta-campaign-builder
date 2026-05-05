import { Info } from "lucide-react";

import type { EventTicketTierRow } from "@/lib/db/ticketing";
import { suggestedPct } from "@/lib/dashboard/suggested-pct";

interface Props {
  tiers: EventTicketTierRow[];
  title?: string;
  emptyMessage?: string;
  compact?: boolean;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-GB");

export function TicketTiersSection({
  tiers,
  title = "Ticket Tiers",
  emptyMessage = "No ticket tier breakdown has been synced yet.",
  compact = false,
}: Props) {
  const sortedTiers = [...tiers].sort(compareTierRows);

  return (
    <section className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          className={
            compact
              ? "font-heading text-sm tracking-wide text-foreground"
              : "font-heading text-lg tracking-wide text-foreground"
          }
        >
          {title}
        </h2>
        <span
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          title="Marketing comms figure. Floor 60%, +20% padding through to 95% suggested at 75% actual, then linear to 99%. Never below 60%, never above 99%."
        >
          <Info className="h-3 w-3" />
          Suggested comms %
        </span>
      </div>
      {tiers.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/70 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2 text-right">Sold / Allocation</th>
                <th className="px-3 py-2 text-right">% sold</th>
                <th className="px-3 py-2 text-right">Suggested</th>
                <th className="px-3 py-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {sortedTiers.map((tier) => {
                const price = tier.price == null ? null : Number(tier.price);
                const actualPct = tierPct(tier);
                return (
                  <tr key={tier.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {tier.tier_name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {NUM.format(tier.quantity_sold)}
                      {" / "}
                      {tier.quantity_available == null
                        ? "—"
                        : NUM.format(tier.quantity_available)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {actualPct == null ? "—" : `${Math.round(actualPct)}%`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {actualPct == null
                        ? "—"
                        : `${Math.round(suggestedPct(actualPct))}% sold`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {price == null || !Number.isFinite(price)
                        ? "—"
                        : GBP.format(price)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function tierPct(tier: EventTicketTierRow): number | null {
  return tier.quantity_available && tier.quantity_available > 0
    ? (tier.quantity_sold / tier.quantity_available) * 100
    : null;
}

function compareTierRows(a: EventTicketTierRow, b: EventTicketTierRow): number {
  const aPct = tierPct(a);
  const bPct = tierPct(b);
  const aBucket = tierSortBucket(aPct);
  const bBucket = tierSortBucket(bPct);
  if (aBucket !== bBucket) return aBucket - bBucket;
  if (aPct != null && bPct != null && aPct !== bPct) return bPct - aPct;
  return a.tier_name.localeCompare(b.tier_name);
}

function tierSortBucket(pct: number | null): number {
  if (pct != null && pct >= 100) return 0;
  if (pct != null && pct > 0) return 1;
  return 2;
}
