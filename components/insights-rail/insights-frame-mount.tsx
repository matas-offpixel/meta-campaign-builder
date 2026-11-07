"use client";

import { useEffect } from "react";

import { CreativeLabCard } from "@/components/dashboard/events/creative-lab-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { seedAddedClusters } from "@/components/insights-rail/add-cluster";
import { AddedClustersFromInsights } from "@/components/insights-rail/added-clusters";
import { InsightsPill } from "@/components/insights-rail/insights-pill";
import { InsightsRail } from "@/components/insights-rail/insights-rail";
import { InsightsRailProvider } from "@/components/insights-rail/rail-context";
import { PlanFrameMount } from "@/components/plan/plan-frame-mount";
import type { RailFrameFixture } from "@/scripts/plan-frames/rail-fixtures";

/**
 * An IR frame: the operator layout's shape (page column + rail) on a
 * fixture, with the rail's data given instead of fetched. The event page
 * is its header with the pill and the Creative Lab card; the canvas is
 * the plan-frames canvas; the audience builder is its header, the
 * interests the rail added (IR5) and a placeholder card. Rail-only frames
 * put the ready mark on the rail, as the record draws them.
 */
export function InsightsRailFrameMount({ fixture }: { fixture: RailFrameFixture }) {
  const added = fixture.page.kind === "audience" ? fixture.page.added : null;
  useEffect(() => {
    if (added) seedAddedClusters(added);
  }, [added]);
  const page =
    fixture.page.kind === "audience" ? (
      <>
        <PageHeader title={`Audience builder · ${fixture.context.clientName ?? ""}`} description={`${fixture.page.stageLabel} · ${fixture.page.draftCount} audiences in this draft`} actions={<InsightsPill />} />
        <main className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-6xl space-y-4">
            <AddedClustersFromInsights />
            <div aria-hidden className="h-[220px] rounded-md border border-border bg-card p-4">
              <div className="my-1.5 h-2.5 w-3/5 rounded bg-muted" />
              <div className="my-1.5 h-2.5 w-[70%] rounded bg-muted" />
              <div className="my-1.5 h-2.5 w-[35%] rounded bg-muted" />
            </div>
          </div>
        </main>
      </>
    ) : fixture.page.kind === "event" ? (
      <>
        <PageHeader
          title={fixture.page.lab.eventName}
          description={[fixture.page.lab.clientName, fixture.page.lab.eventStatus?.replace("_", " "), `Next payday ${fixture.page.lab.paydayLabel}. ${fixture.page.lab.daysToEvent} days to the event.`].filter(Boolean).join(" · ")}
          actions={<InsightsPill />}
        />
        <main className="flex-1 px-6 py-6">
          <div className="mx-auto max-w-[88rem] space-y-6">
            <CreativeLabCard lab={fixture.page.lab} />
          </div>
        </main>
      </>
    ) : (
      <PlanFrameMount fixture={fixture.page.plan} />
    );
  return (
    <InsightsRailProvider operator fixture={{ context: fixture.context, data: fixture.data, open: fixture.open }}>
      {fixture.railOnly ? (
        <div data-frame-ready={fixture.id} className="flex w-[360px] bg-background text-foreground">
          <InsightsRail />
        </div>
      ) : (
        // The sheet and scrim are fixed; the transform makes this frame
        // their containing block, and below 768 the frame is a phone's height
        // (852), as the record draws it, so the sheet sits inside the shot.
        <div data-frame-ready={fixture.id} className="relative flex min-h-screen transform-gpu bg-background text-foreground max-md:h-[852px] max-md:min-h-0 max-md:overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col">{page}</div>
          <InsightsRail />
        </div>
      )}
    </InsightsRailProvider>
  );
}
