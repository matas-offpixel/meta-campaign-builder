"use client";

import type { RefObject } from "react";

import { ChannelRow } from "@/components/viz/channel-row";
import { PLAN_CANVAS_COPY, resumeSupport, type PlanChannelRowModel } from "@/lib/plan/canvas";
import {
  formatChannelNeedsYou,
  formatResumeWord,
  formatRunningFact,
  launchBlockers,
  launchChannelStateWord,
  LAUNCH_NO_READS,
  type LaunchChannelRunning,
  type LaunchReadingUnit,
} from "@/lib/plan/launch-face";
import { VIZ_PLATFORM_LABEL } from "@/lib/viz/tokens";
import type { PlanAdapterName } from "@/lib/plan/types";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * Zone E — what is each channel's state, in one glance.
 *
 * A row click prepares the draft on first open and then opens that
 * channel's drawer at the row's own section — there is no separate Prepare
 * button, and no route change. The needs-you sentence is the control that
 * opens the drawer at the first blocker.
 */
export function CanvasChannels({
  rows,
  blockerCounts,
  readingUnit,
  running,
  onOpen,
  onOpenAnchor,
  onResume,
  onRederive,
  busy,
  openRefs,
  drawerEdit = true,
}: {
  rows: PlanChannelRowModel[];
  blockerCounts?: Record<PlanAdapterName, number>;
  readingUnit?: LaunchReadingUnit;
  running?: LaunchChannelRunning;
  onOpen: (row: PlanChannelRowModel) => void;
  onOpenAnchor?: (row: PlanChannelRowModel, anchor: BlockerAnchor) => void;
  onResume: (row: PlanChannelRowModel) => void;
  onRederive: (row: PlanChannelRowModel) => void;
  busy: boolean;
  openRefs?: Partial<Record<PlanAdapterName, RefObject<HTMLButtonElement | null>>>;
  drawerEdit?: boolean;
}) {
  return (
    <section aria-label="channels" className="min-h-[120px] space-y-1.5">
      {rows.map((row) => {
        const resume = resumeSupport(row.adapter);
        const blockers = launchBlockers(row.blockers);
        const blockerCount = blockerCounts?.[row.adapter] ?? 0;
        const stateWord = launchChannelStateWord({
          skipped: row.skipped,
          waiting: row.waiting,
          blockerCount,
          status: row.status === "paused" ? "paused" : row.status === "live" ? "live" : "idle",
        });
        const first = blockers[0];
        const runningRead = running?.byAdapter[row.adapter];
        const runningFact = !running
          ? null
          : running.empty
            ? LAUNCH_NO_READS
            : readingUnit && runningRead
              ? `${stateWord} · ${formatRunningFact({
                  cost: runningRead.cost,
                  unit: readingUnit,
                  usual: runningRead.usual,
                })}`
              : null;
        const hideStateWord = Boolean(runningFact);
        const needsYou = drawerEdit && stateWord === "needs you" && blockerCount > 0;
        return (
          <div key={row.adapter} className="flex flex-wrap items-center gap-1.5">
            {hideStateWord ? null : needsYou ? (
              <button
                type="button"
                className={`${VIZ_TYPE.label} text-foreground`}
                onClick={() => {
                  if (first?.anchor && onOpenAnchor) onOpenAnchor(row, first.anchor);
                  else onOpen(row);
                }}
              >
                {formatChannelNeedsYou(blockerCount, VIZ_PLATFORM_LABEL[row.adapter])}
              </button>
            ) : (
              <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{stateWord}</span>
            )}
            <div className="min-w-0 flex-1">
              <ChannelRow
                platform={row.adapter}
                status={row.status}
                facts={row.facts}
                derived={row.derived}
                waiting={row.waiting}
                waitingFor={row.waitingFor}
                hideWaitingText
                tip={
                  row.adapter === "tiktok" || row.adapter === "google"
                    ? PLAN_CANVAS_COPY.derive
                    : undefined
                }
                liveFacts={
                  runningFact ? (
                    <span className={VIZ_TYPE.body}>{runningFact}</span>
                  ) : null
                }
                onOpen={drawerEdit ? () => onOpen(row) : undefined}
                onOpenAnchor={
                  drawerEdit && onOpenAnchor ? (anchor) => onOpenAnchor(row, anchor) : undefined
                }
                openRef={openRefs?.[row.adapter]}
              />
            </div>
            {drawerEdit && row.state === "paused" ? (
              resume.supported ? (
                <button
                  type="button"
                  className={`${VIZ_TYPE.label} text-foreground`}
                  onClick={() => onResume(row)}
                >
                  {formatResumeWord(row.adapter)}
                </button>
              ) : row.adsManagerHref ? (
                <a
                  href={row.adsManagerHref}
                  target="_blank"
                  rel="noreferrer"
                  title={PLAN_CANVAS_COPY.resumeElsewhere}
                  className={`${VIZ_TYPE.label} text-muted-foreground underline`}
                >
                  {formatResumeWord(row.adapter)}
                </a>
              ) : (
                <span className={`${VIZ_TYPE.label} text-muted-foreground`}>
                  {formatResumeWord(row.adapter)}
                </span>
              )
            ) : null}
            {drawerEdit && row.staleChip ? (
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
