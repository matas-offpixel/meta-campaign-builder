/**
 * POST /api/meta/interest-discover
 *
 * Pooled audience fingerprint interest discovery.
 *
 * Every selected source (pages, engagement custom audiences, genre groups,
 * manual hints) is normalised into weighted scene signals. The combined
 * fingerprint drives:
 *   - which entity terms are searched (and in what priority order)
 *   - how strict blocklist / score-threshold filtering is
 *   - what confidence level is reported to the UI
 *
 * High-confidence fingerprints → fewer, more specific suggestions.
 * Low-confidence fingerprints  → broader suggestions with curated seeds.
 *
 * Weights:
 *   manual hint                   10 (explicit user signal)
 *   engagement CA (IG/FB 365d)    15 (proven real-audience signal)
 *   named page (classifier match)  8
 *   genre bucket                   6 (per page in bucket)
 *   page category fallback          3
 *   campaign name keyword           2
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Scene tags ────────────────────────────────────────────────────────────────

type SceneTag =
  | "techno"
  | "hard_techno"
  | "hardcore"
  | "psy_trance"
  | "tech_house"
  | "deep_house"
  | "house_music"
  | "progressive_house"
  | "drum_and_bass"
  | "trance"
  | "afrobeats"
  | "garage_uk"
  | "edm_mainstage"
  | "underground_dance"
  | "queer_underground"
  | "festival_circuit"
  | "london_scene"
  | "berlin_scene"
  | "ibiza_scene"
  | "amsterdam_scene"
  | "nyc_scene"
  | "dance_media"
  | "rave_fashion"
  | "avant_garde_fashion"
  | "editorial_fashion";

const ALL_SCENE_TAGS = new Set<SceneTag>([
  "techno", "hard_techno", "hardcore", "psy_trance",
  "tech_house", "deep_house", "house_music", "progressive_house",
  "drum_and_bass", "trance", "afrobeats", "garage_uk", "edm_mainstage",
  "underground_dance", "queer_underground", "festival_circuit",
  "london_scene", "berlin_scene", "ibiza_scene", "amsterdam_scene", "nyc_scene",
  "dance_media", "rave_fashion", "avant_garde_fashion", "editorial_fashion",
]);

/** Scene tags that indicate niche/specific audiences (raise confidence score) */
const NICHE_SCENE_TAGS = new Set<SceneTag>([
  "hard_techno", "hardcore", "psy_trance", "queer_underground",
  "avant_garde_fashion", "editorial_fashion", "drum_and_bass",
  "garage_uk", "berlin_scene",
]);

// ── Genre bucket → scene tag mapping ─────────────────────────────────────────
// Maps Beatport-style genre buckets (from genre-classification.ts) to scene tags.

const GENRE_BUCKET_SCENE_TAGS: Record<string, SceneTag[]> = {
  techno_peak:          ["techno", "hard_techno", "underground_dance", "festival_circuit"],
  techno_raw:           ["techno", "underground_dance", "berlin_scene"],
  melodic_house_techno: ["deep_house", "progressive_house", "underground_dance"],
  progressive_house:    ["progressive_house", "underground_dance"],
  amapiano_afro_house:  ["afrobeats", "underground_dance"],
  underground_house:    ["deep_house", "house_music", "underground_dance"],
  deep_house:           ["deep_house", "house_music"],
  classic_house:        ["house_music"],
  disco_nu_disco:       ["house_music", "ibiza_scene"],
  tech_house:           ["tech_house", "ibiza_scene", "underground_dance"],
  trance:               ["trance"],
  "140_garage_grime":   ["garage_uk", "underground_dance"],
  breaks_breakbeat:     ["underground_dance"],
  dance_pop_commercial: ["edm_mainstage"],
  drum_and_bass:        ["drum_and_bass", "underground_dance"],
};

// ── Signal weights ────────────────────────────────────────────────────────────

const W_HINT          = 10; // explicit user scene hint
const W_ENGAGEMENT_CA = 15; // engagement custom audience (proven real-audience signal)
const W_PAGE_NAMED    = 8;  // page name/IG handle matched a specific classifier rule
const W_GENRE_BUCKET  = 6;  // genre classification bucket (per page unit)
const W_PAGE_CATEGORY = 3;  // page category fallback (weakest)

// ── Entity classifiers ────────────────────────────────────────────────────────

interface ClassifierRule {
  pattern?: RegExp;
  categories?: string[];
  tags: SceneTag[];
}

const ENTITY_CLASSIFIERS: ClassifierRule[] = [
  // Known venues
  { pattern: /\bfabric\b/i, tags: ["techno", "tech_house", "underground_dance", "london_scene"] },
  { pattern: /\bberghain\b/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\btresor\b/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bwatergate\b/i, tags: ["tech_house", "deep_house", "berlin_scene"] },
  { pattern: /\bsisyphos\b/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bxoyo\b/i, tags: ["tech_house", "underground_dance", "london_scene"] },
  { pattern: /\bprintworks\b/i, tags: ["techno", "tech_house", "underground_dance", "london_scene"] },
  { pattern: /\begg\s*london\b|egg\s*club\b/i, tags: ["techno", "underground_dance", "london_scene"] },
  { pattern: /\btobacco\s*dock\b/i, tags: ["underground_dance", "festival_circuit", "london_scene"] },
  { pattern: /\boval\s*space\b/i, tags: ["techno", "underground_dance", "london_scene"] },
  { pattern: /\bcorsica\s*studio/i, tags: ["techno", "underground_dance", "london_scene"] },
  { pattern: /\bthe\s*cause\b/i, tags: ["techno", "underground_dance", "london_scene"] },
  { pattern: /\belectricbrixton|electric\s*brixton\b/i, tags: ["underground_dance", "london_scene"] },
  { pattern: /\bministry\s*of\s*sound\b/i, tags: ["house_music", "edm_mainstage", "london_scene"] },
  { pattern: /\bpacha\b/i, tags: ["house_music", "ibiza_scene"] },
  { pattern: /\bamnesia\b(?!.*(film|movie|band))/i, tags: ["house_music", "tech_house", "ibiza_scene"] },
  { pattern: /\bushua[iï]a\b/i, tags: ["edm_mainstage", "ibiza_scene"] },
  { pattern: /\bdc.?10\b/i, tags: ["techno", "tech_house", "ibiza_scene"] },
  { pattern: /\bspace\s*ibiza\b/i, tags: ["tech_house", "house_music", "ibiza_scene"] },
  { pattern: /\bpanorama\s*bar\b/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bclub\s*der\s*vision/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bde\s*school\b/i, tags: ["techno", "underground_dance", "amsterdam_scene"] },
  { pattern: /\bmelkweg\b/i, tags: ["underground_dance", "amsterdam_scene"] },
  { pattern: /\bshelter\s*amsterdam/i, tags: ["techno", "amsterdam_scene"] },
  { pattern: /\bbrooklyn\s*mirage/i, tags: ["techno", "tech_house", "nyc_scene"] },
  // Record labels
  { pattern: /\bdrumcode\b/i, tags: ["techno"] },
  { pattern: /\bdefected\b/i, tags: ["house_music", "deep_house"] },
  { pattern: /\btoolroom\b/i, tags: ["tech_house"] },
  { pattern: /\bhot\s*creations\b/i, tags: ["tech_house", "deep_house"] },
  { pattern: /\bdirtybird\b/i, tags: ["tech_house"] },
  { pattern: /\banjunadeep\b/i, tags: ["deep_house", "progressive_house"] },
  { pattern: /\banjunabeats\b/i, tags: ["trance", "progressive_house"] },
  { pattern: /\bmetalheadz\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bhospital\s*records\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bram\s*records\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bglitterbox\b/i, tags: ["house_music", "deep_house"] },
  { pattern: /\bsolid\s*grooves\b/i, tags: ["tech_house"] },
  { pattern: /\brelief\s*records\b/i, tags: ["tech_house"] },
  { pattern: /\bblack\s*butter\b/i, tags: ["house_music", "garage_uk"] },
  { pattern: /\bwarp\s*records\b/i, tags: ["techno", "underground_dance"] },
  { pattern: /\bostgut\s*ton\b/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bklockworks\b/i, tags: ["techno", "hard_techno"] },
  // DJs / artists
  { pattern: /\badam\s*beyer\b/i, tags: ["techno"] },
  { pattern: /\brichie\s*hawtin\b/i, tags: ["techno"] },
  { pattern: /\bben\s*klock\b/i, tags: ["techno"] },
  { pattern: /\bcharlotte\s*de\s*witte\b/i, tags: ["techno", "hard_techno"] },
  { pattern: /\bjeff\s*mills\b/i, tags: ["techno"] },
  { pattern: /\bellen\s*allien\b/i, tags: ["techno"] },
  { pattern: /\bsurgeon\b(?!.*(doctor|plastic))/i, tags: ["techno", "hard_techno"] },
  { pattern: /\bpeggy\s*gou\b/i, tags: ["tech_house", "deep_house"] },
  { pattern: /\bcamelphat\b/i, tags: ["tech_house"] },
  { pattern: /\bfisher\b(?!.*(island|price))/i, tags: ["tech_house"] },
  { pattern: /\bsolardo\b/i, tags: ["tech_house"] },
  { pattern: /\beli\s*brown\b/i, tags: ["tech_house"] },
  { pattern: /\bkerri\s*chandler\b/i, tags: ["deep_house"] },
  { pattern: /\blarry\s*heard\b|\bmr\s*fingers\b/i, tags: ["deep_house", "house_music"] },
  { pattern: /\bfrankie\s*knuckles\b/i, tags: ["house_music"] },
  { pattern: /\bron\s*hardy\b/i, tags: ["house_music"] },
  { pattern: /\bdeadmau5\b/i, tags: ["progressive_house", "edm_mainstage"] },
  { pattern: /\beric\s*prydz\b/i, tags: ["progressive_house"] },
  { pattern: /\bswedish\s*house\s*mafia\b/i, tags: ["progressive_house", "edm_mainstage"] },
  { pattern: /\barmin\s*van\s*buuren\b/i, tags: ["trance"] },
  { pattern: /\bpaul\s*van\s*dyk\b/i, tags: ["trance"] },
  { pattern: /\btii?sto\b/i, tags: ["trance", "edm_mainstage"] },
  { pattern: /\bgoldie\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bltj\s*bukem\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bandy\s*c\b/i, tags: ["drum_and_bass"] },
  { pattern: /\broni\s*size\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bchase\s*[&+]\s*status\b/i, tags: ["drum_and_bass"] },
  { pattern: /\bwizkid\b/i, tags: ["afrobeats"] },
  { pattern: /\bburna\s*boy\b/i, tags: ["afrobeats"] },
  { pattern: /\bdavido\b/i, tags: ["afrobeats"] },
  { pattern: /\bstokie|stormzy|skepta|slowthai/i, tags: ["garage_uk"] },
  // Festivals
  { pattern: /\btomorrowland\b/i, tags: ["edm_mainstage", "progressive_house", "festival_circuit"] },
  { pattern: /\bcoachella\b/i, tags: ["festival_circuit", "edm_mainstage"] },
  { pattern: /\bglastonbury\b/i, tags: ["festival_circuit"] },
  { pattern: /\bcreamfields\b/i, tags: ["festival_circuit", "tech_house", "edm_mainstage"] },
  { pattern: /\bawakenings\b/i, tags: ["techno", "hard_techno", "festival_circuit"] },
  { pattern: /\bsonar\b/i, tags: ["techno", "underground_dance", "festival_circuit"] },
  { pattern: /\bade\b|\bamsterdam\s*dance\s*event\b/i, tags: ["festival_circuit", "underground_dance"] },
  { pattern: /\bhideout\s*festival\b/i, tags: ["tech_house", "festival_circuit"] },
  { pattern: /\bboiler\s*room\b/i, tags: ["techno", "underground_dance", "dance_media"] },
  { pattern: /\bgalaxy\s*festival|gala\b/i, tags: ["underground_dance", "festival_circuit"] },
  { pattern: /\bburn(ing)?\s*man\b/i, tags: ["underground_dance", "festival_circuit"] },
  // Music media
  { pattern: /\bmixmag\b/i, tags: ["dance_media", "underground_dance"] },
  { pattern: /\bresident\s*advisor\b/i, tags: ["dance_media", "underground_dance"] },
  { pattern: /\bdj\s*mag\b/i, tags: ["dance_media"] },
  // Fashion
  { pattern: /\bpalace\s*skate/i, tags: ["rave_fashion"] },
  { pattern: /\bcarhartt\b/i, tags: ["rave_fashion"] },
  { pattern: /\bst[uü]ss?y\b/i, tags: ["rave_fashion"] },
  { pattern: /\boff.?white\b/i, tags: ["rave_fashion"] },
  { pattern: /\bdazed\b/i, tags: ["rave_fashion", "dance_media"] },
  { pattern: /\bi.d\s*magazine|i-d\s*mag/i, tags: ["rave_fashion", "dance_media"] },
  // Hard techno / industrial
  { pattern: /\bfury\b/i, tags: ["hard_techno", "underground_dance", "festival_circuit"] },
  { pattern: /\bhard\s*techno\b/i, tags: ["hard_techno", "underground_dance"] },
  { pattern: /\bindustrial\s*techno\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\brebekah\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\bblawan\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\bkarenn\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\btrym\b/i, tags: ["hard_techno"] },
  { pattern: /\boscar\s*mulero\b/i, tags: ["hard_techno", "techno"] },
  // Hardcore / gabber
  { pattern: /\bdefqon\.?1\b|\bq.?dance\b/i, tags: ["hardcore", "festival_circuit"] },
  { pattern: /\bgabber\b|\bhardstyle\b|\bhardcore\s*rave\b/i, tags: ["hardcore"] },
  { pattern: /\bnoisecontrollers\b|\bcoone\b|\bheadhunterz\b/i, tags: ["hardcore"] },
  // Psytrance
  { pattern: /\bpsytrance\b|\bpsy.?trance\b|\bgoa\s*trance\b/i, tags: ["psy_trance", "festival_circuit"] },
  { pattern: /\bozora\b|\bshankra\b|\bspirit\s*festival\b/i, tags: ["psy_trance", "festival_circuit"] },
  { pattern: /\binfected\s*mushroom\b|\bastrix\b|\bshpongle\b/i, tags: ["psy_trance"] },
  // Queer underground
  { pattern: /\bpxssy\s*palace\b|\bbody\s*movements\b/i, tags: ["queer_underground", "underground_dance"] },
  { pattern: /\bqueer\s*(rave|night|club|party)\b/i, tags: ["queer_underground", "underground_dance"] },
  { pattern: /\blgbtq.?\s*(night|club|dance)\b/i, tags: ["queer_underground"] },
  // Avant-garde / editorial fashion
  { pattern: /\braf\s*simons\b/i, tags: ["avant_garde_fashion", "editorial_fashion"] },
  { pattern: /\bmaison\s*margiela\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\brick\s*owens\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\byohji\s*yamamoto\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bcomme\s*des\s*gar[cç][oô]ns\b|\bcdg\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bann\s*demeulemeester\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\balexander\s*wang\b(?!.*restaurant)/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bdazed\b(?!.*confused\s*records)/i, tags: ["editorial_fashion", "avant_garde_fashion"] },
  { pattern: /\bi.?d\s*mag(?:azine)?\b/i, tags: ["editorial_fashion"] },
  { pattern: /\banother\s*mag(?:azine)?\b/i, tags: ["editorial_fashion", "avant_garde_fashion"] },
  { pattern: /\bv\s*mag(?:azine)?\b/i, tags: ["editorial_fashion"] },
  { pattern: /\bmetal\s*mag(?:azine)?\b/i, tags: ["editorial_fashion", "avant_garde_fashion"] },
  { pattern: /\bself\s*service\b|\bgarage\s*mag\b|\b032c\b/i, tags: ["editorial_fashion"] },
  // Genre keywords (lower confidence)
  { pattern: /\btechno\b/i, tags: ["techno"] },
  { pattern: /\btech.?house\b/i, tags: ["tech_house"] },
  { pattern: /\bdeep.?house\b/i, tags: ["deep_house"] },
  { pattern: /\bprogressive\s*house\b/i, tags: ["progressive_house"] },
  { pattern: /\bdrum.and.bass\b|\bdnb\b/i, tags: ["drum_and_bass"] },
  { pattern: /\btrance\b/i, tags: ["trance"] },
  { pattern: /\bafrobeats?\b|\bafropop\b/i, tags: ["afrobeats"] },
  { pattern: /\buk\s*garage\b|\b2.?step\b|\bgrime\b/i, tags: ["garage_uk"] },
  { pattern: /\bunderground\b/i, tags: ["underground_dance"] },
  // Category fallbacks (lowest confidence)
  { categories: ["DJ"], tags: ["underground_dance"] },
  { categories: ["Club"], tags: ["underground_dance", "house_music"] },
  { categories: ["Festival"], tags: ["festival_circuit"] },
  { categories: ["Record Label"], tags: ["house_music", "underground_dance"] },
  { categories: ["Music Production Studio"], tags: ["underground_dance"] },
  { categories: ["Musician/Band"], tags: ["underground_dance"] },
  { categories: ["Concert Tour"], tags: ["festival_circuit"] },
  { categories: ["Performance & Event Venue"], tags: ["underground_dance"] },
  { categories: ["Radio Station"], tags: ["dance_media"] },
];

// ── Scene entity map ──────────────────────────────────────────────────────────

const SCENE_ENTITY_MAP: Partial<Record<SceneTag, string[]>> = {
  techno: [
    "Adam Beyer", "Richie Hawtin", "Ben Klock", "Charlotte de Witte",
    "Drumcode", "Jeff Mills", "Ellen Allien", "Surgeon",
    "Berghain", "Tresor nightclub", "Awakenings",
  ],
  tech_house: [
    "Camelphat", "Fisher", "Solardo", "Eli Brown",
    "Hot Creations", "Toolroom Records", "Dirtybird Records",
    "Relief Records", "Solid Grooves", "DC-10 Ibiza",
  ],
  deep_house: [
    "Kerri Chandler", "Larry Heard", "Defected Records",
    "Anjunadeep", "Larry Levan", "Glitterbox Recordings",
  ],
  house_music: [
    "Frankie Knuckles", "Marshall Jefferson", "Ten City",
    "Ministry of Sound", "Defected Records",
    "house music", "Chicago house music",
  ],
  progressive_house: [
    "Deadmau5", "Eric Prydz", "Axwell",
    "Swedish House Mafia", "Lane 8", "Anjunadeep",
  ],
  drum_and_bass: [
    "Goldie", "LTJ Bukem", "Andy C", "Roni Size",
    "Hospital Records", "Ram Records", "Metalheadz",
    "Chase and Status", "drum and bass",
  ],
  trance: [
    "Armin van Buuren", "Paul van Dyk", "Tiësto", "Ferry Corsten",
    "A State of Trance", "Anjunabeats", "Above and Beyond",
  ],
  afrobeats: [
    "Wizkid", "Burna Boy", "Davido", "Mr Eazi",
    "Joeboy", "Afrobeats", "Afropop",
  ],
  garage_uk: [
    "Craig David", "So Solid Crew", "Dizzee Rascal", "Kano",
    "UK garage", "grime music", "Skepta",
  ],
  edm_mainstage: [
    "Tomorrowland", "Ultra Music Festival", "Electric Daisy Carnival",
    "David Guetta", "Martin Garrix", "Calvin Harris",
    "electronic dance music",
  ],
  underground_dance: [
    "Boiler Room", "Fabric nightclub", "XOYO", "Resident Advisor",
    "underground dance music", "Mixmag",
  ],
  festival_circuit: [
    "Creamfields", "Awakenings Festival",
    "Amsterdam Dance Event", "Sónar music festival",
    "EXIT Festival", "Hideout Festival", "Gala Festival",
    "Outlook Festival",
  ],
  london_scene: [
    "Fabric nightclub", "XOYO", "Printworks London",
    "E1 London", "Egg London", "Oval Space",
  ],
  berlin_scene: [
    "Berghain", "Tresor nightclub", "Watergate",
    "Sisyphos", "Club der Visionäre", "Panorama Bar",
  ],
  ibiza_scene: [
    "DC-10 Ibiza", "Pacha", "Amnesia Ibiza",
    "Ushuaïa Ibiza", "Space Ibiza", "Ibiza nightlife",
  ],
  amsterdam_scene: [
    "Amsterdam Dance Event", "Melkweg", "Shelter Amsterdam",
    "Paradiso Amsterdam",
  ],
  nyc_scene: [
    "Brooklyn Mirage", "House of Yes", "Nowadays",
    "Output Brooklyn",
  ],
  hard_techno: [
    "Awakenings", "Awakenings Festival", "Rebekah",
    "Blawan", "Paula Temple", "Karenn",
    "Oscar Mulero", "Trym", "hard techno", "industrial techno",
  ],
  hardcore: [
    "Q-Dance", "Defqon.1", "Noisecontrollers",
    "Coone", "Headhunterz", "Hardstyle music",
    "gabber music", "hardcore music",
  ],
  psy_trance: [
    "psytrance", "Goa trance", "Infected Mushroom",
    "Astrix", "Ozora Festival", "Spirit Festival",
    "Shpongle",
  ],
  queer_underground: [
    "queer clubbing", "LGBTQ nightlife",
    "Pxssy Palace", "Body Movements Festival",
    "ballroom culture", "vogue ball", "queer rave",
  ],
  avant_garde_fashion: [
    "Maison Margiela", "Raf Simons", "Comme des Garçons",
    "Rick Owens", "Yohji Yamamoto", "Ann Demeulemeester",
    "Alexander Wang (designer)", "Balenciaga (fashion brand)", "avant-garde fashion",
  ],
  editorial_fashion: [
    "Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine",
    "V Magazine", "METAL Magazine", "System Magazine",
    "Garage Magazine", "032c", "GQ",
  ],
  dance_media: [
    "Mixmag", "Resident Advisor", "DJ Mag",
    "Boiler Room", "Red Bull Music Academy", "FACT Magazine",
  ],
  rave_fashion: [
    "Palace Skateboards", "Carhartt WIP", "Stüssy",
    "Off-White", "Raf Simons", "festival fashion",
  ],
};

// ── Cluster scene filter ──────────────────────────────────────────────────────

const CLUSTER_SCENE_FILTER: Record<string, SceneTag[]> = {
  "Music & Nightlife": [
    "techno", "hard_techno", "hardcore", "psy_trance",
    "tech_house", "deep_house", "house_music", "progressive_house",
    "drum_and_bass", "trance", "afrobeats", "garage_uk", "edm_mainstage",
    "underground_dance", "queer_underground", "festival_circuit",
    "london_scene", "berlin_scene", "ibiza_scene", "amsterdam_scene", "nyc_scene",
  ],
  "Fashion & Streetwear": [
    "avant_garde_fashion", "editorial_fashion",
    "rave_fashion", "queer_underground", "underground_dance",
  ],
  "Lifestyle & Nightlife": [
    "ibiza_scene", "festival_circuit", "underground_dance", "queer_underground",
    "london_scene", "berlin_scene", "amsterdam_scene",
  ],
  "Activities & Culture": [
    "london_scene", "berlin_scene", "amsterdam_scene", "underground_dance",
    "queer_underground", "avant_garde_fashion",
  ],
  "Media & Entertainment": [
    "dance_media", "editorial_fashion", "underground_dance",
    "techno", "hard_techno", "tech_house", "deep_house", "house_music",
    "drum_and_bass", "festival_circuit",
  ],
};

const CLUSTER_PATH_PATTERNS: Record<string, RegExp> = {
  "Music & Nightlife":
    /music|nightlife|club|festival|dj|performer|concert|artist|entertainment/i,
  "Fashion & Streetwear":
    /fashion|clothing|apparel|style|luxury|designer|streetwear|accessories/i,
  "Lifestyle & Nightlife":
    /lifestyle|travel|luxury|hotel|dining|nightlife|social|going\s*out/i,
  "Activities & Culture":
    /art|culture|design|museum|photography|creative|gallery|exhibition/i,
  "Media & Entertainment":
    /media|magazine|publication|news|journalism|entertainment|radio|streaming/i,
};

const CURATED_SEEDS: Record<string, string[]> = {
  "Music & Nightlife": [
    "Boiler Room", "Resident Advisor", "Awakenings Festival",
    "Berghain", "techno music", "underground dance music",
    "electronic dance music", "music festival", "nightclub",
  ],
  "Fashion & Streetwear": [
    "Maison Margiela", "Raf Simons", "Balenciaga (fashion brand)",
    "Comme des Garçons", "Rick Owens", "GQ",
    "Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine",
    "METAL Magazine", "Alexander Wang (designer)", "Ann Demeulemeester",
  ],
  "Lifestyle & Nightlife": [
    "luxury travel", "luxury hotels", "Four Seasons Hotels",
    "fine dining", "premium lifestyle", "nightlife",
  ],
  "Activities & Culture": [
    "contemporary art", "art gallery", "museum",
    "street art", "urban culture", "art exhibition",
  ],
  "Media & Entertainment": [
    "Mixmag", "Resident Advisor", "Boiler Room", "DJ Mag",
    "music journalism", "entertainment news",
  ],
};

const CLUSTER_BLOCKLIST: Record<string, RegExp[]> = {
  "Music & Nightlife": [
    /\b(video.?game|gaming|esport|gamer|fortnite|minecraft|call.of.duty|league.of.legends)\b/i,
    /\b(driving.?game|racing.?game|driving.?sim|car.?game)\b/i,
    /\b(language.?learn|english.?course|ielts|toefl|exam.?prep|duolingo|study.?abroad)\b/i,
    /\b(stock.?market|investing|cryptocurrency|forex|bitcoin|crypto|fintech)\b/i,
    /\b(parenting|mommy|toddler|pregnancy|new.?mum|new.?mom)\b/i,
    /\b(cooking|recipe|food.?blog|baking|culinary)\b/i,
    /\b(coding|programming|software.?engineer|web.?develop)\b/i,
    /\b(performing\s*arts|classical\s*music|opera|ballet|musical\s*theatre|orchestra)\b/i,
    /\b(rock\s*music|punk\s*rock|metal\s*music|indie\s*rock|alternative\s*rock|pop\s*rock)\b/i,
  ],
  "Fashion & Streetwear": [
    /\b(video.?game|gaming|esport|gamer)\b/i,
    /\b(language.?learn|ielts|toefl|exam.?prep)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(cryptocurrency|forex|stock.?market)\b/i,
    /\b(cooking|recipe|culinary|food.?blog)\b/i,
    /\b(pop\s*music|chart\s*music|mainstream|top.?40)\b/i,
    /\b(celebrity|reality\s*tv|soap\s*opera|talent\s*show)\b/i,
    /\b(gym|fitness|bodybuilding|crossfit|workout)\b/i,
    /\b(sports?\s*team|football|basketball|cricket)\b/i,
  ],
  "Lifestyle & Nightlife": [
    /\b(video.?game|gaming|esport|gamer)\b/i,
    /\b(language.?learn|ielts|toefl|exam.?prep)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
  ],
  "Activities & Culture": [
    /\b(video.?game|gaming|esport|gamer)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
  ],
  "Media & Entertainment": [
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(language.?learn|ielts|toefl|exam.?prep)\b/i,
  ],
};

// ── City → scene tag ──────────────────────────────────────────────────────────

const CITY_SCENE_MAP: Record<string, SceneTag> = {
  London: "london_scene", Manchester: "london_scene", Bristol: "london_scene",
  Glasgow: "london_scene", Edinburgh: "london_scene", Leeds: "london_scene",
  Liverpool: "london_scene", Berlin: "berlin_scene", Hamburg: "berlin_scene",
  Ibiza: "ibiza_scene", Amsterdam: "amsterdam_scene",
  "New York": "nyc_scene", Chicago: "nyc_scene", Detroit: "nyc_scene", Miami: "nyc_scene",
};

const KNOWN_CITIES = Object.keys(CITY_SCENE_MAP);

function findCity(name: string): string | null {
  for (const city of KNOWN_CITIES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(name)) return city;
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageContextItem {
  name: string;
  category?: string;
  instagramUsername?: string;
}

export interface CustomAudienceSignal {
  /** Group or audience name — used as a classifier signal */
  name: string;
}

export interface GenreDistribution {
  /** Beatport-style genre bucket id → number of pages in this bucket */
  [bucket: string]: number;
}

export interface AudienceFingerprint {
  sources: {
    pages: number;
    customAudiences: number;
    engagementTypes: number;
    genreGroups: number;
    hints: number;
  };
  /** Scene tags sorted by total weighted score, descending */
  dominantScenes: Array<{ tag: string; weight: number }>;
  /** 0–100 */
  confidence: number;
  specificity: "broad" | "moderate" | "high" | "very_high";
}

interface RawInterest {
  id: string;
  name: string;
  audience_size?: number;
  path?: string[];
}

interface ClusteredInterest {
  id: string;
  name: string;
  audienceSize?: number;
  path?: string[];
  searchTerm: string;
  relevanceScore?: number;
}

export interface DiscoverCluster {
  label: string;
  description: string;
  interests: ClusteredInterest[];
}

export interface DiscoverResponse {
  clusters: DiscoverCluster[];
  clusterSeeds: Record<string, string[]>;
  searchTermsUsed: string[];
  detectedSceneTags: string[];
  audienceFingerprint: AudienceFingerprint;
  totalFound: number;
}

// ── Weighted scene tag builder ────────────────────────────────────────────────
/**
 * Accumulates scene tags from ALL signal sources with per-source weights.
 * Returns a Map<SceneTag, totalWeight> and a dev log.
 */
function buildWeightedSceneTags(
  pages: PageContextItem[],
  customAudienceSignals: CustomAudienceSignal[],
  engagementTypesPresent: string[],
  genreDistribution: GenreDistribution,
  rawHints: string[],
): { tagWeights: Map<SceneTag, number>; logs: string[] } {
  const tagWeights = new Map<SceneTag, number>();
  const logs: string[] = [];

  function addWeight(tag: SceneTag, weight: number, source: string) {
    tagWeights.set(tag, (tagWeights.get(tag) ?? 0) + weight);
    logs.push(`  +${weight.toFixed(1)} [${tag}] ← ${source}`);
  }

  // 1. Pages
  for (const page of pages) {
    for (const rule of ENTITY_CLASSIFIERS) {
      const nameMatch =
        !rule.pattern ||
        rule.pattern.test(page.name) ||
        rule.pattern.test(page.instagramUsername ?? "");
      const catMatch = !rule.categories || rule.categories.includes(page.category ?? "");
      const matched = rule.pattern
        ? nameMatch && (rule.categories ? catMatch : true)
        : catMatch;
      if (matched) {
        const w = rule.categories && !rule.pattern ? W_PAGE_CATEGORY : W_PAGE_NAMED;
        for (const tag of rule.tags) addWeight(tag, w, `page:${page.name}`);
      }
    }
    const city = findCity(page.name);
    if (city && CITY_SCENE_MAP[city]) {
      addWeight(CITY_SCENE_MAP[city], W_PAGE_CATEGORY, `city:${city}`);
    }
  }

  // 2. Custom audience signals — run classifier against group/audience names
  for (const ca of customAudienceSignals) {
    for (const rule of ENTITY_CLASSIFIERS) {
      if (!rule.pattern) continue;
      if (rule.pattern.test(ca.name)) {
        for (const tag of rule.tags) addWeight(tag, W_ENGAGEMENT_CA, `ca:${ca.name}`);
      }
    }
  }

  // 3. Engagement types present — each engagement type boosts the EXISTING dominant tags
  // (They confirm the pages' signals rather than adding new signals)
  if (engagementTypesPresent.length > 0) {
    const boostMultiplier = Math.min(engagementTypesPresent.length, 4) * 0.5;
    for (const [tag, existingWeight] of tagWeights.entries()) {
      if (existingWeight > 0) {
        addWeight(tag, existingWeight * boostMultiplier, `engagement-ca-boost(${engagementTypesPresent.join(",")})`);
      }
    }
  }

  // 4. Genre distribution
  for (const [bucket, pageCount] of Object.entries(genreDistribution)) {
    const tags = GENRE_BUCKET_SCENE_TAGS[bucket] ?? [];
    const weight = W_GENRE_BUCKET * Math.log2(pageCount + 1 + 1); // log scale per page
    for (const tag of tags) {
      addWeight(tag as SceneTag, weight, `genre-bucket:${bucket}(${pageCount}p)`);
    }
  }

  // 5. Manual hints — two passes:
  //   a) If the hint maps to a known scene tag, add it as a weighted tag
  //   b) Always collect the raw hint text for direct Meta search (regardless of tag match)
  for (const hint of rawHints) {
    const normalized = hint.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (ALL_SCENE_TAGS.has(normalized as SceneTag)) {
      addWeight(normalized as SceneTag, W_HINT, "manual-hint");
      logs.push(`  scene-hint matched tag: ${normalized}`);
    } else {
      logs.push(`  scene-hint NOT a scene tag (will search directly): "${hint.trim()}"`);
    }
  }

  return { tagWeights, logs };
}

/** Collect raw hint strings that should be searched directly against Meta's API */
function extractDirectHintTerms(rawHints: string[]): string[] {
  return rawHints
    .map((h) => h.trim())
    .filter((h) => h.length >= 2);
}

// ── Confidence calculator ─────────────────────────────────────────────────────

function computeFingerprint(
  tagWeights: Map<SceneTag, number>,
  sources: AudienceFingerprint["sources"],
): Omit<AudienceFingerprint, "sources"> {
  // Base score from source diversity and counts
  const sourceScore =
    Math.min(sources.pages * 4, 24) +
    sources.customAudiences * 8 +
    sources.engagementTypes * 15 +   // highest value signal
    sources.genreGroups * 6 +
    sources.hints * 10;

  // Niche specificity bonus
  let nicheBonus = 0;
  for (const niche of NICHE_SCENE_TAGS) {
    if ((tagWeights.get(niche) ?? 0) > 0) nicheBonus += 8;
  }
  nicheBonus = Math.min(nicheBonus, 24);

  // Signal depth bonus: having many high-weight tags = confident
  const totalTagWeight = [...tagWeights.values()].reduce((s, v) => s + v, 0);
  const depthBonus = Math.min(Math.log2(totalTagWeight + 1) * 3, 15);

  const confidence = Math.min(Math.round(sourceScore + nicheBonus + depthBonus), 100);

  const specificity: AudienceFingerprint["specificity"] =
    confidence >= 75 ? "very_high" :
    confidence >= 50 ? "high" :
    confidence >= 25 ? "moderate" : "broad";

  const dominantScenes = [...tagWeights.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([tag, weight]) => ({ tag, weight: Math.round(weight) }));

  return { confidence, specificity, dominantScenes };
}

// ── Cluster term builder ──────────────────────────────────────────────────────
/**
 * Build search terms for a cluster, sorted by tag weight (highest-weight
 * scenes come first so we burn most of the search budget on the best signals).
 * At higher confidence, curated seeds are trimmed or skipped.
 */
function buildClusterTerms(
  tagWeights: Map<SceneTag, number>,
  clusterLabel: string,
  confidence: number,
): string[] {
  const allowed = new Set(CLUSTER_SCENE_FILTER[clusterLabel] ?? []);
  const terms = new Map<string, number>(); // term → best tag weight (for ordering)

  for (const [tag, weight] of tagWeights.entries()) {
    if (!allowed.has(tag)) continue;
    for (const entity of SCENE_ENTITY_MAP[tag] ?? []) {
      const existing = terms.get(entity) ?? 0;
      terms.set(entity, Math.max(existing, weight));
    }
  }

  // Sort by weight descending
  const sorted = [...terms.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([term]) => term);

  // Curated seeds: at very high confidence, skip generic seeds entirely
  const seeds = CURATED_SEEDS[clusterLabel] ?? [];
  if (confidence < 50) {
    // Low confidence → use all curated seeds
    for (const s of seeds) if (!terms.has(s)) sorted.push(s);
  } else if (confidence < 75) {
    // Moderate → use half the curated seeds (first 4)
    for (const s of seeds.slice(0, 4)) if (!terms.has(s)) sorted.push(s);
  }
  // High/very_high → no curated seeds; rely entirely on entity signals

  const maxTerms = confidence >= 75 ? 12 : confidence >= 50 ? 18 : 24;
  return sorted.slice(0, maxTerms);
}

// ── Meta search ───────────────────────────────────────────────────────────────

async function searchMeta(token: string, query: string): Promise<RawInterest[]> {
  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adinterest");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  try {
    const res = await fetch(url.toString(), { cache: "no-store" });
    const json = (await res.json()) as { data?: RawInterest[]; error?: unknown };
    if (!res.ok || json.error) return [];
    return json.data ?? [];
  } catch {
    return [];
  }
}

// ── Blocklist filter ──────────────────────────────────────────────────────────

function passesBlocklist(
  interest: { name: string; path?: string[] },
  clusterLabel: string,
): boolean {
  const patterns = CLUSTER_BLOCKLIST[clusterLabel] ?? [];
  if (patterns.length === 0) return true;
  const text = [interest.name, ...(interest.path ?? [])].join(" ");
  return !patterns.some((p) => p.test(text));
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

function buildSceneKeywords(tagWeights: Map<SceneTag, number>): Map<string, number> {
  const kws = new Map<string, number>();
  for (const [tag, weight] of tagWeights.entries()) {
    for (const entity of SCENE_ENTITY_MAP[tag] ?? []) {
      for (const word of entity.split(/\s+/)) {
        if (word.length >= 4) {
          const kw = word.toLowerCase();
          kws.set(kw, Math.max(kws.get(kw) ?? 0, weight));
        }
      }
    }
  }
  return kws;
}

function scoreInterest(
  interest: RawInterest,
  clusterLabel: string,
  sceneKeywords: Map<string, number>,
  confidence: number,
): number {
  let score = 0;

  // Path relevance (most important signal)
  const pathPattern = CLUSTER_PATH_PATTERNS[clusterLabel];
  if (pathPattern) {
    const text = [interest.name, ...(interest.path ?? [])].join(" ");
    if (pathPattern.test(text)) score += 30;
  }

  // Scene entity name alignment — weight proportional to tag weight
  const nameLower = interest.name.toLowerCase();
  let bestKwWeight = 0;
  for (const [kw, kw_weight] of sceneKeywords.entries()) {
    if (nameLower.includes(kw) && kw_weight > bestKwWeight) {
      bestKwWeight = kw_weight;
    }
  }
  if (bestKwWeight > 0) {
    score += Math.min((bestKwWeight / 120) * 20, 20);
  }

  // Audience-size-aware scoring: prefer niche/specific interests.
  // Smaller audiences = more targeted = higher value.
  const size = interest.audience_size ?? 0;
  if (size > 0) {
    if      (size < 500_000)      score += 10;  // very niche — highly specific
    else if (size < 2_000_000)    score += 8;   // niche
    else if (size < 10_000_000)   score += 5;   // targeted
    else if (size < 50_000_000)   score += 2;   // medium
    else if (size < 200_000_000)  score += 0;   // large — neutral
    else                          score -= 8;   // mega-broad — penalise
  }

  // Extra penalty at high confidence for generic mega-interests
  if (confidence >= 50 && size > 100_000_000) score -= 5;

  return score;
}

// ── Cluster descriptions ──────────────────────────────────────────────────────

const CLUSTER_DESCRIPTIONS: Record<string, string> = {
  "Music & Nightlife":
    "music genres, artists, DJs, labels, clubs, festivals, venues, nightlife communities",
  "Fashion & Streetwear":
    "luxury brands, streetwear labels, style publications, youth culture aesthetics",
  "Lifestyle & Nightlife":
    "nightlife behaviour, premium lifestyle, bars, city social culture, luxury signals",
  "Activities & Culture":
    "arts, design, creative culture, exhibitions, city experiences",
  "Media & Entertainment":
    "music publications, media brands, creators, streaming platforms",
};

const ALL_CLUSTER_LABELS = Object.keys(CLUSTER_DESCRIPTIONS);

// ── Core discovery function ───────────────────────────────────────────────────

async function discoverForCluster(
  clusterLabel: string,
  tagWeights: Map<SceneTag, number>,
  confidence: number,
  token: string,
  globalSeen: Set<string>,
  directHintTerms: string[] = [],
): Promise<{ cluster: DiscoverCluster; termsUsed: string[] }> {
  const entityTerms = buildClusterTerms(tagWeights, clusterLabel, confidence);

  // Scene hints always go first (they are the user's explicit signal) — deduplicated
  const entitySet = new Set(entityTerms.map((t) => t.toLowerCase()));
  const extraHints = directHintTerms.filter((h) => !entitySet.has(h.toLowerCase()));
  const allTerms = [...extraHints, ...entityTerms];

  const sceneKeywords = buildSceneKeywords(tagWeights);

  // Minimum score floor (only applied at high confidence)
  const minScore = confidence >= 75 ? 15 : confidence >= 50 ? 5 : 0;

  console.info(
    `[interest-discover] cluster="${clusterLabel}" confidence=${confidence}` +
    ` hints(${extraHints.length}): ${extraHints.slice(0, 4).join(", ")}` +
    ` | entity-terms(${entityTerms.length}): ${entityTerms.slice(0, 5).join(", ")}${entityTerms.length > 5 ? "…" : ""}`,
  );

  // ── Phase 1: search all terms ──────────────────────────────────────────────
  const raw: (RawInterest & { searchTerm: string })[] = [];
  const BATCH = 4;
  // Use a per-cluster seen set so hint terms can surface interests that were
  // deduped by globalSeen in another cluster. Hints are high-priority.
  const localSeen = new Set<string>();

  async function runTermsBatch(terms: string[]) {
    for (let i = 0; i < terms.length; i += BATCH) {
      const batch = terms.slice(i, i + BATCH);
      const results = await Promise.all(batch.map((t) => searchMeta(token, t)));
      for (let j = 0; j < batch.length; j++) {
        for (const item of results[j]) {
          if (!localSeen.has(item.id)) {
            localSeen.add(item.id);
            if (!globalSeen.has(item.id)) globalSeen.add(item.id);
            raw.push({ ...item, searchTerm: batch[j] });
          }
        }
      }
      console.info(
        `[interest-discover] cluster="${clusterLabel}" searched batch [${batch.join(", ")}] → ` +
        results.map((r, ri) => `"${batch[ri]}":${r.length}`).join(", "),
      );
    }
  }

  await runTermsBatch(allTerms);

  // ── Phase 2: filter & score ────────────────────────────────────────────────
  const blocklisted = raw.filter((i) => !passesBlocklist(i, clusterLabel));
  if (blocklisted.length > 0) {
    console.info(
      `[interest-discover] cluster="${clusterLabel}" blocklist removed ${blocklisted.length}: ` +
      blocklisted.map((i) => i.name).join(", "),
    );
  }
  const filtered = raw.filter((i) => passesBlocklist(i, clusterLabel));

  const scored = filtered.map((i) => ({
    id: i.id,
    name: i.name,
    audienceSize: i.audience_size,
    path: i.path,
    searchTerm: i.searchTerm,
    relevanceScore: scoreInterest(i, clusterLabel, sceneKeywords, confidence),
  }));

  // Log all scored results for debugging
  console.info(
    `[interest-discover] cluster="${clusterLabel}" scored(${scored.length}): ` +
    scored
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 10)
      .map((i) => `${i.name}[score=${i.relevanceScore?.toFixed(0)},size=${i.audienceSize?.toLocaleString() ?? "?"}]`)
      .join(", "),
  );

  let aboveFloor = scored.filter((i) => (i.relevanceScore ?? 0) >= minScore);

  // ── Phase 3: progressive fallback if too few results ──────────────────────
  if (aboveFloor.length < 2 && minScore > 0) {
    console.info(
      `[interest-discover] cluster="${clusterLabel}" score-floor(${minScore}) left ${aboveFloor.length} results; lowering to 0`,
    );
    aboveFloor = scored; // accept all scored results
  }

  // If still empty, try curated seeds as a last resort (even at high confidence)
  if (aboveFloor.length < 2) {
    const seeds = (CURATED_SEEDS[clusterLabel] ?? []).filter(
      (s) => !localSeen.has(s) && !allTerms.some((t) => t.toLowerCase() === s.toLowerCase()),
    );
    if (seeds.length > 0) {
      console.info(
        `[interest-discover] cluster="${clusterLabel}" fallback — searching curated seeds: ${seeds.slice(0, 6).join(", ")}`,
      );
      await runTermsBatch(seeds.slice(0, 8));
      // Re-score everything
      const fallbackFiltered = raw.filter((i) => passesBlocklist(i, clusterLabel));
      const fallbackScored = fallbackFiltered.map((i) => ({
        id: i.id, name: i.name,
        audienceSize: i.audience_size,
        path: i.path,
        searchTerm: i.searchTerm,
        relevanceScore: scoreInterest(i, clusterLabel, sceneKeywords, confidence),
      }));
      aboveFloor = fallbackScored; // use all results with no floor
    }
  }

  const maxResults = confidence >= 75 ? 6 : 8;
  const interests = aboveFloor
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, maxResults);

  console.info(
    `[interest-discover] cluster="${clusterLabel}" FINAL(${interests.length}): ` +
    interests.map((i) => `${i.name}[${i.relevanceScore?.toFixed(1)}, ${((i.audienceSize ?? 0) / 1e6).toFixed(1)}M]`).join(" | "),
  );

  return {
    cluster: {
      label: clusterLabel,
      description: CLUSTER_DESCRIPTIONS[clusterLabel] ?? clusterLabel,
      interests,
    },
    termsUsed: allTerms,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_ACCESS_TOKEN is not configured on the server" },
      { status: 500 },
    );
  }

  let body: {
    pageContext?: unknown;
    customAudienceSignals?: unknown;
    engagementTypesPresent?: unknown;
    genreDistribution?: unknown;
    campaignName?: unknown;
    clusterLabel?: unknown;
    sceneHints?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pages = (Array.isArray(body.pageContext) ? body.pageContext : []) as PageContextItem[];
  const customAudienceSignals = (
    Array.isArray(body.customAudienceSignals) ? body.customAudienceSignals : []
  ) as CustomAudienceSignal[];
  const engagementTypesPresent = (
    Array.isArray(body.engagementTypesPresent) ? body.engagementTypesPresent : []
  ).filter((v): v is string => typeof v === "string");
  const genreDistribution = (
    typeof body.genreDistribution === "object" && body.genreDistribution !== null
      ? body.genreDistribution
      : {}
  ) as GenreDistribution;
  const clusterLabel =
    typeof body.clusterLabel === "string" ? body.clusterLabel.trim() : undefined;
  const rawHints: string[] = Array.isArray(body.sceneHints)
    ? (body.sceneHints as unknown[]).filter((h): h is string => typeof h === "string")
    : [];

  if (pages.length === 0 && !body.campaignName && Object.keys(genreDistribution).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one page, a campaign name, or genre data" },
      { status: 400 },
    );
  }

  if (clusterLabel && !CLUSTER_DESCRIPTIONS[clusterLabel]) {
    return NextResponse.json(
      { error: `Unknown cluster label "${clusterLabel}". Valid: ${ALL_CLUSTER_LABELS.join(", ")}` },
      { status: 400 },
    );
  }

  // Build weighted scene tag map from all sources
  const { tagWeights, logs: weightLogs } = buildWeightedSceneTags(
    pages,
    customAudienceSignals,
    engagementTypesPresent,
    genreDistribution,
    rawHints,
  );

  const genreGroupCount = Object.keys(genreDistribution).length;
  const sources: AudienceFingerprint["sources"] = {
    pages: pages.length,
    customAudiences: customAudienceSignals.length,
    engagementTypes: engagementTypesPresent.length,
    genreGroups: genreGroupCount,
    hints: rawHints.length,
  };

  const { confidence, specificity, dominantScenes } = computeFingerprint(tagWeights, sources);

  const audienceFingerprint: AudienceFingerprint = { sources, dominantScenes, confidence, specificity };

  console.info(
    `[interest-discover] fingerprint: ${pages.length}p / ${customAudienceSignals.length}ca / ` +
    `${engagementTypesPresent.length}etypes / ${genreGroupCount}genres / ${rawHints.length}hints → ` +
    `confidence=${confidence} (${specificity})`,
  );
  console.info(
    `[interest-discover] dominant scenes: ` +
    dominantScenes.slice(0, 5).map((s) => `${s.tag}=${s.weight}`).join(", "),
  );

  if (process.env.NODE_ENV === "development" && weightLogs.length > 0) {
    console.debug(`[interest-discover] weighted signal log (${weightLogs.length} entries):\n` + weightLogs.slice(0, 40).join("\n"));
  }

  // Collect raw hints as direct search terms (independent of scene-tag mapping)
  const directHintTerms = extractDirectHintTerms(rawHints);
  if (directHintTerms.length > 0) {
    console.info(`[interest-discover] direct-hint search terms: ${directHintTerms.join(", ")}`);
  }

  const targetLabels = clusterLabel ? [clusterLabel] : ALL_CLUSTER_LABELS;
  const globalSeen = new Set<string>();
  const clusterSeeds: Record<string, string[]> = {};
  const clusters: DiscoverCluster[] = [];

  for (const label of targetLabels) {
    const { cluster, termsUsed } = await discoverForCluster(
      label,
      tagWeights,
      confidence,
      token,
      globalSeen,
      directHintTerms,
    );
    clusterSeeds[label] = termsUsed;
    if (cluster.interests.length > 0) clusters.push(cluster);
  }

  const searchTermsUsed = [...new Set(Object.values(clusterSeeds).flat())];
  const detectedSceneTags = [...tagWeights.keys()].filter((t) => (tagWeights.get(t) ?? 0) > 0);

  console.info(
    `[interest-discover] done — ${globalSeen.size} unique interests, ` +
    clusters.map((c) => `${c.label}:${c.interests.length}`).join(", "),
  );

  return NextResponse.json({
    clusters,
    clusterSeeds,
    searchTermsUsed,
    detectedSceneTags,
    audienceFingerprint,
    totalFound: globalSeen.size,
  } satisfies DiscoverResponse);
}
