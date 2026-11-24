"use client";

import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { raView, rbLine, rbView, rdStates, RD_PROPOSALS } from "@/scripts/plan-frames/retargeting-fixtures";

import { RetargetingPanelView } from "./retargeting-panel";

/**
 * RA (a running campaign's rows, PR B's lines), RB (a new show's Create
 * line with all three missing states) and RD (the
 * on-sale panel's one Retargeting note, then the not-proposed states) from
 * fixtures, at the width the runner opens. Read-only and in Shadow, as the
 * record draws them. data-frame-ready carries the shot's frame
 * ("retargeting/RB"), which scripts/plan-frames/run.mjs waits for.
 */
export function RetargetingFrameMount({ id }: { id: string }) {
  if (id === "RA") {
    return (
      <main data-frame-ready="retargeting/RA" className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <div className="mx-auto max-w-[72rem]">
          <RetargetingPanelView view={raView()} clientId="xmpl-client" eventId="xmpl-whse" mode="shadow" />
        </div>
      </main>
    );
  }
  if (id === "RB") {
    const view = rbView();
    return (
      <main data-frame-ready="retargeting/RB" className="min-h-screen bg-background p-4 text-foreground sm:p-8">
        <div className="mx-auto max-w-[72rem]">
          <RetargetingPanelView view={view} line={rbLine(view)} clientId="xmpl-client" eventId="xmpl-roof" mode="shadow" />
        </div>
      </main>
    );
  }
  return (
    <main data-frame-ready="retargeting/RD" className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] space-y-4">
        <OnSaleRefreshPanelView eventId="xmpl-whse" proposals={RD_PROPOSALS} />
        {rdStates().map((view) => (
          <RetargetingPanelView key={view.code} view={view} mode="shadow" />
        ))}
      </div>
    </main>
  );
}
