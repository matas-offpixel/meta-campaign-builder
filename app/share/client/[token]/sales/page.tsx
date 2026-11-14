import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { venueViewFromQuery } from "@/components/dashboard/sales/venue-query";
import { dashboardV2Enabled } from "@/lib/dashboard/sales-calc/gate";
import { pickPeriod, pickShow } from "@/lib/dashboard/sales-calc/query";
import { loadShareSalesDashboard } from "@/lib/dashboard/sales-calc/server";

/**
 * Share sales vs spend (dashboard v2, D11). Computed on our server behind
 * the client share token: the page never reads the database from the
 * viewer's browser. Client-scope tokens only, their own client's shows
 * only; no cross-client line, no audit or review figures, no "Not linked
 * to event" pill. Figures at most 5 minutes old. 404 until
 * DASHBOARD_V2_ENABLED is exactly "1".
 */

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ show?: string; period?: string; venue?: string }>;
}

export default async function ShareSalesPage({ params, searchParams }: Props) {
  if (!dashboardV2Enabled()) notFound();
  const { token } = await params;
  const query = await searchParams;
  const result = await loadShareSalesDashboard(token);
  if (!result.ok) notFound();
  return (
    <Suspense>
      <SalesDashboardUrl
        model={result.model}
        surface="share"
        initialShowId={
          query.show
            ? pickShow(result.model, query.show)
            : query.venue === "all"
              ? "all"
              : venueViewFromQuery(result.model, query.venue) ?? pickShow(result.model, undefined)
        }
        initialPeriod={pickPeriod(query.period)}
        initialVenueKey={query.venue}
      />
    </Suspense>
  );
}
