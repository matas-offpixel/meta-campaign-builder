"use client";

import { useState, type RefObject } from "react";

import { PlanIdentityChips } from "@/components/plan/plan-identity-chips";
import { EventThumb } from "@/components/viz/event-thumb";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { OverflowMenu, type OverflowMenuItem } from "@/components/viz/overflow-menu";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { PLAN_CANVAS_COPY, decisionsHandleLabel, joinInfoTips } from "@/lib/plan/canvas";
import { destinationSourceLabel, type ResolvedPlanDestination } from "@/lib/plan/destination";
import type { IdentityNameMap } from "@/lib/plan/identity-chips";
import { formatVizDay } from "@/lib/viz/format-moment";
import { VIZ_TYPE, VIZ_TYPE_NUM } from "@/lib/viz/tokens";

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
  identityNames,
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
  identityNames?: IdentityNameMap;
}) {
  const [draft, setDraft] = useState(destination.url);
  const handle = decisionsHandleLabel(decisionCount);
  const date = eventDate ? formatVizDay(eventDate) : null;
  const tip = joinInfoTips(
    destination.url
      ? `${destination.url} — ${destinationSourceLabel(destination.source)}`
      : PLAN_CANVAS_COPY.noDestination,
    destination.overridable && PLAN_CANVAS_COPY.destination,
    handle && PLAN_CANVAS_COPY.decisions,
  );

  return (
    <header className="flex min-h-[88px] items-start gap-3">
      <EventThumb url={thumbUrl} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h1 className={`min-w-0 truncate ${VIZ_TYPE.body}`}>{name}</h1>
          <InfoTip label={tip} />
        </div>
        <div className={`mt-0.5 flex flex-wrap items-center gap-1.5 ${VIZ_TYPE.label} text-muted-foreground`}>
          {clientName ? <span className="truncate">{clientName}</span> : null}
          {date && date !== "—" ? <span className={VIZ_TYPE_NUM.body}>{date}</span> : null}
          {eventCode ? <MetricChip label={eventCode} size="sm">{eventCode}</MetricChip> : null}
        </div>
        {destination.overridable ? (
          <label className="mt-1.5 flex items-center gap-1.5">
            <span className="sr-only">Destination URL</span>
            <input
              className={`w-full max-w-md rounded-sm border border-dashed border-border bg-transparent px-2 py-1 ${VIZ_TYPE.body}`}
              placeholder="https://"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => onDestination(draft)}
            />
          </label>
        ) : null}
        <PlanIdentityChips resolved={resolved} names={identityNames} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {handle ? (
          <button
            ref={decisionsRef}
            type="button"
            className={`${VIZ_TYPE_NUM.label} text-muted-foreground hover:text-foreground`}
            onClick={onDecisionsOpen}
          >
            {handle}
          </button>
        ) : null}
        <OverflowMenu items={menuItems} />
      </div>
    </header>
  );
}
