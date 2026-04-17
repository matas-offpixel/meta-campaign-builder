// Audience persona layer for interest discovery.
//
// A persona represents an audience identity (e.g. "underground raver",
// "luxury fashion shopper"), independent of the cluster it appears in.
// Each persona ships per-cluster biases — seed terms, positive / negative
// pattern hints, false-positive guards, preferred buckets — that nudge
// discovery toward that identity rather than the cluster's broad centre
// of gravity.
//
// Used by:
//   - app/api/meta/interest-discover/route.ts (detection + scoring +
//     diversification hooks)
//   - components/steps/audiences/interest-groups-panel.tsx (persona chip
//     row beneath the scene-hint input)
//
// Phase 1+ scope: Fashion & Streetwear, Music & Nightlife, Lifestyle &
// Nightlife. Sports & Live Events keeps its dedicated entity-recovery /
// gym-first pipeline; persona definitions for Sports are intentionally
// absent so that pipeline is never perturbed.
//
// Matcher safety: positivePatterns / negativePatterns are compiled
// **with word-boundary anchors by default** (see
// compilePersonaPatternMatchers in route.ts) so plain phrases like "vans"
// or "supreme" no longer fire on "Vans Warped Tour" / "Supreme Court".
// For rare tail cases (e.g. "Palace of Versailles") use
// falsePositiveGuards on the per-cluster bias.
//
// No DB / package changes; static module-scope tables only.

export type AudiencePersonaKey =
  | "fashionista"
  | "luxury_fashion"
  | "streetwear_sneakerhead"
  | "tech_house_essex_glam"
  | "zen_yoga_organic_house"
  | "hipster_alt"
  | "ibiza_bro"
  | "underground_raver"
  | "hard_techno_queer"
  | "melodic_progressive_luxury"
  | "tech_house_party"
  | "disco_house_social"
  | "commercial_festival"
  | "tastemaker_festival";

/** Per-cluster bias for a persona. The same persona can ship biases for
 *  multiple clusters; only the cluster matching the active discovery
 *  request is applied. */
export type PersonaClusterBias = {
  clusterLabel: string;
  /** Seed terms prepended (after sports tier-1 + user hints, before
   *  generic cluster seeds) so Meta returns persona-aligned candidates
   *  first. */
  seedTerms: string[];
  /** Extra positive substring/word patterns to boost during scoring.
   *  Plain phrases are anchored with word boundaries automatically; use
   *  explicit regex syntax (e.g. backslash-b, parentheses, alternations)
   *  to opt out. */
  positivePatterns?: string[];
  /** Pattern hints for opposed personas — rows matching these get
   *  demoted, never hard-excluded. Same anchoring rules as
   *  positivePatterns. */
  negativePatterns?: string[];
  /** Patterns whose match SUPPRESSES a positive hit on the same row.
   *  Used to neutralise known-noisy brand collisions
   *  (e.g. "Palace of Versailles" / "Supreme Court" /
   *  "Vans Warped Tour"). */
  falsePositiveGuards?: string[];
  /** Persona-aware diversification bucket weights (cluster-specific
   *  bucket names; see classifyForPersonaBucket below). Buckets in this
   *  list get the larger cap during persona-aware diversification. */
  preferredBuckets?: string[];
  /** When true, generic cluster-centre rows get a soft demotion so the
   *  persona seeds and boosted rows surface above them. */
  demoteGeneric?: boolean;
};

export type AudiencePersona = {
  key: AudiencePersonaKey;
  label: string;
  description: string;
  /** Lowercase substrings used for hint detection (in raw textarea text)
   *  and for fuzzy event-style mapping. Order matters — first alias is
   *  used as the canonical detection string in generated hint text. */
  aliases: string[];
  /** Free-text event style descriptors that map to this persona (used by
   *  getPersonasForEventStyle). */
  eventStyles: string[];
  /** Identity-defining brand / scene / culture terms used in chip labels
   *  and as a baseline for hint text composition. */
  coreIdentityTerms: string[];
  clusterBiases: PersonaClusterBias[];
};

export type PersonaPreset = {
  id: string;
  label: string;
  hint: string;
  /** Always "persona" so the UI can render the row distinctly from the
   *  scene-hint preset row. */
  bucket: "persona";
  personaKey: AudiencePersonaKey;
  reason?: string;
};

// ── Persona registry ─────────────────────────────────────────────────────────

const FASHION = "Fashion & Streetwear";
const MUSIC = "Music & Nightlife";
const LIFESTYLE = "Lifestyle & Nightlife";
const SPORTS = "Sports & Live Events";

export const AUDIENCE_PERSONAS: Record<AudiencePersonaKey, AudiencePersona> = {
  fashionista: {
    key: "fashionista",
    label: "Fashionista / avant-garde",
    description:
      "High-end melodic / progressive crowd: editorial, designer-led, runway-adjacent fashion audience.",
    aliases: ["fashionista", "avant-garde fashion", "editorial fashion"],
    eventStyles: ["fashion week", "avant-garde", "editorial", "design-led"],
    coreIdentityTerms: [
      "Rick Owens", "Maison Margiela", "Comme des Garçons", "Helmut Lang",
      "Yohji Yamamoto", "Raf Simons", "Ann Demeulemeester", "Dazed & Confused",
      "i-D", "Another Magazine", "METAL Magazine", "SHOWstudio", "032c",
    ],
    clusterBiases: [
      {
        clusterLabel: FASHION,
        seedTerms: [
          "Rick Owens", "Maison Margiela", "Comme des Garçons", "Helmut Lang",
          "Yohji Yamamoto", "Raf Simons", "Ann Demeulemeester",
          "Dazed & Confused", "i-D magazine", "Another Magazine",
          "METAL Magazine", "SHOWstudio", "032c",
        ],
        positivePatterns: [
          "rick owens", "maison margiela", "margiela", "comme des garcons",
          "comme des garçons", "helmut lang", "yohji yamamoto", "raf simons",
          "ann demeulemeester", "dazed", "i-d magazine", "another magazine",
          "metal magazine", "showstudio", "032c", "the face magazine",
          "purple magazine", "system magazine", "editorial fashion",
          "avant-garde fashion", "fashion week",
        ],
        negativePatterns: [
          "fast fashion", "h&m", "zara", "shein", "primark", "topshop",
          "shopping mall", "discount fashion", "sportswear",
          "prettylittlething", "boohoo", "asos", "fashion nova",
          "white fox", "missguided", "river island",
        ],
        falsePositiveGuards: [
          // "i-d" plain string can appear in "id software", "id badge".
          // Only allow within fashion-magazine context — guard on
          // standalone tech / identity contexts.
          "id software", "id badge", "identity card",
        ],
        preferredBuckets: ["editorial_media", "designer_house"],
        demoteGeneric: true,
      },
    ],
  },

  luxury_fashion: {
    key: "luxury_fashion",
    label: "Luxury fashion",
    description:
      "VIP / premium / upscale heritage-luxury houses + jewellery audience.",
    aliases: ["luxury fashion", "luxury shopper", "luxury brands"],
    eventStyles: ["luxury launch", "premium gala", "high fashion", "couture"],
    coreIdentityTerms: [
      "Gucci", "Prada", "Chanel", "Dior", "Louis Vuitton", "Fendi",
      "Versace", "Burberry", "Givenchy", "Armani", "Bottega Veneta",
      "Yves Saint Laurent", "Cartier", "Tiffany & Co.", "Rolex", "Bvlgari",
      "Van Cleef & Arpels", "Chopard",
    ],
    clusterBiases: [
      {
        clusterLabel: FASHION,
        seedTerms: [
          "Gucci", "Prada", "Chanel", "Dior", "Louis Vuitton", "Fendi",
          "Versace", "Burberry", "Givenchy", "Bottega Veneta",
          "Yves Saint Laurent", "Cartier", "Tiffany & Co.", "Rolex",
          "Bvlgari",
        ],
        positivePatterns: [
          "gucci", "prada", "chanel", "dior", "louis vuitton", "fendi",
          "armani", "versace", "burberry", "givenchy", "bottega veneta",
          "yves saint laurent", "saint laurent", "cartier", "rolex",
          "bvlgari", "tiffany & co", "van cleef", "chopard",
          "balenciaga", "hermes", "hermès",
          "luxury goods", "premium fashion", "luxury lifestyle", "couture",
        ],
        negativePatterns: [
          "supreme", "stussy", "stüssy", "palace skateboards", "vans shoes",
          "thrift", "streetwear", "sneakerhead", "hypebeast",
          "fast fashion", "h&m", "zara", "prettylittlething", "boohoo",
          "asos", "yoga apparel", "lululemon", "alo yoga",
        ],
        preferredBuckets: ["luxury_brand", "designer_house"],
        demoteGeneric: true,
      },
    ],
  },

  streetwear_sneakerhead: {
    key: "streetwear_sneakerhead",
    label: "Streetwear / sneakerheads",
    description:
      "Streetwear / sneaker culture / hype-driven youth audience.",
    aliases: ["streetwear", "sneakerhead", "sneaker culture", "hypebeast"],
    eventStyles: ["streetwear drop", "sneaker launch", "hype event"],
    coreIdentityTerms: [
      "Supreme", "Stüssy", "Palace", "Vans", "Nike", "Adidas",
      "New Balance", "Hypebeast", "sneakerheads", "streetwear culture",
    ],
    clusterBiases: [
      {
        clusterLabel: FASHION,
        seedTerms: [
          "Supreme New York", "Stüssy", "Palace Skateboards",
          "Vans (brand)", "Nike sneakers", "Adidas Originals",
          "New Balance", "sneakerheads", "Hypebeast",
          "streetwear culture", "sneaker collecting",
        ],
        positivePatterns: [
          "supreme new york", "stussy", "stüssy", "palace skateboards",
          "vans \\(brand\\)", "vans shoes", "vans clothing", "nike",
          "adidas", "new balance", "yeezy", "off-white", "off white",
          "fear of god", "bape", "a bathing ape", "kith", "aime leon dore",
          "hypebeast", "highsnobiety", "complex magazine",
          "sneaker collecting", "sneakerhead", "streetwear",
          "skate culture", "skateboarding",
        ],
        negativePatterns: [
          "couture", "haute couture", "fashion week shows", "literary magazine",
          "luxury goods", "premium fashion", "yoga apparel", "lululemon",
          "alo yoga", "wellness fashion",
        ],
        falsePositiveGuards: [
          // High-noise brand-name collisions.
          "supreme court", "the supremes", "supreme being",
          "supreme leader", "supreme commander",
          "palace of versailles", "palace of westminster",
          "buckingham palace", "alexandra palace", "crystal palace",
          "vans warped tour",
          "nike of samothrace", "nike missile", "nike (mythology)",
        ],
        preferredBuckets: ["streetwear_brand", "sneaker_culture"],
        demoteGeneric: true,
      },
    ],
  },

  tech_house_essex_glam: {
    key: "tech_house_essex_glam",
    label: "Tech house / Essex glam",
    description:
      "Tech-house party crowd + UK glam clubbing / Essex going-out fashion.",
    aliases: [
      "tech house essex glam", "essex glam", "essex fashion",
      "clubwear glam", "going out outfit", "glam clubbing",
    ],
    eventStyles: ["tech house party", "glam clubbing", "bottle service"],
    coreIdentityTerms: [
      "Nike", "Adidas", "JD Sports", "Gymshark", "Zara",
      "PrettyLittleThing", "BoohooMAN", "ASOS", "White Fox",
      "clubwear", "glam nightlife", "going out outfit",
    ],
    clusterBiases: [
      {
        clusterLabel: FASHION,
        seedTerms: [
          "PrettyLittleThing", "BoohooMAN", "ASOS", "White Fox Boutique",
          "Fashion Nova", "Missguided", "River Island", "Meshki",
          "Gymshark", "JD Sports", "Zara", "going out outfits", "clubwear",
        ],
        positivePatterns: [
          "prettylittlething", "boohooman", "boohoo", "asos", "white fox",
          "fashion nova", "missguided", "river island", "meshki",
          "gymshark", "jd sports", "zara", "h&m", "shein",
          "clubwear", "going out outfit", "going out top",
          "glam nightlife", "party wear", "nightclub fashion",
        ],
        negativePatterns: [
          "rick owens", "maison margiela", "comme des garcons",
          "yohji yamamoto", "raf simons", "ann demeulemeester",
          "couture", "avant-garde fashion", "editorial fashion",
          "luxury goods", "yoga apparel", "lululemon", "alo yoga",
          "slow fashion",
        ],
        falsePositiveGuards: [
          "zara phillips", "zara tindall", "zara hadid",
          "nike of samothrace", "nike missile",
        ],
        preferredBuckets: [
          "clubwear_glam", "sneaker_culture", "streetwear_brand",
        ],
        demoteGeneric: true,
      },
    ],
  },

  zen_yoga_organic_house: {
    key: "zen_yoga_organic_house",
    label: "Zen / yoga / organic house",
    description:
      "Wellness-led, retreat / yoga / ambient & organic-house audience.",
    aliases: [
      "zen yoga", "yoga organic", "zen yoga organic house", "organic house",
      "yoga retreat", "wellness lifestyle", "wellness fashion",
    ],
    eventStyles: ["yoga retreat", "wellness retreat", "organic house party"],
    coreIdentityTerms: [
      "yoga", "pilates", "wellness", "Lululemon", "Alo Yoga",
      "Free People", "mindfulness", "yoga retreat", "organic lifestyle",
      "slow fashion", "conscious living", "afro house", "organic house",
    ],
    clusterBiases: [
      {
        clusterLabel: FASHION,
        seedTerms: [
          "Lululemon", "Alo Yoga", "Free People", "yoga apparel",
          "activewear", "athleisure", "slow fashion", "conscious lifestyle",
          "wellness fashion", "retreat wear",
        ],
        positivePatterns: [
          "lululemon", "alo yoga", "free people", "yoga apparel",
          "activewear", "athleisure", "slow fashion", "conscious lifestyle",
          "ethical fashion", "sustainable fashion", "boho fashion",
          "retreat wear", "wellness fashion",
        ],
        negativePatterns: [
          "hard techno", "industrial techno", "supreme", "stussy",
          "palace skateboards", "vans (brand)", "couture",
          "luxury goods", "fashion week", "clubwear",
          "going out outfit", "prettylittlething", "boohoo",
        ],
        preferredBuckets: ["wellness_fashion", "alt_lifestyle"],
        demoteGeneric: true,
      },
      {
        clusterLabel: LIFESTYLE,
        seedTerms: [
          "yoga", "pilates", "mindfulness", "wellness", "yoga retreat",
          "Lululemon", "Alo Yoga", "Free People", "organic lifestyle",
          "conscious living", "afro house", "organic house",
          "ambient music",
        ],
        positivePatterns: [
          "yoga", "pilates", "mindfulness", "wellness", "wellbeing",
          "yoga retreat", "lululemon", "alo yoga", "free people",
          "healthy lifestyle", "organic lifestyle", "conscious living",
          "ambient music", "organic house", "afro house",
        ],
        negativePatterns: [
          "vip", "bottle service", "hard techno", "industrial",
          "warehouse rave", "commercial festival", "edm",
        ],
        preferredBuckets: ["wellness_culture", "alt_lifestyle"],
        demoteGeneric: true,
      },
    ],
  },

  hipster_alt: {
    key: "hipster_alt",
    label: "Hipster / alt lifestyle",
    description:
      "Independent, vinyl/coffee/Berlin-creative urban lifestyle crowd.",
    aliases: ["hipster", "alt lifestyle", "independent lifestyle"],
    eventStyles: ["independent venue", "underground arts", "alt-culture"],
    coreIdentityTerms: [
      "Patagonia", "Carhartt", "vinyl culture", "coffee culture",
      "independent venues", "Berlin culture", "urban creatives",
    ],
    clusterBiases: [
      {
        clusterLabel: LIFESTYLE,
        seedTerms: [
          "vinyl culture", "coffee culture", "independent venues",
          "Berlin culture", "urban creatives", "indie bars",
          "third-wave coffee",
        ],
        positivePatterns: [
          "vinyl", "record store", "coffee culture", "indie venue",
          "berlin", "creative city", "underground community",
          "alt lifestyle", "subculture",
        ],
        negativePatterns: [
          "vip", "bottle service", "luxury hotel", "five star",
        ],
        preferredBuckets: ["alt_lifestyle", "city_culture"],
        demoteGeneric: true,
      },
    ],
  },

  ibiza_bro: {
    key: "ibiza_bro",
    label: "Ibiza / VIP party crowd",
    description: "Ibiza, beach clubs, VIP tables, sunset / pool parties.",
    aliases: ["ibiza", "ibiza bro", "vip party", "beach club"],
    eventStyles: ["beach party", "ibiza weekender", "pool party", "vip event"],
    coreIdentityTerms: [
      "Ibiza", "beach clubs", "VIP tables", "luxury travel", "house music",
      "sunset parties", "pool parties",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "Ibiza", "house music", "tech house", "beach club", "pool party",
          "sunset party", "Pacha", "Ushuaïa Ibiza",
        ],
        positivePatterns: [
          "ibiza", "beach club", "pool party", "sunset party", "pacha",
          "ushuaïa", "ushuaia", "amnesia ibiza", "house music",
          "tech house", "vocal house", "vip nightlife",
        ],
        negativePatterns: [
          "hard techno", "industrial", "queer underground", "fetish",
          "warehouse rave", "avant-garde", "tastemaker",
        ],
        preferredBuckets: ["luxury_party", "clubbing_nightlife"],
      },
      {
        clusterLabel: LIFESTYLE,
        seedTerms: [
          "Ibiza", "beach clubs", "luxury travel", "VIP tables", "yacht life",
        ],
        positivePatterns: [
          "ibiza", "beach club", "luxury travel", "yacht", "vip nightlife",
        ],
        preferredBuckets: ["luxury_party", "clubbing_nightlife"],
      },
    ],
  },

  underground_raver: {
    key: "underground_raver",
    label: "Underground rave audience",
    description: "Warehouse / industrial techno / Berlin club culture.",
    aliases: [
      "underground rave", "warehouse rave", "underground raver",
      "industrial nightlife",
    ],
    eventStyles: ["warehouse rave", "underground party", "berlin club"],
    coreIdentityTerms: [
      "warehouse rave", "underground dance", "techno", "Berlin club culture",
      "industrial nightlife", "club crowd",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "techno", "underground dance", "warehouse rave", "Berlin techno",
          "Berghain", "industrial techno",
        ],
        positivePatterns: [
          "techno", "warehouse rave", "berlin techno", "berghain",
          "tresor", "industrial techno", "rave culture", "underground rave",
        ],
        negativePatterns: [
          "ibiza", "beach club", "vip", "pool party",
          "commercial festival", "edm", "mainstream",
          "tastemaker media", "boutique festival",
          "resident advisor", "boiler room", "mixmag",
        ],
        preferredBuckets: ["underground_scene", "artist_dj"],
        demoteGeneric: true,
      },
      {
        clusterLabel: LIFESTYLE,
        seedTerms: [
          "Berlin nightlife", "warehouse parties", "underground community",
        ],
        positivePatterns: [
          "berlin nightlife", "warehouse", "underground community",
        ],
        negativePatterns: ["vip", "luxury hotel", "five star"],
        preferredBuckets: ["alt_lifestyle", "clubbing_nightlife"],
      },
    ],
  },

  hard_techno_queer: {
    key: "hard_techno_queer",
    label: "Hard techno / queer underground",
    description:
      "Hard techno, queer nightlife, fetish-fashion industrial scene.",
    aliases: [
      "hard techno", "queer underground", "queer nightlife", "fetish fashion",
    ],
    eventStyles: ["hard techno party", "queer underground", "kinky"],
    coreIdentityTerms: [
      "hard techno", "queer nightlife", "fetish fashion", "industrial techno",
      "underground rave", "Berghain",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "hard techno", "queer nightlife", "industrial techno",
          "underground rave", "Berghain", "Herrensauna",
        ],
        positivePatterns: [
          "hard techno", "industrial techno", "queer", "lgbt", "fetish",
          "berghain", "herrensauna", "warehouse",
        ],
        negativePatterns: [
          "ibiza", "beach club", "vip", "pool party",
          "commercial festival", "mainstream", "edm",
        ],
        preferredBuckets: ["underground_scene", "artist_dj"],
        demoteGeneric: true,
      },
      {
        clusterLabel: LIFESTYLE,
        seedTerms: [
          "queer nightlife", "fetish nightlife", "Berlin nightlife",
        ],
        positivePatterns: [
          "queer nightlife", "lgbt nightlife", "fetish", "berlin nightlife",
        ],
        preferredBuckets: ["alt_lifestyle", "clubbing_nightlife"],
      },
      // Lighter Fashion bias (kept for back-compat detection only — no
      // longer surfaced as a primary Fashion chip; see PERSONAS_BY_CLUSTER).
      {
        clusterLabel: FASHION,
        seedTerms: [
          "avant-garde fashion", "Rick Owens", "fetish fashion",
        ],
        positivePatterns: [
          "rick owens", "avant-garde fashion", "fetish fashion",
        ],
        preferredBuckets: ["editorial_media", "designer_house"],
      },
    ],
  },

  melodic_progressive_luxury: {
    key: "melodic_progressive_luxury",
    label: "Melodic / progressive luxury",
    description: "Melodic techno / progressive house with luxury crossover.",
    aliases: [
      "melodic techno", "progressive house", "melodic progressive luxury",
    ],
    eventStyles: ["melodic techno", "progressive house", "luxury club"],
    coreIdentityTerms: [
      "melodic techno", "progressive house", "luxury nightlife",
      "designer fashion", "Ibiza luxury", "premium travel",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "melodic techno", "progressive house", "Tale Of Us", "Solomun",
          "Afterlife (record label)", "Innervisions", "Diynamic",
        ],
        positivePatterns: [
          "melodic techno", "progressive house", "tale of us", "solomun",
          "afterlife", "innervisions", "diynamic", "luxury nightlife",
        ],
        negativePatterns: [
          "hard techno", "fetish", "queer underground", "commercial edm",
        ],
        preferredBuckets: ["luxury_party", "artist_dj", "music_media"],
      },
    ],
  },

  tech_house_party: {
    key: "tech_house_party",
    label: "Tech house party crowd",
    description: "Tech house / vocal house / mainstream club party crowd.",
    aliases: ["tech house party", "tech house crowd", "ibiza house"],
    eventStyles: ["tech house party", "ibiza house", "club party"],
    coreIdentityTerms: [
      "tech house", "party crowd", "Ibiza house", "clubbing", "nightlife",
      "vocal house",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "tech house", "vocal house", "Ibiza house", "clubbing", "party",
          "Fisher (musician)", "Hot Since 82",
        ],
        positivePatterns: [
          "tech house", "vocal house", "house music", "fisher",
          "hot since 82", "clubbing", "ibiza",
        ],
        negativePatterns: [
          "hard techno", "industrial", "fetish", "tastemaker",
          "boutique festival", "yoga", "wellness",
        ],
        preferredBuckets: ["clubbing_nightlife", "luxury_party", "artist_dj"],
      },
    ],
  },

  disco_house_social: {
    key: "disco_house_social",
    label: "Disco / house social",
    description: "Feel-good disco / house parties, social cocktail nightlife.",
    aliases: ["disco house", "house party", "social nightlife"],
    eventStyles: ["disco party", "house night", "rooftop social"],
    coreIdentityTerms: [
      "disco house", "house party", "cocktails", "social nightlife",
      "feel-good dance music",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "disco", "disco house", "Nu-disco", "house music", "dance party",
        ],
        positivePatterns: [
          "disco", "nu-disco", "house music", "dance party",
          "feel good dance",
        ],
        negativePatterns: [
          "hard techno", "industrial", "fetish",
          "boutique festival", "tastemaker",
        ],
        preferredBuckets: ["clubbing_nightlife", "artist_dj"],
      },
    ],
  },

  commercial_festival: {
    key: "commercial_festival",
    label: "Commercial festival",
    description: "Mainstream festival / big-event / broad youth crowd.",
    aliases: [
      "commercial festival", "mainstream festival", "big festival",
      "festival travel",
    ],
    eventStyles: ["mainstream festival", "big event", "stadium"],
    coreIdentityTerms: [
      "mainstream festival", "festival travel", "big events",
      "broad youth culture",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "music festivals", "Coachella", "Tomorrowland", "Lollapalooza",
          "Glastonbury Festival", "Ultra Music Festival", "EDC Las Vegas",
          "Creamfields", "Parklife",
        ],
        positivePatterns: [
          "music festival", "coachella", "tomorrowland", "lollapalooza",
          "glastonbury", "ultra music", "edc las vegas", "creamfields",
          "parklife", "festival travel",
        ],
        negativePatterns: [
          "hard techno", "industrial", "queer underground", "fetish",
          "boutique festival", "tastemaker", "yoga", "wellness",
        ],
        preferredBuckets: ["festival", "commercial_dance"],
      },
    ],
  },

  tastemaker_festival: {
    key: "tastemaker_festival",
    label: "Tastemaker / boutique festival",
    description:
      "Tastemaker media + boutique / art-x-music festival audience.",
    aliases: ["tastemaker festival", "boutique festival", "art x music"],
    eventStyles: ["boutique festival", "tastemaker", "art x music"],
    coreIdentityTerms: [
      "tastemaker media", "boutique festivals", "culture magazines",
      "curators", "art x music crowd",
    ],
    clusterBiases: [
      {
        clusterLabel: MUSIC,
        seedTerms: [
          "Resident Advisor", "Boiler Room", "Mixmag", "Dekmantel",
          "Sónar", "Nuits sonores", "Field Day", "Houghton Festival",
        ],
        positivePatterns: [
          "resident advisor", "boiler room", "mixmag", "dj mag",
          "dekmantel", "sonar", "sónar", "nuits sonores", "field day",
          "houghton", "boutique festival", "tastemaker",
        ],
        negativePatterns: [
          "coachella", "tomorrowland", "lollapalooza", "edc",
          "commercial festival", "mainstream", "ibiza vip",
          "hard techno", "warehouse rave",
        ],
        preferredBuckets: ["festival", "music_media"],
        demoteGeneric: true,
      },
      {
        clusterLabel: LIFESTYLE,
        seedTerms: [
          "Resident Advisor", "Boiler Room", "Mixmag",
        ],
        positivePatterns: [
          "resident advisor", "boiler room", "mixmag",
          "tastemaker media", "culture magazine",
        ],
        preferredBuckets: ["city_culture", "alt_lifestyle"],
      },
    ],
  },
};

// ── Persona suggestion lists per cluster ─────────────────────────────────────
//
// Ordered by curation priority (highest first). The UI picks the first 5
// after dedupe + scene-tag re-ranking.
//
// Fashion: hard_techno_queer was deliberately removed from the chip row to
// reduce overlap with fashionista. It still exists in the registry (with a
// lighter Fashion bias) so stand-alone detection from raw hint text works.
const PERSONAS_BY_CLUSTER: Record<string, AudiencePersonaKey[]> = {
  [FASHION]: [
    "fashionista",
    "luxury_fashion",
    "streetwear_sneakerhead",
    "tech_house_essex_glam",
    "zen_yoga_organic_house",
  ],
  [MUSIC]: [
    "underground_raver",
    "hard_techno_queer",
    "tech_house_party",
    "disco_house_social",
    "tastemaker_festival",
    "commercial_festival",
    "ibiza_bro",
    "melodic_progressive_luxury",
  ],
  [LIFESTYLE]: [
    "zen_yoga_organic_house",
    "ibiza_bro",
    "hipster_alt",
    "tastemaker_festival",
    "underground_raver",
  ],
  [SPORTS]: [],
};

/** Tags that nudge a persona to the front of the suggestion list. */
const PERSONA_TAG_AFFINITY: Partial<Record<AudiencePersonaKey, string[]>> = {
  fashionista: ["editorial_fashion", "avant_garde_fashion", "designer_culture"],
  luxury_fashion: ["luxury_fashion", "designer_culture"],
  streetwear_sneakerhead: ["streetwear", "sneaker_culture"],
  tech_house_essex_glam: ["tech_house", "house_music", "clubbing_nightlife"],
  zen_yoga_organic_house: [
    "wellness", "wellness_culture", "yoga", "ambient_music",
    "organic_house", "afro_house",
  ],
  hipster_alt: ["alternative_lifestyle", "indie_culture", "berlin_culture"],
  ibiza_bro: ["ibiza", "house_music", "tech_house"],
  underground_raver: [
    "underground_dance", "techno", "warehouse", "industrial",
  ],
  hard_techno_queer: [
    "hard_techno", "queer_underground", "industrial", "fetish",
  ],
  melodic_progressive_luxury: ["melodic_techno", "progressive_house"],
  tech_house_party: ["tech_house", "house_music"],
  disco_house_social: ["disco_house", "house_music"],
  commercial_festival: ["festival_circuit", "mainstream"],
  tastemaker_festival: ["music_media", "tastemaker", "boutique_festival"],
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildAliasMap(): Array<{ key: AudiencePersonaKey; pattern: RegExp }> {
  const out: Array<{ key: AudiencePersonaKey; pattern: RegExp }> = [];
  for (const persona of Object.values(AUDIENCE_PERSONAS)) {
    for (const alias of persona.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out.push({
        key: persona.key,
        pattern: new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i"),
      });
    }
  }
  return out;
}

const ALIAS_MAP = buildAliasMap();

/** Detect personas referenced in raw scene-hint text. Order-stable. */
export function detectPersonasFromHint(
  rawHintText: string,
): AudiencePersonaKey[] {
  if (!rawHintText) return [];
  const text = rawHintText.toLowerCase();
  const seen = new Set<AudiencePersonaKey>();
  const out: AudiencePersonaKey[] = [];
  for (const { key, pattern } of ALIAS_MAP) {
    if (seen.has(key)) continue;
    if (pattern.test(text)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Suggest personas for a cluster, ranked lightly by scene tag affinity. */
export function getPersonasForCluster(
  clusterLabel: string,
  dominantScenes: Array<{ tag: string; weight: number }> = [],
  detectedSceneTags: string[] = [],
): AudiencePersonaKey[] {
  const base = PERSONAS_BY_CLUSTER[clusterLabel] ?? [];
  if (base.length === 0) return [];
  const tagSet = new Set<string>([
    ...dominantScenes.map((s) => s.tag),
    ...detectedSceneTags,
  ]);
  if (tagSet.size === 0) return base.slice(0, 5);
  // Stable sort: personas whose affinity tags are present float to the top.
  const indexed = base.map((k, i) => {
    const tags = PERSONA_TAG_AFFINITY[k] ?? [];
    const hits = tags.reduce((n, t) => (tagSet.has(t) ? n + 1 : n), 0);
    return { k, i, hits };
  });
  indexed.sort((a, b) => (b.hits - a.hits) || (a.i - b.i));
  return indexed.map((x) => x.k).slice(0, 5);
}

/** Map a free-text event style to one or more persona keys (best-effort). */
export function getPersonasForEventStyle(
  eventStyleText: string,
): AudiencePersonaKey[] {
  if (!eventStyleText) return [];
  const text = eventStyleText.toLowerCase();
  const out: AudiencePersonaKey[] = [];
  for (const persona of Object.values(AUDIENCE_PERSONAS)) {
    const matched = persona.eventStyles.some((s) =>
      text.includes(s.toLowerCase()),
    );
    if (matched) out.push(persona.key);
  }
  return out;
}

/** Build the hint text inserted into the scene-hint textarea on chip click.
 *  Always starts with the persona's canonical alias so backend detection
 *  is reliable, then the cluster-specific seed terms. */
export function getPersonaHintText(
  personaKey: AudiencePersonaKey,
  clusterLabel: string,
): string {
  const persona = AUDIENCE_PERSONAS[personaKey];
  const bias = persona.clusterBiases.find((b) => b.clusterLabel === clusterLabel)
    ?? persona.clusterBiases[0];
  const canonical = persona.aliases[0] ?? persona.label.toLowerCase();
  const tokens = bias?.seedTerms ?? persona.coreIdentityTerms;
  return [canonical, ...tokens.slice(0, 10)].join(", ");
}

/** Chip-shaped presets for the UI persona row. */
export function getPersonaPresetsForCluster(
  clusterLabel: string,
  dominantScenes?: Array<{ tag: string; weight: number }>,
  detectedSceneTags?: string[],
): PersonaPreset[] {
  const keys = getPersonasForCluster(
    clusterLabel,
    dominantScenes,
    detectedSceneTags,
  );
  return keys.map((key) => {
    const persona = AUDIENCE_PERSONAS[key];
    return {
      id: `${clusterLabel}::persona::${key}`,
      label: persona.label,
      hint: getPersonaHintText(key, clusterLabel),
      bucket: "persona" as const,
      personaKey: key,
    };
  });
}

/** Resolve cluster-scoped biases for a list of detected persona keys. */
export function resolvePersonaClusterBiases(
  personaKeys: AudiencePersonaKey[],
  clusterLabel: string,
): PersonaClusterBias[] {
  const out: PersonaClusterBias[] = [];
  for (const key of personaKeys) {
    const persona = AUDIENCE_PERSONAS[key];
    if (!persona) continue;
    const bias = persona.clusterBiases.find(
      (b) => b.clusterLabel === clusterLabel,
    );
    if (bias) out.push(bias);
  }
  return out;
}

// ── Lightweight per-cluster bucket classifier ────────────────────────────────
// Used by both the scoring pass (to spot generic cluster-centre rows) and
// the persona-aware diversification pass. Returns "generic_<cluster>" when
// no specific bucket matches.

export function classifyForPersonaBucket(
  item: { name: string; path?: string[] },
  clusterLabel: string,
): string {
  const haystack = `${item.name} ${(item.path ?? []).join(" ")}`.toLowerCase();
  if (clusterLabel === MUSIC) {
    if (/(festival|tomorrowland|coachella|glastonbury|burning man|lollapalooza|ultra music|edc|creamfields|parklife|sonar|sónar|dekmantel|nuits sonores|field day|houghton)/.test(haystack)) return "festival";
    if (/(resident advisor|mixmag|dj mag|boiler room|nts radio|rinse fm|music media|music magazine)/.test(haystack)) return "music_media";
    if (/(carl cox|solomun|tale of us|adam beyer|fisher|hot since 82|disc jockey|record label)/.test(haystack)) return "artist_dj";
    if (/(berghain|warehouse|underground|industrial|berlin techno|tresor|herrensauna)/.test(haystack)) return "underground_scene";
    if (/(ibiza|beach club|pool party|vip|amnesia|pacha|ushuaïa|ushuaia|luxury nightlife)/.test(haystack)) return "luxury_party";
    if (/(commercial|edm|mainstream|stadium tour|pop music)/.test(haystack)) return "commercial_dance";
    if (/(nightclub|clubbing|nightlife|late night|partygoer|bar)/.test(haystack)) return "clubbing_nightlife";
    return "generic_music";
  }
  if (clusterLabel === FASHION) {
    // Order matters — wellness_fashion and clubwear_glam come first so the
    // cheaper `editorial_media` / `streetwear_brand` checks don't claim
    // brands like Lululemon (athleisure) or Gymshark (clubwear) by accident.
    if (/(yoga apparel|alo yoga|lululemon|free people|activewear|athleisure|slow fashion|conscious lifestyle|sustainable fashion|wellness fashion|boho fashion|retreat wear)/.test(haystack)) return "wellness_fashion";
    if (/(prettylittlething|boohoo|asos|white fox|fashion nova|missguided|river island|meshki|clubwear|going out outfit|going out top|glam nightlife|gymshark|jd sports|\bzara\b|\bh&m\b|shein|nightclub fashion|party wear)/.test(haystack)) return "clubwear_glam";
    if (/(vogue|dazed|i-d magazine|another magazine|metal magazine|showstudio|the face magazine|purple magazine|system magazine|032c|fashion magazine|editorial fashion)/.test(haystack)) return "editorial_media";
    if (/(rick owens|maison margiela|margiela|comme des garçons|comme des garcons|yohji yamamoto|raf simons|ann demeulemeester|helmut lang|balenciaga|saint laurent|bottega veneta|givenchy)/.test(haystack)) return "designer_house";
    if (/(gucci|prada|chanel|dior|louis vuitton|fendi|armani|versace|burberry|cartier|rolex|bvlgari|tiffany & co|hermes|hermès|van cleef|chopard|luxury goods|premium fashion|couture)/.test(haystack)) return "luxury_brand";
    if (/(supreme new york|stussy|stüssy|palace skateboards|off-white|off white|fear of god|bape|a bathing ape|kith|aime leon dore|streetwear|hypebeast|highsnobiety|complex magazine)/.test(haystack)) return "streetwear_brand";
    if (/(sneaker|nike|new balance|adidas|yeezy|vans \(brand\)|jordan|sneakerhead)/.test(haystack)) return "sneaker_culture";
    if (/(patagonia|carhartt|vintage|thrift|indie style|berlin fashion|alt fashion|subculture|urban creatives)/.test(haystack)) return "alt_lifestyle";
    return "generic_fashion";
  }
  if (clusterLabel === LIFESTYLE) {
    if (/(gym|fitness|crossfit|yoga|pilates|wellness|wellbeing|healthy lifestyle|running|cycling|workout|mindfulness|retreat|lululemon|alo yoga|free people|organic lifestyle|conscious living|slow living|meditation)/.test(haystack)) return "wellness_culture";
    if (/(ibiza|beach club|luxury travel|five star|resort|yacht|vip nightlife)/.test(haystack)) return "luxury_party";
    if (/(nightclub|clubbing|nightlife|bar|cocktail|partygoer|late night)/.test(haystack)) return "clubbing_nightlife";
    if (/(berlin|vinyl|coffee culture|indie venue|independent|alt lifestyle|underground community|subculture)/.test(haystack)) return "alt_lifestyle";
    if (/(time out|monocle|vice|lifestyle magazine|urban culture|city guide|magazine)/.test(haystack)) return "city_culture";
    if (/(food|restaurant|cocktail|cuisine|chef|brewery|wine)/.test(haystack)) return "food_culture";
    return "generic_lifestyle";
  }
  if (clusterLabel === SPORTS) {
    return "sports_default";
  }
  return "generic";
}

/** Returns true when a row is one of the generic cluster-centre nodes
 *  (e.g. plain "Fashion (fashion)" / "Music (music)" / "Lifestyle"). */
export function isGenericClusterCenterRow(
  item: { name: string; path?: string[] },
  clusterLabel: string,
): boolean {
  const bucket = classifyForPersonaBucket(item, clusterLabel);
  return bucket.startsWith("generic_");
}
