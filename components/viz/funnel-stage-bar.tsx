import {
  VIZ_LINE_TOKEN,
  VIZ_PLATFORM_BAR,
  VIZ_PROVENANCE_LINE_KIND,
  VIZ_TYPE,
  VIZ_TYPE_NUM,
  isVizPlatform,
  type VizLineKind,
  type VizPlatform,
  type VizProvenance,
} from "@/lib/viz/tokens";

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
  lineKind,
  segments = [],
  provenance,
  title,
}: {
  label: string;
  valueLabel: string;
  widthPct: number;
  /** @deprecated alias for `lineKind: "estimated"` — removed when the last caller migrates. */
  dashed?: boolean;
  lineKind?: VizLineKind;
  segments?: FunnelBarSegment[];
  provenance: VizProvenance;
  title?: string;
}) {
  // not instrumented stays the empty slot (line kind not-yet).
  const kind: VizLineKind =
    lineKind ?? (dashed ? "estimated" : VIZ_PROVENANCE_LINE_KIND[provenance]);
  const width = Math.max(0, Math.min(100, widthPct));
  const empty = kind === "not-yet";
  return (
    <div className="space-y-1" title={title}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`${VIZ_TYPE.micro} text-muted-foreground`}>{label}</span>
        <span className={VIZ_TYPE_NUM.body}>{valueLabel}</span>
      </div>
      <div
        className={`h-2.5 overflow-hidden rounded-sm border border-border ${VIZ_LINE_TOKEN[kind]} ${
          empty ? "border-dashed bg-transparent" : "bg-foreground/[0.06]"
        }`}
        style={{ width: empty || kind === "estimated" ? `${Math.max(width, 16)}%` : `${Math.max(width, 2)}%` }}
        role="img"
        aria-label={`${label} ${valueLabel}${empty ? ", not measured yet" : ""}`}
      >
        {empty ? null : <FunnelBarSegments segments={segments} />}
      </div>
    </div>
  );
}
