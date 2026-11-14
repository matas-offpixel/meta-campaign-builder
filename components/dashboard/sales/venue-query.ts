import type { SalesDashboardModel } from "@/lib/dashboard/sales-vs-spend";

/** `venue` is a venue_key, or "all". Returns the view that key opens. */
export function venueViewFromQuery(model: SalesDashboardModel, venue: string | undefined): string | undefined {
  if (!venue) return undefined;
  if (venue === "all") return "all";
  return model.venues?.find((item) => item.key === venue || item.viewId === venue)?.viewId;
}
