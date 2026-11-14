import { pickShow } from "@/lib/dashboard/sales-calc/query";
import type { SalesDashboardModel } from "@/lib/dashboard/sales-vs-spend";

export type SalesQueryKey = "show" | "period" | "venue";
export type SalesQueryUpdate = Partial<Record<SalesQueryKey, string>>;

/** `venue` is a venue_key, or "all". Returns the view that key opens. */
export function venueViewFromQuery(model: SalesDashboardModel, venue: string | undefined): string | undefined {
  if (!venue) return undefined;
  if (venue === "all") return "all";
  return model.venues?.find((item) => item.key === venue || item.viewId === venue)?.viewId;
}

/**
 * Both sales pages read the query through this. `?venue=all` opens All
 * venues. An older link that carries only `?show=all` (what the page wrote
 * before #1230's fix) opens All venues too, never the default venue.
 */
export function initialFromQuery(
  model: SalesDashboardModel,
  query: { show?: string; venue?: string },
): { showId: string; venueKey: string | undefined } {
  const showId = query.show
    ? pickShow(model, query.show)
    : query.venue === "all"
      ? "all"
      : venueViewFromQuery(model, query.venue) ?? pickShow(model, undefined);
  const venueKey = query.venue ?? (query.show && showId === "all" ? "all" : undefined);
  return { showId, venueKey };
}

/** Every key in one write, so a venue click can't lose `venue` to the `show` written after it. */
export function applyQuery(search: string, updates: SalesQueryUpdate): string {
  const next = new URLSearchParams(search);
  for (const [key, value] of Object.entries(updates)) if (value != null) next.set(key, value);
  return next.toString();
}
