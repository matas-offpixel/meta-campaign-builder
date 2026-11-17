"use client";

import { WhatWeAreTesting } from "@/components/dashboard/creative-section/what-we-are-testing";
import { testPlanFixtureView, testPlanShareFixture } from "@/scripts/plan-frames/test-plan-fixtures";

import { TestPlanPanelView } from "./test-plan-panel";

/**
 * TF-A, TF-B and TT-D (the event page's Test plan panel) and TF-C (the share
 * link's "What we're testing") from fixtures, at the width the runner opens.
 * data-frame-ready carries the shot's frame ("test-plan/TFA"), which
 * scripts/plan-frames/run.mjs waits for.
 */
export function TestPlanFrameMount({ id }: { id: string }) {
  return (
    <main data-frame-ready={`test-plan/${id}`} className="min-h-screen bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-[72rem]">
        {id === "TFC" ? <WhatWeAreTesting cards={testPlanShareFixture()} /> : <TestPlanPanelView view={testPlanFixtureView(id as "TFA" | "TFB" | "TTD")} />}
      </div>
    </main>
  );
}
