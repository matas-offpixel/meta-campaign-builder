import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { initialFromQuery } from "@/components/dashboard/sales/venue-query";
import { loadInternalSalesDashboard } from "@/lib/dashboard/sales-calc/server";
import { dashboardV2Enabled } from "@/lib/dashboard/sales-calc/gate";
import { pickPeriod } from "@/lib/dashboard/sales-calc/query";
import { createClient } from "@/lib/supabase/server";

/**
 * Internal sales vs spend (dashboard v2, D11). The server calc
 * (lib/dashboard/sales-calc) runs on the owner's session. 404 until
 * DASHBOARD_V2_ENABLED is exactly "1"; Matas turns it on after the live check.
 */

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string; period?: string; venue?: string }>;
}

export default async function ClientSalesPage({ params, searchParams }: Props) {
  if (!dashboardV2Enabled()) notFound();
  const { id } = await params;
  const query = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const build = await loadInternalSalesDashboard(supabase, id);
  if (!build) notFound();
  const initial = initialFromQuery(build.model, query);
  return (
    <Suspense>
      <SalesDashboardUrl
        model={build.model}
        surface="internal"
        initialShowId={initial.showId}
        initialPeriod={pickPeriod(query.period)}
        initialVenueKey={initial.venueKey}
      />
    </Suspense>
  );
}
