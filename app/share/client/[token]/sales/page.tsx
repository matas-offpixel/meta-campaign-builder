import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AudiencePanelsUrl } from "@/components/dashboard/audience-panels/audience-panels";
import { CreativeSectionUrl } from "@/components/dashboard/creative-section/creative-panel";
import { SignupsPanelUrl } from "@/components/dashboard/page-audience/signups-panel";
import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { initialFromQuery } from "@/components/dashboard/sales/venue-query";
import { loadShareAudiencePanels } from "@/lib/dashboard/audience-panels-server";
import { loadShareCreativeSection } from "@/lib/dashboard/creative-section-server";
import { loadSharePageAudiencePanels } from "@/lib/dashboard/page-audience-panel/server";
import { resolveShareByToken } from "@/lib/db/report-shares";
import { dashboardV2Enabled } from "@/lib/dashboard/sales-calc/gate";
import { pickPeriod } from "@/lib/dashboard/sales-calc/query";
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
  const initial = initialFromQuery(result.model, query);
  // HE1 + HE3: the same token, its own client only (loadShareSalesDashboard has already refused any other scope).
  const resolved = await resolveShareByToken(token);
  const clientId = resolved.ok && resolved.share.scope === "client" ? resolved.share.client_id : null;
  const panels = clientId ? await loadShareAudiencePanels(clientId, result.model) : null;
  const creatives = clientId ? await loadShareCreativeSection(clientId, result.model) : null;
  // HE2: CIRQLIN page audience, stored rows only.
  const audience = clientId ? await loadSharePageAudiencePanels(clientId, result.model) : null;
  return (
    <Suspense>
      <SalesDashboardUrl
        model={result.model}
        surface="share"
        initialShowId={initial.showId}
        initialPeriod={pickPeriod(query.period)}
        initialVenueKey={initial.venueKey}
      />
      {panels ? <AudiencePanelsUrl byView={panels} initialViewId={initial.showId} geographyByView={audience?.geography} /> : null}
      {audience ? <SignupsPanelUrl byView={audience.signups} initialViewId={initial.showId} initialPeriod={pickPeriod(query.period) ?? result.model.initialPeriod} /> : null}
      {creatives ? <CreativeSectionUrl byView={creatives} initialViewId={initial.showId} /> : null}
    </Suspense>
  );
}
