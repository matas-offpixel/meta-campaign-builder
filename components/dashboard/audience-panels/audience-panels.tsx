"use client";

import { useSearchParams } from "next/navigation";

import { SignupGeography } from "@/components/dashboard/page-audience/signup-geography";
import type { AudiencePanels as Panels, AudiencePanelsByView } from "@/lib/dashboard/audience-panels";
import type { GeographyByView, GeographyModel } from "@/lib/dashboard/page-audience-panel/model";

import { DirectToFanPanel } from "./direct-to-fan-panel";
import { WhoWeReachedPanel } from "./who-we-reached-panel";

/** Both panels for one view. Frames mount this directly. HE2's signup geography sits in Who we reached. */
export function AudiencePanels({ panels, geography }: { panels: Panels; geography?: GeographyModel | null }) {
  return (
    <div className="flex min-w-0 flex-col" data-audience-panels>
      <WhoWeReachedPanel model={panels.reach} aside={geography ? <SignupGeography model={geography} /> : undefined} />
      <DirectToFanPanel model={panels.d2c} />
    </div>
  );
}

/**
 * The sales pages: the panels follow the view the dashboard has open.
 * SalesDashboard writes `show` on every chip and venue choice (venue-query.ts),
 * so the view is `?show=` when it names one, else the page's initial view.
 */
export function AudiencePanelsUrl({
  byView,
  initialViewId,
  geographyByView,
}: {
  byView: AudiencePanelsByView;
  initialViewId: string;
  geographyByView?: GeographyByView | null;
}) {
  const params = useSearchParams();
  const show = params.get("show")?.toLowerCase();
  const viewId = show && byView[show] ? show : initialViewId;
  const panels = byView[viewId];
  if (!panels) return null;
  return <AudiencePanels panels={panels} geography={geographyByView?.[viewId] ?? null} />;
}
