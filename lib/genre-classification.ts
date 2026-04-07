/**
 * Genre Classification Engine
 *
 * Classifies Facebook pages into Beatport-style genre buckets using a
 * curated seed dictionary. Pure client-side — no API calls, no latency.
 */

import type { MetaApiPage } from "@/lib/types";

// ─── Bucket Identifiers ────────────────────────────────────────────────────

export type GenreBucket =
  | "techno_peak"           // Techno (peak time / driving)
  | "techno_raw"            // Techno (raw / deep / hypnotic)
  | "melodic_house_techno"  // Melodic House & Techno
  | "progressive_house"     // Progressive House
  | "amapiano_afro_house"   // Amapiano & Afro House
  | "underground_house"     // Underground House (minimal / deep tech)
  | "deep_house"            // Deep House
  | "classic_house"         // Classic House
  | "disco_nu_disco"        // Disco / Nu Disco
  | "tech_house"            // Tech House
  | "trance"                // Trance
  | "140_garage_grime"      // 140 / Garage / Grime / Dubstep / Bass / Trap / Bassline
  | "breaks_breakbeat"      // Breaks / Breakbeat / UK Bass
  | "dance_pop_commercial"  // Dance / Pop / Commercial House
  | "drum_and_bass";        // Drum & Bass

export const ALL_GENRE_BUCKETS: GenreBucket[] = [
  "techno_peak",
  "techno_raw",
  "melodic_house_techno",
  "progressive_house",
  "amapiano_afro_house",
  "underground_house",
  "deep_house",
  "classic_house",
  "disco_nu_disco",
  "tech_house",
  "trance",
  "140_garage_grime",
  "breaks_breakbeat",
  "dance_pop_commercial",
  "drum_and_bass",
];

export const GENRE_LABELS: Record<GenreBucket, string> = {
  techno_peak:          "Techno (Peak Time)",
  techno_raw:           "Techno (Raw / Deep)",
  melodic_house_techno: "Melodic House & Techno",
  progressive_house:    "Progressive House",
  amapiano_afro_house:  "Amapiano & Afro House",
  underground_house:    "Underground House",
  deep_house:           "Deep House",
  classic_house:        "Classic House",
  disco_nu_disco:       "Disco / Nu Disco",
  tech_house:           "Tech House",
  trance:               "Trance",
  "140_garage_grime":   "140 / Garage / Grime",
  breaks_breakbeat:     "Breaks / Breakbeat",
  dance_pop_commercial: "Dance / Pop",
  drum_and_bass:        "Drum & Bass",
};

// Tailwind classes for genre chips (bg + text)
export const GENRE_COLORS: Record<GenreBucket, string> = {
  techno_peak:          "bg-zinc-800 text-zinc-100",
  techno_raw:           "bg-zinc-700 text-zinc-100",
  melodic_house_techno: "bg-violet-700 text-violet-100",
  progressive_house:    "bg-indigo-600 text-indigo-100",
  amapiano_afro_house:  "bg-amber-600 text-amber-100",
  underground_house:    "bg-slate-600 text-slate-100",
  deep_house:           "bg-blue-700 text-blue-100",
  classic_house:        "bg-orange-600 text-orange-100",
  disco_nu_disco:       "bg-pink-600 text-pink-100",
  tech_house:           "bg-teal-600 text-teal-100",
  trance:               "bg-purple-600 text-purple-100",
  "140_garage_grime":   "bg-green-700 text-green-100",
  breaks_breakbeat:     "bg-lime-600 text-lime-100",
  dance_pop_commercial: "bg-sky-500 text-sky-100",
  drum_and_bass:        "bg-red-700 text-red-100",
};

// ─── Seed Dictionary ───────────────────────────────────────────────────────

interface BucketSeeds {
  /** Broad descriptive keywords — matched against page name + IG handle */
  keywords: string[];
  /** Specific artist / DJ names — high confidence signal */
  artists: string[];
  /** Record labels — medium-high confidence signal */
  labels: string[];
  /** Events, festivals, clubs — medium confidence signal */
  events: string[];
}

const SEEDS: Record<GenreBucket, BucketSeeds> = {

  // ── Techno (peak time / driving) ─────────────────────────────────────────
  techno_peak: {
    keywords: [
      "peak time techno", "driving techno", "hard techno", "industrial techno",
      "raw techno", "fast techno", "hard dance", "dark techno", "pumping techno",
    ],
    artists: [
      "Charlotte de Witte", "Amelie Lens", "Enrico Sangiuliano", "Chris Liebing",
      "Len Faki", "Svreca", "Alignment", "KI/KI", "SPFDJ", "Kobosil", "Reinier Zonneveld",
      "Sara Landry", "Speedy J", "Paula Temple", "Ancient Methods", "Surgeon",
      "Blawan", "Rebekah", "Dax J", "Truncate", "Phase",
      "Etapp Kyle", "SDH", "Developer", "Klaudia Gawlas", "Alignment",
      "Fury", "Slam", "Planetary Assault System", "Marco Faraone",
    ],
    labels: [
      "KNTXT", "EXHALE", "Mord", "Figure", "Pole Group", "Infrastructure",
      "Primate", "Token Records", "CLR", "Generator", "Tresor",
      "Repitch", "Soma Records", "Novamute",
    ],
    events: [
      "Awakenings", "Verknipt", "Junction 2", "Bassiani",
      "Tresor", "De School", "Hessle Audio", "fabric",
      "Sonar", "Dekmantel", "Movement", "Khidi",
    ],
  },

  // ── Techno (raw / deep / hypnotic) ────────────────────────────────────────
  techno_raw: {
    keywords: [
      "hypnotic techno", "berlin techno", "underground techno", "dark techno",
      "dub techno", "warehouse techno", "modular techno", "acid techno",
      "deep techno", "minimal techno",
    ],
    artists: [
      "Ben Klock", "DVS1", "Rødhåd", "Oscar Mulero", "Dj Nobu", "Psyk",
      "Regis", "Surgeon", "Perc", "Lucy", "Stroboscopic Artefacts",
      "Donato Dozzy", "Neel", "Varg", "Gesloten Cirkel", "Mike Parker",
      "Dj Stingray", "Regis", "Inigo Kennedy", "Shifted",
      "Truss", "Headless Horseman", "Orphx", "Karl OConnor",
      "Ancient Methods", "Phase Fatale", "Blawan",
    ],
    labels: [
      "Ostgut Ton", "Klockworks", "Blueprint", "Stroboscopic Artefacts",
      "Prologue Records", "Semantica Records", "Eerie Recordings",
      "Creme Organization", "Black Vinyl", "Horizontal Ground",
    ],
    events: [
      "Berghain", "Fuse Brussels", "Vault Sessions", "Hoppetosse",
      "Analog Room", "Industrial Copera", "Concrete Paris",
      "Voltage Musette", "Shelter Amsterdam",
    ],
  },

  // ── Melodic House & Techno ────────────────────────────────────────────────
  melodic_house_techno: {
    keywords: [
      "melodic techno", "melodic house", "organic house", "ethereal techno",
      "melodic progressive", "dark progressive", "cinematic techno",
    ],
    artists: [
      "Tale Of Us", "Adriatique", "Stephan Bodzin", "Worakls", "Mind Against",
      "Innellea", "Mano Le Tough", "WhoMadeWho", "Massano", "Recondite",
      "Romain Garcia", "SHDW", "Orphx", "Fur Coat", "Agents Of Time",
      "Mathame", "Yokoo", "Colyn", "Yotto", "Maeve", "Kamran Sadeghi",
      "Guy Gerber", "Agoria", "Stimming", "Nils Hoffmann", "Rufus Du Sol",
      "Maceo Plex", "Gui Boratto",
    ],
    labels: [
      "Afterlife", "Cercle", "Kompakt", "Get Physical", "Sol Selectas",
      "Diynamic", "Embassy One", "Crosstown Rebels", "Stil vor Talent",
      "Life and Death", "Watergate Records",
    ],
    events: [
      "Afterlife", "Cercle", "Watergate", "Day Zero", "Burning Man",
      "Neopop", "Sónar", "Fusion Festival",
    ],
  },

  // ── Progressive House ─────────────────────────────────────────────────────
  progressive_house: {
    keywords: [
      "progressive house", "progressive trance", "epic house", "big room progressive",
      "orchestral progressive", "emotional house",
    ],
    artists: [
      "Eric Prydz", "Deadmau5", "Lane 8", "Marsh", "Andrew Bayer",
      "Yotto", "Cubicolor", "Myon", "Tritonal", "Thomas Gold",
      "Sultan Shepard", "Kyau Albert", "Feed Me", "Pryda",
      "CIREZ D", "Anjunadeep DJs", "Seven Lions", "BT",
      "Sasha", "John Digweed", "Nick Warren", "Hernan Cattaneo",
    ],
    labels: [
      "Anjunadeep", "Anjunabeats", "Protocol", "Mau5trap", "Bedrock",
      "Renaissance Records", "Global Underground", "Balance Music",
    ],
    events: [
      "ABGT", "Group Therapy Radio", "Tomorrowland", "Creamfields",
      "Beats for Love", "A State of Trance",
    ],
  },

  // ── Amapiano & Afro House ─────────────────────────────────────────────────
  amapiano_afro_house: {
    keywords: [
      "amapiano", "afro house", "afro tech", "afro deep", "afrobeats",
      "south african house", "kwaito", "deep afro", "log drum",
    ],
    artists: [
      "Kabza De Small", "DJ Maphorisa", "Black Coffee", "Enoo Napa",
      "Uncle Waffles", "DBN Gogo", "Major League DJz", "Themba",
      "Culoe De Song", "Djeff", "Manoo", "Black Motion", "Lemon Pepper Freestyle",
      "Da Capo", "Christos", "Soulistic Music", "Louie Vega",
      "Dave", "Nakhane", "Afrotraction", "Sun El Musician",
    ],
    labels: [
      "PTX Music", "Somewhere Somehow", "Platoon Africa", "Afrocentric",
      "Soulistic", "Naked Music", "Open Bar Music", "Offering Recordings",
    ],
    events: [
      "Boiler Room Johannesburg", "Afropunk", "One City Festival",
      "Sun Music Festival", "Ultra South Africa",
    ],
  },

  // ── Underground House (minimal / deep tech) ──────────────────────────────
  underground_house: {
    keywords: [
      "minimal house", "deep tech", "rominimal", "microhouse", "minimal techno house",
      "deep minimal", "experimental house", "lo-fi house",
    ],
    artists: [
      "Raresh", "Ricardo Villalobos", "Roman Flügel", "Âme", "Dixon",
      "Zip", "Lawrence", "DJ Nobu", "Move D", "Mathew Jonson",
      "Luciano", "Dandy Jack", "Isolee", "Chris Watson",
      "Petre Inspirescu", "Rhadoo", "Cezar", "Nok In The Box",
      "Martyn", "Omar-S", "Kyle Hall", "John Dimas",
    ],
    labels: [
      "Cadenza", "Perlon", "Wagon Repair", "Giegling", "R&S Records",
      "Delsin", "Rush Hour", "Clone Records", "Smallville Records",
    ],
    events: [
      "Fabric London", "Movement Detroit", "Warp", "Unsound",
      "Dekmantel", "Boiler Room", "RBMA", "Rex Paris",
    ],
  },

  // ── Deep House ────────────────────────────────────────────────────────────
  deep_house: {
    keywords: [
      "deep house", "soulful house", "spiritual house", "jackin house",
      "raw deep house", "new deep house", "organic deep house",
    ],
    artists: [
      "Larry Heard", "Kerri Chandler", "DJ Spen", "Kai Alce",
      "Moodymann", "Kyle Hall", "Delano Smith", "Francisco", "Gene Hunt",
      "Theo Parrish", "Heidi", "Ron Trent", "Mr G",
      "Gemini", "Amp Fiddler", "Ten City", "Andres",
      "Domu", "Terranova", "Franck Roger", "Kenny Dope",
    ],
    labels: [
      "Defected Records", "Classic Music Company", "Strictly Rhythm",
      "Trax Records", "D1 Recordings", "4 To The Floor",
      "King Street Sounds", "Harmless Records",
    ],
    events: [
      "Panorama Bar", "fabric", "Shelter New York", "Smart Bar Chicago",
      "Southport Weekender", "Deep Space New York",
    ],
  },

  // ── Classic House ─────────────────────────────────────────────────────────
  classic_house: {
    keywords: [
      "classic house", "chicago house", "old school house", "acid house",
      "warehouse house", "gospel house", "vocal house", "soulful classics",
    ],
    artists: [
      "Larry Levan", "Ron Hardy", "Frankie Knuckles", "Marshall Jefferson",
      "Larry Heard", "Jesse Saunders", "Jamie Principle", "Ten City",
      "Robert Owens", "Lil Louis", "Todd Terry", "Armando",
      "Ralphi Rosario", "Farley Jackmaster Funk", "Fast Eddie",
      "Joe Smooth", "Fingers Inc", "Darryl Pandy",
    ],
    labels: [
      "Trax Records", "DJ International", "Hot Mix 5", "Nervous Records",
      "Champion Records", "Strictly Rhythm", "Subterranean Records",
    ],
    events: [
      "The Warehouse Chicago", "Paradise Garage", "Music Box",
      "Winter Music Conference", "Heritage celebrations",
    ],
  },

  // ── Disco / Nu Disco ────────────────────────────────────────────────────
  disco_nu_disco: {
    keywords: [
      "disco", "nu disco", "funk", "boogie", "cosmic disco", "italo disco",
      "nu-disco", "space disco", "balearic", "french touch",
    ],
    artists: [
      "Daft Punk", "Lindstrøm", "Todd Terje", "Tensnake", "Poolside",
      "Purple Disco Machine", "Catz 'N Dogz", "Joey Negro", "Horse Meat Disco",
      "Dimitri From Paris", "Joss Moog", "Nile Rodgers", "Chic",
      "Kurtis Blow", "Larry Levan", "Theo Parrish", "Hunee",
      "Dam Swindle", "Antal", "Floating Points",
    ],
    labels: [
      "Glitterbox", "Midnight Riot", "Discotexas", "Permanent Vacation",
      "Paper Recordings", "Tirk Records", "Bordello a Parigi",
    ],
    events: [
      "Glitterbox Ibiza", "Defected Croatia", "Lovebox",
      "Hideout Festival", "Festival Soul",
    ],
  },

  // ── Tech House ────────────────────────────────────────────────────────────
  tech_house: {
    keywords: [
      "tech house", "techno house", "groove tech", "funky tech", "sexy tech",
      "tribal tech house", "tech funk",
    ],
    artists: [
      "Carl Cox", "Fisher", "Camelphat", "Solardo", "Eli Brown",
      "Kevin Saunderson", "Walker & Royce", "Patrick Topping", "Detlef",
      "Marco Carola", "Butch", "Sidney Charles", "Chris Stussy",
      "Paul Woolford", "HAAi", "Skream", "Route 94", "Dense & Pika",
      "Sam Paganini", "Layton Giordani", "Gorgon City",
      "Hot Since 82", "Danny Howard",
    ],
    labels: [
      "Toolroom Records", "Hot Creations", "Relief Records", "Solid Grooves",
      "Elrow Music", "Defected", "DFTD", "Kneaded Pains",
      "From The Vaults", "Repopulate Mars", "REALM",
    ],
    events: [
      "Space Ibiza", "DC10 Ibiza", "Pacha Ibiza", "Elrow",
      "Egg London", "Printworks London", "Motion Bristol",
      "We Are FSTVL",
    ],
  },

  // ── Trance ────────────────────────────────────────────────────────────────
  trance: {
    keywords: [
      "trance", "uplifting trance", "psytrance", "goa trance", "melodic trance",
      "psy trance", "full-on trance", "dark psy", "progressive trance",
      "vocal trance", "epic trance", "hi-nrg trance",
    ],
    artists: [
      "Armin van Buuren", "Paul van Dyk", "Ferry Corsten", "Above & Beyond",
      "Cosmic Gate", "ATB", "Markus Schulz", "Aly & Fila",
      "Simon Patterson", "Bryan Kearney", "John O'Callaghan",
      "Tiesto", "Gareth Emery", "Andrew Rayel", "Dash Berlin",
      "Ben Gold", "Solarstone", "Joseph Capriati", "Infected Mushroom",
      "Astrix", "Vini Vici", "Freedom Fighters",
    ],
    labels: [
      "Anjunabeats", "A State of Trance", "FSOE", "Armada Music",
      "Black Hole Recordings", "Enhanced Music", "Monster Tunes",
      "Subculture", "Pure Trance",
    ],
    events: [
      "A State of Trance", "Transmission", "Luminosity Beach Festival",
      "Dreamstate", "Trancemission", "Spirit of Trance",
    ],
  },

  // ── 140 / Garage / Grime / Dubstep / Bass / Trap / Bassline ─────────────
  "140_garage_grime": {
    keywords: [
      "uk garage", "ukg", "2-step", "grime", "dubstep", "bass music",
      "bassline", "trap", "uk bass", "140 bpm", "footwork", "juke",
      "drill", "uk drill", "funky house garage",
    ],
    artists: [
      "Craig David", "So Solid Crew", "Skream", "Benga", "Wiley", "Skepta",
      "DJ Zinc", "El-B", "Wookie", "MJ Cole", "Oxide Neutrino",
      "Hatcha", "Digital Mystikz", "Mala", "Coki", "Kode9",
      "Jamie xx", "Joy Orbison", "Hessle Audio crew",
      "Joker", "Gemmy", "Zomby", "Rustie", "Katy B",
      "Devlin", "Dizzee Rascal", "Stormzy", "Dave", "AJ Tracey",
    ],
    labels: [
      "Boy Better Know", "Tempa", "Deep Medi Musik", "Big Apple Records",
      "Butterz", "R&S Records", "Hyperdub", "1Xtra", "XL Recordings",
    ],
    events: [
      "FWD>> London", "Plastic People", "Rinse FM", "Eskimo Dance",
      "Roll Deep events", "Grime Originals",
    ],
  },

  // ── Breaks / Breakbeat / UK Bass ─────────────────────────────────────────
  breaks_breakbeat: {
    keywords: [
      "breaks", "breakbeat", "big beat", "nu skool breaks", "electro breaks",
      "funky breaks", "uk bass", "broken beats", "juke",
    ],
    artists: [
      "The Prodigy", "Leftfield", "Plump DJs", "Stanton Warriors",
      "Hybrid Minds", "Chemical Brothers", "Fatboy Slim",
      "Adam Freeland", "BeatFreakz", "Freq Nasty",
      "DJ Rogue", "Lo-Fi Fnk", "Bassbin Twins",
      "Overseer", "Elite Force", "Aquasky",
    ],
    labels: [
      "Skint Records", "Southern Fried Records", "Wall of Sound",
      "XL Recordings", "Monstrous", "Finger Lickin Records",
    ],
    events: [
      "Fabric breaks nights", "Glastonbury Dance Stage",
      "Big Beach Boutique", "Essential Selection",
    ],
  },

  // ── Dance / Pop / Commercial House ───────────────────────────────────────
  dance_pop_commercial: {
    keywords: [
      "commercial house", "pop dance", "edm", "radio dance", "big room house",
      "festival edm", "electro house", "progressive edm",
      "stadium edm", "mainstream house",
    ],
    artists: [
      "Calvin Harris", "David Guetta", "Kygo", "Robin Schulz",
      "Martin Garrix", "Avicii", "Zedd", "Tiësto", "KSHMR",
      "Dimitri Vegas", "Steve Angello", "Swedish House Mafia",
      "Alesso", "Nicky Romero", "Hardwell", "DJ Snake",
      "Major Lazer", "Afrojack", "Diplo", "Duke Dumont",
    ],
    labels: [
      "Ultra Records", "CR2 Records", "Positiva Records", "Ministry of Sound",
      "Spinnin Records", "STMPD Records", "Heldeep Records",
      "Armada Music", "Musical Freedom",
    ],
    events: [
      "Ultra Music Festival", "Tomorrowland", "EDC", "Creamfields",
      "Parookaville", "S2O Songkran", "Capital FM events",
    ],
  },

  // ── Drum & Bass ──────────────────────────────────────────────────────────
  drum_and_bass: {
    keywords: [
      "drum and bass", "dnb", "jungle", "neurofunk", "liquid dnb",
      "liquid drum and bass", "rollers", "halftime", "techstep",
      "jump up", "intelligent dnb", "atmospheric dnb",
    ],
    artists: [
      "Goldie", "LTJ Bukem", "Andy C", "Chase & Status", "Sub Focus",
      "Camo & Krooked", "Noisia", "Pendulum", "Netsky", "Maduk",
      "Logistics", "High Contrast", "Need For Mirrors", "Total Science",
      "Dj Hype", "Friction", "DJ Fresh", "Calyx & Teebee",
      "Spectrasoul", "Seba", "Calibre", "dBridge",
    ],
    labels: [
      "Hospital Records", "RAM Records", "Metalheadz", "Liquid V",
      "Med School Music", "Shogun Audio", "Critical Music",
      "Dispatch Recordings", "Spearhead Records",
    ],
    events: [
      "Hospitality on the Beach", "Ram Records events", "Metalheadz Sundays",
      "Let It Roll", "Hospitality Festival", "Outlook Festival",
    ],
  },
};

// ─── Classification Types ──────────────────────────────────────────────────

export interface PageGenreClassification {
  pageId: string;
  /** Top genre (highest score) */
  primaryBucket?: GenreBucket;
  secondaryBucket?: GenreBucket;
  tertiaryBucket?: GenreBucket;
  /** Raw score per bucket (0 = no match) */
  scores: Partial<Record<GenreBucket, number>>;
  /** Which seed terms triggered the match (for debugging) */
  matchedSignals: string[];
  /** True if the user overrode the auto-classification */
  isManualOverride: boolean;
  classifiedAt: string; // ISO timestamp
}

// ─── Classification Engine ─────────────────────────────────────────────────

/** Weights for each seed type */
const W_ARTIST  = 10;
const W_LABEL   = 6;
const W_EVENT   = 5;
const W_KEYWORD = 3;

function scoreAgainst(
  text: string,
  seeds: BucketSeeds,
): { score: number; matched: string[] } {
  const lower = text.toLowerCase();
  let score = 0;
  const matched: string[] = [];

  for (const kw of seeds.keywords) {
    if (lower.includes(kw.toLowerCase())) {
      score += W_KEYWORD;
      matched.push(kw);
    }
  }
  for (const artist of seeds.artists) {
    if (lower.includes(artist.toLowerCase())) {
      score += W_ARTIST;
      matched.push(artist);
    }
  }
  for (const label of seeds.labels) {
    if (lower.includes(label.toLowerCase())) {
      score += W_LABEL;
      matched.push(label);
    }
  }
  for (const ev of seeds.events) {
    if (lower.includes(ev.toLowerCase())) {
      score += W_EVENT;
      matched.push(ev);
    }
  }

  return { score, matched };
}

/**
 * Classify a single Facebook page into up to 3 genre buckets.
 * Runs purely client-side with no external calls.
 */
export function classifyPage(page: MetaApiPage): PageGenreClassification {
  // Build a search corpus from available page signals
  const corpus = [
    page.name,
    page.instagramUsername ?? "",
    page.category ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const scores: Partial<Record<GenreBucket, number>> = {};
  const allMatched: string[] = [];

  for (const bucket of ALL_GENRE_BUCKETS) {
    const { score, matched } = scoreAgainst(corpus, SEEDS[bucket]);
    if (score > 0) {
      scores[bucket] = score;
      allMatched.push(...matched.map((m) => `[${GENRE_LABELS[bucket]}] ${m}`));
    }
  }

  // Sort buckets by score descending
  const ranked = (Object.entries(scores) as [GenreBucket, number][]).sort(
    ([, a], [, b]) => b - a,
  );

  const [first, second, third] = ranked;

  if (process.env.NODE_ENV === "development" && ranked.length > 0) {
    console.debug(
      `[genre-classify] ${page.name}`,
      ranked.slice(0, 3).map(([b, s]) => `${GENRE_LABELS[b]}=${s}`).join(" | "),
      "signals:", allMatched.slice(0, 5).join(", "),
    );
  }

  return {
    pageId: page.id,
    primaryBucket:   first?.[0],
    secondaryBucket: second?.[0],
    tertiaryBucket:  third?.[0],
    scores,
    matchedSignals: allMatched,
    isManualOverride: false,
    classifiedAt: new Date().toISOString(),
  };
}

/**
 * Classify an array of pages, returning a map from page ID to classification.
 * Already-classified pages (non-override) are skipped to preserve performance.
 */
export function classifyPages(
  pages: MetaApiPage[],
  existing: Record<string, PageGenreClassification> = {},
): Record<string, PageGenreClassification> {
  const result: Record<string, PageGenreClassification> = { ...existing };

  for (const page of pages) {
    // Skip if already classified and not a forced re-run
    if (result[page.id] && !result[page.id].isManualOverride) {
      // Re-classify if the page has new enrichment data (IG handle now available)
      const prev = result[page.id];
      const hadIg = prev.matchedSignals.some((s) => s.includes("@") || s.toLowerCase().includes("ig"));
      if (!hadIg && !page.instagramUsername) continue; // no new signal, skip
    }

    result[page.id] = classifyPage(page);
  }

  return result;
}

/**
 * Get all pages that match ANY of the provided genre buckets (union logic).
 */
export function filterPagesByGenres(
  pages: MetaApiPage[],
  activeGenres: GenreBucket[],
  classifications: Record<string, PageGenreClassification>,
): MetaApiPage[] {
  if (activeGenres.length === 0) return pages;

  const genreSet = new Set(activeGenres);

  return pages.filter((page) => {
    const c = classifications[page.id];
    if (!c) return false;
    return (
      (c.primaryBucket   && genreSet.has(c.primaryBucket))   ||
      (c.secondaryBucket && genreSet.has(c.secondaryBucket)) ||
      (c.tertiaryBucket  && genreSet.has(c.tertiaryBucket))
    );
  });
}

/**
 * Returns a count map: genre bucket → number of pages classified into it
 * (a page is counted once even if it appears in secondary/tertiary).
 */
export function buildGenrePageCounts(
  pages: MetaApiPage[],
  classifications: Record<string, PageGenreClassification>,
): Partial<Record<GenreBucket, number>> {
  const counts: Partial<Record<GenreBucket, number>> = {};

  for (const page of pages) {
    const c = classifications[page.id];
    if (!c) continue;

    const seen = new Set<GenreBucket>();
    for (const bucket of [c.primaryBucket, c.secondaryBucket, c.tertiaryBucket]) {
      if (bucket && !seen.has(bucket)) {
        counts[bucket] = (counts[bucket] ?? 0) + 1;
        seen.add(bucket);
      }
    }
  }

  return counts;
}

/**
 * Get assigned buckets for a page (primary, secondary, tertiary, non-null).
 */
export function getPageBuckets(
  pageId: string,
  classifications: Record<string, PageGenreClassification>,
): GenreBucket[] {
  const c = classifications[pageId];
  if (!c) return [];
  return [c.primaryBucket, c.secondaryBucket, c.tertiaryBucket].filter(
    (b): b is GenreBucket => !!b,
  );
}

// ─── Genre Cache (localStorage) ────────────────────────────────────────────

const GENRE_CACHE_KEY = "meta_page_genres_v1";

interface GenreCache {
  v: 1;
  classifications: Record<string, PageGenreClassification>;
  savedAt: number;
}

export function readGenreCache(): Record<string, PageGenreClassification> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(GENRE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as GenreCache;
    if (parsed.v !== 1) return {};
    return parsed.classifications ?? {};
  } catch {
    return {};
  }
}

export function writeGenreCache(
  classifications: Record<string, PageGenreClassification>,
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: GenreCache = { v: 1, classifications, savedAt: Date.now() };
    localStorage.setItem(GENRE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded — silent fail
  }
}

export function updatePageGenreOverride(
  pageId: string,
  buckets: { primary?: GenreBucket; secondary?: GenreBucket; tertiary?: GenreBucket },
): void {
  const existing = readGenreCache();
  existing[pageId] = {
    ...(existing[pageId] ?? {
      pageId,
      scores: {},
      matchedSignals: [],
      classifiedAt: new Date().toISOString(),
    }),
    ...buckets,
    primaryBucket: buckets.primary,
    secondaryBucket: buckets.secondary,
    tertiaryBucket: buckets.tertiary,
    isManualOverride: true,
    classifiedAt: new Date().toISOString(),
  };
  writeGenreCache(existing);
}
