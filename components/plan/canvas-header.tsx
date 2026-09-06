"use client";

import { useState, type RefObject } from "react";

import { EventThumb } from "@/components/viz/event-thumb";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { OverflowMenu, type OverflowMenuItem } from "@/components/viz/overflow-menu";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { PLAN_CANVAS_COPY, joinInfoTips } from "@/lib/plan/canvas";
import { destinationSourceLabel, type ResolvedPlanDestination } from "@/lib/plan/destination";
import type { IdentityNameMap } from "@/lib/plan/identity-chips";
import {
  LAUNCH_INFO_VARIANT,
  decisionsChangesLabel,
  formatIdentitySentence,
  formatIdentityTip,
  formatLaunchedLine,
  planIdentityMetaId,
  type PlanLaunchedWord,
} from "@/lib/plan/launch-face";
import type { CampaignPlanLaunchRecord } from "@/lib/plan/types";
import { formatVizDay } from "@/lib/viz/format-moment";
import { VIZ_TYPE, VIZ_TYPE_NUM } from "@/lib/viz/tokens";

/**
 * Zone A — which show is this. Venue on the line; client name in the ⓘ
 * with the destination URL. Identity is one sentence, once.
 */
export function CanvasHeader({
  name,
  clientName,
  venueName,
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
  launchedMeta,
  clientDefaultMetaId,
  launchedAt,
  launchedWord,
}: {
  name: string;
  clientName: string | null;
  venueName?: string | null;
  eventDate: string | null;
  eventCode: string | null;
  thumbUrl: string | null;
  destination: ResolvedPlanDestination;
  onDestination: (url: string) => void;
  decisionCount: number;
  onDecisionsOpen: () => void;
  decisionsRef?: RefObject<HTMLButtonElement | null>;
  menuItems: OverflowMenuItem[];
  resolved: ResolvedChannelDefaults | null;
  identityNames?: IdentityNameMap;
  launchedMeta: CampaignPlanLaunchRecord;
  clientDefaultMetaId?: string | null;
  launchedAt?: string | null;
  launchedWord?: PlanLaunchedWord;
}) {
  const [draft, setDraft] = useState(destination.url);
  const handle = decisionsChangesLabel(decisionCount);
  const date = eventDate ? formatVizDay(eventDate) : null;
  const metaId = planIdentityMetaId({
    launchedMeta,
    resolvedMetaId: resolved?.metaAdAccount.value ?? null,
  });
  const identity = resolved
    ? formatIdentitySentence({
        metaId,
        metaConnected: Boolean(metaId),
        tiktokConnected: Boolean(resolved.tiktokAdvertiser.value),
        googleConnected: Boolean(resolved.googleAdsCustomer.value),
        names: identityNames,
      })
    : null;
  const tip = joinInfoTips(
    formatIdentityTip({
      metaId,
      clientDefaultMetaId,
      destinationUrl: destination.url || null,
      clientName,
    }),
    destination.url
      ? destinationSourceLabel(destination.source)
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
          {tip ? <InfoTip variant={LAUNCH_INFO_VARIANT} label={tip} /> : null}
        </div>
        <div className={`mt-0.5 flex flex-wrap items-center gap-1.5 ${VIZ_TYPE.label} text-muted-foreground`}>
          {venueName ? <span className="truncate">{venueName}</span> : null}
          {date && date !== "—" ? <span className={VIZ_TYPE_NUM.body}>{date}</span> : null}
          {eventCode ? <MetricChip label={eventCode} size="sm">{eventCode}</MetricChip> : null}
        </div>
        {identity ? (
          <span className={`mt-1 block ${VIZ_TYPE.body} text-muted-foreground`}>{identity}</span>
        ) : null}
        {launchedAt && launchedWord ? (
          <span className={`mt-0.5 block ${VIZ_TYPE.label} text-muted-foreground`}>
            {formatLaunchedLine(launchedAt, launchedWord)}
          </span>
        ) : null}
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
