/**
 * Pure helpers for funnel pacing metrics sourced from
 * `active_creatives_snapshots.payload` (ShareActiveCreativesResult-compatible).
 * Kept separate from `funnel-pacing.ts` so tests do not load `server-only`.
 */

export type SnapshotPayloadForLpv =
  | {
      kind: "ok";
      groups: ReadonlyArray<{ landingPageViews: number }>;
      meta: { unattributed: { landingPageViews: number } };
    }
  | { kind: "skip" | "error" };

/** Sums LPV from concept groups plus unattributed snapshot rows. */
export function sumLandingPageViewsFromSharePayload(
  payload: SnapshotPayloadForLpv,
): number {
  if (payload.kind !== "ok") return 0;
  let sum = payload.meta.unattributed.landingPageViews;
  for (const g of payload.groups) {
    sum += g.landingPageViews;
  }
  return sum;
}
