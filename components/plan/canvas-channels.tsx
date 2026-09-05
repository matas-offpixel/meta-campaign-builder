"use client";

import type { RefObject } from "react";

import { ChannelRow } from "@/components/viz/channel-row";
import { MetricChip } from "@/components/viz/metric-chip";
import { SectionAnchor } from "@/components/viz/section-anchor";
import { PLAN_CANVAS_COPY, joinInfoTips, resumeSupport, type PlanChannelRowModel } from "@/lib/plan/canvas";
import type { PlanAdapterName } from "@/lib/plan/types";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import type { EventFunnelPlatformCosts } from "@/lib/dashboard/event-funnel";
import { channelLiveCostLabel } from "@/lib/plan/channel-costs";
import { VIZ_TYPE } from "@/lib/viz/tokens";

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
  const resumeTips = [
    ...new Set(
      rows
        .filter((row) => row.state === "paused" && !resumeSupport(row.adapter).supported)
        .map((row) => resumeSupport(row.adapter).reason ?? PLAN_CANVAS_COPY.resumeElsewhere),
    ),
  ];
  const tip = joinInfoTips(
    PLAN_CANVAS_COPY.derive,
    ...resumeTips,
    rows.some((row) => row.skipped) && PLAN_CANVAS_COPY.splitZeroIsOff,
  );

  return (
    <section aria-label="channels" className="min-h-[120px] space-y-1.5">
      <SectionAnchor kind="derive" label="derive" tip={tip} />
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
                        {channelLiveCostLabel(cost.cpm, "thousand")}
                      </MetricChip>
                      <MetricChip label="cost per click" size="sm">
                        {channelLiveCostLabel(cost.cpc, "click")}
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
                  className={`${VIZ_TYPE.label} text-muted-foreground`}
                  aria-label="resume"
                >
                  ▷
                </button>
                {row.adsManagerHref ? (
                  <a
                    href={row.adsManagerHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="ads manager"
                    className={`${VIZ_TYPE.label} text-muted-foreground underline`}
                  >
                    ↗
                  </a>
                ) : null}
              </span>
            ) : null}
            {row.staleChip ? (
              <button
                type="button"
                className={`rounded-sm border border-border bg-muted/40 px-1.5 py-0.5 ${VIZ_TYPE.label}`}
                disabled={busy}
                title={row.staleChip}
                onClick={() => onRederive(row)}
              >
                {row.staleChip}
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
