import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NX_SALES_FIXTURE, NX_SALES_LIVE_LIKE } from "@/lib/dashboard/sales-vs-spend-fixture";
import { DASHBOARD_V2_FRAMES, type DashboardV2FrameId } from "@/scripts/plan-frames/dashboard-v2-ids";

export function SalesFrameMount({ id }: { id: string }) {
  const frame = DASHBOARD_V2_FRAMES[id as DashboardV2FrameId];
  if (!frame) return null;
  return (
    // A flex column, as both sales pages put the section (the share page's
    // <body>, the internal layout's column). In a block parent the MB1 bug
    // never shows, which is how CI missed it.
    <div data-frame-ready={`sales/${id}`} className="flex flex-col bg-background">
      <SalesDashboard
        model={frame.fixture === "live" ? NX_SALES_LIVE_LIKE : NX_SALES_FIXTURE}
        surface={frame.surface}
        initialShowId={frame.showId}
        initialPeriod={frame.period}
        pinHover={frame.pinHover === true}
        pinSpend={frame.pinSpend === true}
        initialVenueKey={frame.venueKey}
      />
    </div>
  );
}
