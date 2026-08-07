/**
 * Objective-compatibility helpers for the multi-campaign attach flows.
 *
 * `assertSameObjective` detects mixed objectives across attach_all_adsets
 * launches (Phase 0) where one creative-set is distributed across N
 * campaigns. As of task #114 this is informational, not a hard block: the
 * caller in `launch-campaign/route.ts` turns a non-ok result into a
 * non-blocking `preflightWarning` (mixed objectives are an explicitly
 * supported use case — e.g. attaching the same ads across Traffic + Sales +
 * Awareness campaigns) rather than a 409. Any resulting per-ad
 * creative/objective mismatch is caught individually in Phase 4 — see
 * `isObjectiveIncompatibilityError` in `lib/meta/error-classify.ts`.
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
