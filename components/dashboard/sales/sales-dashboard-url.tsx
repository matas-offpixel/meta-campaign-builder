"use client";

import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { applyQuery, type SalesQueryUpdate } from "@/components/dashboard/sales/venue-query";
import type { SalesDashboardModel, SalesPeriod, SalesSurface } from "@/lib/dashboard/sales-vs-spend";

/**
 * Writes `show`, `period` and `venue` into the address bar in place. The
 * native History API keeps useSearchParams in step at once, so the panels
 * under the dashboard (who we reached, direct to fan, creatives) follow the
 * venue switch with the tiles. router.replace waited for the whole page to
 * re-render on the server first; every view is already in the page.
 */
export function replaceSalesQuery(updates: SalesQueryUpdate): void {
  const search = applyQuery(window.location.search, updates);
  // null, as in the Next docs: passing Next's own history state back marks the call as Next's and skips the sync.
  window.history.replaceState(null, "", `${window.location.pathname}?${search}${window.location.hash}`);
}

/** Same tree as the frames, with `show`, `period` and `venue` kept in the query string. */
export function SalesDashboardUrl({
  model,
  surface,
  initialShowId,
  initialPeriod,
  initialVenueKey,
}: {
  model: SalesDashboardModel;
  surface: SalesSurface;
  initialShowId?: string;
  initialPeriod?: SalesPeriod;
  initialVenueKey?: string;
}) {
  return (
    <SalesDashboard
      model={model}
      surface={surface}
      initialShowId={initialShowId}
      initialPeriod={initialPeriod}
      initialVenueKey={initialVenueKey}
      onQuery={replaceSalesQuery}
    />
  );
}
