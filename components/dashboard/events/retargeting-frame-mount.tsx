"use client";

import { OnSaleRefreshPanelView } from "@/components/dashboard/events/onsale-refresh-panel";
import { ClaudeMetaRow } from "@/components/dashboard/today/claude-meta-row";
import { rdStates, RD_PROPOSALS } from "@/scripts/plan-frames/retargeting-fixtures";
import { rfbView, rfcView, twaPanels, twbPanels, twcFrames, twdBlocks, type CaptionedPanel } from "@/scripts/plan-frames/retargeting-funnel-fixtures";

import { FunnelWiderRow, RetargetingPanelView } from "./retargeting-panel";

/**
 * The Retargeting frames from fixtures, at the width the runner opens:
 * RD (the on-sale panel's one Retargeting note, then the not-proposed
 * states, 17 Nov); TW-A (the two-campaign Create line, on sale and
 * presale), TW-B (Similar with and without a group), TW-C (Wider's
 * lifetime step, on Today, and the floor) and TW-D (what Claude is told)
 * of docs/design-record/2026-11-26-retargeting-two-campaigns.html; and the
 * funnel's RF-B (a tier at its frequency ceiling) and RF-C (missing
 * advertiser access), which stand. Read-only and in Shadow, as the records
 * draw them. data-frame-ready carries the shot's frame ("retargeting/TW-A"),
 * which scripts/plan-frames/run.mjs waits for.
 */
export function RetargetingFrameMount({ id }: { id: string }) {
  const frame = (children: React.ReactNode) => (
    <main data-frame-ready={`retargeting/${id}`} className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem] space-y-4">{children}</div>
    </main>
  );
  const caption = (text: string) => (
    <p className="text-xs text-muted-foreground" data-caption>
      {text}
    </p>
  );
  const panels = (list: CaptionedPanel[]) =>
    frame(
      list.map(({ caption: text, view, line }) => (
        <div key={text} className="space-y-1">
          {caption(text)}
          <RetargetingPanelView view={view} line={line} clientId="xmpl-client" eventId={view.code} mode="shadow" />
        </div>
      )),
    );
  if (id === "TW-A") return panels(twaPanels());
  if (id === "TW-B") return panels(twbPanels());
  if (id === "TW-C") {
    const { widers, today, floor } = twcFrames();
    const block = (w: (typeof widers)[number]) => (
      <div key={w.caption} className="space-y-1">
        {caption(w.caption)}
        <section className="rounded-md border border-border bg-card p-4">
          <FunnelWiderRow wider={w.wider} next={w.next} />
        </section>
      </div>
    );
    return frame(
      <>
        {widers.map(block)}
        <div className="space-y-1">
          {caption("The step on Today (MB1)")}
          <ul className="space-y-2">
            <ClaudeMetaRow row={today} />
          </ul>
        </div>
        {block(floor)}
      </>,
    );
  }
  if (id === "TW-D") {
    return frame(
      twdBlocks().map((block) => (
        <div key={block.call} className="space-y-1">
          {block.caption ? caption(block.caption) : null}
          <section className="rounded-md border border-border bg-card p-4" data-told>
            <p className="text-xs font-medium text-muted-foreground">{block.call}</p>
            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5">{block.lines.join("\n")}</pre>
          </section>
        </div>
      )),
    );
  }
  if (id === "RF-B") return frame(<RetargetingPanelView view={rfbView()} clientId="xmpl-client" eventId="nx26-rudimental" mode="shadow" />);
  if (id === "RF-C") return frame(<RetargetingPanelView view={rfcView()} clientId="xmpl-client" eventId="nx26-rudimental" mode="shadow" />);
  return frame(
    <>
      <OnSaleRefreshPanelView eventId="xmpl-whse" proposals={RD_PROPOSALS} />
      {rdStates().map((view) => (
        <RetargetingPanelView key={view.code} view={view} mode="shadow" />
      ))}
    </>,
  );
}
