/**
 * lib/reporting/active-creatives-dedup.ts
 *
 * Pure helper that deduplicates `AdInput` rows by `ad_id`. Lives
 * outside `lib/reporting/active-creatives-fetch.ts` (which carries
 * `import "server-only"`) so unit tests can import the helper
 * without dragging in the server-only stub — strip-only TS mode
 * under `node:test` rejects the bundler-injected throw.
 *
 * Why this exists (PR #50):
 * `fetchActiveCreativesForEvent` matches campaigns via Meta's
 * CONTAIN substring filter on `event_code`. Big events (Junction 2
 * / Innervisions) have multiple sibling campaigns all carrying the
 * event_code token, and the same `ad_id` is reused/linked across
 * those sibling campaigns. Both the `/{campaignId}/ads` call and
 * the parallel `/{campaignId}/insights?level=ad` call return the
 * ad once per campaign it appears in. `Promise.all(...).flat()`
 * concatenates without de-duping, so the downstream grouper sees
 * the same ad N times and sums its purchases / LPV / spend that
 * many times — observed 3× inflation on UGC 2 - Ry X (15
 * purchases reported, ground-truth in Ads Manager: 5).
 *
 * Fix: first-seen wins per `ad_id`. All campaigns in the fan-out
 * carry the same insights payload for a given ad_id (Meta's
 * /insights?level=ad is parameter-equivalent across the sibling
 * campaign URLs the ad belongs to), so first-seen is semantically
 * identical to any other pick.
 */

import type { AdInput } from "@/lib/reporting/active-creatives-group";

export interface DedupAdsResult {
  /** First-seen rows per `ad_id`, original order preserved. */
  kept: AdInput[];
  /** Number of duplicate rows dropped (always >= 0). */
  dropped: number;
}

/**
 * First-seen-wins dedup by `ad_id`. Stable ordering — the kept
 * array preserves the order of first occurrences in the input.
 *
 * Pure: no Meta calls, no I/O, no logging. The caller is
 * responsible for emitting a console.log when `dropped > 0`
 * (centralised so the log line carries the event_code context).
 */
export function dedupAdsByAdId(ads: readonly AdInput[]): DedupAdsResult {
  const seen = new Set<string>();
  const kept: AdInput[] = [];
  let dropped = 0;
  for (const ad of ads) {
    if (seen.has(ad.ad_id)) {
      dropped += 1;
      continue;
    }
    seen.add(ad.ad_id);
    kept.push(ad);
  }
  return { kept, dropped };
}
