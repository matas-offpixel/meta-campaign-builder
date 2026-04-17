// Deterministic, rule-based scene-hint presets per cluster.
//
// Used by the audience interest groups panel to render quick-pick chips
// underneath the free-text "Scene hints" input. The presets are derived
// from the selected cluster label plus the existing audience fingerprint
// (dominantScenes / detected scene tags). No LLM, no external API.
//
// The function signature is intentionally extensible so we can later feed
// event/brand/venue/promoter context from a project dashboard without
// rewriting the UI layer.

export type SceneHintPreset = {
  /** Stable identifier (cluster + base id), used by the UI to track which
   *  chip is currently selected for a group. */
  id: string;
  /** Short human label rendered on the chip. May be lightly tailored
   *  using the top dominant scene tag (e.g. "Festival crossover (techno)"). */
  label: string;
  /** The hint text written into the scene-hint input on click. Phrased as
   *  natural language so the backend intent classifier picks it up. */
  hint: string;
  /** Optional dev-only annotation explaining why this preset was chosen
   *  (top scene match, intent inference, etc.). */
  reason?: string;
};

export type SceneHintPresetParams = {
  clusterLabel: string;
  dominantScenes?: Array<{ tag: string; weight: number }>;
  detectedSceneTags?: string[];
  // Reserved for future use (project dashboard / event metadata).
  // Adding a field here must not change existing call sites.
  context?: {
    eventName?: string;
    brandName?: string;
    venue?: string;
    promoter?: string;
  };
};

const MAX_PRESETS = 6;

// ── Tag → human-readable phrase ─────────────────────────────────────────────
// Used both to convert raw tags into chip labels and to compose the hint
// text written into the input. Keep this loose — unmapped tags fall back
// to a simple snake_case → "snake case" conversion.
const TAG_LABEL: Record<string, string> = {
  hard_techno: "hard techno",
  techno: "techno",
  underground_dance: "underground dance",
  festival_circuit: "festival circuit",
  queer_underground: "queer underground",
  psy_trance: "psytrance",
  electronic_music: "electronic music",
  house_music: "house music",
  tech_house: "tech house",
  deep_house: "deep house",
  drum_and_bass: "drum & bass",
  hip_hop: "hip-hop",
  indie_rock: "indie rock",
  afrobeats: "afrobeats",
  reggaeton: "reggaeton",
  jazz: "jazz",
  avant_garde_fashion: "avant-garde fashion",
  streetwear: "streetwear",
  editorial_fashion: "editorial fashion",
  luxury_fashion: "luxury fashion",
  designer_culture: "designer culture",
  sneaker_culture: "sneaker culture",
  nightlife_social: "nightlife",
  bar_culture: "bar culture",
  food_culture: "food culture",
  travel_culture: "travel culture",
  wellness_culture: "wellness",
  fitness_culture: "fitness",
  art_design: "art & design",
  gallery_culture: "gallery culture",
  museum_culture: "museum culture",
  architecture: "architecture",
  immersive_experience: "immersive experiences",
  film_culture: "film culture",
  music_media: "music media",
  streaming_platform: "streaming platforms",
  radio_culture: "radio culture",
  podcast_culture: "podcasts",
  football_soccer: "football",
  sports_fandom: "sports fandom",
  matchday: "matchday",
  gym_fitness: "gym & fitness",
  combat_sports: "combat sports",
  sport_fitness: "sport & fitness",
  motorsport: "motorsport",
  live_viewing_event: "live viewing",
};

function friendlyTag(tag: string): string {
  return TAG_LABEL[tag] ?? tag.replace(/_/g, " ");
}

// ── Cluster-specific base presets ───────────────────────────────────────────
// Each entry is the "always-available" set per cluster. Context-aware extras
// are inserted in front by `buildContextualPresets()` when the fingerprint
// supports it (e.g. underground_dance dominant → "Underground rave & techno
// audience" preset is promoted to the top).

type BasePreset = Omit<SceneHintPreset, "id"> & { baseId: string };

const BASE_PRESETS: Record<string, BasePreset[]> = {
  "Music & Nightlife": [
    {
      baseId: "music-underground-dance",
      label: "Underground dance audience",
      hint: "underground dance audience, club crowd, raver-style",
    },
    {
      baseId: "music-tech-house-club",
      label: "Tech house / club crowd",
      hint: "tech house club crowd, dancefloor regulars",
    },
    {
      baseId: "music-festival-crossover",
      label: "Festival crossover",
      hint: "festival circuit audience, multi-day events crowd",
    },
    {
      baseId: "music-afterparty",
      label: "Afterparty / nightlife behaviour",
      hint: "afterparty crowd, nightlife regulars, late-night clubbing",
    },
    {
      baseId: "music-dj-label-culture",
      label: "DJ / label / club culture",
      hint: "DJ culture, record label fans, underground club scene",
    },
  ],
  "Fashion & Streetwear": [
    {
      baseId: "fashion-editorial",
      label: "Editorial fashion audience",
      hint: "editorial fashion readers, Vogue / Dazed / i-D audience",
    },
    {
      baseId: "fashion-streetwear",
      label: "Streetwear & subculture",
      hint: "streetwear audience, sneaker culture, urban style",
    },
    {
      baseId: "fashion-avant-garde",
      label: "Designer / avant-garde fashion",
      hint: "avant-garde fashion, Rick Owens / Maison Margiela / designer-led audience",
    },
    {
      baseId: "fashion-club-crossover",
      label: "Club-fashion crossover",
      hint: "club fashion crossover, nightlife style, underground party fashion",
    },
    {
      baseId: "fashion-youth-culture",
      label: "Youth culture & style media",
      hint: "youth culture, style media readers, fashion magazine audience",
    },
  ],
  "Lifestyle & Nightlife": [
    {
      baseId: "lifestyle-going-out",
      label: "Nightlife & going-out",
      hint: "nightlife regulars, going-out crowd, weekend party scene",
    },
    {
      baseId: "lifestyle-food-bar",
      label: "Food / drink / bar culture",
      hint: "bar culture, cocktail crowd, foodie scene",
    },
    {
      baseId: "lifestyle-fitness-wellness",
      label: "Fitness & wellness crossover",
      hint: "fitness and wellness audience, gym lifestyle, healthy lifestyle",
    },
    {
      baseId: "lifestyle-travel",
      label: "Travel / city-break crowd",
      hint: "travel and city-break audience, weekend travellers",
    },
    {
      baseId: "lifestyle-alternative",
      label: "Alternative lifestyle",
      hint: "alternative lifestyle audience, queer-friendly venues, underground community",
    },
  ],
  "Activities & Culture": [
    {
      baseId: "activities-art-exhibition",
      label: "Art & exhibition audience",
      hint: "art exhibitions, gallery openings, contemporary art crowd",
    },
    {
      baseId: "activities-urban-creative",
      label: "Urban culture & creative spaces",
      hint: "urban culture, creative spaces, independent venues",
    },
    {
      baseId: "activities-design-architecture",
      label: "Design / architecture",
      hint: "design and architecture audience, design week visitors",
    },
    {
      baseId: "activities-immersive",
      label: "Immersive experiences",
      hint: "immersive experiences, interactive installations, experiential events",
    },
    {
      baseId: "activities-culture-nightlife",
      label: "Culture + nightlife crossover",
      hint: "cultural nightlife crossover, late-opening galleries, after-hours events",
    },
  ],
  "Media & Entertainment": [
    {
      baseId: "media-music-media",
      label: "Music media audience",
      hint: "music media readers, Mixmag / Resident Advisor / DJ Mag audience",
    },
    {
      baseId: "media-editorial",
      label: "Editorial / magazine readers",
      hint: "editorial magazine readers, long-form culture media",
    },
    {
      baseId: "media-streaming",
      label: "Streaming / platform culture",
      hint: "streaming platform audience, Spotify / Apple Music / Tidal listeners",
    },
    {
      baseId: "media-radio-podcasts",
      label: "Radio / podcasts / tastemakers",
      hint: "radio listeners, podcast audience, tastemaker followers",
    },
    {
      baseId: "media-event-discovery",
      label: "Event discovery / nightlife media",
      hint: "event discovery audience, nightlife media followers, party listings readers",
    },
  ],
  "Sports & Live Events": [
    {
      baseId: "sports-fan-matchday",
      label: "Fan culture & matchday",
      hint: "football fans, matchday supporters, club fan culture",
    },
    {
      baseId: "sports-watch-parties",
      label: "Watch parties & fan zones",
      hint: "watch party audience, fan zones, live sports screening crowd",
    },
    {
      baseId: "sports-broad-football",
      label: "Broad football audience",
      hint: "broad football audience, Premier League and Champions League fans",
    },
    {
      baseId: "sports-gym-crossover",
      label: "Gym & fitness crossover",
      hint: "gym audiences for sports screenings, fitness crowd, sport activities",
    },
    {
      baseId: "sports-bars-screenings",
      label: "Sports bars & screenings",
      hint: "sports bar crowd, pub screenings, beer-and-football audience",
    },
  ],
};

// ── Contextual injections by top dominant scene ─────────────────────────────
// Cluster-aware "promoted" presets that get prepended (and dedup against the
// base list) when the audience fingerprint clearly leans a particular way.
function buildContextualPresets(
  clusterLabel: string,
  topTag: string | null,
  tagSet: Set<string>,
): BasePreset[] {
  const promoted: BasePreset[] = [];
  if (!topTag) return promoted;
  const topPretty = friendlyTag(topTag);

  if (clusterLabel === "Music & Nightlife") {
    if (
      topTag === "hard_techno" ||
      topTag === "techno" ||
      topTag === "underground_dance"
    ) {
      promoted.push({
        baseId: "music-underground-rave-techno",
        label: `Underground rave & ${topPretty}`,
        hint: `underground rave audience, ${topPretty}, hard techno club crowd`,
        reason: `top scene: ${topTag}`,
      });
    }
    if (topTag === "festival_circuit" || tagSet.has("festival_circuit")) {
      promoted.push({
        baseId: "music-festival-circuit",
        label: "Festival circuit fans",
        hint: "festival circuit fans, multi-day electronic festivals, dance music festivals",
      });
    }
  }

  if (clusterLabel === "Fashion & Streetwear") {
    if (topTag === "avant_garde_fashion" || topTag === "editorial_fashion") {
      promoted.push({
        baseId: "fashion-promoted-editorial",
        label: `Editorial-led (${topPretty})`,
        hint: `editorial fashion readers, ${topPretty}, designer-led audience`,
        reason: `top scene: ${topTag}`,
      });
    }
    if (topTag === "streetwear" || topTag === "sneaker_culture") {
      promoted.push({
        baseId: "fashion-promoted-streetwear",
        label: `Streetwear-first (${topPretty})`,
        hint: `streetwear audience, ${topPretty}, urban style crowd`,
        reason: `top scene: ${topTag}`,
      });
    }
  }

  if (clusterLabel === "Lifestyle & Nightlife") {
    if (topTag === "nightlife_social" || tagSet.has("underground_dance")) {
      promoted.push({
        baseId: "lifestyle-promoted-club",
        label: `Club-going (${topPretty})`,
        hint: `nightlife regulars, ${topPretty}, going-out crowd`,
        reason: `top scene: ${topTag}`,
      });
    }
    if (topTag === "wellness_culture" || topTag === "fitness_culture") {
      promoted.push({
        baseId: "lifestyle-promoted-wellness",
        label: `Wellness-led (${topPretty})`,
        hint: `${topPretty} audience, healthy lifestyle, gym and fitness crowd`,
        reason: `top scene: ${topTag}`,
      });
    }
  }

  if (clusterLabel === "Activities & Culture") {
    if (
      topTag === "underground_dance" ||
      topTag === "techno" ||
      topTag === "nightlife_social"
    ) {
      // One nightlife-adjacent cultural preset, but never general music
      // discovery — Activities & Culture must stay culture-led.
      promoted.push({
        baseId: "activities-promoted-nightlife-culture",
        label: `Culture x nightlife (${topPretty})`,
        hint: `cultural nightlife crossover, late-opening cultural venues, after-hours events`,
        reason: `top scene: ${topTag}`,
      });
    }
    if (topTag === "art_design" || topTag === "gallery_culture") {
      promoted.push({
        baseId: "activities-promoted-galleries",
        label: `Gallery-led (${topPretty})`,
        hint: `gallery openings, ${topPretty}, contemporary art audience`,
        reason: `top scene: ${topTag}`,
      });
    }
  }

  if (clusterLabel === "Media & Entertainment") {
    if (
      topTag === "music_media" ||
      topTag === "techno" ||
      topTag === "underground_dance"
    ) {
      promoted.push({
        baseId: "media-promoted-music-media",
        label: `Music media (${topPretty})`,
        hint: `electronic music media readers, ${topPretty}, club culture media audience`,
        reason: `top scene: ${topTag}`,
      });
    }
  }

  if (clusterLabel === "Sports & Live Events") {
    if (topTag === "football_soccer" || tagSet.has("football_soccer")) {
      promoted.push({
        baseId: "sports-promoted-football",
        label: "Football-first audience",
        hint: "football supporters, club fan culture, matchday and screening crowd",
        reason: `top scene: ${topTag}`,
      });
    }
    if (
      topTag === "gym_fitness" ||
      topTag === "sport_fitness" ||
      tagSet.has("gym_fitness")
    ) {
      promoted.push({
        baseId: "sports-promoted-gym",
        label: "Gym-first activity crowd",
        hint: "popular gym groups and sport activities, fitness crowd",
        reason: `top scene: ${topTag}`,
      });
    }
    if (topTag === "combat_sports" || tagSet.has("combat_sports")) {
      promoted.push({
        baseId: "sports-promoted-combat",
        label: "Combat sports / watch parties",
        hint: "boxing watch party, combat sports fans, UFC viewing audience",
        reason: `top scene: ${topTag}`,
      });
    }
  }

  return promoted;
}

/**
 * Build a stable, deduplicated list of scene-hint presets for a cluster.
 *
 * - Always returns at most {@link MAX_PRESETS} entries.
 * - Returns the cluster's base presets when no fingerprint is available.
 * - Promotes context-aware presets to the front when the top dominant
 *   scene supports it.
 * - Stable ordering: promoted (in declaration order) → base presets (in
 *   declaration order). Duplicates by `baseId` are collapsed.
 */
export function getSceneHintPresets(
  params: SceneHintPresetParams,
): SceneHintPreset[] {
  const { clusterLabel, dominantScenes = [], detectedSceneTags = [] } = params;
  const base = BASE_PRESETS[clusterLabel] ?? [];
  if (base.length === 0) return [];

  const tagSet = new Set<string>([
    ...dominantScenes.map((s) => s.tag),
    ...detectedSceneTags,
  ]);
  const topTag = dominantScenes[0]?.tag ?? null;

  const promoted = buildContextualPresets(clusterLabel, topTag, tagSet);

  const seen = new Set<string>();
  const out: SceneHintPreset[] = [];
  const push = (p: BasePreset) => {
    if (seen.has(p.baseId)) return;
    seen.add(p.baseId);
    out.push({
      id: `${clusterLabel}::${p.baseId}`,
      label: p.label,
      hint: p.hint,
      reason: p.reason,
    });
  };

  for (const p of promoted) push(p);
  for (const p of base) push(p);

  return out.slice(0, MAX_PRESETS);
}
