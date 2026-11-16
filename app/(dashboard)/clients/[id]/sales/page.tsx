import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { AudiencePanelsUrl } from "@/components/dashboard/audience-panels/audience-panels";
import { CreativeSectionUrl } from "@/components/dashboard/creative-section/creative-panel";
import { ObjectiveBudgetPanel } from "@/components/dashboard/objective-budget-panel/panel";
import { PresalePanel } from "@/components/dashboard/presale-panel/presale-panel";
import { loadSalesPanels } from "@/lib/dashboard/he-panels/server";
import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { initialFromQuery } from "@/components/dashboard/sales/venue-query";
import { loadInternalAudiencePanels } from "@/lib/dashboard/audience-panels-server";
import { loadInternalCreativeSection } from "@/lib/dashboard/creative-section-server";
import { loadInternalSalesDashboard } from "@/lib/dashboard/sales-calc/server";
import { dashboardV2Enabled } from "@/lib/dashboard/sales-calc/gate";
import { pickPeriod } from "@/lib/dashboard/sales-calc/query";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

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
  // HE1 + HE3: read only after the owner's session has read this client's dashboard.
  const panels = await loadInternalAudiencePanels(supabase, id, build.model);
  const he = await loadSalesPanels(createServiceRoleClient(), id, initial.showId, "internal");
  const creatives = await loadInternalCreativeSection(supabase, id, build.model);
  return (
    <Suspense>
      <SalesDashboardUrl
        model={build.model}
        surface="internal"
        initialShowId={initial.showId}
        initialPeriod={pickPeriod(query.period)}
        initialVenueKey={initial.venueKey}
      />
      {panels ? <AudiencePanelsUrl byView={panels} initialViewId={initial.showId} /> : null}
      {he.presale ? <PresalePanel model={he.presale} /> : null}
      {creatives ? <CreativeSectionUrl byView={creatives} initialViewId={initial.showId} /> : null}
      {he.budget ? <ObjectiveBudgetPanel model={he.budget} /> : null}
    </Suspense>
  );
}
