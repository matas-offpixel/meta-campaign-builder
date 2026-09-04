"use client";

import {
  assetIsUnrouted,
  assetStripState,
  googleRoutingMark,
  isPlatformLit,
  tiktokDisabledReason,
  type AssetStripItem,
} from "@/lib/viz/asset-strip";
import { VIZ_PLATFORMS, type VizPlatform } from "@/lib/viz/tokens";

import { AspectChip } from "./metric-chip";
import { BlockerBadge } from "./blocker-badge";
import { PlatformGlyph } from "./platform-glyph";
import { PlatformToggle } from "./platform-toggle";

export function AssetStrip({
  assets,
  routing,
  onUpload,
  onToggle,
  disabledReasons,
}: {
  assets: AssetStripItem[];
  routing: Record<string, VizPlatform[]>;
  onUpload: () => void;
  onToggle: (assetId: string, platform: VizPlatform) => void;
  disabledReasons?: Record<string, Partial<Record<VizPlatform, string>>>;
}) {
  const state = assetStripState(assets, routing);

  return (
    <div className="flex flex-wrap items-center gap-3" data-state={state}>
      {assets.map((asset) => {
        const routed = routing[asset.id] ?? [];
        const unrouted = assetIsUnrouted(asset, routed);
        const tiktokReason = tiktokDisabledReason(asset, disabledReasons?.[asset.id]);
        return (
          <div key={asset.id} className="flex items-center gap-2">
            <span className="relative inline-flex h-10 w-8 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted">
              {asset.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.thumbUrl} alt="" className="h-full w-full object-cover" />
              ) : null}
              <span className="absolute bottom-0 right-0">
                <AspectChip ratio={asset.aspect} />
              </span>
              <span className="sr-only">{asset.label}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              →
              {VIZ_PLATFORMS.map((platform) => {
                if (platform === "google") {
                  return (
                    <span
                      key={platform}
                      className="inline-flex items-center gap-0.5 border-b border-dashed border-border text-muted-foreground"
                      title="not instrumented"
                    >
                      <PlatformGlyph platform="google" size="sm" />
                      {googleRoutingMark()}
                    </span>
                  );
                }
                const lit = isPlatformLit(routed, platform);
                const disabled = platform === "tiktok" && Boolean(tiktokReason);
                return (
                  <span key={platform} className="inline-flex items-center gap-0.5" title={disabled ? tiktokReason : undefined}>
                    <PlatformToggle
                      platform={platform}
                      checked={lit && !disabled}
                      onChange={() => {
                        if (disabled) return;
                        onToggle(asset.id, platform);
                      }}
                    />
                    <span aria-hidden="true">{lit && !disabled ? "✓" : ""}</span>
                  </span>
                );
              })}
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
      <button
        type="button"
        className="inline-flex h-10 w-8 items-center justify-center rounded-sm border border-dashed border-border text-muted-foreground hover:bg-muted"
        aria-label="upload"
        onClick={onUpload}
      >
        +
      </button>
    </div>
  );
}
