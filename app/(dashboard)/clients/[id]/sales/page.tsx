import { Suspense } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { SalesDashboardUrl } from "@/components/dashboard/sales/sales-dashboard-url";
import { NX_SALES_FIXTURE } from "@/lib/dashboard/sales-vs-spend-fixture";
import { SALES_PERIODS, type SalesPeriod } from "@/lib/dashboard/sales-vs-spend";

interface Props {
  searchParams: Promise<{ show?: string; period?: string }>;
}

const PERIOD_IDS = new Set(SALES_PERIODS.map((item) => item.id));

function periodFromQuery(value: string | undefined): SalesPeriod | undefined {
  if (value && PERIOD_IDS.has(value as SalesPeriod)) return value as SalesPeriod;
  return undefined;
}

/**
 * Internal sales vs spend. The figures are the 12 Nov NX fixture until the
 * server calc fills `SalesDashboardModel`.
 */
export default async function ClientSalesPage({ searchParams }: Props) {
  const query = await searchParams;
  return (
    <>
      <PageHeader
        title="Sales vs spend"
        description="12 Nov NX fixture, until the server calc is connected."
      />
      <Suspense>
        <SalesDashboardUrl
          model={NX_SALES_FIXTURE}
          surface="internal"
          initialShowId={query.show}
          initialPeriod={periodFromQuery(query.period)}
        />
      </Suspense>
    </>
  );
}
