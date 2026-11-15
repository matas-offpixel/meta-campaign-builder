import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AudiencePanelsUrl } from "@/components/dashboard/audience-panels/audience-panels";
import { ObjectiveBudgetPanel } from "@/components/dashboard/objective-budget-panel/panel";
import { PresalePanel } from "@/components/dashboard/presale-panel/presale-panel";
import { loadSalesPanels } from "@/lib/dashboard/he-panels/server";
import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { initialFromQuery } from "@/components/dashboard/sales/venue-query";
import { loadShareAudiencePanels } from "@/lib/dashboard/audience-panels-server";
import { resolveShareByToken } from "@/lib/db/report-shares";
import { dashboardV2Enabled } from "@/lib/dashboard/sales-calc/gate";
import { pickPeriod } from "@/lib/dashboard/sales-calc/query";
import { loadShareSalesDashboard } from "@/lib/dashboard/sales-calc/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
  const initial = initialFromQuery(result.model, query);
  // HE1 + HE3: the same token, its own client only (loadShareSalesDashboard has already refused any other scope).
  const resolved = await resolveShareByToken(token);
  const clientId = resolved.ok && resolved.share.scope === "client" ? resolved.share.client_id : null;
  const panels = clientId ? await loadShareAudiencePanels(clientId, result.model) : null;
  const he = clientId ? await loadSalesPanels(createServiceRoleClient(), clientId, initial.showId, "share") : null;
  return (
    <Suspense>
      <SalesDashboardUrl
        model={result.model}
        surface="share"
        initialShowId={initial.showId}
        initialPeriod={pickPeriod(query.period)}
        initialVenueKey={initial.venueKey}
      />
      {panels ? <AudiencePanelsUrl byView={panels} initialViewId={initial.showId} /> : null}
      {he?.presale ? <PresalePanel model={he.presale} /> : null}
      {he?.budget ? <ObjectiveBudgetPanel model={he.budget} /> : null}
    </Suspense>
  );
}
