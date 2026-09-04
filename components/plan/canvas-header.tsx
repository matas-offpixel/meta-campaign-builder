"use client";

import { useState, type RefObject } from "react";

import { EventThumb } from "@/components/viz/event-thumb";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { OverflowMenu, type OverflowMenuItem } from "@/components/viz/overflow-menu";
import { PlanIdentityChips } from "@/components/plan/plan-identity-chips";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { PLAN_CANVAS_COPY, decisionsHandleLabel } from "@/lib/plan/canvas";
import { destinationSourceLabel, type ResolvedPlanDestination } from "@/lib/plan/destination";
import { formatPlanEventDate } from "@/lib/plan/event-picker";

/**
 * Zone A — which show is this. Nothing here is editable: the event picks
 * the name, the code, the date and the destination (§2 "Change event =
 * new plan"). The one exception is an event with no ticket_url and no
 * signup_url, where the `ⓘ` accepts a pasted URL because otherwise the
 * plan can never launch.
 */
export function CanvasHeader({
  name,
  clientName,
  eventDate,
  eventCode,
  thumbUrl,
  destination,
  onDestination,
  decisionCount,
  onDecisionsOpen,
  decisionsRef,
  menuItems,
  resolved,
}: {
  name: string;
  clientName: string | null;
  eventDate: string | null;
  eventCode: string | null;
  thumbUrl: string | null;
  destination: ResolvedPlanDestination;
  onDestination: (url: string) => void;
  decisionCount: number;
  onDecisionsOpen: () => void;
  decisionsRef?: RefObject<HTMLButtonElement | null>;
  menuItems: OverflowMenuItem[];
  /** Ad account / page / pixel, with where each one came from. */
  resolved: ResolvedChannelDefaults | null;
}) {
  const [draft, setDraft] = useState(destination.url);
  const handle = decisionsHandleLabel(decisionCount);
  const date = formatPlanEventDate(eventDate);

  return (
    <header className="flex items-start gap-3">
      <EventThumb url={thumbUrl} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h1 className="min-w-0 truncate font-heading text-lg tracking-wide">{name}</h1>
          <InfoTip
            label={
              destination.url
                ? `${destination.url} — ${destinationSourceLabel(destination.source)}`
                : PLAN_CANVAS_COPY.noDestination
            }
          />
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {clientName ? <span className="truncate">{clientName}</span> : null}
          {date ? <span className="tabular-nums">{date}</span> : null}
          {eventCode ? <MetricChip label={eventCode} size="sm">{eventCode}</MetricChip> : null}
        </div>
        {destination.overridable ? (
          <label className="mt-1.5 flex items-center gap-1.5">
            <span className="sr-only">Destination URL</span>
            <input
              className="w-full max-w-md rounded-sm border border-dashed border-border bg-transparent px-2 py-1 text-[11px]"
              placeholder="https://"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => onDestination(draft)}
            />
            <InfoTip label={PLAN_CANVAS_COPY.destination} />
          </label>
        ) : null}
        <PlanIdentityChips resolved={resolved} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {handle ? (
          <button
            ref={decisionsRef}
            type="button"
            className="text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
            onClick={onDecisionsOpen}
          >
            {handle}
          </button>
        ) : null}
        {handle ? <InfoTip label={PLAN_CANVAS_COPY.decisions} /> : null}
        <OverflowMenu items={menuItems} />
      </div>
    </header>
  );
}
