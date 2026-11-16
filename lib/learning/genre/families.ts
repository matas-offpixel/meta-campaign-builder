/**
 * The genre key per event (design record 2026-11-16-genre-key.html, GK1–GK2).
 *
 * `events.genre_family` (migration 253) holds one key from this fixed list,
 * or null for "Not set". The list, its order and its labels are GK1's. A new
 * family is a new record and a new migration, never a free entry.
 *
 * A suggestion is derived at render time from the event's genre tags
 * (`events.genres`), else from its lineup's genres (`artists.genres` through
 * `event_artists`). It is never pre-selected and never written: only an
 * operator's "Use it" + save, on that one event, sets the column.
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

export const GENRE_FAMILIES = [
  { key: "house_tech", label: "House / tech house" },
  { key: "deep_afro", label: "Deep / afro house" },
  { key: "melodic_prog", label: "Melodic / progressive" },
  { key: "disco", label: "Disco" },
  { key: "garage_bass", label: "Garage / bass" },
  { key: "dnb", label: "Drum & bass" },
  { key: "techno", label: "Techno" },
  { key: "hard_techno", label: "Hard techno" },
  { key: "commercial", label: "Commercial / nostalgia" },
  { key: "no_single_genre", label: "No single genre" },
] as const;

export type GenreFamilyKey = (typeof GENRE_FAMILIES)[number]["key"];
/** The nine families a show can pool into. "No single genre" joins none. */
export type GenrePoolKey = Exclude<GenreFamilyKey, "no_single_genre">;

export const GENRE_FAMILY_KEYS: readonly GenreFamilyKey[] = GENRE_FAMILIES.map((f) => f.key);
export const GENRE_POOL_KEYS: readonly GenrePoolKey[] = GENRE_FAMILY_KEYS.filter(
  (key): key is GenrePoolKey => key !== "no_single_genre",
);

// ─── Strings (GK1, GK2) ──────────────────────────────────────────────────────

export const GENRE_FIELD_LABEL = "Genre";
export const GENRE_NOT_SET = "Not set";
export const GENRE_USE_IT = "Use it";
export const GENRE_HELPER = "One per show. Shows of the same genre can share learnings once there are enough of them.";

export type GenreSuggestionSource = "tags" | "lineup";
export type GenreSuggestion = { key: GenrePoolKey; source: GenreSuggestionSource };

export function isGenreFamily(value: unknown): value is GenreFamilyKey {
  return typeof value === "string" && (GENRE_FAMILY_KEYS as readonly string[]).includes(value);
}

export function isGenrePoolKey(value: unknown): value is GenrePoolKey {
  return typeof value === "string" && (GENRE_POOL_KEYS as readonly string[]).includes(value);
}

export function genreLabel(key: GenreFamilyKey): string {
  return GENRE_FAMILIES.find((f) => f.key === key)!.label;
}

/** GK1: inside a sentence a label is lower case ("house / tech house shows"). */
export function genreLabelInSentence(key: GenreFamilyKey): string {
  return genreLabel(key).toLowerCase();
}

/** The trigger's text: the chosen label, or "Not set" for null. */
export function genreFieldText(value: GenreFamilyKey | null): string {
  return value ? genreLabel(value) : GENRE_NOT_SET;
}

export function genreSuggestionLine(suggestion: GenreSuggestion): string {
  return `Suggested: ${genreLabel(suggestion.key)}, from ${suggestion.source === "tags" ? "the genre tags" : "the lineup"}`;
}

/** What a save writes: the chosen key, or null for "Not set". Anything else is null, never a guess. */
export function genreFamilyForSave(value: string | null | undefined): GenreFamilyKey | null {
  return isGenreFamily(value) ? value : null;
}

/**
 * The suggestion shows only while the field is "Not set". Once an operator
 * picks a family (any, including "No single genre"), the line goes.
 */
export function visibleSuggestion(value: GenreFamilyKey | null, suggestion: GenreSuggestion | null): GenreSuggestion | null {
  return value == null ? suggestion : null;
}

// ─── Tag → family ────────────────────────────────────────────────────────────

/**
 * Free-text genre tags (as typed into `events.genres`, or Spotify-style
 * artist genres) to a family. Matched whole, after lower-casing and turning
 * hyphens and underscores into spaces, so "melodic techno" is melodic /
 * progressive, not techno. Covers every tag on prod events on 16 Nov 2026;
 * a tag not listed ("electronic", "football", "hip hop") suggests nothing.
 */
const TAG_FAMILY: Readonly<Record<string, GenrePoolKey>> = {
  house: "house_tech",
  "tech house": "house_tech",
  "minimal house": "house_tech",
  "rolling house": "house_tech",
  "minimal tech": "house_tech",
  "deep house": "deep_afro",
  "afro house": "deep_afro",
  afrohouse: "deep_afro",
  "organic house": "deep_afro",
  "melodic house": "melodic_prog",
  "melodic techno": "melodic_prog",
  "melodic house and techno": "melodic_prog",
  "melodic house & techno": "melodic_prog",
  "progressive house": "melodic_prog",
  progressive: "melodic_prog",
  trance: "melodic_prog",
  disco: "disco",
  "nu disco": "disco",
  "disco house": "disco",
  "uk garage": "garage_bass",
  garage: "garage_bass",
  ukg: "garage_bass",
  "2 step": "garage_bass",
  bass: "garage_bass",
  "bass house": "garage_bass",
  bassline: "garage_bass",
  "140": "garage_bass",
  grime: "garage_bass",
  dubstep: "garage_bass",
  dnb: "dnb",
  "drum and bass": "dnb",
  "drum & bass": "dnb",
  "drum n bass": "dnb",
  jungle: "dnb",
  techno: "techno",
  "peak time techno": "techno",
  "raw techno": "techno",
  "hard techno": "hard_techno",
  "industrial techno": "hard_techno",
  commercial: "commercial",
  nostalgia: "commercial",
  throwback: "commercial",
  pop: "commercial",
  "90s": "commercial",
  "00s": "commercial",
};

export function normaliseGenreTag(tag: string): string {
  return tag.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function familyOfTag(tag: string): GenrePoolKey | null {
  return TAG_FAMILY[normaliseGenreTag(tag)] ?? null;
}

/** The family most tags point to; a tie goes to the family of the earliest tag. Null when none map. */
function familyOfTags(tags: readonly string[]): GenrePoolKey | null {
  const counts = new Map<GenrePoolKey, { n: number; first: number }>();
  tags.forEach((tag, at) => {
    const family = familyOfTag(tag);
    if (!family) return;
    const hit = counts.get(family) ?? { n: 0, first: at };
    hit.n += 1;
    counts.set(family, hit);
  });
  let best: { key: GenrePoolKey; n: number; first: number } | null = null;
  for (const [key, { n, first }] of counts) {
    if (!best || n > best.n || (n === best.n && first < best.first)) best = { key, n, first };
  }
  return best?.key ?? null;
}

/**
 * GK2's suggestion: from the event's genre tags, else from its lineup's
 * genres. Never "No single genre" (that is the operator's call only).
 */
export function suggestGenreFamily(input: {
  tags: readonly string[] | null | undefined;
  lineupGenres?: readonly string[] | null;
}): GenreSuggestion | null {
  const fromTags = familyOfTags(input.tags ?? []);
  if (fromTags) return { key: fromTags, source: "tags" };
  const fromLineup = familyOfTags(input.lineupGenres ?? []);
  if (fromLineup) return { key: fromLineup, source: "lineup" };
  return null;
}

/** The form's comma list of tags, as the save splits it. */
export function splitGenreTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}
