import { ObjectiveBlock, OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import type { PanelProposal } from "@/lib/onsale-refresh/read";
import { OR1_PROPOSALS, OR2_WHY, OR3_WHY, OR4_STATES, OR5_WHY, OR6_PROPOSALS, OR7_PROPOSALS, OR8_PROPOSALS, OR_APPLY_LIVE } from "@/scripts/plan-frames/refresh-fixtures";

/** The Objective block alone, in the panel's own card. */
function ObjectiveFrame({ why }: { why: PanelProposal["why"] }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <ObjectiveBlock why={why} />
    </section>
  );
}

/** Every purchase-line state (the per-event record's F2 and the ticket-platform record's F1), each drawn by the panel's own Objective block. */
function PurchaseStatesFrame() {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <p className="text-xs font-medium">Objective</p>
      <div className="mt-1 divide-y divide-border">
        {OR4_STATES.map((row) => (
          <div key={row.label} className="grid grid-cols-1 gap-x-4 py-2 sm:grid-cols-[190px_minmax(0,1fr)]" data-state={row.label}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{row.label}</p>
            <ObjectiveBlock why={row.why} heading={false} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * An OR frame: OR1 is the panel (F1 at 1280, F2 at 393 of the refresh
 * record); OR2, OR3 and OR5 are one show's Objective block; OR4 is every
 * purchase-line state; OR6 is F1 with Accept and Reject live (P2: Live,
 * budget set); OR7 is F3 after Apply; OR8 is P3's audience and budget
 * lines live. Fixture only: nothing here fetches,
 * and the clicks do nothing.
 */
export function OnSaleRefreshFrameMount({ id }: { id: string }) {
  return (
    <div data-frame-ready={`onsale/${id}`} className="bg-background px-4 py-4 text-foreground">
      {id === "OR2" ? (
        <ObjectiveFrame why={OR2_WHY} />
      ) : id === "OR3" ? (
        <ObjectiveFrame why={OR3_WHY} />
      ) : id === "OR5" ? (
        <ObjectiveFrame why={OR5_WHY} />
      ) : id === "OR4" ? (
        <PurchaseStatesFrame />
      ) : id === "OR6" ? (
        <OnSaleRefreshPanelView eventId="fixture" proposals={OR6_PROPOSALS} apply={OR_APPLY_LIVE} />
      ) : id === "OR7" ? (
        <OnSaleRefreshPanelView eventId="fixture" proposals={OR7_PROPOSALS} apply={OR_APPLY_LIVE} />
      ) : id === "OR8" ? (
        <OnSaleRefreshPanelView eventId="fixture" proposals={OR8_PROPOSALS} apply={OR_APPLY_LIVE} />
      ) : (
        <OnSaleRefreshPanelView eventId="fixture" proposals={OR1_PROPOSALS} />
      )}
    </div>
  );
}
