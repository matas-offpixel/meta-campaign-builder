"use client";

import { pipelineNodeStatus, type PipelineNodeId } from "@/lib/viz/status";
import type { CampaignPlanLaunches } from "@/lib/plan/types";

import { StatusDot } from "./status-dot";

export const PLAN_PIPELINE_HREFS: Record<PipelineNodeId, string> = {
  meta: "plan-meta",
  derive: "plan-step-2",
  assets: "plan-assets",
  launch: "plan-launch",
};

const NODES: Array<{ id: PipelineNodeId; label: string }> = [
  { id: "meta", label: "Meta" },
  { id: "derive", label: "Derive" },
  { id: "assets", label: "Assets" },
  { id: "launch", label: "Launch" },
];

export function PipelineStepper({ launches }: { launches: CampaignPlanLaunches }) {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav aria-label="Plan pipeline" className="flex items-center gap-1">
      {NODES.map((node, idx) => {
        const status = pipelineNodeStatus(node.id, launches);
        return (
          <span key={node.id} className="inline-flex items-center gap-1">
            {idx > 0 ? (
              <span className="mx-1 h-px w-6 bg-border-strong" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium"
              onClick={() => scrollTo(PLAN_PIPELINE_HREFS[node.id])}
            >
              <StatusDot status={status} />
              {node.label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
