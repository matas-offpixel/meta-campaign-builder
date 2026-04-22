/**
 * lib/reporting/benchmark-verdict.ts
 *
 * Pure helper shared by the server route + the client UI to verdict a
 * single metric value against an account baseline. Lives in its own
 * file (separate from `ad-account-benchmarks.ts`) so the
 * `"server-only"` import in the latter doesn't poison the client
 * bundle when this comparator gets imported by a `"use client"`
 * component.
 *
 * Direction matters: lower is better for CPR/CPM, higher is better
 * for CTR. Threshold is ±10% per spec.
 */

export type BenchmarkVerdict =
  | "better"
  | "neutral"
  | "worse"
  | "no-baseline";

export function compareToBenchmark(
  value: number | null,
  baseline: number | null,
  direction: "higher-is-better" | "lower-is-better",
): BenchmarkVerdict {
  if (baseline == null || baseline === 0) return "no-baseline";
  if (value == null) return "no-baseline";
  const ratio = value / baseline;
  if (direction === "higher-is-better") {
    if (ratio >= 1.1) return "better";
    if (ratio <= 0.9) return "worse";
    return "neutral";
  }
  if (ratio <= 0.9) return "better";
  if (ratio >= 1.1) return "worse";
  return "neutral";
}
