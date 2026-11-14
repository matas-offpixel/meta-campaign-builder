import { SalesDashboard } from "@/components/dashboard/sales/sales-dashboard";
import { NX_SALES_FIXTURE, NX_SALES_LIVE_LIKE } from "@/lib/dashboard/sales-vs-spend-fixture";
import { DASHBOARD_V2_FRAMES, type DashboardV2FrameId } from "@/scripts/plan-frames/dashboard-v2-ids";

/** The record's fold: a dashed line at the first screen's height, the part below dimmed. Frames only. */
function FoldLine({ width, height }: { width: number; height: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0" style={{ top: height }} data-fold>
      <div className="absolute inset-0 bg-background/55" />
      <div className="absolute inset-x-0 top-0 border-t border-dashed border-foreground" />
      <span className="absolute right-2 top-0.5 bg-background px-1 font-mono text-[9px] text-muted-foreground">
        fold · {width}×{height}
      </span>
    </div>
  );
}

export function SalesFrameMount({ id }: { id: string }) {
  const frame = DASHBOARD_V2_FRAMES[id as DashboardV2FrameId];
  if (!frame) return null;
  return (
    // A flex column, as both sales pages put the section (the share page's
    // <body>, the internal layout's column). In a block parent the MB1 bug
    // never shows, which is how CI missed it.
    <div data-frame-ready={`sales/${id}`} className="relative flex flex-col bg-background">
      <SalesDashboard
        model={frame.fixture === "live" ? NX_SALES_LIVE_LIKE : NX_SALES_FIXTURE}
        surface={frame.surface}
        initialShowId={frame.showId}
        initialPeriod={frame.period}
        pinHover={frame.pinHover === true}
        pinSpend={frame.pinSpend === true}
        initialVenueKey={frame.venueKey}
        phoneMoreOpen={frame.moreOpen}
        phoneHoldDay={frame.holdDay ?? null}
        phoneChartOpenAt={frame.chartOpenAt}
      />
      {frame.fold ? <FoldLine width={frame.fold.width} height={frame.fold.height} /> : null}
    </div>
  );
}
