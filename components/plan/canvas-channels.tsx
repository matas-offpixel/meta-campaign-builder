"use client";

import type { RefObject } from "react";

import { ChannelRow } from "@/components/viz/channel-row";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { SectionAnchor } from "@/components/viz/section-anchor";
import { PLAN_CANVAS_COPY, resumeSupport, type PlanChannelRowModel } from "@/lib/plan/canvas";
import type { PlanAdapterName } from "@/lib/plan/types";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import type { EventFunnelPlatformCosts } from "@/lib/dashboard/event-funnel";
import { funnelCostLabel } from "@/lib/dashboard/event-funnel";

/**
 * Zone E — what is each channel's state, in one glance.
 *
 * A row click prepares the draft on first open and then opens that
 * channel's drawer at the row's own section — there is no separate Prepare
 * button, and no route change. A blocker click opens the same drawer at
 * the section the blocker names.
 */
export function CanvasChannels({
  rows,
  costs,
  onOpen,
  onOpenAnchor,
  onResume,
  onRederive,
  busy,
  openRefs,
}: {
  rows: PlanChannelRowModel[];
  /** LIVE state — one cost-per-stage chip per row instead of the noun facts. */
  costs?: Partial<Record<PlanAdapterName, EventFunnelPlatformCosts>>;
  onOpen: (row: PlanChannelRowModel) => void;
  /** A blocker click opens the drawer at the section the blocker names. */
  onOpenAnchor?: (row: PlanChannelRowModel, anchor: BlockerAnchor) => void;
  onResume: (row: PlanChannelRowModel) => void;
  onRederive: (row: PlanChannelRowModel) => void;
  busy: boolean;
  /** Per-adapter `open ▸` refs, so each drawer can exempt its own trigger. */
  openRefs?: Partial<Record<PlanAdapterName, RefObject<HTMLButtonElement | null>>>;
}) {
  return (
    <section aria-label="channels" className="space-y-1.5">
      <SectionAnchor kind="derive" label="derive" tip={PLAN_CANVAS_COPY.derive} />
      {rows.map((row) => {
        const resume = resumeSupport(row.adapter);
        const cost = costs?.[row.adapter];
        return (
          <div key={row.adapter} className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <ChannelRow
                platform={row.adapter}
                status={row.status}
                facts={row.facts}
                derived={row.derived}
                waiting={row.waiting}
                waitingFor={row.waitingFor}
                blockers={row.blockers}
                liveFacts={
                  cost ? (
                    <>
                      <MetricChip label="cost per mille" size="sm">
                        {funnelCostLabel(cost.cpm)}
                      </MetricChip>
                      <MetricChip label="cost per click" size="sm">
                        {funnelCostLabel(cost.cpc)}
                      </MetricChip>
                    </>
                  ) : null
                }
                onOpen={() => onOpen(row)}
                onOpenAnchor={
                  onOpenAnchor ? (anchor) => onOpenAnchor(row, anchor) : undefined
                }
                openRef={openRefs?.[row.adapter]}
                onResume={resume.supported && !busy ? () => onResume(row) : undefined}
              />
            </div>
            {row.state === "paused" && !resume.supported ? (
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled
                  className="text-[11px] text-muted-foreground"
                  aria-label="resume"
                >
                  ▷
                </button>
                <InfoTip label={resume.reason ?? PLAN_CANVAS_COPY.resumeElsewhere} />
                {row.adsManagerHref ? (
                  <a
                    href={row.adsManagerHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="ads manager"
                    className="text-[11px] text-muted-foreground underline"
                  >
                    ↗
                  </a>
                ) : null}
              </span>
            ) : null}
            {row.staleChip ? (
              <button
                type="button"
                className="rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 text-[10px]"
                disabled={busy}
                title={row.staleChip}
                onClick={() => onRederive(row)}
              >
                {row.staleChip}
              </button>
            ) : null}
            {row.skipped ? <InfoTip label={PLAN_CANVAS_COPY.splitZeroIsOff} /> : null}
          </div>
        );
      })}
    </section>
  );
}
