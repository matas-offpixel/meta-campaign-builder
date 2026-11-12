import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { OR1_PROPOSALS } from "@/scripts/plan-frames/refresh-fixtures";

/** An OR frame (F1 at 1280, F2 at 393). Fixture only: nothing here fetches. */
export function OnSaleRefreshFrameMount({ id, width }: { id: string; width: number }) {
  return (
    <div data-frame-ready={id} className="bg-background px-4 py-4 text-foreground">
      <OnSaleRefreshPanelView eventId="fixture" proposals={OR1_PROPOSALS} wide={width >= 768} />
    </div>
  );
}
