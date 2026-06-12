/**
 * Objective-compatibility helpers for the multi-campaign attach flows.
 *
 * `assertSameObjective` is used both in the launch route (Phase 0 pre-flight)
 * and in unit tests. Extracted here to keep the route file importable and
 * to colocate the logic with the Meta campaign layer.
 */

import type { ExistingMetaCampaignSnapshot } from "@/lib/types";

export type AssertSameObjectiveResult =
  | { ok: true }
  | {
      ok: false;
      campaignA: string;
      campaignB: string;
      objA: string;
      objB: string;
    };

/**
 * Returns `ok: true` when all snapshots share the same raw Meta objective
 * string (e.g. `"LINK_CLICKS"`), or when the list has ≤ 1 entry.
 *
 * On conflict, returns `ok: false` with the first conflicting pair named so
 * the caller can surface a human-readable error:
 *
 * ```
 * "Selected campaigns have incompatible objectives. "{A}" is {objA} while
 * "{B}" is {objB}. Pick campaigns with the same objective and re-try."
 * ```
 */
export function assertSameObjective(
  snaps: ExistingMetaCampaignSnapshot[],
): AssertSameObjectiveResult {
  if (snaps.length <= 1) return { ok: true };
  const first = snaps[0];
  for (let i = 1; i < snaps.length; i++) {
    if (snaps[i].objective !== first.objective) {
      return {
        ok: false,
        campaignA: first.name,
        campaignB: snaps[i].name,
        objA: first.objective,
        objB: snaps[i].objective,
      };
    }
  }
  return { ok: true };
}
