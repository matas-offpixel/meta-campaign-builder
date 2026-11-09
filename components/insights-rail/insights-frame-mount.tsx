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
    ) : fixture.page.kind === "today" ? (
      <>
        <PageHeader
          title="Today · Sun 8 Nov"
          description="3 to approve · 2 reads due · 1 held"
          actions={
            <span className="inline-flex items-center gap-2">
              <span className="inline-flex h-[26px] items-center rounded-full border border-border-strong bg-card px-2.5 text-[11.5px] font-semibold">Insights ›</span>
              <button type="button" className="h-6 rounded-md bg-foreground px-2.5 text-[11.5px] font-semibold text-background">
                Approve all 3
              </button>
            </span>
          }
        />
        <main className="flex-1 px-6 py-4">
          <div className="mx-auto max-w-6xl space-y-2.5">
            <section className="rounded-md border border-border bg-card p-3">
              <p className="mb-1.5 text-[9px] font-bold tracking-[.16em] text-muted-foreground uppercase">To approve</p>
              {["Puzzle · 3rd release 90% sold out · proposed from Mon read", "Puzzle · artist card · Reeshy", "NX Loves · EED presale reminder"].map((label) => (
                <div key={label} className="my-1.5 flex items-center justify-between rounded-md border border-border px-2.5 py-2 text-[12px]">
                  <span>{label}</span>
                  <button type="button" className="h-6 rounded-md border border-border-strong px-2 text-[11.5px] font-semibold">
                    Approve
                  </button>
                </div>
              ))}
            </section>
            <section className="rounded-md border border-border bg-card p-3">
              <p className="mb-1.5 text-[9px] font-bold tracking-[.16em] text-muted-foreground uppercase">Reads due</p>
              <div className="my-1.5 h-2.5 w-3/5 rounded bg-muted" />
              <div className="my-1.5 h-2.5 w-[45%] rounded bg-muted" />
            </section>
            <section className="rounded-md border border-border bg-card p-3">
              <p className="mb-1.5 text-[9px] font-bold tracking-[.16em] text-muted-foreground uppercase">Held</p>
              <div className="my-1.5 h-2.5 w-1/2 rounded bg-muted" />
            </section>
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
