"use client";

import type { RefObject } from "react";

import { PlanBlockerItems } from "@/components/plan/blocker-items";
import { Button } from "@/components/ui/button";
import { ChannelRow } from "@/components/viz/channel-row";
import { PLAN_CANVAS_COPY, resumeSupport, type PlanChannelRowModel } from "@/lib/plan/canvas";
import {
  formatChannelNeedsYou,
  formatResumeWord,
  launchBlockers,
  launchChannelRowView,
  type LaunchChannelRunning,
  type LaunchReadingUnit,
} from "@/lib/plan/launch-face";
import { VIZ_PLATFORM_LABEL } from "@/lib/viz/tokens";
import type { PlanAdapterName } from "@/lib/plan/types";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * MML ⑥ — one card per channel: state, blocker count, Adjust.
 *
 * Adjust prepares the draft on first open and then opens that channel's
 * drawer at the row's own section — there is no separate Prepare button,
 * and no route change. The needs-you sentence opens the drawer at the
 * first blocker.
 */
export function CanvasChannels({
  rows,
  blockerCounts,
  readingUnit,
  running,
  readsPending = false,
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
  /** Until reads resolve — 35% ink bars, no state word. */
  readsPending?: boolean;
  onOpen: (row: PlanChannelRowModel) => void;
  onOpenAnchor?: (row: PlanChannelRowModel, anchor: BlockerAnchor) => void;
  onResume: (row: PlanChannelRowModel) => void;
  onRederive: (row: PlanChannelRowModel) => void;
  busy: boolean;
  openRefs?: Partial<Record<PlanAdapterName, RefObject<HTMLButtonElement | null>>>;
  drawerEdit?: boolean;
}) {
  return (
    <section aria-label="channels" className="grid min-h-[120px] gap-3 lg:grid-cols-3">
      {rows.map((row) => {
        const resume = resumeSupport(row.adapter);
        const blockers = launchBlockers(row.blockers);
        const blockerCount = blockerCounts?.[row.adapter] ?? 0;
        const face = launchChannelRowView({
          ...(readsPending ? { reads: undefined } : { reads: running ?? null }),
          skipped: row.skipped,
          waiting: row.waiting,
          blockerCount,
          status: row.status === "paused" ? "paused" : row.status === "live" ? "live" : "idle",
          readingUnit,
          adapter: row.adapter,
        });
        const first = blockers[0];
        const stateWord = face.stateWord;
        const runningFact = face.runningFact;
        const hideStateWord = face.pending || !stateWord;
        const needsYou = drawerEdit && stateWord === "needs you" && blockerCount > 0;
        if (face.pending) {
          return (
            <div
              key={row.adapter}
              data-pending={true}
              className="flex h-[120px] items-start rounded-md border border-border bg-card p-3"
            >
              <span className="h-2 w-24 bg-foreground/35" aria-hidden="true" />
            </div>
          );
        }
        return (
          <article
            key={row.adapter}
            data-mml-channel={row.adapter}
            className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-card p-3"
          >
            <header className="flex items-center gap-2">
              <h3 className={`${VIZ_TYPE.body} font-medium`}>{VIZ_PLATFORM_LABEL[row.adapter]}</h3>
              {hideStateWord ? null : (
                <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{stateWord}</span>
              )}
              <span
                data-blocker-count={blockerCount}
                className={`${VIZ_TYPE.label} ${blockerCount > 0 ? "text-foreground" : "text-muted-foreground"}`}
              >
                {blockerCount === 0 ? "no blockers" : blockerCount === 1 ? "1 blocker" : `${blockerCount} blockers`}
              </span>
              {drawerEdit ? (
                <Button
                  ref={openRefs?.[row.adapter]}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={busy}
                  onClick={() => onOpen(row)}
                >
                  Adjust
                </Button>
              ) : null}
            </header>
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
              onOpenAnchor={
                drawerEdit && onOpenAnchor ? (anchor) => onOpenAnchor(row, anchor) : undefined
              }
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {needsYou ? (
                <button
                  type="button"
                  className={`text-left ${VIZ_TYPE.label} text-foreground hover:underline`}
                  onClick={() => {
                    if (first?.anchor && onOpenAnchor) onOpenAnchor(row, first.anchor);
                    else onOpen(row);
                  }}
                >
                  {formatChannelNeedsYou(blockerCount, VIZ_PLATFORM_LABEL[row.adapter])}
                </button>
              ) : null}
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
            {onOpenAnchor && blockers.length > 0 ? (
              <details className="group">
                <summary className={`cursor-pointer list-none ${VIZ_TYPE.label} text-muted-foreground hover:text-foreground`}>
                  <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
                  what to fix
                </summary>
                <div className="mt-1 pl-4">
                  <PlanBlockerItems items={blockers} onOpenAnchor={(anchor) => onOpenAnchor(row, anchor)} />
                </div>
              </details>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
