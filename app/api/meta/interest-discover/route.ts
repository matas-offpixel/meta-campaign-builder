/**
 * POST /api/meta/interest-discover
 *
 * Affinity-based interest discovery that treats selected Facebook pages as
 * seed entities rather than keyword sources.
 *
 * Pipeline:
 *   1. classifyPages()        — pattern + category match → SceneTag set
 *   2. buildClusterTerms()    — scene tags → curated entity names per cluster
 *   3. searchMeta()           — /search?type=adinterest for each entity name
 *   4. passesBlocklist()      — hard-reject irrelevant categories
 *   5. scoreInterest()        — cluster path + scene alignment + audience size
 *   6. Return top 6 per cluster
 *
 * Single-cluster mode: pass `clusterLabel` in the request body to target
 * one cluster only (used when an interest group has a cluster type set).
 *
 * Dev logging: console.info shows per-cluster scene tags, entity terms,
 * pre-filter count, removed interests, and final kept interests.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Scene tags ────────────────────────────────────────────────────────────────

type SceneTag =
  // Electronic sub-genres
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
  // Cultural positioning
  | "underground_dance"
  | "queer_underground"
  | "festival_circuit"
  // City scenes
  | "london_scene"
  | "berlin_scene"
  | "ibiza_scene"
  | "amsterdam_scene"
  | "nyc_scene"
  // Fashion / media
  | "dance_media"
  | "rave_fashion"
  | "avant_garde_fashion"
  | "editorial_fashion";

// For sceneHints validation — set of all valid tags
const ALL_SCENE_TAGS = new Set<SceneTag>([
  "techno", "hard_techno", "hardcore", "psy_trance",
  "tech_house", "deep_house", "house_music", "progressive_house",
  "drum_and_bass", "trance", "afrobeats", "garage_uk", "edm_mainstage",
  "underground_dance", "queer_underground", "festival_circuit",
  "london_scene", "berlin_scene", "ibiza_scene", "amsterdam_scene", "nyc_scene",
  "dance_media", "rave_fashion", "avant_garde_fashion", "editorial_fashion",
]);

// ── Entity classifiers ────────────────────────────────────────────────────────
// Ordered from most-specific (named entity) to most-general (category fallback).
// A page is matched against ALL rules — tags accumulate.

interface ClassifierRule {
  /** Matched against page name OR Instagram username (case-insensitive) */
  pattern?: RegExp;
  /** Matched against page category */
  categories?: string[];
  tags: SceneTag[];
}

const ENTITY_CLASSIFIERS: ClassifierRule[] = [
  // ── Known venues ───────────────────────────────────────────────────────────
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
  { pattern: /\bdestino\b.*ibiza|\bibiza.*destino/i, tags: ["house_music", "ibiza_scene"] },
  { pattern: /\bspace\s*ibiza\b/i, tags: ["tech_house", "house_music", "ibiza_scene"] },
  { pattern: /\bpanorama\s*bar\b/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bclub\s*der\s*vision/i, tags: ["techno", "underground_dance", "berlin_scene"] },
  { pattern: /\bde\s*school\b/i, tags: ["techno", "underground_dance", "amsterdam_scene"] },
  { pattern: /\bmelkweg\b/i, tags: ["underground_dance", "amsterdam_scene"] },
  { pattern: /\babsolut\s*terano|shelter\s*amsterdam/i, tags: ["techno", "amsterdam_scene"] },
  { pattern: /\bbooby\s*trap|output\s*brooklyn|brooklyn\s*mirage/i, tags: ["techno", "tech_house", "nyc_scene"] },
  { pattern: /\bdc10\b|\bspace\s*miami\b|\bbare\s*club\b/i, tags: ["tech_house", "house_music"] },

  // ── Known record labels ────────────────────────────────────────────────────
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
  { pattern: /\bwest\s*end\s*records\b/i, tags: ["house_music"] },
  { pattern: /\bsolid\s*grooves\b/i, tags: ["tech_house"] },
  { pattern: /\brelief\s*records\b/i, tags: ["tech_house"] },
  { pattern: /\bblack\s*butter\b/i, tags: ["house_music", "garage_uk"] },
  { pattern: /\bwarp\s*records\b/i, tags: ["techno", "underground_dance"] },

  // ── Known DJs / artists ────────────────────────────────────────────────────
  { pattern: /\badam\s*beyer\b/i, tags: ["techno"] },
  { pattern: /\brichie\s*hawtin\b/i, tags: ["techno"] },
  { pattern: /\bben\s*klock\b/i, tags: ["techno"] },
  { pattern: /\bcharlotte\s*de\s*witte\b/i, tags: ["techno"] },
  { pattern: /\bjeff\s*mills\b/i, tags: ["techno"] },
  { pattern: /\bellen\s*allien\b/i, tags: ["techno"] },
  { pattern: /\bsurgeon\b(?!.*(doctor|plastic))/i, tags: ["techno"] },
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

  // ── Known festivals ────────────────────────────────────────────────────────
  { pattern: /\btomorrowland\b/i, tags: ["edm_mainstage", "progressive_house", "festival_circuit"] },
  { pattern: /\bcoachella\b/i, tags: ["festival_circuit", "edm_mainstage"] },
  { pattern: /\bglastonbury\b/i, tags: ["festival_circuit"] },
  { pattern: /\bcreamfields\b/i, tags: ["festival_circuit", "tech_house", "edm_mainstage"] },
  { pattern: /\bawakenings\b/i, tags: ["techno", "festival_circuit"] },
  { pattern: /\bsonar\b/i, tags: ["techno", "underground_dance", "festival_circuit"] },
  { pattern: /\bade\b|\bamsterdam\s*dance\s*event\b/i, tags: ["festival_circuit", "underground_dance"] },
  { pattern: /\bhideout\s*festival\b/i, tags: ["tech_house", "festival_circuit"] },
  { pattern: /\bexit\s*festival\b/i, tags: ["edm_mainstage", "festival_circuit"] },
  { pattern: /\blollapalooza\b/i, tags: ["festival_circuit"] },
  { pattern: /\bburn(ing)?\s*man\b/i, tags: ["underground_dance", "festival_circuit"] },
  { pattern: /\bgalaxy\s*festival|gala\b/i, tags: ["underground_dance", "festival_circuit"] },
  { pattern: /\bboiler\s*room\b/i, tags: ["techno", "underground_dance", "dance_media"] },
  { pattern: /\bdefected\s*croatia|defected\s*ibiza/i, tags: ["house_music", "festival_circuit"] },

  // ── Music media ────────────────────────────────────────────────────────────
  { pattern: /\bmixmag\b/i, tags: ["dance_media", "underground_dance"] },
  { pattern: /\bresident\s*advisor\b/i, tags: ["dance_media", "underground_dance"] },
  { pattern: /\bdj\s*mag\b/i, tags: ["dance_media"] },
  { pattern: /\braheem/i, tags: ["dance_media"] },

  // ── Fashion / streetwear adjacent ─────────────────────────────────────────
  { pattern: /\bpalace\s*skate/i, tags: ["rave_fashion"] },
  { pattern: /\bcarhartt\b/i, tags: ["rave_fashion"] },
  { pattern: /\bst[uü]ss?y\b/i, tags: ["rave_fashion"] },
  { pattern: /\boff.?white\b/i, tags: ["rave_fashion"] },
  { pattern: /\bchrome\s*hearts\b/i, tags: ["rave_fashion"] },
  { pattern: /\bdazed\b/i, tags: ["rave_fashion", "dance_media"] },
  { pattern: /\bi.d\s*magazine|i-d\s*mag/i, tags: ["rave_fashion", "dance_media"] },

  // ── Hard techno / industrial / fast techno ────────────────────────────────
  { pattern: /\bfury\b/i, tags: ["hard_techno", "underground_dance", "festival_circuit"] },
  { pattern: /\bhard\s*techno\b/i, tags: ["hard_techno", "underground_dance"] },
  { pattern: /\bindustrial\s*techno\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\bawakenings\b/i, tags: ["hard_techno", "techno", "festival_circuit"] },
  { pattern: /\brebekah\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\bblawan\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\bkarenn\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\btrym\b/i, tags: ["hard_techno"] },
  { pattern: /\boscar\s*mulero\b/i, tags: ["hard_techno", "techno"] },
  { pattern: /\bbinary\s*function|arcadia|pole\s*position|renegade\b/i, tags: ["hard_techno", "festival_circuit"] },

  // ── Hardcore / gabber ─────────────────────────────────────────────────────
  { pattern: /\bdefqon\.?1\b|\bq.?dance\b/i, tags: ["hardcore", "festival_circuit"] },
  { pattern: /\bgabber\b|\bhardstyle\b|\bhardcore\s*rave\b/i, tags: ["hardcore"] },
  { pattern: /\bnoisecontrollers\b|\bcoone\b|\bheadhunterz\b/i, tags: ["hardcore"] },

  // ── Psytrance ─────────────────────────────────────────────────────────────
  { pattern: /\bpsytrance\b|\bpsy.?trance\b|\bgoa\s*trance\b/i, tags: ["psy_trance", "festival_circuit"] },
  { pattern: /\bozora\b|\bshankra\b|\bspirit\s*festival\b/i, tags: ["psy_trance", "festival_circuit"] },
  { pattern: /\binfected\s*mushroom\b|\bastrix\b|\bshpongle\b/i, tags: ["psy_trance"] },

  // ── Queer underground ─────────────────────────────────────────────────────
  { pattern: /\bpxssy\s*palace\b|\bbody\s*movements\b|\bprotect\s*ya\s*neck\b/i, tags: ["queer_underground", "underground_dance"] },
  { pattern: /\bvogue\s*ball\b|\bballroom\b|\bhouse\s*of\b/i, tags: ["queer_underground"] },
  { pattern: /\bqueer\s*(rave|night|club|party)\b/i, tags: ["queer_underground", "underground_dance"] },
  { pattern: /\blgbtq.?\s*(night|club|dance)\b/i, tags: ["queer_underground"] },

  // ── Avant-garde / editorial fashion ──────────────────────────────────────
  { pattern: /\braf\s*simons\b/i, tags: ["avant_garde_fashion", "editorial_fashion"] },
  { pattern: /\bmaison\s*margiela\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\brick\s*owens\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\byohji\s*yamamoto\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bcomme\s*des\s*gar[cç][oô]ns\b|\bcdg\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bann\s*demeulemeester\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bdamir\s*doma\b/i, tags: ["avant_garde_fashion"] },
  { pattern: /\balexander\s*wang\b(?!.*restaurant)/i, tags: ["avant_garde_fashion"] },
  { pattern: /\bdazed\b(?!.*confused\s*records)/i, tags: ["editorial_fashion", "avant_garde_fashion"] },
  { pattern: /\bi.?d\s*mag(?:azine)?\b/i, tags: ["editorial_fashion"] },
  { pattern: /\banother\s*mag(?:azine)?\b/i, tags: ["editorial_fashion", "avant_garde_fashion"] },
  { pattern: /\bv\s*mag(?:azine)?\b/i, tags: ["editorial_fashion"] },
  { pattern: /\bmetal\s*mag(?:azine)?\b/i, tags: ["editorial_fashion", "avant_garde_fashion"] },
  { pattern: /\bsystem\s*mag(?:azine)?\b/i, tags: ["editorial_fashion"] },
  { pattern: /\bself\s*service\b|\bgarage\s*mag\b|\b032c\b/i, tags: ["editorial_fashion"] },

  // ── Genre keywords in name (lower confidence) ─────────────────────────────
  { pattern: /\btechno\b/i, tags: ["techno"] },
  { pattern: /\btech.?house\b/i, tags: ["tech_house"] },
  { pattern: /\bdeep.?house\b/i, tags: ["deep_house"] },
  { pattern: /\bprogressive\s*house\b/i, tags: ["progressive_house"] },
  { pattern: /\bdrum.and.bass\b|\bdnb\b/i, tags: ["drum_and_bass"] },
  { pattern: /\btrance\b/i, tags: ["trance"] },
  { pattern: /\bafrobeats?\b|\bafropop\b/i, tags: ["afrobeats"] },
  { pattern: /\buk\s*garage\b|\b2.?step\b|\bgrime\b/i, tags: ["garage_uk"] },
  { pattern: /\bunderground\b/i, tags: ["underground_dance"] },

  // ── Category fallbacks (lowest confidence) ────────────────────────────────
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
// Curated entity names that Meta reliably resolves as interests.
// Searched directly via /search?type=adinterest.

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
    "Ministry of Sound", "Defected Records", "Kerri Chandler",
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
    "Oscar Mulero", "Trym", "Phase (artist)",
    "hard techno", "industrial techno",
  ],
  hardcore: [
    "Q-Dance", "Defqon.1", "Noisecontrollers",
    "Coone", "Headhunterz", "Hardstyle music",
    "gabber music", "Thunderdome", "hardcore music",
  ],
  psy_trance: [
    "psytrance", "Goa trance", "Infected Mushroom",
    "Astrix", "Ozora Festival", "Spirit Festival",
    "Shpongle", "Ott (musician)",
  ],
  queer_underground: [
    "queer clubbing", "LGBTQ nightlife",
    "Pxssy Palace", "Body Movements Festival",
    "ballroom culture", "vogue ball",
    "queer rave",
  ],
  avant_garde_fashion: [
    "Maison Margiela", "Raf Simons", "Comme des Garçons",
    "Rick Owens", "Yohji Yamamoto", "Ann Demeulemeester",
    "Damir Doma", "Alexander Wang (designer)",
    "Balenciaga (fashion brand)", "avant-garde fashion",
  ],
  editorial_fashion: [
    "Dazed & Confused (magazine)", "i-D (magazine)", "Another Magazine",
    "V Magazine", "METAL Magazine", "System Magazine",
    "Garage Magazine", "032c", "Tank Magazine",
    "GQ", "Vogue (magazine)",
  ],
  dance_media: [
    "Mixmag", "Resident Advisor", "DJ Mag",
    "Boiler Room", "Red Bull Music Academy", "FACT Magazine",
  ],
  rave_fashion: [
    "Palace Skateboards", "Carhartt WIP", "Stüssy",
    "Off-White", "Chrome Hearts", "Raf Simons",
    "festival fashion", "rave clothing",
  ],
};

// ── Cluster scene filter ──────────────────────────────────────────────────────
// Only scene tags in the allowed list contribute entity terms for a cluster.

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

// ── Cluster path patterns ─────────────────────────────────────────────────────
// Meta returns an interest `path` array like ["Music", "Electronic music"].
// These patterns match path/name text to boost relevance score for the cluster.

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

// ── Cluster curated seeds ─────────────────────────────────────────────────────
// Generic cluster seeds merged AFTER entity expansion.
// These provide a quality floor when no scene tags are detected.

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

// ── Cluster hard blocklists ───────────────────────────────────────────────────

const CLUSTER_BLOCKLIST: Record<string, RegExp[]> = {
  "Music & Nightlife": [
    /\b(video.?game|gaming|esport|gamer|fortnite|minecraft|call.of.duty|league.of.legends|counter.strike|dota|hearthstone|overwatch|roblox|valorant)\b/i,
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

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageContextItem {
  name: string;
  category?: string;
  instagramUsername?: string;
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
  /** Scene tags detected from the selected pages — useful for debug / UI display */
  detectedSceneTags: string[];
  totalFound: number;
}

// ── City → scene tag mapping ──────────────────────────────────────────────────

const CITY_SCENE_MAP: Record<string, SceneTag> = {
  London: "london_scene",
  Manchester: "london_scene",
  Bristol: "london_scene",
  Glasgow: "london_scene",
  Edinburgh: "london_scene",
  Leeds: "london_scene",
  Liverpool: "london_scene",
  Berlin: "berlin_scene",
  Hamburg: "berlin_scene",
  Ibiza: "ibiza_scene",
  Amsterdam: "amsterdam_scene",
  "New York": "nyc_scene",
  Chicago: "nyc_scene",
  Detroit: "nyc_scene",
  Miami: "nyc_scene",
};

const KNOWN_CITIES = Object.keys(CITY_SCENE_MAP);

function findCity(name: string): string | null {
  for (const city of KNOWN_CITIES) {
    if (new RegExp(`\\b${city}\\b`, "i").test(name)) return city;
  }
  return null;
}

// ── Stage 1: classifyPages ────────────────────────────────────────────────────
// Accumulates scene tags from all pages by running every classifier rule.

function classifyPages(pages: PageContextItem[]): Set<SceneTag> {
  const tags = new Set<SceneTag>();

  for (const page of pages) {
    for (const rule of ENTITY_CLASSIFIERS) {
      const nameMatch =
        !rule.pattern ||
        rule.pattern.test(page.name) ||
        rule.pattern.test(page.instagramUsername ?? "");
      const catMatch =
        !rule.categories ||
        rule.categories.includes(page.category ?? "");

      // For category-only rules, require no pattern — match category alone.
      // For pattern rules, the category is optionally required in addition.
      const matched = rule.pattern
        ? nameMatch && (rule.categories ? catMatch : true)
        : catMatch;

      if (matched) {
        for (const t of rule.tags) tags.add(t);
      }
    }

    // City detection → city scene tag
    const city = findCity(page.name);
    if (city) {
      const sceneTag = CITY_SCENE_MAP[city];
      if (sceneTag) tags.add(sceneTag);
    }
  }

  return tags;
}

// ── Stage 2: buildClusterTerms ────────────────────────────────────────────────
// Converts detected scene tags into Meta entity search terms for a given cluster.
// Entity terms from the knowledge base come first; curated seeds are appended.

const MAX_TERMS_PER_CLUSTER = 24;

function buildClusterTerms(
  sceneTags: Set<SceneTag>,
  clusterLabel: string,
): string[] {
  const allowed = new Set(CLUSTER_SCENE_FILTER[clusterLabel] ?? []);
  const terms = new Set<string>();

  // Entity terms from scene knowledge base (filtered to cluster's allowed tags)
  for (const tag of sceneTags) {
    if (!allowed.has(tag)) continue;
    for (const entity of SCENE_ENTITY_MAP[tag] ?? []) {
      terms.add(entity);
    }
  }

  // Append curated seeds (generic quality floor)
  for (const s of CURATED_SEEDS[clusterLabel] ?? []) {
    terms.add(s);
  }

  return [...terms].slice(0, MAX_TERMS_PER_CLUSTER);
}

// ── Stage 3: Meta interest search ────────────────────────────────────────────

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

// ── Stage 4: Blocklist filter ─────────────────────────────────────────────────

function passesBlocklist(
  interest: { name: string; path?: string[] },
  clusterLabel: string,
): boolean {
  const patterns = CLUSTER_BLOCKLIST[clusterLabel] ?? [];
  if (patterns.length === 0) return true;
  const text = [interest.name, ...(interest.path ?? [])].join(" ");
  return !patterns.some((p) => p.test(text));
}

// ── Stage 5: Relevance scoring ────────────────────────────────────────────────
//
// Points:
//   +30  Meta path contains cluster-relevant category keyword
//   +15  Interest name contains a term from the scene entity map
//   +5   Audience size ≥ 1 M
//   +log10(audience_size) tiebreaker

function buildSceneKeywords(sceneTags: Set<SceneTag>): Set<string> {
  const kws = new Set<string>();
  for (const tag of sceneTags) {
    for (const entity of SCENE_ENTITY_MAP[tag] ?? []) {
      // Use individual significant words from entity names
      for (const word of entity.split(/\s+/)) {
        if (word.length >= 4) kws.add(word.toLowerCase());
      }
    }
  }
  return kws;
}

function scoreInterest(
  interest: RawInterest,
  clusterLabel: string,
  sceneKeywords: Set<string>,
): number {
  let score = 0;

  // Path relevance
  const pathPattern = CLUSTER_PATH_PATTERNS[clusterLabel];
  if (pathPattern) {
    const text = [interest.name, ...(interest.path ?? [])].join(" ");
    if (pathPattern.test(text)) score += 30;
  }

  // Scene entity name alignment
  const nameLower = interest.name.toLowerCase();
  for (const kw of sceneKeywords) {
    if (nameLower.includes(kw)) {
      score += 15;
      break; // only count once per interest
    }
  }

  // Audience size bonus
  const size = interest.audience_size ?? 0;
  if (size >= 1_000_000) score += 5;
  score += Math.log10(size + 1) * 2;

  return score;
}

// ── Cluster description map ───────────────────────────────────────────────────

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
  sceneTags: Set<SceneTag>,
  token: string,
  globalSeen: Set<string>,
): Promise<{ cluster: DiscoverCluster; termsUsed: string[]; removedCount: number }> {
  const allTerms = buildClusterTerms(sceneTags, clusterLabel);
  const sceneKeywords = buildSceneKeywords(sceneTags);

  console.info(
    `[interest-discover] cluster="${clusterLabel}" entity terms (${allTerms.length}):`,
    allTerms.join(", "),
  );

  // Search Meta in batches of 4 (parallel per batch)
  const raw: (RawInterest & { searchTerm: string })[] = [];
  const BATCH = 4;
  for (let i = 0; i < allTerms.length; i += BATCH) {
    const batch = allTerms.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((t) => searchMeta(token, t)));
    for (let j = 0; j < batch.length; j++) {
      for (const item of results[j]) {
        if (!globalSeen.has(item.id)) {
          globalSeen.add(item.id);
          raw.push({ ...item, searchTerm: batch[j] });
        }
      }
    }
  }

  // Blocklist filter
  const filtered = raw.filter((i) => passesBlocklist(i, clusterLabel));
  const removedCount = raw.length - filtered.length;

  if (removedCount > 0) {
    console.info(
      `[interest-discover] cluster="${clusterLabel}" blocked ${removedCount}:`,
      raw
        .filter((i) => !passesBlocklist(i, clusterLabel))
        .map((i) => i.name)
        .join(", "),
    );
  }

  // Score + sort + cap at 6
  const scored = filtered.map((i) => ({
    id: i.id,
    name: i.name,
    audienceSize: i.audience_size,
    path: i.path,
    searchTerm: i.searchTerm,
    relevanceScore: scoreInterest(i, clusterLabel, sceneKeywords),
  }));

  const interests = scored
    .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
    .slice(0, 6);

  console.info(
    `[interest-discover] cluster="${clusterLabel}" final (${interests.length}):`,
    interests.map((i) => `${i.name} [${i.relevanceScore?.toFixed(1)}]`).join(", "),
  );

  return {
    cluster: {
      label: clusterLabel,
      description: CLUSTER_DESCRIPTIONS[clusterLabel] ?? clusterLabel,
      interests,
    },
    termsUsed: allTerms,
    removedCount,
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

  let body: { pageContext?: unknown; campaignName?: unknown; clusterLabel?: unknown; sceneHints?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pages = (
    Array.isArray(body.pageContext) ? body.pageContext : []
  ) as PageContextItem[];
  const clusterLabel =
    typeof body.clusterLabel === "string" ? body.clusterLabel.trim() : undefined;

  // sceneHints: array of scene tag strings the user manually specifies to bias discovery
  const rawHints: string[] = Array.isArray(body.sceneHints)
    ? (body.sceneHints as unknown[]).filter((h): h is string => typeof h === "string")
    : [];

  if (pages.length === 0 && !body.campaignName) {
    return NextResponse.json(
      { error: "Provide at least one page or a campaign name" },
      { status: 400 },
    );
  }

  if (clusterLabel && !CLUSTER_DESCRIPTIONS[clusterLabel]) {
    return NextResponse.json(
      {
        error: `Unknown cluster label "${clusterLabel}". Valid: ${ALL_CLUSTER_LABELS.join(", ")}`,
      },
      { status: 400 },
    );
  }

  // Stage 1: classify pages → scene tags
  const sceneTags = classifyPages(pages);

  // Apply manual scene hints — treat known tags directly, use as search terms for unknown
  const hintTagsApplied: string[] = [];
  for (const hint of rawHints) {
    const normalized = hint.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (ALL_SCENE_TAGS.has(normalized as SceneTag)) {
      sceneTags.add(normalized as SceneTag);
      hintTagsApplied.push(normalized);
    }
  }

  const detectedSceneTags = [...sceneTags];
  if (hintTagsApplied.length > 0) {
    console.info(`[interest-discover] sceneHints applied: ${hintTagsApplied.join(", ")}`);
  }

  console.info(
    `[interest-discover] mode=${clusterLabel ? `single:${clusterLabel}` : "all"}, ` +
      `${pages.length} pages → scene tags: ${detectedSceneTags.join(", ") || "(none — using curated seeds only)"}`,
  );

  // Stage 2–5: discover per cluster
  const targetLabels = clusterLabel ? [clusterLabel] : ALL_CLUSTER_LABELS;
  const globalSeen = new Set<string>();
  const clusterSeeds: Record<string, string[]> = {};
  const clusters: DiscoverCluster[] = [];

  for (const label of targetLabels) {
    const { cluster, termsUsed } = await discoverForCluster(
      label,
      sceneTags,
      token,
      globalSeen,
    );
    clusterSeeds[label] = termsUsed;
    if (cluster.interests.length > 0) clusters.push(cluster);
  }

  const searchTermsUsed = [...new Set(Object.values(clusterSeeds).flat())];

  console.info(
    `[interest-discover] done — ${globalSeen.size} unique interests seen, ` +
      `${clusters.length} clusters with results: ` +
      clusters.map((c) => `${c.label}:${c.interests.length}`).join(", "),
  );

  return NextResponse.json({
    clusters,
    clusterSeeds,
    searchTermsUsed,
    detectedSceneTags,
    totalFound: globalSeen.size,
  } satisfies DiscoverResponse);
}
