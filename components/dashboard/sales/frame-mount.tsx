import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NX_SALES_FIXTURE } from "@/lib/dashboard/sales-vs-spend-fixture";
import { DASHBOARD_V2_FRAMES, type DashboardV2FrameId } from "@/scripts/plan-frames/dashboard-v2-ids";

export function SalesFrameMount({ id }: { id: string }) {
  const frame = DASHBOARD_V2_FRAMES[id as DashboardV2FrameId];
  if (!frame) return null;
  return (
    <div data-frame-ready={`sales/${id}`} className="bg-background">
      <SalesDashboard model={NX_SALES_FIXTURE} surface={frame.surface} initialShowId={frame.showId} initialPeriod="14" />
    </div>
  );
}
