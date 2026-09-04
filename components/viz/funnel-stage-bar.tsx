import {
  VIZ_PLATFORM_BAR,
  VIZ_TYPE,
  VIZ_TYPE_NUM,
  isVizPlatform,
  type VizPlatform,
  type VizProvenance,
} from "@/lib/viz/tokens";

import { ProvenanceBadge } from "./provenance-badge";

export type FunnelBarSegment = { platform: string; pct: number; label: string };

/** Shared segment track — SplitBar composes this; do not copy. */
export function FunnelBarSegments({
  segments,
}: {
  segments: FunnelBarSegment[];
}) {
  if (segments.length === 0) return null;
  return (
    <div className="flex h-full w-full gap-[2px]">
      {segments.map((segment) => {
        const platform = isVizPlatform(segment.platform)
          ? (segment.platform as VizPlatform)
          : null;
        return (
          <span
            key={segment.platform}
            className={`h-full overflow-hidden rounded-sm ${platform ? VIZ_PLATFORM_BAR[platform] : "bg-muted-foreground/40"}`}
            style={{ width: `${segment.pct}%` }}
            title={`${segment.label} ${segment.pct.toFixed(0)}%`}
          />
        );
      })}
    </div>
  );
}

export function FunnelStageBar({
  label,
  valueLabel,
  widthPct,
  dashed,
  segments = [],
  provenance,
  title,
}: {
  label: string;
  valueLabel: string;
  widthPct: number;
  dashed: boolean;
  segments?: FunnelBarSegment[];
  provenance: VizProvenance;
  title?: string;
}) {
  const width = Math.max(0, Math.min(100, widthPct));
  return (
    <div className="space-y-1" title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${VIZ_TYPE.micro} text-muted-foreground`}>{label}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={VIZ_TYPE_NUM.body}>{valueLabel}</span>
          <ProvenanceBadge provenance={provenance} />
        </span>
      </div>
      <div
        className={`h-2.5 overflow-hidden rounded-sm ${
          dashed
            ? "border border-dashed border-border bg-transparent"
            : "border border-border bg-foreground/[0.06]"
        }`}
        style={{ width: dashed ? `${Math.max(width, 16)}%` : `${Math.max(width, 2)}%` }}
        role="img"
        aria-label={`${label} ${valueLabel}${dashed ? ", not instrumented" : ""}`}
      >
        {dashed ? null : <FunnelBarSegments segments={segments} />}
      </div>
    </div>
  );
}
