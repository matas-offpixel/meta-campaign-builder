import type { TikTokAudienceCategory } from "../tiktok/audience.ts";
import type { TikTokTargetingItem } from "../types/tiktok-draft.ts";

/**
 * TikTok has no genre-level interest nodes. Categories are broad backing
 * only; precision comes from single-word keyword seeds (FUZZ_MATCH is a
 * literal substring matcher). Streaming is a TikTok-only cluster — it is
 * not in Meta's category list.
 */
export const TIKTOK_GENRE_PRESET_LIMITATION_NOTE =
  "TikTok has no genre-level interest categories. A preset adds broad backing paths plus single-word keyword seeds — precision comes from those seeds, geo, age and custom audiences, not from a genre node. Streaming exists here only; it is not a Meta category.";

export type TikTokTaxonomyPath = readonly string[];

export const TIKTOK_PRESET_CLUSTERS = [
  "Music & Nightlife",
  "Fashion & Streetwear",
  "Lifestyle & Nightlife",
  "Activities & Culture",
  "Media & Entertainment",
  "Sports & Live Events",
  "Streaming",
] as const;

export type TikTokPresetCluster = (typeof TIKTOK_PRESET_CLUSTERS)[number];

export type TikTokPresetBucket =
  | "scene"
  | "festival"
  | "media"
  | "nightlife"
  | "lifestyle"
  | "artist";

export const TIKTOK_ELECTRONIC_INTEREST_PATHS = [
  ["News & Entertainment", "Culture & Art", "Music"],
  ["News & Entertainment", "Culture & Art", "Dance"],
] as const satisfies readonly TikTokTaxonomyPath[];

export const TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS = [
  ["Entertainment", "Entertainment & Culture", "Music"],
  ["Talents", "Singing & Dancing"],
  ["Talents", "Singing & Dancing", "Dance"],
] as const satisfies readonly TikTokTaxonomyPath[];

const PATH_CULTURE_MUSIC = TIKTOK_ELECTRONIC_INTEREST_PATHS[0];
const PATH_CULTURE_DANCE = TIKTOK_ELECTRONIC_INTEREST_PATHS[1];
const PATH_CULTURE_ART = ["News & Entertainment", "Culture & Art"] as const;
const PATH_CULTURE_PAINTING = ["News & Entertainment", "Culture & Art", "Painting"] as const;
const PATH_MOVIE = ["News & Entertainment", "Movie"] as const;
const PATH_LIVE_EVENTS = ["News & Entertainment", "Live Events"] as const;
const PATH_SPORTS_FITNESS_NEWS = ["News & Entertainment", "Sports & Fitness"] as const;
const PATH_HEALTH_WELLNESS = ["News & Entertainment", "Health & Wellness"] as const;
const PATH_CELEBRITY = ["News & Entertainment", "Celebrity"] as const;
const PATH_TOURISM = ["News & Entertainment", "Tourism"] as const;
const PATH_APPAREL = ["Apparel & Accessories"] as const;
const PATH_HOODIES = ["Apparel & Accessories", "Men's Clothing", "Sweatshirts & Hoodies"] as const;
const PATH_ATHLEISURE = ["Apparel & Accessories", "Women's Clothing", "Athleisure"] as const;
const PATH_JEWELRY = ["Apparel & Accessories", "High-end Jewelry"] as const;
const PATH_MEN_SNEAKERS = ["Apparel & Accessories", "Men's Shoes", "Sneakers"] as const;
const PATH_WOMEN_SNEAKERS = ["Apparel & Accessories", "Women's Shoes", "Sneakers"] as const;
const PATH_SPORTS = ["Sports & Outdoors"] as const;
const PATH_SOCCER = ["Sports & Outdoors", "Sports Equipment", "Soccer"] as const;
const PATH_FITNESS_GEAR = ["Sports & Outdoors", "Sports Equipment", "Fitness Training Supplies"] as const;
const PATH_TRAVEL = ["Travel"] as const;
const PATH_MUSEUMS = ["Travel", "Tours & Attractions", "Museum Exhibits"] as const;
const PATH_ATTRACTIONS = ["Travel", "Tours & Attractions"] as const;
const PATH_BEAUTY = ["Beauty & Personal Care"] as const;
const PATH_EXERCISE = ["Life Services", "Exercise & Fitness"] as const;

const BEHAVIOUR_MUSIC = TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS[0];
const BEHAVIOUR_SINGING = TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS[1];
const BEHAVIOUR_DANCE = TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS[2];
const BEHAVIOUR_FITNESS = ["Sports & Outdoors", "Fitness & Health", "Fitness"] as const;
const BEHAVIOUR_SPORTS = ["Sports & Outdoors", "Sports"] as const;
const BEHAVIOUR_FASHION = ["Fashion & Beauty"] as const;

export interface TikTokGenrePreset {
  id: string;
  cluster: TikTokPresetCluster;
  bucket: TikTokPresetBucket;
  label: string;
  seeds: string[];
  interestPaths: readonly TikTokTaxonomyPath[];
  behaviourPaths: readonly TikTokTaxonomyPath[];
}

function preset(
  partial: TikTokGenrePreset,
): TikTokGenrePreset {
  return partial;
}

export const TIKTOK_GENRE_PRESETS: TikTokGenrePreset[] = [
  preset({
    id: "electronic-music",
    cluster: "Music & Nightlife",
    bucket: "scene",
    label: "Electronic music",
    // Validated against the live catalog. Single words only: FUZZ_MATCH
    // is a literal substring matcher ("tech house" → 0, "edm" → edmonton).
    seeds: ["techno", "house", "disco", "electronic", "dance"],
    interestPaths: TIKTOK_ELECTRONIC_INTEREST_PATHS,
    behaviourPaths: TIKTOK_ELECTRONIC_BEHAVIOUR_PATHS,
  }),
  preset({
    id: "music-festival",
    cluster: "Music & Nightlife",
    bucket: "festival",
    label: "Festival audiences",
    seeds: ["festival", "glastonbury", "tomorrowland", "boiler", "rave"],
    interestPaths: [PATH_CULTURE_MUSIC, PATH_CULTURE_DANCE],
    behaviourPaths: [BEHAVIOUR_MUSIC, BEHAVIOUR_DANCE],
  }),
  preset({
    id: "music-nightlife",
    cluster: "Music & Nightlife",
    bucket: "nightlife",
    label: "Afterparty & nightlife",
    seeds: ["club", "nightlife", "afterparty", "warehouse", "party"],
    interestPaths: [PATH_CULTURE_MUSIC, PATH_CULTURE_DANCE],
    behaviourPaths: [BEHAVIOUR_DANCE, BEHAVIOUR_SINGING],
  }),
  preset({
    id: "music-media",
    cluster: "Music & Nightlife",
    bucket: "media",
    label: "Music media",
    seeds: ["mixmag", "resident", "radio", "tastemaker", "press"],
    interestPaths: [PATH_CULTURE_MUSIC],
    behaviourPaths: [BEHAVIOUR_MUSIC],
  }),
  preset({
    id: "music-artist",
    cluster: "Music & Nightlife",
    bucket: "artist",
    label: "DJs & labels",
    seeds: ["producer", "vinyl", "label", "remix", "dj"],
    interestPaths: [PATH_CULTURE_MUSIC],
    behaviourPaths: [BEHAVIOUR_MUSIC, BEHAVIOUR_SINGING],
  }),
  preset({
    id: "fashion-streetwear",
    cluster: "Fashion & Streetwear",
    bucket: "scene",
    label: "Streetwear",
    seeds: ["streetwear", "hypebeast", "skate", "graphic", "oversized"],
    interestPaths: [PATH_HOODIES, PATH_ATHLEISURE],
    behaviourPaths: [BEHAVIOUR_FASHION],
  }),
  preset({
    id: "fashion-luxury",
    cluster: "Fashion & Streetwear",
    bucket: "lifestyle",
    label: "Luxury fashion",
    seeds: ["luxury", "designer", "runway", "couture", "tailoring"],
    interestPaths: [PATH_JEWELRY, PATH_APPAREL],
    behaviourPaths: [BEHAVIOUR_FASHION],
  }),
  preset({
    id: "fashion-media",
    cluster: "Fashion & Streetwear",
    bucket: "media",
    label: "Fashion media",
    seeds: ["vogue", "dazed", "editorial", "magazine", "campaign"],
    interestPaths: [PATH_APPAREL, PATH_CELEBRITY],
    behaviourPaths: [BEHAVIOUR_FASHION],
  }),
  preset({
    id: "fashion-sneakers",
    cluster: "Fashion & Streetwear",
    bucket: "nightlife",
    label: "Sneaker culture",
    seeds: ["sneaker", "kicks", "jordan", "trainer", "resale"],
    interestPaths: [PATH_MEN_SNEAKERS, PATH_WOMEN_SNEAKERS],
    behaviourPaths: [BEHAVIOUR_FASHION],
  }),
  preset({
    id: "lifestyle-nightlife",
    cluster: "Lifestyle & Nightlife",
    bucket: "nightlife",
    label: "Going-out",
    seeds: ["bar", "cocktail", "nightlife", "weekend", "clubbing"],
    interestPaths: [PATH_CULTURE_DANCE, PATH_LIVE_EVENTS, PATH_TRAVEL],
    behaviourPaths: [BEHAVIOUR_DANCE],
  }),
  preset({
    id: "lifestyle-alternative",
    cluster: "Lifestyle & Nightlife",
    bucket: "scene",
    label: "Alternative lifestyle",
    seeds: ["queer", "alternative", "underground", "community", "subculture"],
    interestPaths: [PATH_CULTURE_DANCE],
    behaviourPaths: [BEHAVIOUR_SINGING, BEHAVIOUR_DANCE],
  }),
  preset({
    id: "lifestyle-wellness",
    cluster: "Lifestyle & Nightlife",
    bucket: "lifestyle",
    label: "Wellness & fitness",
    seeds: ["gym", "yoga", "wellness", "fitness", "pilates"],
    interestPaths: [PATH_EXERCISE, PATH_HEALTH_WELLNESS, PATH_BEAUTY],
    behaviourPaths: [BEHAVIOUR_FITNESS],
  }),
  preset({
    id: "lifestyle-travel",
    cluster: "Lifestyle & Nightlife",
    bucket: "festival",
    label: "City-break travel",
    seeds: ["travel", "weekend", "ibiza", "berlin", "amsterdam"],
    interestPaths: [PATH_TRAVEL, PATH_TOURISM],
    behaviourPaths: [],
  }),
  preset({
    id: "culture-art",
    cluster: "Activities & Culture",
    bucket: "scene",
    label: "Art & exhibitions",
    seeds: ["gallery", "exhibition", "contemporary", "curator", "painting"],
    interestPaths: [PATH_CULTURE_PAINTING, PATH_CULTURE_ART],
    behaviourPaths: [],
  }),
  preset({
    id: "culture-institutions",
    cluster: "Activities & Culture",
    bucket: "artist",
    label: "Galleries & institutions",
    seeds: ["museum", "tate", "biennale", "collection", "sculpture"],
    interestPaths: [PATH_MUSEUMS, PATH_CULTURE_ART],
    behaviourPaths: [],
  }),
  preset({
    id: "culture-festivals",
    cluster: "Activities & Culture",
    bucket: "festival",
    label: "Cultural festivals",
    seeds: ["frieze", "biennale", "festival", "fair", "design"],
    interestPaths: [PATH_LIVE_EVENTS, PATH_ATTRACTIONS],
    behaviourPaths: [],
  }),
  preset({
    id: "culture-immersive",
    cluster: "Activities & Culture",
    bucket: "nightlife",
    label: "Immersive experiences",
    seeds: ["immersive", "installation", "experiential", "interactive", "late"],
    interestPaths: [PATH_CULTURE_ART, PATH_LIVE_EVENTS],
    behaviourPaths: [BEHAVIOUR_SINGING],
  }),
  preset({
    id: "media-press",
    cluster: "Media & Entertainment",
    bucket: "media",
    label: "Music press",
    seeds: ["mixmag", "boiler", "radio", "tastemaker", "press"],
    interestPaths: [PATH_CULTURE_MUSIC],
    behaviourPaths: [BEHAVIOUR_MUSIC],
  }),
  preset({
    id: "media-editorial",
    cluster: "Media & Entertainment",
    bucket: "scene",
    label: "Editorial culture",
    seeds: ["dazed", "magazine", "culture", "editorial", "interview"],
    interestPaths: [PATH_MOVIE, PATH_CELEBRITY],
    behaviourPaths: [],
  }),
  preset({
    id: "media-radio",
    cluster: "Media & Entertainment",
    bucket: "lifestyle",
    label: "Radio & podcasts",
    seeds: ["radio", "podcast", "nts", "rinse", "broadcast"],
    interestPaths: [PATH_CULTURE_MUSIC],
    behaviourPaths: [BEHAVIOUR_MUSIC],
  }),
  preset({
    id: "media-listings",
    cluster: "Media & Entertainment",
    bucket: "nightlife",
    label: "Event listings",
    seeds: ["listings", "nightlife", "calendar", "ticket", "event"],
    interestPaths: [PATH_LIVE_EVENTS, PATH_CULTURE_MUSIC, PATH_CULTURE_DANCE],
    behaviourPaths: [BEHAVIOUR_DANCE],
  }),
  preset({
    id: "sports-fans",
    cluster: "Sports & Live Events",
    bucket: "scene",
    label: "Fan culture",
    seeds: ["football", "supporter", "matchday", "stadium", "ultras"],
    interestPaths: [PATH_SPORTS, PATH_SOCCER, PATH_SPORTS_FITNESS_NEWS],
    behaviourPaths: [BEHAVIOUR_SPORTS],
  }),
  preset({
    id: "sports-watchparty",
    cluster: "Sports & Live Events",
    bucket: "nightlife",
    label: "Watch parties",
    seeds: ["pub", "screening", "fanzone", "football", "beer"],
    interestPaths: [PATH_SPORTS, PATH_LIVE_EVENTS],
    behaviourPaths: [BEHAVIOUR_SPORTS],
  }),
  preset({
    id: "sports-competitions",
    cluster: "Sports & Live Events",
    bucket: "festival",
    label: "Major competitions",
    seeds: ["premier", "champions", "tournament", "football", "final"],
    interestPaths: [PATH_SPORTS, PATH_SPORTS_FITNESS_NEWS],
    behaviourPaths: [BEHAVIOUR_SPORTS],
  }),
  preset({
    id: "sports-media",
    cluster: "Sports & Live Events",
    bucket: "media",
    label: "Sports media",
    seeds: ["sky", "espn", "broadcast", "highlights", "sport"],
    interestPaths: [PATH_SPORTS_FITNESS_NEWS],
    behaviourPaths: [BEHAVIOUR_SPORTS],
  }),
  preset({
    id: "sports-fitness",
    cluster: "Sports & Live Events",
    bucket: "lifestyle",
    label: "Gym & fitness",
    seeds: ["gym", "crossfit", "running", "training", "fitness"],
    interestPaths: [PATH_EXERCISE, PATH_FITNESS_GEAR, PATH_SPORTS_FITNESS_NEWS],
    behaviourPaths: [BEHAVIOUR_FITNESS],
  }),
  preset({
    id: "streaming-music",
    cluster: "Streaming",
    bucket: "artist",
    label: "Music streaming",
    seeds: ["spotify", "playlist", "soundcloud", "tidal", "stream"],
    interestPaths: [PATH_CULTURE_MUSIC],
    behaviourPaths: [BEHAVIOUR_MUSIC],
  }),
  preset({
    id: "streaming-video",
    cluster: "Streaming",
    bucket: "media",
    label: "Video streaming",
    seeds: ["netflix", "youtube", "twitch", "binge", "series"],
    interestPaths: [PATH_MOVIE],
    behaviourPaths: [],
  }),
  preset({
    id: "streaming-creator",
    cluster: "Streaming",
    bucket: "scene",
    label: "Creators",
    seeds: ["creator", "influencer", "follow", "subscribe", "livestream"],
    interestPaths: [PATH_MOVIE],
    behaviourPaths: [],
  }),
];

export function tikTokPresetsForCluster(
  cluster: TikTokPresetCluster,
): TikTokGenrePreset[] {
  return TIKTOK_GENRE_PRESETS.filter((item) => item.cluster === cluster);
}

export function tikTokPresetById(id: string): TikTokGenrePreset | undefined {
  return TIKTOK_GENRE_PRESETS.find((item) => item.id === id);
}

export interface TikTokPresetKeywordRow {
  id: string;
  name: string;
  audienceSize: number | null;
  seeds: string[];
}

export interface TikTokUnresolvedPresetPath {
  kind: "interest" | "behaviour";
  path: TikTokTaxonomyPath;
}

export interface TikTokPresetTaxonomySelection {
  interestItems: TikTokTargetingItem[];
  behaviourItems: TikTokTargetingItem[];
  unresolvedPaths: TikTokUnresolvedPresetPath[];
}

export function formatTikTokTaxonomyPath(path: TikTokTaxonomyPath): string {
  return path.map((segment) => segment.trim()).filter(Boolean).join(" > ");
}

export function formatTikTokUnresolvedPresetPaths(
  unresolved: readonly TikTokUnresolvedPresetPath[],
): string | null {
  if (unresolved.length === 0) return null;
  const named = unresolved.map((item) => formatTikTokTaxonomyPath(item.path));
  return `TikTok catalog has no node for ${named.join("; ")}.`;
}

export function tikTokPresetTaxonomyPendingReason(input: {
  hasGroup: boolean;
  catalogLoaded: boolean;
}): "no-group" | "catalog-empty" | null {
  if (!input.hasGroup) return "no-group";
  if (!input.catalogLoaded) return "catalog-empty";
  return null;
}

export function resolveTikTokPresetTaxonomy(
  catalog: {
    interests: TikTokAudienceCategory[];
    behaviours: TikTokAudienceCategory[];
  },
  preset: Pick<TikTokGenrePreset, "interestPaths" | "behaviourPaths">,
): TikTokPresetTaxonomySelection {
  const unresolvedPaths: TikTokUnresolvedPresetPath[] = [];
  const interestItems: TikTokTargetingItem[] = [];
  for (const path of preset.interestPaths) {
    const row = matchCatalogPath(catalog.interests, path);
    if (!row) {
      unresolvedPaths.push({ kind: "interest", path });
      continue;
    }
    interestItems.push({
      id: row.id,
      name: formatTikTokTaxonomyPath(path),
      kind: "category",
    });
  }
  const behaviourItems: TikTokTargetingItem[] = [];
  for (const path of preset.behaviourPaths) {
    const row = matchCatalogPath(catalog.behaviours, path);
    if (!row) {
      unresolvedPaths.push({ kind: "behaviour", path });
      continue;
    }
    behaviourItems.push({
      id: row.id,
      name: formatTikTokTaxonomyPath(path),
      kind: "category",
    });
  }
  return { interestItems, behaviourItems, unresolvedPaths };
}

export function mergeTikTokPresetTaxonomy(
  group: {
    interestIds: TikTokTargetingItem[];
    behaviourIds: TikTokTargetingItem[];
  },
  taxonomy: Pick<TikTokPresetTaxonomySelection, "interestItems" | "behaviourItems">,
): {
  interestIds: TikTokTargetingItem[];
  behaviourIds: TikTokTargetingItem[];
} {
  return {
    interestIds: unionById(group.interestIds, taxonomy.interestItems),
    behaviourIds: unionById(group.behaviourIds, taxonomy.behaviourItems),
  };
}

export async function expandTikTokPresetKeywords(
  seeds: string[],
  fetchSeed: (seed: string) => Promise<
    Array<{ id: string; name: string; audienceSize?: number | null }>
  >,
): Promise<{
  rows: TikTokPresetKeywordRow[];
  failedSeeds: string[];
  requested: number;
}> {
  const trimmed = [...new Set(seeds.map((seed) => seed.trim()).filter(Boolean))];
  const settled = await Promise.allSettled(
    trimmed.map((seed) => fetchSeed(seed)),
  );
  const byId = new Map<string, TikTokPresetKeywordRow>();
  const failedSeeds: string[] = [];
  settled.forEach((result, index) => {
    const seed = trimmed[index];
    if (result.status === "rejected") {
      failedSeeds.push(seed);
      return;
    }
    for (const item of result.value) {
      const existing = byId.get(item.id);
      if (existing) {
        if (!existing.seeds.includes(seed)) existing.seeds.push(seed);
        continue;
      }
      byId.set(item.id, {
        id: item.id,
        name: item.name,
        audienceSize: item.audienceSize ?? null,
        seeds: [seed],
      });
    }
  });
  return {
    rows: [...byId.values()],
    failedSeeds,
    requested: trimmed.length,
  };
}

export function tikTokHashtagPresetQuery(seeds: string[]): {
  keywords: string[];
  operator: "OR";
} {
  return {
    keywords: seeds.map((seed) => seed.trim()).filter(Boolean).slice(0, 10),
    operator: "OR",
  };
}

function matchCatalogPath(
  rows: TikTokAudienceCategory[],
  path: TikTokTaxonomyPath,
): TikTokAudienceCategory | null {
  const wanted = path.map(normaliseLabel);
  if (wanted.length === 0 || wanted.some((segment) => !segment)) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const leaf = wanted[wanted.length - 1];
  for (const row of rows) {
    if (normaliseLabel(row.label) !== leaf) continue;
    if (ancestorPathEquals(row, wanted, byId)) return row;
  }
  return null;
}

function ancestorPathEquals(
  row: TikTokAudienceCategory,
  wanted: string[],
  byId: Map<string, TikTokAudienceCategory>,
): boolean {
  const walked: string[] = [];
  const seen = new Set<string>();
  let current: TikTokAudienceCategory | undefined = row;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    walked.unshift(normaliseLabel(current.label));
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  if (walked.length !== wanted.length) return false;
  return walked.every((segment, index) => segment === wanted[index]);
}

function unionById(
  current: TikTokTargetingItem[],
  extra: TikTokTargetingItem[],
): TikTokTargetingItem[] {
  const seen = new Set(current.map((item) => item.id));
  const next = [...current];
  for (const item of extra) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    next.push(item);
  }
  return next;
}

function normaliseLabel(label: string): string {
  return label.trim().toLowerCase();
}
