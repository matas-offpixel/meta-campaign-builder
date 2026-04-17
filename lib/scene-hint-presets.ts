// Deterministic, rule-based scene-hint presets per cluster.
//
// Used by the audience interest groups panel to render quick-pick chips
// underneath the free-text "Scene hints" input. Each preset represents a
// DISTINCT targeting angle (scene / festival / media / nightlife /
// lifestyle / artist) so each chip click produces a meaningfully
// different Meta interest pool.
//
// No LLM, no external API. Function signature is intentionally extensible
// so we can later feed event/brand/venue/promoter context from a project
// dashboard without rewriting the UI layer.

/** A targeting angle. Each cluster ships at most one preset per bucket
 *  (with rare exceptions where two angles within a cluster are clearly
 *  distinct, e.g. designer brands vs streetwear). */
export type SceneHintBucket =
  | "scene"
  | "festival"
  | "media"
  | "nightlife"
  | "lifestyle"
  | "artist";

export type SceneHintPreset = {
  /** Stable identifier (`<cluster>::<baseId>`), used by the UI to track
   *  which chip is currently selected for a group. */
  id: string;
  /** Short human label rendered on the chip. */
  label: string;
  /** Short, comma-separated hint text written into the scene-hint input
   *  on click. Phrased as natural language with concrete entity names so
   *  the backend intent classifier + Meta search both pick it up. */
  hint: string;
  /** Targeting angle. Each angle aims to produce a different result set
   *  so the user can flip between them and see clear deltas. */
  bucket: SceneHintBucket;
  /** Optional dev-only annotation explaining why this preset was reordered
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

// ── Cluster base presets (one per bucket where possible) ─────────────────────
// Hints are intentionally short, comma-separated, and use named entities
// where they help (festivals, media brands, designer houses, competitions,
// streaming platforms, broadcasters) so each bucket lands in a distinctly
// different slice of the Meta interest graph.

type BasePreset = Omit<SceneHintPreset, "id">;

const BASE_PRESETS: Record<string, BasePreset[]> = {
  "Music & Nightlife": [
    {
      bucket: "scene",
      label: "Underground rave audience",
      hint: "underground rave, techno, underground dance, club crowd",
    },
    {
      bucket: "festival",
      label: "Festival audiences (major events)",
      hint: "music festivals, Glastonbury, Tomorrowland, Coachella, Ultra Music Festival, Burning Man, Lollapalooza, Boiler Room",
    },
    {
      bucket: "media",
      label: "Music media & tastemakers",
      hint: "Resident Advisor, Boiler Room, Mixmag, DJ Mag, electronic music media, DJs",
    },
    {
      bucket: "nightlife",
      label: "Afterparty & nightlife behaviour",
      hint: "nightclub, clubbing, nightlife, late night venues, partygoers",
    },
    {
      bucket: "lifestyle",
      label: "Gym & lifestyle crossover",
      hint: "gym, fitness, workout, running, CrossFit, healthy lifestyle",
    },
    {
      bucket: "artist",
      label: "DJs & labels ecosystem",
      hint: "Carl Cox, Solomun, Tale Of Us, Adam Beyer, record label, electronic music",
    },
  ],

  "Fashion & Streetwear": [
    {
      bucket: "scene",
      label: "Editorial fashion audience",
      hint: "editorial fashion, runway, avant-garde fashion, fashion week",
    },
    {
      bucket: "artist",
      label: "Designer brands ecosystem",
      hint: "Rick Owens, Maison Margiela, Comme des Garçons, Helmut Lang, Yohji Yamamoto, Raf Simons",
    },
    {
      bucket: "media",
      label: "Fashion magazines & media",
      hint: "Vogue, Dazed, i-D, Another Magazine, SHOWstudio, fashion magazines",
    },
    {
      bucket: "nightlife",
      label: "Streetwear & sneaker culture",
      hint: "streetwear, sneakerheads, Hypebeast, hype culture, sneaker collecting",
    },
    {
      bucket: "lifestyle",
      label: "Luxury lifestyle crossover",
      hint: "luxury lifestyle, designer clothing, high fashion shoppers, premium brands",
    },
  ],

  "Lifestyle & Nightlife": [
    {
      bucket: "nightlife",
      label: "Going-out & late nights",
      hint: "nightclub, clubbing, bars, cocktails, weekend nightlife",
    },
    {
      bucket: "scene",
      label: "Alternative lifestyle audience",
      hint: "alternative lifestyle, queer-friendly venues, underground community, subculture",
    },
    {
      bucket: "lifestyle",
      label: "Wellness & fitness",
      hint: "wellness, gym, fitness, yoga, healthy lifestyle, mindfulness",
    },
    {
      bucket: "festival",
      label: "Travel & city-break crowd",
      hint: "city breaks, weekend travel, festival tourism, Ibiza, Berlin, Amsterdam",
    },
    {
      bucket: "media",
      label: "Lifestyle media readers",
      hint: "Time Out, Vice, Monocle, lifestyle magazines, urban culture media",
    },
  ],

  "Activities & Culture": [
    {
      bucket: "scene",
      label: "Art & exhibitions audience",
      hint: "art exhibitions, contemporary art, gallery openings, art collectors",
    },
    {
      bucket: "artist",
      label: "Galleries & institutions",
      hint: "Tate, MoMA, Centre Pompidou, Serpentine Galleries, Saatchi Gallery, Guggenheim",
    },
    {
      bucket: "festival",
      label: "Design weeks & cultural festivals",
      hint: "Frieze Art Fair, Venice Biennale, London Design Week, Milan Design Week, Art Basel",
    },
    {
      bucket: "nightlife",
      label: "Immersive experiences",
      hint: "immersive experiences, interactive installations, late-opening galleries, experiential events",
    },
    {
      bucket: "lifestyle",
      label: "Creative urban lifestyle",
      hint: "creative spaces, independent venues, design culture, urban creatives",
    },
  ],

  "Media & Entertainment": [
    {
      bucket: "media",
      label: "Music media & DJ press",
      hint: "Resident Advisor, Mixmag, DJ Mag, Boiler Room, electronic music media",
    },
    {
      bucket: "artist",
      label: "Streaming platforms",
      hint: "Spotify, Apple Music, Tidal, SoundCloud, Deezer, YouTube Music",
    },
    {
      bucket: "scene",
      label: "Editorial culture magazines",
      hint: "Dazed, i-D, Vogue, Another Magazine, The Face, culture magazines",
    },
    {
      bucket: "lifestyle",
      label: "Radio, podcasts & tastemakers",
      hint: "NTS Radio, Rinse FM, BBC Radio 1, podcasts, tastemaker radio",
    },
    {
      bucket: "nightlife",
      label: "Event discovery & nightlife listings",
      hint: "event discovery, nightlife listings, party calendars, club listings, Resident Advisor events",
    },
  ],

  "Sports & Live Events": [
    {
      bucket: "scene",
      label: "Fan culture & matchday",
      hint: "football fans, matchday supporters, club fan culture, supporter identity",
    },
    {
      bucket: "nightlife",
      label: "Watch parties & fan zones",
      hint: "sports bar, pub screenings, fan zones, watch party, beer and football",
    },
    {
      bucket: "festival",
      label: "Major competitions",
      hint: "Premier League, UEFA Champions League, UEFA Europa League, FIFA World Cup, UEFA Euro",
    },
    {
      bucket: "media",
      label: "Sports broadcasters & media",
      hint: "Sky Sports, BT Sport, TNT Sports, ESPN, sports broadcasting",
    },
    {
      bucket: "lifestyle",
      label: "Gym & fitness crossover",
      hint: "popular gym groups and sport activities, CrossFit, fitness crowd, gym audiences",
    },
  ],
};

// ── Scene-aware bucket priority ──────────────────────────────────────────────
// Light reordering only — we never duplicate, rename, or invent new presets
// based on the fingerprint. Buckets with non-zero priority float to the
// front (preserving relative order for ties via the base ordering).
function bucketPriority(
  clusterLabel: string,
  topTag: string | null,
  tagSet: Set<string>,
): Partial<Record<SceneHintBucket, number>> {
  const p: Partial<Record<SceneHintBucket, number>> = {};
  if (!topTag && tagSet.size === 0) return p;

  if (clusterLabel === "Music & Nightlife") {
    if (
      topTag === "underground_dance" ||
      topTag === "techno" ||
      topTag === "hard_techno"
    ) {
      p.scene = 3;
      p.media = 2;
    }
    if (topTag === "festival_circuit" || tagSet.has("festival_circuit")) {
      p.festival = 3;
    }
    if (topTag === "nightlife_social" || tagSet.has("nightlife_social")) {
      p.nightlife = 3;
    }
    if (
      topTag === "wellness_culture" ||
      topTag === "fitness_culture" ||
      tagSet.has("gym_fitness")
    ) {
      p.lifestyle = 3;
    }
  }

  if (clusterLabel === "Fashion & Streetwear") {
    if (
      topTag === "editorial_fashion" ||
      topTag === "avant_garde_fashion" ||
      topTag === "luxury_fashion"
    ) {
      p.scene = 3;
      p.media = 2;
    }
    if (topTag === "streetwear" || topTag === "sneaker_culture") {
      p.nightlife = 3;
      p.artist = 2;
    }
    if (topTag === "designer_culture") {
      p.artist = 3;
    }
  }

  if (clusterLabel === "Lifestyle & Nightlife") {
    if (topTag === "nightlife_social" || tagSet.has("underground_dance")) {
      p.nightlife = 3;
    }
    if (topTag === "wellness_culture" || topTag === "fitness_culture") {
      p.lifestyle = 3;
    }
    if (topTag === "travel_culture" || tagSet.has("festival_circuit")) {
      p.festival = 2;
    }
  }

  if (clusterLabel === "Activities & Culture") {
    if (topTag === "art_design" || topTag === "gallery_culture") {
      p.scene = 3;
      p.artist = 2;
    }
    if (topTag === "immersive_experience") {
      p.nightlife = 3;
    }
    if (topTag === "architecture") {
      p.festival = 2;
    }
  }

  if (clusterLabel === "Media & Entertainment") {
    if (
      topTag === "music_media" ||
      topTag === "techno" ||
      topTag === "underground_dance"
    ) {
      p.media = 3;
    }
    if (topTag === "streaming_platform") {
      p.artist = 3;
    }
    if (topTag === "podcast_culture" || topTag === "radio_culture") {
      p.lifestyle = 3;
    }
  }

  if (clusterLabel === "Sports & Live Events") {
    if (topTag === "football_soccer" || tagSet.has("football_soccer")) {
      p.scene = 3;
      p.festival = 2;
    }
    if (topTag === "sports_fandom") {
      p.scene = 3;
      p.nightlife = 2;
    }
    if (
      topTag === "gym_fitness" ||
      topTag === "sport_fitness" ||
      tagSet.has("gym_fitness")
    ) {
      p.lifestyle = 3;
    }
    if (topTag === "combat_sports" || topTag === "live_viewing_event") {
      p.nightlife = 3;
    }
    if (topTag === "matchday") {
      p.scene = 3;
      p.nightlife = 2;
    }
  }

  return p;
}

/**
 * Build a stable, deduplicated list of scene-hint presets for a cluster.
 *
 * - Returns at most {@link MAX_PRESETS} entries (currently 6).
 * - Returns the cluster's base presets in declaration order when no
 *   fingerprint is available.
 * - Lightly reorders presets so buckets matching the top dominant scene
 *   surface first; never invents, renames, or duplicates presets.
 * - Stable: ties resolve to base declaration order.
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
  const priority = bucketPriority(clusterLabel, topTag, tagSet);

  // Stable sort: higher priority first; original index for tie-break.
  const indexed = base.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => {
    const pa = priority[a.p.bucket] ?? 0;
    const pb = priority[b.p.bucket] ?? 0;
    if (pa !== pb) return pb - pa;
    return a.i - b.i;
  });

  // Deduplicate by bucket: only the first occurrence of each bucket wins.
  // (Base lists generally have one entry per bucket already; this is
  // belt-and-braces and prevents accidental duplicates from future edits.)
  const seenIds = new Set<string>();
  const out: SceneHintPreset[] = [];
  for (const { p } of indexed) {
    const id = `${clusterLabel}::${p.bucket}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const reason =
      (priority[p.bucket] ?? 0) > 0 && topTag
        ? `top scene: ${topTag}`
        : undefined;
    out.push({ id, label: p.label, hint: p.hint, bucket: p.bucket, reason });
    if (out.length >= MAX_PRESETS) break;
  }

  return out;
}
