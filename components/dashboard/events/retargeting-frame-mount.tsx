"use client";

import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { rdStates, RD_PROPOSALS } from "@/scripts/plan-frames/retargeting-fixtures";
import { rfaPanels, rfbView, rfcView, rfeBlocks } from "@/scripts/plan-frames/retargeting-funnel-fixtures";

import { RetargetingPanelView } from "./retargeting-panel";

/**
 * The Retargeting frames from fixtures, at the width the runner opens:
 * RD (the on-sale panel's one Retargeting note, then the not-proposed
 * states, 17 Nov) and the funnel's RF-A (the Create line), RF-B (a tier at
 * its frequency ceiling), RF-C (missing advertiser access) and RF-E (what
 * Claude is told) of docs/design-record/2026-11-26-retargeting-funnel.html.
 * Read-only and in Shadow, as the records draw them. data-frame-ready
 * carries the shot's frame ("retargeting/RF-A"), which
 * scripts/plan-frames/run.mjs waits for.
 */
export function RetargetingFrameMount({ id }: { id: string }) {
  const frame = (children: React.ReactNode) => (
    <main data-frame-ready={`retargeting/${id}`} className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] space-y-4">{children}</div>
    </main>
  );
  if (id === "RF-A") {
    return frame(
      rfaPanels().map(({ caption, view, line }) => (
        <div key={line.id} className="space-y-1">
          <p className="text-xs text-muted-foreground" data-caption>
            {caption}
          </p>
          <RetargetingPanelView view={view} line={line} clientId="xmpl-client" eventId={view.code} mode="shadow" />
        </div>
      )),
    );
  }
  if (id === "RF-B") return frame(<RetargetingPanelView view={rfbView()} clientId="xmpl-client" eventId="nx26-rudimental" mode="shadow" />);
  if (id === "RF-C") return frame(<RetargetingPanelView view={rfcView()} clientId="xmpl-client" eventId="nx26-rudimental" mode="shadow" />);
  if (id === "RF-E") {
    return frame(
      rfeBlocks().map((block) => (
        <section key={block.call} className="rounded-md border border-border bg-card p-4" data-told>
          <p className="text-xs font-medium text-muted-foreground">{block.call}</p>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5">{block.lines.join("\n")}</pre>
        </section>
      )),
    );
  }
  return frame(
    <>
      <OnSaleRefreshPanelView eventId="xmpl-whse" proposals={RD_PROPOSALS} />
      {rdStates().map((view) => (
        <RetargetingPanelView key={view.code} view={view} mode="shadow" />
      ))}
    </>,
  );
}
