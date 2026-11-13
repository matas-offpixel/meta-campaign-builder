import { Suspense } from "react";
import { notFound } from "next/navigation";

import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { NX_SALES_FIXTURE, NX_SHARE_FIXTURE_TOKEN } from "@/lib/dashboard/sales-vs-spend-fixture";
import { SALES_PERIODS, salesForSurface, type SalesPeriod } from "@/lib/dashboard/sales-vs-spend";

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ show?: string; period?: string }>;
}

const PERIOD_IDS = new Set(SALES_PERIODS.map((item) => item.id));

/**
 * Share variant of the sales layout. The fixture token is the only one
 * that renders until the server calc resolves a real share token.
 * Cross-client learnings stay off this surface.
 */
export default async function ShareSalesPage({ params, searchParams }: Props) {
  const { token } = await params;
  if (token !== NX_SHARE_FIXTURE_TOKEN) notFound();
  const query = await searchParams;
  const period = query.period && PERIOD_IDS.has(query.period as SalesPeriod) ? (query.period as SalesPeriod) : undefined;
  return (
    <main className="min-h-screen bg-background">
      <Suspense>
        <SalesDashboardUrl
          model={salesForSurface(NX_SALES_FIXTURE, "share")}
          surface="share"
          initialShowId={query.show}
          initialPeriod={period}
        />
      </Suspense>
    </main>
  );
}
