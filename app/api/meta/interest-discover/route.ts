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

// ── Cluster-specific entity banks ─────────────────────────────────────────────

const MUSIC_ENTITIES: Partial<Record<SceneTag, string[]>> = {
  techno: [
    "techno music", "electronic dance music", "Adam Beyer", "Richie Hawtin",
    "Ben Klock", "Charlotte de Witte", "Drumcode", "Jeff Mills", "Ellen Allien",
    "Surgeon", "Berghain", "Tresor nightclub", "Awakenings", "Resident Advisor",
    "Boiler Room", "Mixmag", "DJ Mag", "Carl Cox", "Nina Kraviz",
    "Amelie Lens", "Maceo Plex", "Sven Väth",
  ],
  hard_techno: [
    "hard techno", "industrial techno", "techno music", "rave",
    "Awakenings", "Awakenings Festival", "Rebekah", "Blawan", "Paula Temple",
    "Karenn", "Oscar Mulero", "Trym", "I Hate Models", "SPFDJ",
    "Charlotte de Witte", "Amelie Lens", "Sara Landry", "Kobosil",
    "Verknipt", "Junction 2", "Intercell", "Possession",
    "Resident Advisor", "Boiler Room", "Mixmag",
  ],
  tech_house: [
    "tech house", "Camelphat", "Fisher", "Solardo", "Eli Brown",
    "Hot Creations", "Toolroom Records", "Dirtybird Records",
    "Patrick Topping", "Michael Bibi", "Dom Dolla", "Chris Lake",
    "Solid Grooves", "DC-10 Ibiza", "Elrow", "Defected Records",
  ],
  deep_house: [
    "deep house", "soulful house", "Kerri Chandler", "Larry Heard",
    "Defected Records", "Anjunadeep", "Glitterbox Recordings",
    "Moodymann", "Theo Parrish", "Ron Trent",
  ],
  house_music: [
    "house music", "Chicago house music", "Frankie Knuckles",
    "Marshall Jefferson", "Ten City", "Ministry of Sound",
    "Defected Records", "Glitterbox",
  ],
  progressive_house: [
    "progressive house", "Deadmau5", "Eric Prydz", "Axwell",
    "Swedish House Mafia", "Lane 8", "Anjunadeep", "Anjunabeats",
    "Ben Böhmer", "Nora En Pure", "Above and Beyond",
  ],
  drum_and_bass: [
    "drum and bass", "jungle music", "Goldie", "LTJ Bukem", "Andy C",
    "Chase and Status", "Hospital Records", "Ram Records", "Metalheadz",
    "Sub Focus", "Pendulum", "Shy FX", "Dimension", "Netsky",
    "Camo & Krooked", "UKF (music)", "Let It Roll",
  ],
  trance: [
    "trance music", "Armin van Buuren", "Paul van Dyk", "Tiësto",
    "Ferry Corsten", "A State of Trance", "Anjunabeats",
    "Above and Beyond", "Gareth Emery",
  ],
  afrobeats: [
    "Afrobeats", "Afropop", "Wizkid", "Burna Boy", "Davido",
    "Black Coffee", "Amapiano", "Kabza De Small",
  ],
  garage_uk: [
    "UK garage", "grime music", "Skepta", "Craig David",
    "Stormzy", "Dizzee Rascal", "Rinse FM",
  ],
  edm_mainstage: [
    "electronic dance music", "Tomorrowland", "Ultra Music Festival",
    "Electric Daisy Carnival", "David Guetta", "Martin Garrix", "Calvin Harris",
  ],
  underground_dance: [
    "underground dance music", "electronic music", "rave",
    "Boiler Room", "Fabric nightclub", "XOYO", "Resident Advisor",
    "Mixmag", "DJ Mag", "warehouse rave",
  ],
  festival_circuit: [
    "music festival", "Creamfields", "Awakenings Festival",
    "Amsterdam Dance Event", "Sónar music festival", "Glastonbury Festival",
    "EXIT Festival", "Outlook Festival", "Dekmantel",
  ],
  london_scene: [
    "Fabric nightclub", "XOYO", "Printworks London",
    "E1 London", "Egg London", "Oval Space", "Ministry of Sound",
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
    "Amsterdam Dance Event", "Melkweg", "Shelter Amsterdam", "Paradiso Amsterdam",
  ],
  nyc_scene: [
    "Brooklyn Mirage", "House of Yes", "Nowadays", "Output Brooklyn",
  ],
  dance_media: [
    "Mixmag", "Resident Advisor", "DJ Mag", "Boiler Room",
    "Red Bull Music Academy", "FACT Magazine",
  ],
  hardcore: [
    "Q-Dance", "Defqon.1", "Hardstyle music", "gabber music",
    "Headhunterz", "hardcore music",
  ],
  psy_trance: [
    "psytrance", "Goa trance", "Infected Mushroom", "Astrix",
    "Ozora Festival", "Shpongle",
  ],
  queer_underground: [
    "LGBTQ nightlife", "queer clubbing", "ballroom culture",
    "vogue ball", "queer rave",
  ],
};

const FASHION_ENTITIES: Partial<Record<SceneTag, string[]>> = {
  hard_techno: [
    "Rick Owens", "Maison Margiela", "Raf Simons", "032c",
    "Comme des Garçons", "Carhartt WIP", "MISBHV", "Heliot Emil",
    "Yohji Yamamoto", "Ann Demeulemeester", "Balenciaga (fashion brand)",
    "Dazed & Confused (magazine)", "i-D (magazine)",
  ],
  techno: [
    "Rick Owens", "Maison Margiela", "Raf Simons", "032c",
    "Carhartt WIP", "Comme des Garçons", "Helmut Lang",
    "Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine",
  ],
  underground_dance: [
    "Rick Owens", "Maison Margiela", "Raf Simons",
    "Palace Skateboards", "Stüssy", "Carhartt WIP", "032c",
    "Dazed & Confused (magazine)", "i-D (magazine)", "METAL Magazine",
    "Another Magazine", "GQ",
  ],
  tech_house: [
    "Zara (clothing)", "ASOS (retailer)", "Nike", "Adidas",
    "Ray-Ban", "Hugo Boss (fashion brand)",
  ],
  deep_house: [
    "Stüssy", "Carhartt WIP", "Nike", "Adidas",
    "GQ", "Esquire (magazine)",
  ],
  house_music: [
    "Nike", "Adidas", "GQ", "Stüssy",
  ],
  festival_circuit: [
    "ASOS (retailer)", "Dr. Martens", "Vans (brand)",
    "Ray-Ban", "Levi Strauss & Co.",
  ],
  drum_and_bass: [
    "Nike Sportswear", "The North Face (clothing)", "Supreme (brand)",
    "Stone Island", "Palace Skateboards",
  ],
  garage_uk: [
    "Nike Sportswear", "Stone Island", "CP Company",
    "Moschino", "Versace",
  ],
  afrobeats: [
    "Nike", "Puma (brand)", "Off-White", "Gucci",
  ],
  trance: [
    "ASOS (retailer)", "Nike", "Adidas",
  ],
  avant_garde_fashion: [
    "Maison Margiela", "Rick Owens", "Comme des Garçons",
    "Yohji Yamamoto", "Ann Demeulemeester", "Issey Miyake",
    "Jil Sander", "Helmut Lang", "Balenciaga (fashion brand)",
    "Alexander Wang (designer)", "Damir Doma",
    "Dries Van Noten", "Haider Ackermann",
  ],
  editorial_fashion: [
    "Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine",
    "V Magazine", "METAL Magazine", "032c", "GQ", "Vogue",
    "W Magazine", "Self Service (magazine)", "System Magazine",
    "Garage Magazine", "Purple (magazine)",
  ],
  rave_fashion: [
    "Palace Skateboards", "Carhartt WIP", "Stüssy",
    "Off-White", "Supreme (brand)", "032c",
  ],
  queer_underground: [
    "Vivienne Westwood", "Jean Paul Gaultier", "Rick Owens",
    "Dazed & Confused (magazine)", "i-D (magazine)",
  ],
  edm_mainstage: [
    "ASOS (retailer)", "PrettyLittleThing", "Boohoo",
  ],
};

const LIFESTYLE_ENTITIES: Partial<Record<SceneTag, string[]>> = {
  hard_techno: [
    "weight training", "CrossFit", "boxing", "mixed martial arts",
    "running", "gym", "bodybuilding", "calisthenics",
    "craft beer", "natural wine", "vinyl records",
  ],
  techno: [
    "vinyl records", "craft beer", "natural wine",
    "specialty coffee", "tattoo", "cycling",
    "Berlin (travel)", "city break",
  ],
  underground_dance: [
    "vinyl records", "craft beer", "natural wine",
    "specialty coffee", "tattoo", "record collecting",
    "cycling", "vegetarianism", "thrift shopping",
  ],
  tech_house: [
    "Ibiza (island)", "cocktails", "beach club",
    "yacht", "luxury travel", "Marbella",
  ],
  deep_house: [
    "jazz", "cocktails", "vinyl records",
    "soul music", "wine", "cooking",
  ],
  house_music: [
    "cocktails", "city break", "cooking",
    "wine", "brunch",
  ],
  progressive_house: [
    "outdoor adventure", "camping", "surfing",
    "road trip", "hiking", "snowboarding",
  ],
  festival_circuit: [
    "camping", "backpacking", "travel",
    "road trip", "glamping", "outdoor adventure",
  ],
  drum_and_bass: [
    "skateboarding", "graffiti", "BMX",
    "football", "sneakers", "gaming",
  ],
  garage_uk: [
    "football", "basketball", "sneakers",
    "barber shop", "streetwear",
  ],
  afrobeats: [
    "African cuisine", "travel to Africa",
    "entrepreneurship", "fashion",
  ],
  trance: [
    "yoga", "meditation", "hiking",
    "outdoor activities", "spirituality",
  ],
  psy_trance: [
    "yoga", "meditation", "spirituality",
    "vegetarianism", "outdoor festival",
  ],
  edm_mainstage: [
    "music festival", "social media",
    "fitness", "travel",
  ],
  queer_underground: [
    "LGBTQ culture", "drag", "Pride",
    "queer art", "ballroom culture",
  ],
  london_scene: [
    "London restaurants", "East London",
    "Shoreditch", "Peckham",
  ],
  berlin_scene: [
    "Berlin travel", "Kreuzberg",
    "vegan food", "cycling",
  ],
  ibiza_scene: [
    "Ibiza travel", "Balearic Islands",
    "beach lifestyle", "yoga",
  ],
  amsterdam_scene: [
    "Amsterdam travel", "cycling", "Dutch culture",
  ],
  avant_garde_fashion: [
    "art gallery", "boutique hotel",
    "design museum", "architecture",
  ],
  editorial_fashion: [
    "fashion photography", "creative industry",
    "design", "photography",
  ],
  hardcore: [
    "martial arts", "CrossFit", "extreme sports",
    "weight training", "powerlifting",
  ],
};

const MEDIA_ENTITIES: Partial<Record<SceneTag, string[]>> = {
  techno: ["Resident Advisor", "Boiler Room", "Drumcode Radio", "ARTE Concert"],
  hard_techno: ["Mixmag", "Boiler Room", "HATE podcast", "Resident Advisor"],
  tech_house: ["Toolroom Radio", "Defected Radio", "Ministry of Sound"],
  deep_house: ["Defected Records", "Glitterbox Radio", "Anjunadeep"],
  underground_dance: ["Resident Advisor", "Mixmag", "FACT Magazine", "Crack Magazine", "Electronic Beats"],
  dance_media: ["Mixmag", "Resident Advisor", "DJ Mag", "Boiler Room", "Red Bull Music Academy", "FACT Magazine", "Crack Magazine"],
  editorial_fashion: ["Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine", "Business of Fashion", "Vogue"],
  drum_and_bass: ["UKF (music)", "Hospital Records", "DJ Mag"],
  trance: ["A State of Trance", "Group Therapy Radio", "Anjunabeats"],
  afrobeats: ["COLORS Studios", "Link Up TV", "GRM Daily"],
  garage_uk: ["Rinse FM", "NTS Radio", "GRM Daily"],
  festival_circuit: ["Mixmag", "DJ Mag", "Festicket", "Resident Advisor"],
  queer_underground: ["LGBTQ media", "queer publications", "Dazed & Confused (magazine)"],
  avant_garde_fashion: ["Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine", "System Magazine"],
  house_music: ["Defected Radio", "Ministry of Sound"],
  edm_mainstage: ["Ultra Music Festival", "Tomorrowland", "EDM.com"],
  progressive_house: ["Anjunabeats", "Anjunadeep", "Group Therapy Radio"],
};

const CULTURE_ENTITIES: Partial<Record<SceneTag, string[]>> = {
  underground_dance: ["street art", "contemporary art", "warehouse culture", "installation art", "sound art"],
  berlin_scene: ["Berlin art", "Kreuzberg art", "contemporary art Berlin", "Berghain architecture"],
  london_scene: ["Tate Modern", "Barbican Centre", "Design Museum London", "South Bank"],
  amsterdam_scene: ["Stedelijk Museum", "Amsterdam art", "Dutch design"],
  avant_garde_fashion: ["fashion exhibitions", "MET Gala", "design museums", "art exhibitions"],
  queer_underground: ["queer art", "LGBTQ culture", "ballroom culture", "performance art", "drag art"],
  editorial_fashion: ["photography exhibitions", "fashion photography", "art photography"],
  festival_circuit: ["art installations", "Burning Man art", "immersive experience", "light festivals"],
  techno: ["sound design", "electronic art", "new media art"],
  hard_techno: ["industrial art", "warehouse architecture", "brutalist design"],
  deep_house: ["jazz culture", "vinyl culture", "soul music history"],
  house_music: ["dance culture history", "Chicago culture", "Detroit culture"],
  drum_and_bass: ["graffiti art", "street culture", "urban art"],
};

function getClusterEntities(clusterLabel: string): Partial<Record<SceneTag, string[]>> {
  switch (clusterLabel) {
    case "Music & Nightlife": return MUSIC_ENTITIES;
    case "Fashion & Streetwear": return FASHION_ENTITIES;
    case "Lifestyle & Nightlife": return LIFESTYLE_ENTITIES;
    case "Media & Entertainment": return MEDIA_ENTITIES;
    case "Activities & Culture": return CULTURE_ENTITIES;
    default: return MUSIC_ENTITIES;
  }
}

// ── Cluster scene filter ──────────────────────────────────────────────────────

const CLUSTER_SCENE_FILTER: Record<string, SceneTag[]> = {
  "Music & Nightlife": [
    "techno", "hard_techno", "hardcore", "psy_trance",
    "tech_house", "deep_house", "house_music", "progressive_house",
    "drum_and_bass", "trance", "afrobeats", "garage_uk", "edm_mainstage",
    "underground_dance", "queer_underground", "festival_circuit",
    "london_scene", "berlin_scene", "ibiza_scene", "amsterdam_scene", "nyc_scene",
    "dance_media",
  ],
  "Fashion & Streetwear": [
    "techno", "hard_techno", "hardcore", "psy_trance",
    "tech_house", "deep_house", "house_music", "progressive_house",
    "drum_and_bass", "trance", "afrobeats", "garage_uk", "edm_mainstage",
    "underground_dance", "queer_underground", "festival_circuit",
    "avant_garde_fashion", "editorial_fashion", "rave_fashion",
    "london_scene", "berlin_scene", "ibiza_scene",
  ],
  "Lifestyle & Nightlife": [
    "techno", "hard_techno", "hardcore", "psy_trance",
    "tech_house", "deep_house", "house_music", "progressive_house",
    "drum_and_bass", "trance", "afrobeats", "garage_uk", "edm_mainstage",
    "underground_dance", "queer_underground", "festival_circuit",
    "london_scene", "berlin_scene", "ibiza_scene", "amsterdam_scene", "nyc_scene",
    "dance_media", "rave_fashion", "avant_garde_fashion", "editorial_fashion",
  ],
  "Activities & Culture": [
    "techno", "hard_techno", "underground_dance", "deep_house", "house_music",
    "drum_and_bass", "festival_circuit",
    "london_scene", "berlin_scene", "amsterdam_scene", "nyc_scene",
    "queer_underground", "avant_garde_fashion", "editorial_fashion",
  ],
  "Media & Entertainment": [
    "dance_media", "editorial_fashion", "underground_dance",
    "techno", "hard_techno", "tech_house", "deep_house", "house_music",
    "progressive_house", "drum_and_bass", "trance", "afrobeats", "garage_uk",
    "edm_mainstage", "festival_circuit", "queer_underground",
  ],
};

const CLUSTER_PATH_PATTERNS: Record<string, RegExp> = {
  "Music & Nightlife":
    /music|nightlife|club|festival|dj|performer|concert|artist|record\s*label|genre|band/i,
  "Fashion & Streetwear":
    /fashion|clothing|apparel|style|designer|streetwear|accessories|brand|magazine|footwear|jewel/i,
  "Lifestyle & Nightlife":
    /lifestyle|travel|hotel|dining|fitness|sport|food|drink|hobby|recreation|outdoor|wellness/i,
  "Activities & Culture":
    /art|culture|design|museum|photography|creative|gallery|exhibition|theatre|cinema/i,
  "Media & Entertainment":
    /media|magazine|publication|news|journalism|radio|streaming|podcast|broadcast/i,
};

const CURATED_SEEDS: Record<string, string[]> = {
  "Music & Nightlife": [
    "techno music", "electronic dance music", "house music",
    "Boiler Room", "Resident Advisor", "Mixmag", "DJ Mag",
    "Awakenings Festival", "Berghain", "Fabric nightclub",
    "underground dance music", "rave", "music festival",
  ],
  "Fashion & Streetwear": [
    "Rick Owens", "Maison Margiela", "Raf Simons",
    "Comme des Garçons", "Balenciaga (fashion brand)", "Yohji Yamamoto",
    "Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine",
    "GQ", "Vogue", "METAL Magazine",
    "Carhartt WIP", "Palace Skateboards", "032c",
  ],
  "Lifestyle & Nightlife": [
    "weight training", "CrossFit", "boxing", "running",
    "craft beer", "natural wine", "vinyl records",
    "yoga", "cycling", "tattoo",
    "camping", "city break", "cocktails",
  ],
  "Activities & Culture": [
    "contemporary art", "art gallery", "street art",
    "photography", "design", "architecture",
  ],
  "Media & Entertainment": [
    "Mixmag", "Resident Advisor", "Boiler Room", "DJ Mag",
    "FACT Magazine", "NTS Radio", "Rinse FM",
  ],
};

const CLUSTER_BLOCKLIST: Record<string, RegExp[]> = {
  "Music & Nightlife": [
    /\b(video.?game|gaming|esport|gamer|fortnite|minecraft|call.of.duty|league.of.legends|the\s*sims)\b/i,
    /\b(driving.?game|racing.?game|driving.?sim|car.?game)\b/i,
    /\b(language.?learn|english.?course|ielts|toefl|exam.?prep|duolingo|study.?abroad)\b/i,
    /\b(stock.?market|investing|cryptocurrency|forex|bitcoin|crypto|fintech)\b/i,
    /\b(parenting|mommy|toddler|pregnancy|new.?mum|new.?mom)\b/i,
    /\b(cooking|recipe|food.?blog|baking|culinary)\b/i,
    /\b(coding|programming|software.?engineer|web.?develop)\b/i,
    /\b(performing\s*arts|classical\s*music|opera|ballet|musical\s*theatre|orchestra)\b/i,
    /\b(rock\s*music|punk\s*rock|metal\s*music|indie\s*rock|alternative\s*rock|pop\s*rock)\b/i,
    /\b(fashion\s*brand|designer\s*brand|luxury\s*brand|haute\s*couture)\b/i,
    /\b(home\s*decor|interior\s*design|gardening|DIY|home\s*improvement)\b/i,
  ],
  "Fashion & Streetwear": [
    /\b(video.?game|gaming|esport|gamer|the\s*sims)\b/i,
    /\b(language.?learn|ielts|toefl|exam.?prep)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(cryptocurrency|forex|stock.?market)\b/i,
    /\b(cooking|recipe|culinary|food.?blog)\b/i,
    /\b(pop\s*music|chart\s*music|top.?40)\b/i,
    /\b(celebrity|reality\s*tv|soap\s*opera|talent\s*show)\b/i,
    /\b(gym|fitness|bodybuilding|crossfit|workout|weight\s*training)\b/i,
    /\b(sports?\s*team|football\s*club|basketball\s*team|cricket)\b/i,
    // Block music artists/DJs/venues/labels from polluting fashion
    /\b(disc\s*jockey|nightclub|music\s*festival|record\s*label|concert|live\s*music)\b/i,
    /\b(DJ\s+\w|techno\s*music|electronic\s*dance\s*music|house\s*music|drum\s*and\s*bass)\b/i,
    /\b(Boiler\s*Room|Resident\s*Advisor|Mixmag|DJ\s*Mag)\b/i,
    /\b(home\s*decor|gardening|DIY|home\s*improvement)\b/i,
    /\b(coding|programming|software)\b/i,
  ],
  "Lifestyle & Nightlife": [
    // Video games and fictional content
    /\b(video.?game|gaming|esport|gamer|the\s*sims|fortnite|minecraft|grand\s*theft|call\s*of\s*duty)\b/i,
    /\b(simulation\s*game|role.?playing\s*game|MMO|MMORPG|expansion\s*pack)\b/i,
    // Fiction / TV / Film junk
    /\b(TV\s*series|TV\s*show|soap\s*opera|sitcom|anime|manga|comic\s*book|superhero)\b/i,
    /\b(Hollywood|Bollywood|Netflix\s*series|Disney|Pixar|Marvel|DC\s*Comics)\b/i,
    // Academic / language
    /\b(language.?learn|ielts|toefl|exam.?prep|university\s*course|online\s*course)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(coding|programming|software.?engineer)\b/i,
    /\b(stock.?market|investing|cryptocurrency|forex)\b/i,
    // Block music-specific terms from lifestyle
    /\b(record\s*label|disc\s*jockey|DJ\s+\w|music\s*production|mixing\s*console)\b/i,
    // Block fashion-specific from lifestyle
    /\b(haute\s*couture|fashion\s*week|fashion\s*designer|runway|catwalk)\b/i,
  ],
  "Activities & Culture": [
    /\b(video.?game|gaming|esport|gamer|the\s*sims)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(coding|programming|software)\b/i,
    /\b(stock.?market|cryptocurrency|forex)\b/i,
    /\b(reality\s*tv|soap\s*opera|talent\s*show|celebrity\s*gossip)\b/i,
  ],
  "Media & Entertainment": [
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(language.?learn|ielts|toefl|exam.?prep)\b/i,
    /\b(video.?game|gaming|esport|the\s*sims)\b/i,
    /\b(stock.?market|cryptocurrency|forex)\b/i,
    /\b(home\s*decor|gardening|DIY)\b/i,
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
  ageRecommendation?: AgeRecommendation;
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
  audienceSizeBand?: string;
  path?: string[];
  searchTerm: string;
  relevanceScore?: number;
  matchReason?: string;
}

export interface DiscoverCluster {
  label: string;
  description: string;
  interests: ClusteredInterest[];
}

export interface HintIntelligenceDebug {
  hintIntentsDetected: string[];
  hintPositiveFamilies: string[];
  hintNegativeFamilies: string[];
  hintBiasApplied: boolean;
  hintFilteredOutNames: string[];
  /** Candidates matching combat-sport patterns that were soft-demoted because
   * the hint did not explicitly mention boxing / MMA / martial arts. */
  hintCombatSportDemotedNames?: string[];
  byCluster: Record<string, {
    applied: boolean;
    positive: string[];
    negative: string[];
    filteredOutNames: string[];
    combatSportDemotedNames: string[];
  }>;
}

export interface DiscoverResponse {
  clusters: DiscoverCluster[];
  clusterSeeds: Record<string, string[]>;
  searchTermsUsed: string[];
  detectedSceneTags: string[];
  audienceFingerprint: AudienceFingerprint;
  totalFound: number;
  /** Populated only when the caller supplied free-text hints (see classifyHintIntents). */
  hintIntelligence: HintIntelligenceDebug | null;
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

/**
 * Collect raw hint strings that should be searched directly against Meta's API.
 *
 * A natural-language sentence ("suggest sport activities for people into
 * nightlife clubbing") is a terrible Meta /search query — it returns nothing.
 * We keep only short (≤ 4 word) phrases as direct terms; longer hints still
 * drive intent classification and intent-seed generation upstream.
 */
function extractDirectHintTerms(rawHints: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawHints) {
    const trimmed = raw.trim();
    if (trimmed.length < 2) continue;
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount > 4) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
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

// ── Age inference ─────────────────────────────────────────────────────────────

const SCENE_AGE_PROFILES: Partial<Record<SceneTag, { min: number; max: number; peak: number }>> = {
  hard_techno:        { min: 18, max: 32, peak: 24 },
  hardcore:           { min: 18, max: 30, peak: 22 },
  psy_trance:         { min: 20, max: 38, peak: 27 },
  techno:             { min: 20, max: 38, peak: 28 },
  tech_house:         { min: 21, max: 38, peak: 27 },
  deep_house:         { min: 23, max: 42, peak: 32 },
  house_music:        { min: 22, max: 45, peak: 33 },
  progressive_house:  { min: 22, max: 42, peak: 30 },
  underground_dance:  { min: 20, max: 38, peak: 27 },
  drum_and_bass:      { min: 18, max: 34, peak: 24 },
  trance:             { min: 22, max: 42, peak: 30 },
  afrobeats:          { min: 18, max: 35, peak: 25 },
  garage_uk:          { min: 18, max: 32, peak: 24 },
  edm_mainstage:      { min: 18, max: 34, peak: 24 },
  festival_circuit:   { min: 18, max: 38, peak: 26 },
  queer_underground:  { min: 20, max: 38, peak: 27 },
  avant_garde_fashion:{ min: 22, max: 42, peak: 30 },
  editorial_fashion:  { min: 20, max: 40, peak: 28 },
  dance_media:        { min: 20, max: 38, peak: 27 },
};

export interface AgeRecommendation {
  minAge: number;
  maxAge: number;
  peakAge: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

function inferAgeRange(tagWeights: Map<SceneTag, number>): AgeRecommendation {
  let totalWeight = 0;
  let weightedMin = 0;
  let weightedMax = 0;
  let weightedPeak = 0;
  let matchedScenes = 0;

  for (const [tag, weight] of tagWeights.entries()) {
    const profile = SCENE_AGE_PROFILES[tag];
    if (!profile) continue;
    matchedScenes++;
    totalWeight += weight;
    weightedMin += profile.min * weight;
    weightedMax += profile.max * weight;
    weightedPeak += profile.peak * weight;
  }

  if (totalWeight === 0) {
    return { minAge: 18, maxAge: 45, peakAge: 28, confidence: "low", rationale: "No scene-specific age data available — using broad defaults." };
  }

  const avgMin = Math.round(weightedMin / totalWeight);
  const avgMax = Math.round(weightedMax / totalWeight);
  const avgPeak = Math.round(weightedPeak / totalWeight);

  const confidence: AgeRecommendation["confidence"] =
    matchedScenes >= 3 && totalWeight > 30 ? "high" :
    matchedScenes >= 2 ? "medium" : "low";

  const topScene = [...tagWeights.entries()].sort(([, a], [, b]) => b - a)[0];
  const topSceneLabel = topScene ? topScene[0].replace(/_/g, " ") : "mixed";

  return {
    minAge: avgMin,
    maxAge: avgMax,
    peakAge: avgPeak,
    confidence,
    rationale: `Derived from ${matchedScenes} scene signal${matchedScenes !== 1 ? "s" : ""} (dominant: ${topSceneLabel}). Core audience: ${avgMin}–${avgMax}, peak at ${avgPeak}.`,
  };
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
  const entities = getClusterEntities(clusterLabel);
  const terms = new Map<string, number>(); // term → best tag weight (for ordering)

  for (const [tag, weight] of tagWeights.entries()) {
    if (!allowed.has(tag)) continue;
    for (const entity of entities[tag] ?? []) {
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

  const maxTerms = confidence >= 75 ? 18 : confidence >= 50 ? 24 : 30;
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

function buildSceneKeywords(tagWeights: Map<SceneTag, number>, clusterLabel: string): Map<string, number> {
  const entities = getClusterEntities(clusterLabel);
  const kws = new Map<string, number>();
  for (const [tag, weight] of tagWeights.entries()) {
    for (const entity of entities[tag] ?? []) {
      // Full entity name (lowered, stripped of parentheticals) for exact matching
      const clean = entity.replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
      if (clean.length >= 3) {
        kws.set(clean, Math.max(kws.get(clean) ?? 0, weight));
      }
      // Individual words ≥3 chars for partial matching
      for (const word of entity.split(/\s+/)) {
        const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (w.length >= 3) {
          kws.set(w, Math.max(kws.get(w) ?? 0, weight * 0.8));
        }
      }
    }
  }
  return kws;
}

function audienceSizeBand(size: number): string {
  if (size <= 0)              return "unknown";
  if (size < 500_000)         return "micro (<500K)";
  if (size < 2_000_000)       return "niche (<2M)";
  if (size < 10_000_000)      return "targeted (<10M)";
  if (size < 50_000_000)      return "medium (<50M)";
  if (size < 200_000_000)     return "broad (<200M)";
  return "mega (200M+)";
}

interface ScoreResult {
  score: number;
  reason: string;
}

function scoreInterest(
  interest: RawInterest,
  clusterLabel: string,
  sceneKeywords: Map<string, number>,
  confidence: number,
): ScoreResult {
  let score = 0;
  const reasons: string[] = [];

  // Path relevance (most important signal)
  const pathPattern = CLUSTER_PATH_PATTERNS[clusterLabel];
  if (pathPattern) {
    const text = [interest.name, ...(interest.path ?? [])].join(" ");
    if (pathPattern.test(text)) {
      score += 30;
      reasons.push("path-match");
    }
  }

  // Scene entity name alignment — weight proportional to tag weight
  const nameLower = interest.name.toLowerCase();
  let bestKw = "";
  let bestKwWeight = 0;
  for (const [kw, kw_weight] of sceneKeywords.entries()) {
    if (nameLower.includes(kw) && kw_weight > bestKwWeight) {
      bestKwWeight = kw_weight;
      bestKw = kw;
    }
  }
  if (bestKwWeight > 0) {
    score += Math.min((bestKwWeight / 120) * 20, 20);
    reasons.push(`keyword:${bestKw}`);
  }

  const size = interest.audience_size ?? 0;
  if (size > 0) {
    if      (size < 500_000)      { score += 10; reasons.push("micro-niche"); }
    else if (size < 2_000_000)    { score += 8;  reasons.push("niche"); }
    else if (size < 10_000_000)   { score += 5;  reasons.push("targeted"); }
    else if (size < 50_000_000)   { score += 2;  }
    else if (size < 200_000_000)  { /* neutral */ }
    else                          { score -= 8;  reasons.push("mega-broad-penalty"); }
  }

  if (confidence >= 50 && size > 100_000_000) {
    score -= 5;
    reasons.push("high-conf-broad-penalty");
  }

  return { score, reason: reasons.join(", ") || "general" };
}

// ── Cluster descriptions ──────────────────────────────────────────────────────

const CLUSTER_DESCRIPTIONS: Record<string, string> = {
  "Music & Nightlife":
    "genres, artists, DJs, labels, clubs, festivals, venues, nightlife communities",
  "Fashion & Streetwear":
    "scene-adjacent fashion brands, designers, streetwear, publications, subcultural style",
  "Lifestyle & Nightlife":
    "nightlife behaviour, fitness, food & drink, travel, hobbies, cultural consumption",
  "Activities & Culture":
    "art, creative spaces, exhibitions, cultural venues, design, urban culture",
  "Media & Entertainment":
    "music publications, radio, podcasts, streaming, editorial platforms",
};

const ALL_CLUSTER_LABELS = Object.keys(CLUSTER_DESCRIPTIONS);

// ── Core discovery function ───────────────────────────────────────────────────

// ── Hint-intent layer (Activities & Culture) ─────────────────────────────────
//
// Free-text scene hints like "suggest sport activities for people into nightlife
// clubbing" are classified into a small set of high-level intents. Those intents
// then bias the Activities & Culture generator so sport/fitness-oriented hints
// don't get swamped by the generic art/gallery defaults in CULTURE_ENTITIES.
//
// Everything else (other clusters, scoring formulas, blocklists, fallbacks)
// is untouched.

type HintIntent =
  | "sport_fitness"
  | "art_design"
  | "nightlife_social"
  | "music_scene"
  | "fashion_editorial"
  | "general_culture";

const HINT_INTENT_PATTERNS: Array<{ intent: HintIntent; pattern: RegExp }> = [
  {
    intent: "sport_fitness",
    pattern:
      /\b(sport|sports|gym|fitness|running|runner|cycling|cyclist|football|soccer|basketball|boxing|mma|martial\s+arts|yoga|pilates|dance\s+workout|workout|exercise|movement|wellness|wellbeing|padel|tennis|swim|swimming|hiking|climbing|skating|skateboard|surf|surfing|crossfit|weights?|strength|cardio|triathlon|marathon|rugby|cricket|health|active\s+lifestyle|recreation)\b/i,
  },
  {
    intent: "nightlife_social",
    pattern:
      /\b(nightlife|clubbing|club(s|bing)?|rave|rav(e|ing|er)s?|party|parties|going\s+out|festival|festivals|late\s+night|after\s?hours?|dj\s+set|warehouse\s+party)\b/i,
  },
  {
    intent: "art_design",
    pattern:
      /\b(art|artist|artists|gallery|galleries|exhibition|exhibitions|street\s+art|mural|murals|visual\s+art|fine\s+art|museum|museums|design(er)?|architecture|photography|photographer|sculpture|installation)\b/i,
  },
  {
    intent: "music_scene",
    pattern:
      /\b(music|techno|house\s+music|trance|electronic|dj|djs|record\s+label|genre|band|musician|concert|live\s+music)\b/i,
  },
  {
    intent: "fashion_editorial",
    pattern:
      /\b(fashion|editorial|streetwear|designer|runway|magazine|magazines|vogue|style)\b/i,
  },
];

function classifyHintIntents(rawHints: string[]): Set<HintIntent> {
  const intents = new Set<HintIntent>();
  if (rawHints.length === 0) return intents;
  // Normalise before regex matching: replace "_" and "-" with spaces so that
  // word boundaries (\b) fire even if a caller passed an underscore-joined
  // token like "suggest_sport_activities_for_people_into_nightlife_clubbing".
  // This is defensive — the frontend now sends natural-language phrases.
  const joined = rawHints
    .map((h) => h.trim().replace(/[_-]+/g, " "))
    .filter(Boolean)
    .join(" | ");
  for (const { intent, pattern } of HINT_INTENT_PATTERNS) {
    if (pattern.test(joined)) intents.add(intent);
  }
  if (intents.size === 0 && joined.length > 0) intents.add("general_culture");
  return intents;
}

// Seed terms injected into the candidate pool when a given intent is active.
// Kept narrow: each list is the concrete set of Meta-searchable phrases a human
// buyer would try first for that intent. Used only for the Activities & Culture
// cluster when hint intents are detected.
//
// Notes:
// - sport_fitness intentionally excludes combat-specific terms (boxing, MMA,
//   martial arts). Those are only injected when the hint explicitly mentions
//   them — see COMBAT_SPORT_HINT_PATTERN below. This prevents "Martial arts"
//   and "Mixed martial arts" from dominating results for hints like
//   "suggest sport activities for people into nightlife clubbing".
const INTENT_SEED_TERMS: Record<HintIntent, string[]> = {
  sport_fitness: [
    "sports", "fitness", "physical fitness", "gym", "exercise", "workout",
    "running", "cycling", "yoga", "pilates",
    "dance", "movement", "wellness", "healthy lifestyle", "recreation",
    "social sports",
  ],
  art_design: [
    "contemporary art", "art gallery", "photography", "design", "architecture",
  ],
  nightlife_social: [
    "nightlife", "social event", "dance", "parties",
  ],
  music_scene: [
    "live music", "music festival",
  ],
  fashion_editorial: [
    "fashion", "editorial fashion",
  ],
  general_culture: [],
};

// Combat-sport terms are injected only when the hint text explicitly mentions
// them. Otherwise "Martial arts (sports)" / "Mixed martial arts" crowd out the
// broader nightlife-adjacent activity/movement interests the hint actually
// implies.
const COMBAT_SPORT_HINT_PATTERN =
  /\b(boxing|mma|mixed\s+martial\s+arts|martial\s+arts|karate|kickbox(ing)?|muay\s*thai|judo|taekwondo|bjj|jiu.?jitsu|wrestling)\b/i;
const COMBAT_SPORT_EXTRA_SEEDS = ["boxing", "martial arts", "mixed martial arts"];
const COMBAT_SPORT_CANDIDATE_PATTERN =
  /\b(martial\s+arts|mixed\s+martial\s+arts|artistic\s+gymnastics|karate|kickbox(ing)?|muay\s+thai|judo|taekwondo|jiu.?jitsu|bjj|mma)\b/i;

function hintHasCombatSport(rawHints: string[]): boolean {
  if (rawHints.length === 0) return false;
  const joined = rawHints.map((h) => h.trim().replace(/[_-]+/g, " ")).join(" | ");
  return COMBAT_SPORT_HINT_PATTERN.test(joined);
}

/**
 * Concatenate intent seed lists in a stable, deduped order.
 * When `combatSport` is true (the hint explicitly mentioned boxing/MMA/etc),
 * combat-specific seeds are re-added.
 */
function deriveHintIntentSeedTerms(
  intents: Set<HintIntent>,
  combatSport: boolean,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const intent of intents) {
    for (const t of INTENT_SEED_TERMS[intent] ?? []) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  if (combatSport && intents.has("sport_fitness")) {
    for (const t of COMBAT_SPORT_EXTRA_SEEDS) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

// Positive / negative keyword families per intent. These are matched against
// each candidate's name + path to boost or demote (and sometimes drop) it.
const INTENT_POSITIVE_FAMILIES: Record<HintIntent, string[]> = {
  sport_fitness: [
    "sport", "sports", "fitness", "gym", "exercise", "workout", "training",
    "running", "cycling", "football", "soccer", "basketball", "boxing",
    "martial arts", "yoga", "pilates", "dance", "movement", "wellness",
    "wellbeing", "healthy lifestyle", "recreation", "outdoor", "tennis",
    "padel", "swimming", "hiking", "climbing", "skateboard", "surfing",
    "crossfit", "triathlon", "marathon", "athletics", "bodybuilding",
  ],
  art_design: [
    "art", "artist", "gallery", "exhibition", "museum", "photography",
    "design", "architecture", "sculpture", "installation art", "street art",
    "mural", "visual art", "fine art", "contemporary art",
  ],
  nightlife_social: [
    "nightlife", "nightclub", "clubbing", "party", "festival", "rave",
    "dj", "disc jockey", "social event",
  ],
  music_scene: ["music", "concert", "live music", "record label", "band"],
  fashion_editorial: [
    "fashion", "editorial", "magazine", "designer clothing", "runway",
    "streetwear", "style",
  ],
  general_culture: [],
};

const INTENT_NEGATIVE_FAMILIES: Record<HintIntent, string[]> = {
  sport_fitness: [
    "street art", "mural", "gallery", "exhibition", "contemporary art",
    "visual art", "fine art", "museum", "sculpture", "installation art",
    "architecture",
  ],
  art_design: [
    "gym", "fitness", "workout", "crossfit", "bodybuilding", "running club",
  ],
  nightlife_social: [],
  music_scene: [],
  fashion_editorial: [],
  general_culture: [],
};

function buildIntentFamilies(intents: Set<HintIntent>): {
  positive: string[];
  negative: string[];
  hasSportFitness: boolean;
  hasArtDesign: boolean;
} {
  const positive = new Set<string>();
  const negative = new Set<string>();
  for (const intent of intents) {
    for (const kw of INTENT_POSITIVE_FAMILIES[intent] ?? []) positive.add(kw);
    for (const kw of INTENT_NEGATIVE_FAMILIES[intent] ?? []) negative.add(kw);
  }
  const hasSportFitness = intents.has("sport_fitness");
  const hasArtDesign = intents.has("art_design");
  // If sport_fitness is present WITHOUT art_design, enforce art-family negatives
  // even if the user didn't imply them. This is the "intent override" rule.
  if (hasSportFitness && !hasArtDesign) {
    for (const kw of INTENT_NEGATIVE_FAMILIES.sport_fitness) negative.add(kw);
  }
  return {
    positive: [...positive],
    negative: [...negative],
    hasSportFitness,
    hasArtDesign,
  };
}

/** Escape user-supplied text so it can be embedded safely into a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Token-aware match: the keyword must appear as whole words, with real
 * separator boundaries on either side. This stops "art" from matching
 * inside "martial arts" / "artistic gymnastics", and "mural" from matching
 * inside "intramural", etc. Multi-word keywords (e.g. "street art",
 * "martial arts") are matched as a whole phrase, with \s+ collapsing any
 * amount of whitespace between tokens.
 */
function keywordMatches(text: string, keyword: string): boolean {
  if (!keyword) return false;
  const kw = keyword.toLowerCase().trim();
  if (!kw) return false;
  const pattern = kw.includes(" ")
    ? new RegExp(`\\b${kw.split(/\s+/).map(escapeRegex).join("\\s+")}\\b`, "i")
    : new RegExp(`\\b${escapeRegex(kw)}\\b`, "i");
  return pattern.test(text);
}

/**
 * Re-score / filter Activities & Culture candidates according to hint intents.
 * Additive only: if no intents or no matches, returns the original scored list.
 *
 * `combatSportHinted` controls whether combat-sport candidates (martial arts,
 * MMA, boxing, karate, etc.) are allowed to keep their raw score. When the
 * hint does NOT explicitly mention combat sports, these candidates are still
 * eligible but get a soft demotion so they don't crowd out broader
 * nightlife-adjacent activity/movement interests.
 */
function applyHintBiasForActivitiesCulture<
  T extends {
    name: string;
    path?: string[];
    relevanceScore?: number;
    matchReason?: string;
  },
>(
  scored: T[],
  families: ReturnType<typeof buildIntentFamilies>,
  combatSportHinted: boolean,
): {
  adjusted: T[];
  filteredOutNames: string[];
  biasApplied: boolean;
  combatSportDemotedNames: string[];
} {
  if (families.positive.length === 0 && families.negative.length === 0) {
    return {
      adjusted: scored,
      filteredOutNames: [],
      biasApplied: false,
      combatSportDemotedNames: [],
    };
  }
  const filteredOutNames: string[] = [];
  const combatSportDemotedNames: string[] = [];
  const adjusted: T[] = [];
  for (const item of scored) {
    const corpus = [item.name, ...(item.path ?? [])].join(" ");
    const negHit = families.negative.some((kw) => keywordMatches(corpus, kw));
    const posHit = families.positive.some((kw) => keywordMatches(corpus, kw));
    // Drop if clearly negative and nothing positive rescues it, and the caller
    // has a strong sport_fitness intent without art_design.
    if (negHit && !posHit && families.hasSportFitness && !families.hasArtDesign) {
      filteredOutNames.push(item.name);
      continue;
    }
    const current = item.relevanceScore ?? 0;
    let delta = 0;
    let combatDemoted = false;
    if (posHit) delta += 25;
    if (negHit) delta -= 15;
    // Soft-demote combat-sport candidates when the hint didn't ask for them.
    // They stay eligible, just no longer dominate the top of the list.
    if (
      !combatSportHinted &&
      families.hasSportFitness &&
      COMBAT_SPORT_CANDIDATE_PATTERN.test(item.name)
    ) {
      delta -= 25;
      combatDemoted = true;
      combatSportDemotedNames.push(item.name);
    }
    const nextItem = { ...item };
    if (delta !== 0) {
      nextItem.relevanceScore = current + delta;
      const tags: string[] = [];
      if (posHit && !negHit) tags.push("hint+");
      else if (negHit && !posHit) tags.push("hint-");
      else if (posHit && negHit) tags.push("hint~");
      if (combatDemoted) tags.push("combat-demote");
      nextItem.matchReason = `${item.matchReason ?? "score"};${tags.join(",")}`;
    }
    adjusted.push(nextItem);
  }
  return { adjusted, filteredOutNames, biasApplied: true, combatSportDemotedNames };
}

async function discoverForCluster(
  clusterLabel: string,
  tagWeights: Map<SceneTag, number>,
  confidence: number,
  token: string,
  globalSeen: Set<string>,
  directHintTerms: string[] = [],
  hintIntents: Set<HintIntent> = new Set(),
  combatSportHinted: boolean = false,
): Promise<{
  cluster: DiscoverCluster;
  termsUsed: string[];
  hintBias?: {
    applied: boolean;
    positive: string[];
    negative: string[];
    filteredOutNames: string[];
    combatSportDemotedNames: string[];
  };
}> {
  const entityTerms = buildClusterTerms(tagWeights, clusterLabel, confidence);

  // Scene hints always go first (they are the user's explicit signal) — deduplicated.
  // For Activities & Culture specifically, when hint intents are detected, we
  // also inject concrete intent-derived seed terms (sports/fitness/etc.) so
  // candidate retrieval is driven by the hint rather than the default art pack.
  const entitySet = new Set(entityTerms.map((t) => t.toLowerCase()));
  const extraHints = directHintTerms.filter((h) => !entitySet.has(h.toLowerCase()));
  const intentSeedTerms =
    clusterLabel === "Activities & Culture" && hintIntents.size > 0
      ? deriveHintIntentSeedTerms(hintIntents, combatSportHinted).filter(
          (t) => !entitySet.has(t.toLowerCase()) &&
            !extraHints.some((h) => h.toLowerCase() === t.toLowerCase()),
        )
      : [];
  const allTerms = [...extraHints, ...intentSeedTerms, ...entityTerms];

  const sceneKeywords = buildSceneKeywords(tagWeights, clusterLabel);

  // Minimum score floor (only applied at high confidence)
  const minScore = confidence >= 75 ? 15 : confidence >= 50 ? 5 : 0;

  console.info(
    `[interest-discover] ═══ CLUSTER: "${clusterLabel}" ═══ confidence=${confidence}\n` +
    `  candidate-pool(${allTerms.length}): ${allTerms.join(", ")}\n` +
    `  entity-terms(${entityTerms.length}): ${entityTerms.join(", ")}\n` +
    `  hints(${extraHints.length}): ${extraHints.join(", ")}` +
    (intentSeedTerms.length > 0
      ? `\n  intent-seeds(${intentSeedTerms.length}): ${intentSeedTerms.join(", ")}`
      : ""),
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

  const scored = filtered.map((i) => {
    const { score, reason } = scoreInterest(i, clusterLabel, sceneKeywords, confidence);
    return {
      id: i.id,
      name: i.name,
      audienceSize: i.audience_size,
      audienceSizeBand: audienceSizeBand(i.audience_size ?? 0),
      path: i.path,
      searchTerm: i.searchTerm,
      relevanceScore: score,
      matchReason: reason,
    };
  });

  console.info(
    `[interest-discover] cluster="${clusterLabel}" scored(${scored.length}): ` +
    scored
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, 10)
      .map((i) => `${i.name}[score=${i.relevanceScore?.toFixed(0)},size=${i.audienceSize?.toLocaleString() ?? "?"},reason=${i.matchReason}]`)
      .join(", "),
  );

  let aboveFloor = scored.filter((i) => (i.relevanceScore ?? 0) >= minScore);
  const belowFloor = scored.filter((i) => (i.relevanceScore ?? 0) < minScore);
  if (belowFloor.length > 0) {
    console.info(
      `[interest-discover] cluster="${clusterLabel}" rejected-by-score(${belowFloor.length}): ` +
      belowFloor.slice(0, 8).map((i) => `${i.name}[score=${i.relevanceScore?.toFixed(0)}]`).join(", "),
    );
  }

  // ── Phase 3: progressive fallback if too few results ──────────────────────
  if (aboveFloor.length < 2 && minScore > 0) {
    console.info(
      `[interest-discover] cluster="${clusterLabel}" score-floor(${minScore}) left ${aboveFloor.length} results; lowering to 0`,
    );
    aboveFloor = scored;
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
      const fallbackFiltered = raw.filter((i) => passesBlocklist(i, clusterLabel));
      const fallbackScored = fallbackFiltered.map((i) => {
        const { score, reason } = scoreInterest(i, clusterLabel, sceneKeywords, confidence);
        return {
          id: i.id, name: i.name,
          audienceSize: i.audience_size,
          audienceSizeBand: audienceSizeBand(i.audience_size ?? 0),
          path: i.path,
          searchTerm: i.searchTerm,
          relevanceScore: score,
          matchReason: reason,
        };
      });
      aboveFloor = fallbackScored;
    }
  }

  // ── Hint-intent bias (Activities & Culture only) ─────────────────────────
  // If the user provided free-text hints like "sport activities", bias the
  // final pool so sport/fitness intents beat the generic art/gallery defaults.
  let hintBiasMeta: {
    applied: boolean;
    positive: string[];
    negative: string[];
    filteredOutNames: string[];
    combatSportDemotedNames: string[];
  } | undefined;
  if (clusterLabel === "Activities & Culture" && hintIntents.size > 0) {
    const families = buildIntentFamilies(hintIntents);
    const { adjusted, filteredOutNames, biasApplied, combatSportDemotedNames } =
      applyHintBiasForActivitiesCulture(aboveFloor, families, combatSportHinted);
    aboveFloor = adjusted;
    hintBiasMeta = {
      applied: biasApplied,
      positive: families.positive,
      negative: families.negative,
      filteredOutNames,
      combatSportDemotedNames,
    };
    if (biasApplied) {
      console.info(
        `[hint] intents=${[...hintIntents].join(",")}\n` +
        `[hint] positive=${families.positive.slice(0, 12).join(",")}\n` +
        `[hint] negative=${families.negative.slice(0, 12).join(",")}\n` +
        (filteredOutNames.length > 0
          ? `[hint] filtered=${filteredOutNames.join(", ")}\n`
          : `[hint] filtered=<none>\n`) +
        `[hint] combatSportHinted=${combatSportHinted}` +
        (combatSportDemotedNames.length > 0
          ? `  demoted=${combatSportDemotedNames.join(", ")}`
          : ""),
      );
    }
  }

  const maxResults = confidence >= 75 ? 6 : 8;
  const interests = aboveFloor
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, maxResults);

  console.info(
    `[interest-discover] cluster="${clusterLabel}" ── FINAL(${interests.length}) ──\n` +
    interests.map((i) =>
      `  ✓ ${i.name} [score=${i.relevanceScore?.toFixed(1)}, size=${((i.audienceSize ?? 0) / 1e6).toFixed(1)}M, band=${i.audienceSizeBand}, reason=${i.matchReason}]`
    ).join("\n"),
  );

  return {
    cluster: {
      label: clusterLabel,
      description: CLUSTER_DESCRIPTIONS[clusterLabel] ?? clusterLabel,
      interests,
    },
    termsUsed: allTerms,
    hintBias: hintBiasMeta,
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
  const ageRecommendation = inferAgeRange(tagWeights);

  const audienceFingerprint: AudienceFingerprint = { sources, dominantScenes, confidence, specificity, ageRecommendation };

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

  // Classify free-text hints into high-level intents (used by Activities & Culture only)
  const hintIntents = classifyHintIntents(rawHints);
  const combatSportHinted = hintHasCombatSport(rawHints);
  const hintFallbackUsed =
    rawHints.length > 0 && (hintIntents.size === 0 || (hintIntents.size === 1 && hintIntents.has("general_culture")));
  console.info(
    `[interest-discover] request: clusterLabel=${clusterLabel ?? "<ALL>"}  rawHints=${JSON.stringify(rawHints)}  ` +
    `intents=${hintIntents.size > 0 ? [...hintIntents].join(",") : "<none>"}  ` +
    `combatSport=${combatSportHinted}  hintFallback=${hintFallbackUsed}`,
  );

  const targetLabels = clusterLabel ? [clusterLabel] : ALL_CLUSTER_LABELS;
  console.info(
    `[interest-discover] scope: ${clusterLabel ? `single-cluster "${clusterLabel}"` : `multi-cluster (${targetLabels.length})`}`,
  );
  const globalSeen = new Set<string>();
  const clusterSeeds: Record<string, string[]> = {};
  const clusters: DiscoverCluster[] = [];
  const hintBiasByCluster: Record<string, {
    applied: boolean;
    positive: string[];
    negative: string[];
    filteredOutNames: string[];
    combatSportDemotedNames: string[];
  }> = {};

  for (const label of targetLabels) {
    const { cluster, termsUsed, hintBias } = await discoverForCluster(
      label,
      tagWeights,
      confidence,
      token,
      globalSeen,
      directHintTerms,
      hintIntents,
      combatSportHinted,
    );
    clusterSeeds[label] = termsUsed;
    if (cluster.interests.length > 0) clusters.push(cluster);
    if (hintBias) hintBiasByCluster[label] = hintBias;
  }

  const searchTermsUsed = [...new Set(Object.values(clusterSeeds).flat())];
  const detectedSceneTags = [...tagWeights.keys()].filter((t) => (tagWeights.get(t) ?? 0) > 0);

  console.info(
    `[interest-discover] done — ${globalSeen.size} unique interests, ` +
    clusters.map((c) => `${c.label}:${c.interests.length}`).join(", "),
  );

  const firstBias = Object.values(hintBiasByCluster)[0];
  // Populate hintIntelligence whenever any hint text was provided, even if
  // no intents were matched — so callers can distinguish "no hint"
  // (hintIntelligence === null) from "hint provided but unparsed"
  // (hintIntentsDetected === []).
  const hintIntelligence = rawHints.length > 0
    ? {
        hintIntentsDetected: [...hintIntents],
        hintPositiveFamilies: firstBias?.positive ?? [],
        hintNegativeFamilies: firstBias?.negative ?? [],
        hintBiasApplied: Object.values(hintBiasByCluster).some((b) => b.applied),
        hintFilteredOutNames: Object.values(hintBiasByCluster).flatMap((b) => b.filteredOutNames),
        hintCombatSportDemotedNames: Object.values(hintBiasByCluster).flatMap((b) => b.combatSportDemotedNames),
        byCluster: hintBiasByCluster,
      }
    : null;

  return NextResponse.json({
    clusters,
    clusterSeeds,
    searchTermsUsed,
    detectedSceneTags,
    audienceFingerprint,
    totalFound: globalSeen.size,
    hintIntelligence,
  } satisfies DiscoverResponse);
}
