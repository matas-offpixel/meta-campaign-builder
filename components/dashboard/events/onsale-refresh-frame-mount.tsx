import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { OR1_PROPOSALS } from "@/scripts/plan-frames/refresh-fixtures";

/** An OR frame (F1 at 1280, F2 at 393): the viewport decides the stack. Fixture only: nothing here fetches. */
export function OnSaleRefreshFrameMount({ id }: { id: string }) {
  return (
    <div data-frame-ready={`onsale/${id}`} className="bg-background px-4 py-4 text-foreground">
      <OnSaleRefreshPanelView eventId="fixture" proposals={OR1_PROPOSALS} />
    </div>
  );
}
