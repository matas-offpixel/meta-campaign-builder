"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import type { SalesDashboardModel, SalesPeriod, SalesSurface } from "@/lib/dashboard/sales-vs-spend";

/** Same tree as the frames, with `show` and `period` kept in the query string. */
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
  const router = useRouter();
  const params = useSearchParams();
  return (
    <SalesDashboard
      model={model}
      surface={surface}
      initialShowId={initialShowId}
      initialPeriod={initialPeriod}
      initialVenueKey={initialVenueKey}
      onQuery={(key, value) => {
        const next = new URLSearchParams(params.toString());
        next.set(key, value);
        router.replace(`?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
