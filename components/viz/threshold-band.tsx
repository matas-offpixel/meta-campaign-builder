import {
  BAND_ZONE_LABEL,
  BAND_ZONE_TOKEN,
  bandFromAction,
  bandFromRule,
  type ThresholdBandModel,
} from "@/lib/viz/threshold-band";
import type { OptimisationRule } from "@/lib/types";

export function ThresholdBand({
  model,
  rule,
  action,
  currentValue,
  dashed = false,
  size = "md",
}: {
  model?: ThresholdBandModel;
  rule?: Pick<OptimisationRule, "thresholds">;
  action?: string;
  currentValue?: number | null;
  /** Honest empty — no colour, a dashed track (brief §5.7). */
  dashed?: boolean;
  size?: "sm" | "md";
}) {
  const resolved =
    model ??
    (rule
      ? bandFromRule(rule, currentValue ?? null)
      : bandFromAction(action ?? "maintain", currentValue ?? null));
  const height = size === "sm" ? "h-2" : "h-3";

  if (dashed) {
    return (
      <div
        className={`relative min-w-[96px] max-w-[160px] w-full overflow-hidden rounded-full border border-dashed border-muted-foreground/40 ${height}`}
        role="img"
        aria-label="no reads yet"
      />
    );
  }

  return (
    <div
      className={`relative min-w-[96px] max-w-[160px] w-full overflow-hidden rounded-full ${height}`}
      role="img"
      aria-label={resolved.zones.map((z) => BAND_ZONE_LABEL[z.kind]).join(", ")}
    >
      <div className="flex h-full w-full">
        {resolved.zones.map((zone, idx) => {
          const span = resolved.max - resolved.min || 1;
          const width = ((zone.end - zone.start) / span) * 100;
          return (
            <span
              key={`${zone.kind}-${idx}`}
              className={`h-full ${BAND_ZONE_TOKEN[zone.kind]}`}
              style={{ width: `${width}%` }}
              title={`${BAND_ZONE_LABEL[zone.kind]} ${zone.start}–${zone.end}`}
            />
          );
        })}
      </div>
      {resolved.markerRatio != null ? (
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-card shadow-sm"
          style={{ left: `${resolved.markerRatio * 100}%` }}
          aria-label={
            currentValue != null ? `Current ${currentValue}` : "Current zone"
          }
        />
      ) : null}
    </div>
  );
}
