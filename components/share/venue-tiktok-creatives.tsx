"use client";

import { useState } from "react";
import { Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fmtCurrency, fmtShort } from "@/lib/dashboard/format";
import {
  PLATFORM_COLORS,
  PLATFORM_LABELS,
} from "@/lib/dashboard/platform-colors";
import type {
  VenueTikTokCreativeCard,
  VenueTikTokEventGroup,
} from "@/lib/dashboard/venue-tiktok-creatives-view";

/**
 * components/share/venue-tiktok-creatives.tsx
 *
 * TikTok concept cards for the venue "Top creatives" section, one block
 * per event that has a TikTok snapshot. Card layout follows the Meta
 * `ShareCreativeCard` (share-active-creatives-client.tsx); metrics are
 * only what `tiktok_active_creatives_snapshots` stores.
 */

interface Props {
  groups: VenueTikTokEventGroup[];
  topN: number;
  fullReport: boolean;
}

export function VenueTikTokCreatives({ groups, topN, fullReport }: Props) {
  const showEventName = groups.length > 1;
  return (
    <div className="space-y-5" data-testid="venue-tiktok-creatives">
      {groups.map((group) => (
        <TikTokEventBlock
          key={group.event_id}
          group={group}
          showEventName={showEventName}
          topN={topN}
          fullReport={fullReport}
        />
      ))}
    </div>
  );
}

function TikTokEventBlock({
  group,
  showEventName,
  topN,
  fullReport,
}: {
  group: VenueTikTokEventGroup;
  showEventName: boolean;
  topN: number;
  fullReport: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const cards =
    fullReport || showAll ? group.cards : group.cards.slice(0, topN);
  const canToggle = !fullReport && group.cards.length > topN;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          {showEventName ? (
            <span className="mr-2 font-medium text-foreground">
              {group.event_name}
            </span>
          ) : null}
          {group.cards.length} concept{group.cards.length === 1 ? "" : "s"} ·{" "}
          {fmtShort(group.window.since)} – {fmtShort(group.window.until)} ·
          snapshot {fmtShort(group.fetched_at)}
        </span>
        {canToggle ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-medium text-primary underline underline-offset-2 hover:text-primary-hover"
          >
            {showAll
              ? `Show top ${topN} only`
              : `View all ${group.cards.length} concepts →`}
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <TikTokCreativeCard key={card.group_key} card={card} />
        ))}
      </div>
    </div>
  );
}

function TikTokCreativeCard({ card }: { card: VenueTikTokCreativeCard }) {
  return (
    <div
      className="flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4 text-left"
      data-testid="venue-tiktok-creative-card"
    >
      <div className="flex items-start gap-3">
        <TikTokThumbnail
          key={card.thumbnail_url ?? ""}
          url={card.thumbnail_url}
          alt={card.display_name}
        />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium text-foreground">
            {card.display_name}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <TikTokChip />
        <Badge variant="outline">
          <Layers className="mr-1 h-3 w-3" />
          {card.ad_count} ad{card.ad_count === 1 ? "" : "s"}
        </Badge>
        {card.campaign_count > 1 && (
          <Badge variant="outline">{card.campaign_count} campaigns</Badge>
        )}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Spend
        </div>
        <div className="text-base font-semibold text-foreground">
          {fmtCurrency(card.spend)}
        </div>
      </div>

      <div className="space-y-1.5 text-sm">
        <MetricRow label="Impressions" value={fmtInt(card.impressions)} />
        <MetricRow
          label="Clicks"
          value={fmtInt(card.clicks)}
          costLabel="CPC"
          cost={card.cpc != null ? fmtCurrency(card.cpc) : null}
        />
        <MetricRow label="2s views" value={fmtInt(card.video_views_2s)} />
      </div>

      {card.deeplink_url ? (
        <a
          href={card.deeplink_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-auto pt-1 text-xs font-medium text-primary hover:text-primary-hover"
        >
          View on TikTok →
        </a>
      ) : null}
    </div>
  );
}

function TikTokChip() {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border-strong px-2 py-0.5 text-xs font-medium text-foreground">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: PLATFORM_COLORS.tiktok }}
      />
      {PLATFORM_LABELS.tiktok}
    </span>
  );
}

function MetricRow({
  label,
  value,
  costLabel,
  cost,
}: {
  label: string;
  value: string | null;
  costLabel?: string;
  cost?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {value != null ? (
          <span className="text-sm font-medium text-foreground">{value}</span>
        ) : null}
      </div>
      {costLabel && cost != null ? (
        <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
          <span>{costLabel}</span>
          <span className="text-foreground">{cost}</span>
        </div>
      ) : null}
    </div>
  );
}

function TikTokThumbnail({ url, alt }: { url: string | null; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);

  if (!url || broken) {
    return (
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-border bg-muted text-[10px] font-medium text-muted-foreground"
        aria-hidden
      >
        {PLATFORM_LABELS.tiktok}
      </div>
    );
  }
  return (
    <span className="relative inline-block h-16 w-16 shrink-0">
      {!loaded ? (
        <span
          className="absolute inset-0 z-0 animate-pulse rounded border border-border bg-muted"
          aria-hidden
        />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        width={64}
        height={64}
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        onError={() => setBroken(true)}
        className={`relative z-10 h-16 w-16 rounded border border-border object-cover transition-opacity ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </span>
  );
}

function fmtInt(v: number | null): string | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.round(v).toLocaleString("en-GB");
}
