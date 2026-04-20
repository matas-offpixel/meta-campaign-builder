/**
 * lib/tiktok/verticals.ts
 *
 * Coarse classification of TikTok interest/audience labels into the
 * `TikTokVertical` enum. The interest-breakdown parser tags each row
 * with the result so the dashboard can group by vertical.
 *
 * Rules are case-insensitive substring matches. Order matters — the
 * first rule whose pattern fires wins. The table is exported so tests
 * (and future tooling) can iterate it without re-parsing the source.
 *
 * Keep this in sync with `TikTokVertical` in lib/types/tiktok.ts. A
 * label matching no rule returns `null` and renders under "Other" in
 * the UI.
 */

import type { TikTokVertical } from "@/lib/types/tiktok";

export interface VerticalRule {
  /** Vertical bucket assigned when any pattern fires. */
  vertical: TikTokVertical;
  /** Case-insensitive substrings — match if any token appears in the label. */
  patterns: readonly string[];
}

export const VERTICAL_RULES: readonly VerticalRule[] = [
  {
    vertical: "music_entertainment",
    patterns: [
      "music",
      "concert",
      "band",
      "dj",
      "rap",
      "hip-hop",
      "hip hop",
      "electronic",
      "rock",
      "pop",
    ],
  },
  {
    vertical: "games",
    patterns: ["game", "gaming", "esport"],
  },
  {
    vertical: "food_drink",
    patterns: ["food", "drink", "restaurant", "cocktail"],
  },
  {
    vertical: "beauty_fashion",
    patterns: [
      "beauty",
      "makeup",
      "skincare",
      "fashion",
      "clothing",
      "streetwear",
    ],
  },
  {
    vertical: "travel",
    patterns: ["travel", "tourism", "hotel", "airline"],
  },
  {
    vertical: "sports_fitness",
    patterns: ["sport", "fitness", "gym", "yoga", "running"],
  },
  {
    vertical: "shopping_commerce",
    patterns: ["shop", "retail", "ecommerce", "deal"],
  },
  {
    vertical: "tech",
    patterns: ["tech", "gadget", "software", "app"],
  },
  {
    vertical: "lifestyle",
    patterns: ["lifestyle", "wellness", "home"],
  },
] as const;

/**
 * Pattern-match an interest/audience label against {@link VERTICAL_RULES}
 * and return the bucketed vertical. Returns `null` when no rule matches —
 * the UI renders nulls under "Other".
 */
export function classifyVertical(
  audienceLabel: string,
): TikTokVertical | null {
  if (!audienceLabel) return null;
  const haystack = audienceLabel.toLowerCase();
  for (const rule of VERTICAL_RULES) {
    for (const pattern of rule.patterns) {
      if (haystack.includes(pattern)) return rule.vertical;
    }
  }
  return null;
}
