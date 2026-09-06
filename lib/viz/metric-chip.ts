import { VIZ_DELTA_TOKEN, type VizDeltaTone, type VizLineKind } from "./tokens.ts";

export type VizBenchmarkDirection = "lower-is-better" | "higher-is-better";

export type MetricChipBenchmark = {
  value: number;
  band?: [number, number];
  lineKind: VizLineKind;
  sentence: string;
  runsUsed: string[];
  bandWord: "your middle half";
  n: number;
  direction?: VizBenchmarkDirection;
};

/** Every cost → lower; share and pace → higher. */
export function defaultBenchmarkDirection(
  unit: "cost" | "share" | "pace" | string,
): VizBenchmarkDirection {
  if (unit === "share" || unit === "pace") return "higher-is-better";
  return "lower-is-better";
}

/**
 * Tone from direction, never from sign. `VIZ_DELTA_TOKEN.above` (success)
 * is consumed only through this — a cost above the band is "below" (warning).
 * Inside the band: no tone.
 */
export function metricChipTone(input: {
  value: number;
  band: [number, number];
  direction: VizBenchmarkDirection;
}): VizDeltaTone | null {
  const [lo, hi] = input.band;
  if (input.value >= lo && input.value <= hi) return null;
  const aboveBand = input.value > hi;
  if (input.direction === "lower-is-better") {
    return aboveBand ? "below" : "above";
  }
  return aboveBand ? "above" : "below";
}

export function metricChipToneClass(
  tone: VizDeltaTone | null,
): string {
  return tone ? VIZ_DELTA_TOKEN[tone] : "";
}

/** £— never renders without a following sentence. */
export function emptyMetricDisplay(sentence?: string): { display: "£—"; sentence: string } | null {
  const text = sentence?.trim();
  if (!text) return null;
  return { display: "£—", sentence: text };
}

/** Band needs n ≥ 3; interpolated at n = 3–4. */
export function benchmarkBandAllowed(n: number): boolean {
  return n >= 3;
}
