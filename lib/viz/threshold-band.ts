import type { OptimisationRule, OptimisationThreshold } from "../types.ts";
import type { VizAction } from "./tokens.ts";

export type BandZoneKind = "scale_up" | "maintain" | "scale_down" | "pause";

export interface BandZone {
  kind: BandZoneKind;
  start: number;
  end: number;
}

export interface ThresholdBandModel {
  zones: BandZone[];
  min: number;
  max: number;
  markerRatio: number | null;
}

const ACTION_TO_ZONE: Record<string, BandZoneKind> = {
  increase_budget: "scale_up",
  decrease_budget: "scale_down",
  pause: "pause",
  scale_up: "scale_up",
  scale_down: "scale_down",
  maintain: "maintain",
};

export function zoneKindFromAction(action: string): BandZoneKind {
  return ACTION_TO_ZONE[action] ?? "maintain";
}

function thresholdMatches(threshold: OptimisationThreshold, value: number): boolean {
  if (threshold.operator === "below") return value < threshold.value;
  if (threshold.operator === "above") return value > threshold.value;
  return (
    threshold.valueTo !== undefined &&
    value >= threshold.value &&
    value <= threshold.valueTo
  );
}

export function zoneKindAtValue(
  thresholds: OptimisationThreshold[],
  value: number,
): BandZoneKind {
  for (const threshold of thresholds) {
    if (thresholdMatches(threshold, value)) {
      return zoneKindFromAction(threshold.action);
    }
  }
  return "maintain";
}

export function zonesFromThresholds(thresholds: OptimisationThreshold[]): BandZone[] {
  if (thresholds.length === 0) {
    return [
      { kind: "scale_up", start: 0, end: 0.25 },
      { kind: "maintain", start: 0.25, end: 0.5 },
      { kind: "scale_down", start: 0.5, end: 0.75 },
      { kind: "pause", start: 0.75, end: 1 },
    ];
  }
  const cuts = new Set<number>([0]);
  for (const threshold of thresholds) {
    cuts.add(threshold.value);
    if (threshold.valueTo != null) cuts.add(threshold.valueTo);
  }
  const sorted = [...cuts].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const last = sorted[sorted.length - 1] ?? 1;
  const end = last <= 0 ? 1 : last * 1.25;
  if (sorted[sorted.length - 1] !== end) sorted.push(end);

  const zones: BandZone[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const stop = sorted[i + 1];
    const mid = (start + stop) / 2;
    zones.push({
      kind: zoneKindAtValue(thresholds, mid),
      start,
      end: stop,
    });
  }
  return zones;
}

export function bandFromRule(
  rule: Pick<OptimisationRule, "thresholds">,
  currentValue: number | null,
): ThresholdBandModel {
  const zones = zonesFromThresholds(rule.thresholds);
  const min = zones[0]?.start ?? 0;
  const max = zones[zones.length - 1]?.end ?? 1;
  const span = max - min || 1;
  const markerRatio =
    currentValue == null || !Number.isFinite(currentValue)
      ? null
      : Math.min(1, Math.max(0, (currentValue - min) / span));
  return { zones, min, max, markerRatio };
}

export function bandFromAction(
  action: VizAction | string,
  currentValue: number | null,
): ThresholdBandModel {
  const kind = zoneKindFromAction(action);
  const zones: BandZone[] = [
    { kind: "scale_up", start: 0, end: 0.25 },
    { kind: "maintain", start: 0.25, end: 0.5 },
    { kind: "scale_down", start: 0.5, end: 0.75 },
    { kind: "pause", start: 0.75, end: 1 },
  ];
  const highlighted = zones.find((z) => z.kind === kind);
  const markerRatio = highlighted
    ? (highlighted.start + highlighted.end) / 2
    : currentValue != null && Number.isFinite(currentValue)
      ? 0.5
      : null;
  return { zones, min: 0, max: 1, markerRatio };
}

export const BAND_ZONE_TOKEN: Record<BandZoneKind, string> = {
  scale_up: "bg-success",
  maintain: "bg-muted-foreground/30",
  scale_down: "bg-warning",
  pause: "bg-destructive",
};

export const BAND_ZONE_LABEL: Record<BandZoneKind, string> = {
  scale_up: "Scale up",
  maintain: "Maintain",
  scale_down: "Reduce",
  pause: "Pause",
};
