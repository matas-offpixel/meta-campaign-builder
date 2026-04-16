import type { AudienceSettings, InterestGroup } from "./types";

// Cluster labels that match CLUSTER_DEFS in the interest-discover route.
export const CLUSTER_LABELS = [
  "Music & Nightlife",
  "Fashion & Streetwear",
  "Lifestyle & Nightlife",
  "Activities & Culture",
  "Media & Entertainment",
  "Sports & Live Events",
] as const;

export type ClusterLabel = typeof CLUSTER_LABELS[number];

// Map friendly display group names → canonical cluster label for auto-discovery
const CLUSTER_NAME_MAP: Record<string, ClusterLabel> = {
  "Music & Venues": "Music & Nightlife",
  "Music & Nightlife": "Music & Nightlife",
  "Fashion & Streetwear": "Fashion & Streetwear",
  "Lifestyle & Nightlife": "Lifestyle & Nightlife",
  "Activities & Culture": "Activities & Culture",
  "Media & Entertainment": "Media & Entertainment",
  "Sports & Live Events": "Sports & Live Events",
  "Sports": "Sports & Live Events",
  "Live Sports": "Sports & Live Events",
  "Matchday": "Sports & Live Events",
  "Fanpark": "Sports & Live Events",
};

/** Infer a cluster label from a group name, or return null. */
export function inferClusterFromName(name: string): ClusterLabel | null {
  // Exact match first
  const exact = CLUSTER_NAME_MAP[name];
  if (exact) return exact;
  // Fuzzy: check if any label words appear. Order matters — more specific
  // patterns (sports) are tried before broader music/nightlife patterns.
  const lower = name.toLowerCase();
  if (/\b(sport|sports|football|soccer|match\s*day|matchday|fanpark|fan\s*zone|premier\s*league|champions\s*league|screening|boxing|mma|ufc|rugby|cricket|f1|formula\s*1|motorsport)\b/i.test(lower))
    return "Sports & Live Events";
  if (/music|venue|\bclub\b|dj|festival|nightl/i.test(lower)) return "Music & Nightlife";
  if (/fashion|streetwear|style|luxury.?brand|designer/i.test(lower)) return "Fashion & Streetwear";
  if (/lifestyle|nightlife|bar|hotel|premium/i.test(lower)) return "Lifestyle & Nightlife";
  if (/activit|culture|art|creative|design|exhibit/i.test(lower)) return "Activities & Culture";
  if (/media|entertainment|publication|creator|magazine/i.test(lower)) return "Media & Entertainment";
  return null;
}

// Themed group name suggestions for the auto-generate feature.
const INTEREST_GROUP_TEMPLATES: Array<{ name: string; clusterType: ClusterLabel }> = [
  { name: "Music & Venues", clusterType: "Music & Nightlife" },
  { name: "Fashion & Streetwear", clusterType: "Fashion & Streetwear" },
  { name: "Lifestyle & Nightlife", clusterType: "Lifestyle & Nightlife" },
  { name: "Activities & Culture", clusterType: "Activities & Culture" },
  { name: "Media & Entertainment", clusterType: "Media & Entertainment" },
  { name: "Sports & Live Events", clusterType: "Sports & Live Events" },
];

/**
 * Generate empty themed interest groups based on common targeting categories.
 * Groups have suggested names but NO pre-filled interests — the user must
 * search Meta's interest database for real targeting IDs.
 */
export function generateInterestGroupsFromAudiences(
  _audiences: AudienceSettings
): InterestGroup[] {
  return INTEREST_GROUP_TEMPLATES.map(({ name, clusterType }) => ({
    id: crypto.randomUUID(),
    name,
    interests: [],
    clusterType,
  }));
}

/**
 * Default age range suggestion. Once real page genre data is available
 * from Meta, this can be enhanced with genre-based heuristics.
 */
export function suggestAgeRange(_audiences: AudienceSettings): { min: number; max: number } {
  return { min: 18, max: 45 };
}
