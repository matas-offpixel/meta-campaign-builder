import type { AudienceSettings, InterestGroup } from "./types";

// Themed group name suggestions for the auto-generate feature.
// These create empty named groups — the user must search Meta's interest
// database to add real targetable interests with valid Meta IDs.
const INTEREST_GROUP_TEMPLATES = [
  "Music & Venues",
  "Fashion & Streetwear",
  "Lifestyle & Nightlife",
  "Activities & Culture",
  "Media & Entertainment",
  "Behaviours & Tech",
  "Beauty & Wellness",
];

/**
 * Generate empty themed interest groups based on common targeting categories.
 * Groups have suggested names but NO pre-filled interests — the user must
 * search Meta's interest database for real targeting IDs.
 */
export function generateInterestGroupsFromAudiences(
  _audiences: AudienceSettings
): InterestGroup[] {
  return INTEREST_GROUP_TEMPLATES.slice(0, 5).map((name) => ({
    id: crypto.randomUUID(),
    name,
    interests: [],
  }));
}

/**
 * Default age range suggestion. Once real page genre data is available
 * from Meta, this can be enhanced with genre-based heuristics.
 */
export function suggestAgeRange(_audiences: AudienceSettings): { min: number; max: number } {
  return { min: 18, max: 45 };
}
