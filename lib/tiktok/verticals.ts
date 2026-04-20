/**
 * lib/tiktok/verticals.ts
 *
 * Coarse classification of TikTok interest/audience labels into verticals.
 * Used by the interest-breakdown parser to group rows for dashboard
 * display. Stub — rule table is filled in by the next commit.
 */

import type { TikTokVertical } from "@/lib/types/tiktok";

/**
 * Pattern-match an interest/audience label against TikTok's taxonomy and
 * return the bucketed vertical. Returns `null` when no rule matches —
 * the UI renders nulls under "Other".
 */
export function classifyVertical(
  // Reserved for the rule-table commit. Underscore prefix silences
  // no-unused-vars while we keep the signature stable.
  _audienceLabel: string,
): TikTokVertical | null {
  return null;
}
