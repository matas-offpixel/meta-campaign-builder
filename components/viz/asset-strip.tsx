"use client";

import { useState } from "react";
import {
  ASSET_STRIP_GOOGLE_HEAD,
  assetIsUnrouted,
  assetStripState,
  isPlatformLit,
  tiktokDisabledReason,
  type AssetStripItem,
} from "@/lib/viz/asset-strip";
import { aspectChipRatio } from "@/lib/viz/aspect-chip";
import { VIZ_PLATFORM_LABEL, VIZ_TYPE, type VizPlatform } from "@/lib/viz/tokens";

import { BlockerBadge } from "./blocker-badge";

export function AssetStrip({
  assets,
  routing,
  onUpload,
  onToggle,
  disabledReasons,
}: {
  assets: AssetStripItem[];
  routing: Record<string, VizPlatform[]>;
  onUpload?: () => void;
  onToggle?: (assetId: string, platform: VizPlatform) => void;
  disabledReasons?: Record<string, Partial<Record<VizPlatform, string>>>;
}) {
  const state = assetStripState(assets, routing);

  return (
    <div className="flex flex-wrap items-center gap-3" data-state={state}>
      <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{ASSET_STRIP_GOOGLE_HEAD}</span>
      {assets.map((asset) => {
        const routed = routing[asset.id] ?? [];
        const unrouted = assetIsUnrouted(asset, routed);
        const tiktokReason = tiktokDisabledReason(asset, disabledReasons?.[asset.id]);
        const metaOn = isPlatformLit(routed, "meta");
        const tiktokOn = isPlatformLit(routed, "tiktok") && !tiktokReason;
        return (
          <div key={asset.id} className="flex items-center gap-2">
            <AssetThumb asset={asset} />
            <span className={VIZ_TYPE.label}>{aspectChipRatio(asset.aspect)}</span>
            <span className={`inline-flex items-center gap-1 ${VIZ_TYPE.label}`}>
              <ToggleWord
                label={VIZ_PLATFORM_LABEL.meta}
                on={metaOn}
                disabled
                onClick={() => undefined}
              />
              <span aria-hidden="true">·</span>
              <ToggleWord
                label={VIZ_PLATFORM_LABEL.tiktok}
                on={tiktokOn}
                disabled={Boolean(tiktokReason) || !onToggle}
                title={tiktokReason}
                onClick={() => onToggle?.(asset.id, "tiktok")}
              />
            </span>
            {unrouted ? (
              <BlockerBadge
                rows={[
                  {
                    id: `unrouted-${asset.id}`,
                    label: "unrouted",
                    full: "unrouted",
                    href: null,
                  },
                ]}
              />
            ) : null}
          </div>
        );
      })}
      {onUpload ? (
        <button
          type="button"
          className="inline-flex h-10 w-8 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground hover:bg-muted"
          aria-label="upload"
          onClick={onUpload}
        >
          +
        </button>
      ) : null}
    </div>
  );
}

function ToggleWord({
  label,
  on,
  disabled,
  title,
  onClick,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`min-h-11 ${on ? "text-foreground" : "text-muted-foreground"}`}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function AssetThumb({ asset }: { asset: AssetStripItem }) {
  const [broken, setBroken] = useState(false);
  const failed = !asset.thumbUrl || broken;
  return (
    <span
      className={`inline-flex h-10 w-8 items-center justify-center overflow-hidden rounded-sm border bg-muted ${
        failed ? "border-dashed border-border" : "border-border"
      }`}
    >
      {failed ? (
        <span className={`max-w-full truncate px-0.5 text-center leading-tight text-muted-foreground ${VIZ_TYPE.micro}`}>
          {asset.label}
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <span className="sr-only">{asset.label}</span>
    </span>
  );
}
