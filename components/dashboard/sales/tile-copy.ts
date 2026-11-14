import type { SalesMetricId, SalesPeriod, SalesTotal } from "@/lib/dashboard/sales-vs-spend";

/** N7 names. The metric table in the model still has the earlier labels. */
export const TILE_NAMES: Record<SalesMetricId, { wide: string; narrow: string }> = {
  spend: { wide: "Spend", narrow: "Spend" },
  sold: { wide: "Total sold", narrow: "Total sold" },
  tickets: { wide: "Sales", narrow: "Sales" },
  costPerTicket: { wide: "Cost per ticket", narrow: "Cost / ticket" },
  checkoutActions: { wide: "Checkouts + add to cart", narrow: "Checkouts + carts" },
  costPerCheckout: { wide: "Cost per checkout / cart", narrow: "Cost / checkout" },
  lpv: { wide: "Landing page views", narrow: "LPVs" },
  costPerLpv: { wide: "Cost per LPV", narrow: "Cost / LPV" },
  clicks: { wide: "Clicks", narrow: "Clicks" },
  cpc: { wide: "Cost per click", narrow: "Cost / click" },
  registrations: { wide: "Registrations (CIRQLIN)", narrow: "Registrations" },
  costPerRegistration: { wide: "Cost per registration", narrow: "Cost / registration" },
};

export function periodSpan(period: SalesPeriod): string {
  if (period === "launch") return "since launch";
  if (period === "yesterday") return "yesterday";
  return `in ${period} days`;
}

export type ShowCountScope = { showsWithCounts: number; shows: number };

/** Every subline starts with its span. Sold is always the count date, whatever the period. */
export function tileSubline(
  id: SalesMetricId,
  detail: string,
  period: SalesPeriod,
  endLabel: string,
  scope: ShowCountScope | null = null,
  wide = false,
): string {
  const text = detail.trim();
  const span = periodSpan(period);
  if (id === "sold") return soldSubline(text, endLabel);
  if (id === "costPerTicket") return costPerTicketSubline(span, scope, wide);
  if (id === "tickets" && period === "launch") return `since launch, to ${endLabel}`;
  if (id === "checkoutActions") return `${span} · actions, one person can do both`;
  if (id === "costPerRegistration") return `${span} · show pages, inside their signup windows`;
  if (id === "registrations" && period === "launch") {
    if (text.toLowerCase().startsWith("to date")) return text;
    if (text === "" || text.toLowerCase() === "since launch") return "to date · signup pages close at on-sale";
    return `to date · ${text}`;
  }
  if (text.toLowerCase().startsWith(span)) return text;
  return `${span} · ${text}`;
}

function soldSubline(detail: string, endLabel: string): string {
  const line = `to date · Internal Counts, ${endLabel}`;
  const comps = detail.match(/plus\s+([\d,]+)\s+comps/i);
  return comps ? `${line} · plus ${comps[1]} comps` : line;
}

/**
 * N3 names the shows that have no counts. A single show, or a set where every
 * show has a count, stays "blended". Wide keeps "complete windows" on every
 * period except Since launch; 393 drops it.
 */
/** N3: "{scope} · Meta £x · TikTok £y". A period adds "of £{since launch} since launch". */
export function spendScopeLine(total: SalesTotal, period: SalesPeriod, launch: SalesTotal | null): string {
  const channels = total.channels.map((channel) => `${channel.label} ${channel.text}`).join(" · ");
  const line = channels ? `${total.scope} · ${channels}` : total.scope;
  if (period !== "launch" && launch) return `${line} · of ${launch.text} since launch`;
  return line;
}

function costPerTicketSubline(span: string, scope: ShowCountScope | null, wide: boolean): string {
  const body = scope && scope.showsWithCounts < scope.shows
    ? `the ${scope.showsWithCounts} shows with counts`
    : "blended";
  const line = `${span} · ${body}`;
  if (wide && span !== "since launch") return `${line} · complete windows`;
  return line;
}
