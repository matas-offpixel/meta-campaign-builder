"use client";

import { useSearchParams } from "next/navigation";

import type { AudiencePanels as Panels, AudiencePanelsByView } from "@/lib/dashboard/audience-panels";

import { DirectToFanPanel } from "./direct-to-fan-panel";
import { WhoWeReachedPanel } from "./who-we-reached-panel";

/** Both panels for one view. Frames mount this directly. */
export function AudiencePanels({ panels }: { panels: Panels }) {
  return (
    <div className="flex min-w-0 flex-col" data-audience-panels>
      <WhoWeReachedPanel model={panels.reach} />
      <DirectToFanPanel model={panels.d2c} />
    </div>
  );
}

/**
 * The sales pages: the panels follow the view the dashboard has open.
 * SalesDashboard writes `show` on every chip and venue choice (venue-query.ts),
 * so the view is `?show=` when it names one, else the page's initial view.
 */
export function AudiencePanelsUrl({ byView, initialViewId }: { byView: AudiencePanelsByView; initialViewId: string }) {
  const params = useSearchParams();
  const show = params.get("show")?.toLowerCase();
  const viewId = show && byView[show] ? show : initialViewId;
  const panels = byView[viewId];
  if (!panels) return null;
  return <AudiencePanels panels={panels} />;
}
