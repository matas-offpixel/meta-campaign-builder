"use client";

import type { ReactNode, RefObject } from "react";

import { channelRowView, type ChannelFact } from "@/lib/viz/channel-row";
import type { BlockerAnchor, BlockerRowModel } from "@/lib/viz/blockers";
import type { VizPlatform, VizStatus } from "@/lib/viz/tokens";

import { BlockerBadge } from "./blocker-badge";
import { PlatformGlyph } from "./platform-glyph";
import { ProvenanceBadge } from "./provenance-badge";
import { StatusDot } from "./status-dot";

export function ChannelRow({
  platform,
  status,
  facts,
  derived = false,
  waiting = false,
  waitingFor,
  blockers,
  liveFacts,
  onOpen,
  onResume,
  onOpenAnchor,
  openRef,
}: {
  platform: VizPlatform;
  status: VizStatus;
  facts: ChannelFact[];
  derived?: boolean;
  waiting?: boolean;
  waitingFor?: VizPlatform;
  blockers?: BlockerRowModel[];
  /** LIVE state — MetricChips replace the noun facts. */
  liveFacts?: ReactNode;
  onOpen: () => void;
  onResume?: () => void;
  onOpenAnchor?: (anchor: BlockerAnchor) => void;
  /**
   * The `open ▸` button, so a drawer opened from this row can exempt its
   * own trigger from the outside-click closer (#876).
   */
  openRef?: RefObject<HTMLButtonElement | null>;
}) {
  const view = channelRowView({
    status,
    facts,
    derived,
    waiting,
    blocked: (blockers?.length ?? 0) > 0,
    waitingFor,
  });
  const dotStatus: VizStatus =
    view.state === "waiting"
      ? "idle"
      : view.state === "blocked"
        ? "blocked"
        : status;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <PlatformGlyph platform={platform} size="sm" />
      <StatusDot status={dotStatus} />
      {view.state === "waiting" ? (
        <span className="text-[11px] text-muted-foreground">{view.waitingText}</span>
      ) : null}
      {view.showDerived ? <ProvenanceBadge provenance="derived" /> : null}
      {view.showFactsText ? (
        <span className="text-[11px] tabular-nums text-foreground">{view.factsText}</span>
      ) : null}
      {view.showLiveFacts ? <span className="inline-flex items-center gap-1">{liveFacts}</span> : null}
      {blockers && blockers.length > 0 ? (
        <BlockerBadge rows={blockers} onOpenAnchor={onOpenAnchor} />
      ) : null}
      {view.showResume && onResume ? (
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground"
          onClick={onResume}
        >
          ▷ resume
        </button>
      ) : null}
      <button
        type="button"
        className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
        ref={openRef}
        onClick={onOpen}
      >
        open ▸
      </button>
    </div>
  );
}
