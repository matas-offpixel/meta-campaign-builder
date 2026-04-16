/**
 * GET /api/meta/interest-suggestions
 *
 * Returns related interest suggestions based on already-selected interests.
 * Uses Meta's adinterestsuggestion search type — the same mechanism Meta Ads
 * Manager uses for its "Suggestions" panel when building an audience.
 *
 * Query params:
 *   ids[]     — one or more selected interest IDs (repeatable, required)
 *   names[]   — parallel array of names for those IDs (required, same order)
 *   cluster   — optional cluster label for type-score boosting + blocklist
 *   exclude[] — optional additional IDs to exclude from results
 *   debug=1   — bypass all local filtering (show raw Meta output)
 *
 * Returns:
 *   { suggestions: SuggestedInterest[], count: number, debug: SuggestionsDebugInfo }
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Suggestion type ───────────────────────────────────────────────────────────

type SuggestionType =
  | "genre"             // music genres (techno, house, drum & bass, etc.)
  | "artist"            // artists, DJs, bands, performers
  | "festival"          // music festivals and events
  | "venue"             // clubs and venues
  | "label"             // record labels
  | "music_media"       // music magazines and media outlets
  | "music_platform"    // streaming and music apps
  | "nightlife"         // nightlife culture / underground / club culture
  | "fashion_brand"     // fashion brands and designers
  | "fashion_media"     // fashion magazines and publications
  | "streetwear"        // streetwear and sneaker culture
  | "lifestyle_brand"   // lifestyle and cultural brands
  | "media"             // general media / publications
  | "behaviour"         // Facebook behavioural targeting
  | "device_owner"      // device / tech ownership audiences
  | "life_event"        // life event audiences
  | "demographic_proxy" // demographic / behavioural proxies
  | "services"          // service industry categories
  | "junk"              // other unusable targeting categories
  | "unknown";

// ── Universal junk regex — TELEMETRY ONLY (Landing 1) ────────────────────────
// Primary defence is now the structural taxonomy-root filter (path[0] must be
// "Interests"). These regexes remain as a debug assertion that fires if any
// final suggestion still looks junky — signalling a bug in the enrichment or
// structural filter, not a new regex to add.

const UNIVERSAL_JUNK: RegExp[] = [
  // Facebook access / browser / device usage
  /\bfacebook\s*(access|lite|for\s*(android|ios|blackberry)|stories)\b/i,
  /\b(mobile|browser)\s*(app\s*)?access\b/i,
  /\bsmartphone\s*users?\b/i,
  /\bfeature\s*phone\b/i,
  // Device ownership
  /\bown(s|er|ing|ed)?\s*(an?\s*)?(iphone|ipad|samsung|galaxy|android|kindle|tablet|pc|mac|blackberry|apple\s*device|ios\s*device)\b/i,
  /\b(iphone|galaxy)\s*owner\b/i,
  // Life events — broad "friends of" catches "friends of men/women/people/[any]"
  /\bnewlywed\b/i,
  /\brecently\s*(married|moved|graduated|started\s*a\s*(new\s*)?(job|business))\b/i,
  /\bnew\s*(parent|baby|job|home)\b/i,
  /\bexpecting\s*(a\s*)?(baby|child)\b/i,
  /\bengaged\s+(to|couple)\b/i,
  /\bfriends?\s+of\b/i,           // catches: "friends of men", "friends of women", "friends of people" etc.
  /\bbirthday\b/i,                 // catches: "birthday this week", "people with a birthday", standalone birthday audiences
  // Geographic / demographic proxies
  /\b(lived|living)\s+in\b/i,     // catches: "Lived in Honduras", "Living in X"
  /\bfrequent\s*travel(l?er|ling)\b/i,
  /\bbusiness\s*travel(l?er)\b/i,
  /\bcommuter\b/i,
  /\bexpat\b/i,
  /\breturned\s+from\b/i,
  /\baway\s+from\s+(home|family)\b/i,
  /\bearly\s*(technology\s*)?adopter\b/i,
  // Service industries — use services? (not service\b) to match plural "services"
  /\b(legal|healthcare|medical|administrative|protective|installation|repair|financial|insurance)\s*services?\b/i,
  /\bcleaning\s*(and\s*maintenance|services?)\b/i, // "Cleaning services", "Cleaning and maintenance"
  /\blaw\s*(firm|office)\b/i,
  /\bhospital\b/i,
];

function isUniversalJunk(name: string, path: string[]): boolean {
  const text = [name, ...path].join(" ");
  return UNIVERSAL_JUNK.some((p) => p.test(text));
}

// ── Suggestion type classifier ────────────────────────────────────────────────

function classifySuggestion(name: string, path: string[]): SuggestionType {
  const text = [name, ...path].join(" ").toLowerCase();
  const n = name.toLowerCase();
  const pathStr = path.join(" ").toLowerCase();

  if (isUniversalJunk(name, path)) return "junk";

  // Explicitly behavioural / demographic categories — mirror UNIVERSAL_JUNK
  // (isUniversalJunk already hard-drops these; these branches set the right type
  //  when debugBypass=true so the debug output is still labelled correctly)
  if (/\b(iphone|android|galaxy|tablet|kindle|blackberry)\b/i.test(text) &&
      !/magazine|music\s*app|film|band|fashion|record/i.test(text)) return "device_owner";
  if (/\bnewlywed|recently\s*(married|moved|graduated)|friends?\s+of\b|birthday\b/i.test(text)) return "life_event";
  if (/\b(lived|living)\s+in\b|\bfrequent\s*travel|commuter|expat\b/i.test(text)) return "demographic_proxy";
  // services? (plural) — the s is optional so both "service" and "services" match
  if (/\bservices?\b/i.test(text) &&
      /\b(legal|healthcare|medical|admin|protective|installation|repair|cleaning|financial)\b/i.test(text))
    return "services";
  if (/\bcleaning\s*(and\s*maintenance|services?)\b/i.test(text)) return "services";

  // Music streaming / platforms (check name first — these are well-known proper nouns)
  if (/\b(spotify|apple\s*music|soundcloud|tidal|deezer|bandcamp|itunes(\s*store)?|youtube(\s*(music|premium))?|amazon\s*music|pandora|audiomack|mixcloud|shazam|napster|boomplay|anghami|last\.?fm)\b/i.test(n))
    return "music_platform";
  if (/streaming|music.*(app|platform|service)/i.test(pathStr)) return "music_platform";

  // Music genres
  if (/\b(techno|house\s*music|trance|drum\s*(and|'?n'?)\s*bass|d(rum)?n?b|jungle|garage|grime|dubstep|acid\s*(house|techno)?|industrial\s*(music|techno)?|ambient|edm|hip.?hop|r&b|soul\s*music|funk|jazz|reggae|metal\s*music|punk|indie|disco|synthwave|wave|rave|hardcore|hardstyle|psytrance|minimal\s*(techno)?|deep\s*house|tech\s*house|melodic\s*(techno|house)|afrobeat|afrohouse|tribal|progressive\s*(house|trance)|dance\s*music|electronic\s*(dance\s*)?music|electro\b|breakbeat|breaks\b|neurofunk|liquid\s*(drum|dnb)|footwork|juke|ambient\s*techno|dub\s*techno)\b/i.test(text))
    return "genre";
  if (/genre|music\s*genre/i.test(pathStr)) return "genre";

  // Music media / press
  if (/\b(mixmag|resident\s*advisor|\bra\b|dj\s*mag|xlr8r|fact\s*mag(azine)?|pitchfork|nme|rolling\s*stone|billboard|the\s*wire|groove\s*magazine|crack\s*magazine|thump|boiler\s*room|fabric\s*(london)?)\b/i.test(n))
    return "music_media";
  if (/music.*(magazine|media|publication|press)/i.test(pathStr)) return "music_media";

  // Record labels
  if (/\b(record\s*label|recordings?)\b/i.test(text) ||
      /record\s*label/i.test(pathStr)) return "label";

  // Festivals / events
  if (/\b(festival|burning\s*man|coachella|glastonbury|tomorrowland|awakenings|junction\s*2|dc10|movement\s*detroit|sonar|exit\s*festival|ultra\s*(music\s*)?festival|electric\s*(daisy|zoo)|berghain|printworks|fabric\s*(london)?|warehouse\s*(project|events?))\b/i.test(text))
    return "festival";
  if (/music.*event|festival/i.test(pathStr)) return "festival";

  // Venues / clubs
  if (/\b(nightclub|night\s*club|berghain|tresor|bunker|sub\s*club|corsica\s*studios?|egg\s*london|pacha|amnesia|dc10|printworks|studio\s*338|fabric(\s*london)?|warehouse\s*project)\b/i.test(text))
    return "venue";

  // Artists / DJs / performers
  if (/\b(disc\s*jockey|dj\b|musician|rapper|singer|producer|electronic\s*musician)\b/i.test(text) &&
      !/magazine|fashion|clothing|publication/i.test(text)) return "artist";
  if (/\bmusician\b|\bband\b|\bperformer\b|\bdisc\s*jockey\b/i.test(pathStr)) return "artist";

  // Nightlife culture
  if (/\b(nightlife|rave\s*culture|club\s*culture|underground\s*(music|scene|culture)?|night\s*out|going\s*out\s*(culture)?|after\s*hours)\b/i.test(text))
    return "nightlife";

  // Fashion brands / designers
  if (/\b(rick\s*owens|raf\s*simons|margiela|maison\s*margiela|comme\s*des\s*gar[cç]ons|\bcdg\b|yohji\s*yamamoto|ann\s*demeulemeester|balenciaga|vetements|off.?white|stone\s*island|supreme|palace\s*skateboards?|acne\s*studios?|celine|prada|gucci|versace|fendi|louis\s*vuitton|burberry|helmut\s*lang|issey\s*miyake|alexander\s*mcqueen|vivienne\s*westwood|kenzo|givenchy|dries\s*van\s*noten|jil\s*sander|bottega\s*veneta|loewe|ami\s*paris|miu\s*miu|jacquemus|wales\s*bonner|martine\s*rose)\b/i.test(text))
    return "fashion_brand";
  if (/fashion.*(brand|designer|house)|designer.*clothing|apparel.*brand/i.test(pathStr))
    return "fashion_brand";

  // Fashion media / publications
  if (/\b(vogue|dazed(\s*(&|and)\s*confused)?|i.?d\s*magazine|i-d\b|another\s*magazine|love\s*magazine|w\s*magazine|another\s*man|bon\s*magazine|system\s*magazine|pop\s*magazine|industrie\s*magazine|tank\s*magazine|purple\s*fashion|num[eé]ro(\s*magazine)?|wallpaper\*?|monocle|kinfolk|porter\s*magazine|document\s*journal|032c|metal\s*magazine)\b/i.test(n))
    return "fashion_media";
  if (/fashion.*(magazine|publication)|style.*magazine/i.test(pathStr)) return "fashion_media";

  // Streetwear / sneaker culture
  if (/\b(streetwear|sneaker(head)?|hypebeast|complex(mag)?|highsnobiety|sneaker\s*(culture|collecting)|air\s*(max|jordan|force\s*1)|yeezy|jordan\s*brand|adidas\s*originals|new\s*balance\s*(sneaker)?|nike(\s*sb)?|bape|stussy|kith\b)\b/i.test(text))
    return "streetwear";

  // Lifestyle / cultural brands
  if (/\b(lifestyle|creative\s*(industry|arts?)|architecture|photography|cinema|art\s*(gallery|museum|direction)|theatre|yoga|meditation|wellness|cultural)\b/i.test(text))
    return "lifestyle_brand";

  // General media / publications (path-based)
  if (/magazine|publication|media|journalism|broadcasting/i.test(pathStr)) return "media";
  if (/\b(magazine|journal|publication|press|editorial|zine|blog|media\s*outlet)\b/i.test(text)) return "media";

  return "unknown";
}

// ── Per-cluster type scores ───────────────────────────────────────────────────
// Positive values add to the base score. -999 = hard-drop (never show).

const CLUSTER_TYPE_SCORES: Record<string, Partial<Record<SuggestionType, number>>> = {
  "Music & Nightlife": {
    genre: 35,
    artist: 30,
    festival: 25,
    label: 25,
    music_media: 22,
    music_platform: 22,
    nightlife: 20,
    venue: 20,
    media: 5,
    lifestyle_brand: 0,
    streetwear: -5,
    fashion_brand: -10,
    fashion_media: -10,
    behaviour: -999,
    device_owner: -999,
    life_event: -999,
    demographic_proxy: -999,
    services: -999,
    junk: -999,
  },
  "Fashion & Streetwear": {
    fashion_brand: 35,
    fashion_media: 35,
    streetwear: 30,
    media: 10,
    lifestyle_brand: 8,
    music_platform: 5,
    genre: -5,
    artist: -10,
    festival: -12,
    nightlife: -5,
    behaviour: -999,
    device_owner: -999,
    life_event: -999,
    demographic_proxy: -999,
    services: -999,
    junk: -999,
  },
  "Lifestyle & Nightlife": {
    nightlife: 25,
    festival: 22,
    lifestyle_brand: 20,
    genre: 12,
    music_platform: 10,
    music_media: 8,
    media: 8,
    fashion_brand: 5,
    streetwear: 5,
    behaviour: -999,
    device_owner: -999,
    life_event: -999,
    demographic_proxy: -999,
    services: -999,
    junk: -999,
  },
  "Activities & Culture": {
    lifestyle_brand: 25,
    media: 20,
    festival: 18,
    fashion_media: 10,
    genre: 8,
    artist: 8,
    music_platform: 5,
    behaviour: -999,
    device_owner: -999,
    life_event: -999,
    demographic_proxy: -999,
    services: -999,
    junk: -999,
  },
  "Media & Entertainment": {
    media: 30,
    music_media: 25,
    fashion_media: 22,
    music_platform: 18,
    genre: 12,
    artist: 10,
    festival: 8,
    lifestyle_brand: 8,
    nightlife: 5,
    behaviour: -999,
    device_owner: -999,
    life_event: -999,
    demographic_proxy: -999,
    services: -999,
    junk: -999,
  },
};

// Applied when no cluster is specified — suppresses junk but adds no positive bias
const DEFAULT_TYPE_SCORES: Partial<Record<SuggestionType, number>> = {
  behaviour: -999,
  device_owner: -999,
  life_event: -999,
  demographic_proxy: -999,
  services: -999,
  junk: -999,
};

// ── Per-cluster supplementary blocklists ─────────────────────────────────────

const CLUSTER_PATH_PATTERNS: Record<string, RegExp> = {
  "Music & Nightlife":
    /music|nightlife|club|festival|dj|performer|concert|artist|record\s*label|genre|band/i,
  "Fashion & Streetwear":
    /fashion|clothing|apparel|style|designer|streetwear|accessories|brand|magazine|footwear/i,
  "Lifestyle & Nightlife":
    /lifestyle|travel|hotel|dining|fitness|sport|food|drink|hobby|recreation|outdoor|wellness/i,
  "Activities & Culture":
    /art|culture|design|museum|photography|creative|gallery|exhibition|theatre|cinema/i,
  "Media & Entertainment":
    /media|magazine|publication|news|journalism|radio|streaming|podcast|broadcast/i,
};

const CLUSTER_BLOCKLIST: Record<string, RegExp[]> = {
  "Music & Nightlife": [
    /\b(video.?game|gaming|esport|the\s*sims|fortnite|minecraft)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(stock.?market|cryptocurrency|forex|bitcoin)\b/i,
  ],
  "Fashion & Streetwear": [
    /\b(video.?game|gaming|esport|the\s*sims)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(disc\s*jockey|nightclub|music\s*festival|record\s*label)\b/i,
    /\b(techno\s*music|electronic\s*dance\s*music|house\s*music)\b/i,
  ],
  "Lifestyle & Nightlife": [
    /\b(video.?game|gaming|esport|the\s*sims|fortnite|expansion\s*pack)\b/i,
    /\b(TV\s*series|soap\s*opera|sitcom|anime|manga|superhero)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(stock.?market|cryptocurrency|forex)\b/i,
    /\b(haute\s*couture|fashion\s*week|runway|catwalk)\b/i,
  ],
  "Activities & Culture": [
    /\b(video.?game|gaming|esport|the\s*sims)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(reality\s*tv|soap\s*opera|talent\s*show)\b/i,
  ],
  "Media & Entertainment": [
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(video.?game|gaming|esport|the\s*sims)\b/i,
    /\b(stock.?market|cryptocurrency|forex)\b/i,
  ],
};

// ── Known-deprecated names ────────────────────────────────────────────────────

const KNOWN_DEPRECATED_NAMES = new Set([
  "metal magazine",
  "dj magazine",
  "dj mag",
  "fact magazine",
  "the sims 2: nightlife",
  "list of fashion magazines",
  "list of music genres",
  "music genre",
  "new rave",
  "fidget house",
  "electroclash",
]);

function isKnownDeprecated(name: string): boolean {
  return KNOWN_DEPRECATED_NAMES.has(name.toLowerCase().replace(/\s*\([^)]*\)/g, "").trim());
}

// ── Audience size band scoring ────────────────────────────────────────────────

function sizeBandScore(size: number): number {
  if (size <= 0) return 0;
  if (size < 500_000) return 10;   // micro-niche
  if (size < 2_000_000) return 8;  // niche
  if (size < 10_000_000) return 5; // targeted
  if (size < 50_000_000) return 2; // medium
  if (size < 200_000_000) return 0; // broad
  return -8;                        // mega — penalise
}

function audienceSizeBand(size: number): string {
  if (size <= 0) return "unknown";
  if (size < 500_000) return "micro (<500K)";
  if (size < 2_000_000) return "niche (<2M)";
  if (size < 10_000_000) return "targeted (<10M)";
  if (size < 50_000_000) return "medium (<50M)";
  if (size < 200_000_000) return "broad (<200M)";
  return "mega (200M+)";
}

// ── Path-based classifier (Landing 1 — primary classifier) ───────────────────
// Meta's `path[]` is the authoritative taxonomy. Classify by inspecting the
// joined path string rather than name regex. This is:
//   1. More accurate — Meta tells us exactly where the interest sits
//   2. Locale-stable — paths are in the account's primary language but the
//      categorical structure is stable across languages
//   3. Cheaper — no brittle name regex to maintain

function classifyFromPath(path: string[]): SuggestionType {
  if (!path || path.length === 0) return "unknown";
  const joined = path.map((s) => s.toLowerCase()).join(" > ");

  // Music-related branches
  if (/\bmusic\b/.test(joined)) {
    if (/(streaming|audio\s*apps?|music\s*(and\s*)?audio|music\s*apps?|apps?\s*and\s*sites)/.test(joined))
      return "music_platform";
    if (/(record\s*label|recordings?\b)/.test(joined)) return "label";
    if (/(magazine|publication|media|press|news|journalism)/.test(joined)) return "music_media";
    if (/(festival|event|concert)/.test(joined)) return "festival";
    if (/(venue|night\s*club|club\b)/.test(joined)) return "venue";
    if (/(dj\b|disc\s*jockey|musician|artist|performer|singer|band)/.test(joined)) return "artist";
    if (/(genre|techno|house|electronic|drum|bass|hip.?hop|jazz|rock|metal|pop|country|classical|indie|dance|edm|reggae|soul|funk|disco|punk|wave)/.test(joined))
      return "genre";
    return "genre";
  }

  // Nightlife / club culture (can live outside Music path)
  if (/(nightlife|night\s*club|club\s*culture|rave|underground)/.test(joined)) return "nightlife";

  // Fashion / shopping branches
  if (/(fashion|shopping|apparel|clothing|footwear|accessories|style|beauty)/.test(joined)) {
    if (/(magazine|publication|editorial|press)/.test(joined)) return "fashion_media";
    if (/(streetwear|sneaker|hypebeast|skate)/.test(joined)) return "streetwear";
    return "fashion_brand";
  }

  // Media / entertainment / publications
  if (/(magazine|publication|news|journalism|broadcasting|media|entertainment|tv\s*channels?|radio)/.test(joined))
    return "media";

  // Lifestyle / hobbies / travel / food / sport — lifestyle lane
  if (/(lifestyle|hobby|hobbies|recreation|travel|food|drink|wellness|fitness|sport|outdoor|creative|art|culture|photography)/.test(joined))
    return "lifestyle_brand";

  return "unknown";
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface SuggestedInterest {
  id: string;
  name: string;
  audienceSize: number | null;
  path?: string[];
  /** Taxonomy root (path[0]) — always "Interests" after Landing 1 structural filter */
  taxonomyRoot?: string;
  score: number;
  likelyDeprecated?: boolean;
  audienceSizeBand?: string;
  /** Classified suggestion type for client-side display and diagnostics */
  suggestionType: SuggestionType;
  /** Landing 2a: fraction of retrieval seeds that surfaced this candidate (0–1) */
  seedAgreement?: number;
  /** Landing 2a: IDs of seeds that surfaced this candidate */
  sourceSeedIds?: string[];
  /** Landing 2b-ii: reliability-weighted seed agreement (0–1) */
  weightedSeedAgreement?: number;
  /** Landing 2b-ii: domain-fit class against the inferred dominant cluster */
  clusterFitClass?: "primary" | "secondary" | "off_cluster" | "neutral" | "unknown_cluster";
  /** Landing 2b-ii (intent-aware): the candidate's fine-grained class (music_platform, electronic_genre, film_tv, lifestyle, …) */
  candidateClass?:
    | "music_platform"
    | "electronic_genre"
    | "music_genre_other"
    | "music_artist_electronic"
    | "music_artist_other"
    | "electronic_music_festival"
    | "generic_music_festival"
    | "nightlife_venue"
    | "music_media"
    | "generic_music_media"
    | "fashion_brand"
    | "fashion_designer"
    | "fashion_editorial_media"
    | "fashion_media"
    | "fashion_photography"
    | "generic_fashion_media"
    | "art_design"
    | "generic_design"
    | "film_tv"
    | "lifestyle"
    | "sports"
    | "gaming"
    | "food_drink"
    | "travel"
    | "literature"
    | "tech_general"
    | "general_other"
    | "unknown";
  /** Landing 2b-ii (intent-aware): which cluster-fit rule fired */
  clusterFitReason?: string;
  /** Landing 2b-ii: surfacing-seed quality class */
  seedQualityClass?: "all_good" | "all_bad" | "mixed" | "no_seeds";
  /** Landing 2c: this candidate came from second-hop expansion (not original seeds). Names of expansion seeds that surfaced it. */
  expansionSourceSeeds?: string[];
  /** Landing 2b-ii: per-component score breakdown for transparency */
  scoreBreakdown?: {
    sizeBand: number;
    typeBonus: number;
    weightedAgreement: number;
    clusterFit: number;
    seedQuality: number;
    pathPattern: number;
    deprecation: number;
    genericName: number;
    total: number;
  };
}

export interface SuggestionsDebugInfo {
  receivedIds: string[];
  receivedNames: string[];
  validSeedCount: number;
  invalidSeedIds: string[];
  metaUrl: string;
  metaHttpStatus: number;
  payloadMode: "interest_list";
  seedNamesSent: string[];
  seedCount: number;
  fallbackUsed: boolean;
  fallbackSeedNames: string[];
  rawSuggestionCount: number;
  /** Landing 1: enrichment + structural filter telemetry */
  enrichedCandidateCount: number;
  droppedMissingPathCount: number;
  droppedNonInterestCount: number;
  droppedNonInterestRoots: Record<string, number>;
  finalInterestOnlyCount: number;
  excludedBySeedCount: number;
  excludedJunkCount: number;
  excludedByClusterBlocklistCount: number;
  excludedByTypeCount: number;
  excludedByTypeBreakdown: Record<string, number>;
  finalCount: number;
  finalSuggestionTypes: Record<string, number>;
  blockedNames: string[];
  tokenPrefix: string;
  metaError?: string;
  top5Raw: string[];
  top10ScoreBreakdown: Array<{
    name: string;
    type: string;
    score: number;
    sizeBand: string;
    path: string[];
    seedAgreement?: number;
    sources?: string[];
    /** Landing 2b-ii: weighted agreement, fit, quality, components */
    weightedAgreement?: number;
    clusterFit?: "primary" | "secondary" | "off_cluster" | "neutral" | "unknown_cluster";
    candidateClass?: SuggestedInterest["candidateClass"];
    clusterFitReason?: string;
    seedQuality?: "all_good" | "all_bad" | "mixed" | "no_seeds";
    components?: {
      sizeBand: number;
      typeBonus: number;
      weightedAgreement: number;
      clusterFit: number;
      seedQuality: number;
      pathPattern: number;
      deprecation: number;
      genericName: number;
    };
  }>;
  /** Landing 2a: per-seed retrieval telemetry */
  perSeedStats?: Record<string, { seedName: string; status: "ok" | "empty" | "error"; count: number; errMsg?: string; errCode?: unknown }>;
  unionPoolSize?: number;
  maxSeedsCapped?: boolean;
  retrievalSeedCount?: number;
  /** Landing 2b-i: seed profiling + dominant cluster inference (observation only) */
  seedProfiles?: Record<string, {
    name: string;
    bucket: SeedBucket;
    reliability: number;
    reliabilityInputs: Record<string, number>;
    ambiguityScore: number;
    domain: string;
    entityType: SuggestionType;
    normalisedEntityType: NormalisedEntityType;
    domainFamilies: DomainFamily[];
    watchlistClass: WatchlistClass;
    pathDepth: number;
    path: string[];
    audienceSize: number;
    onDominantCluster: boolean;
    flags: string[];
  }>;
  dominantCluster?: DominantCluster;
  trustedSeedCount?: number;
  weakSeedCount?: number;
  ambiguousSeedCount?: number;
  conflictingSeedCount?: number;
  seedEnrichmentResolved?: number;
  seedEnrichmentRequested?: number;
  /** Landing 2b-ii: ranking telemetry */
  quarantinedCount?: number;
  quarantinedNames?: string[];
  clusterFitDistribution?: Record<string, number>;
  seedQualityDistribution?: Record<string, number>;
  /** Landing 2b-ii final eligibility gate */
  droppedByFinalEligibilityCount?: number;
  droppedByFinalEligibilityNames?: string[];
  /** Strict gate: also drops neutral candidates on high-confidence clusters */
  droppedNeutralByFinalEligibilityCount?: number;
  droppedNeutralByFinalEligibilityNames?: string[];
  fallbackModeUsed?: boolean;
  survivorFitDistribution?: Record<string, number>;
  highConfidenceClusterGate?: boolean;
  /** Landing 2c expansion stage telemetry */
  expansionAttempted?: boolean;
  expansionMode?: "candidate_expansion" | "seed_rescue_expansion" | "none";
  expansionTriggerReason?: string;
  expansionReasonSkipped?: string;
  expansionSeedNames?: string[];
  expansionSeedSourceBreakdown?: Record<"primary_candidate" | "uncapped_trusted_original" | "curated_rescue", number>;
  curatedExpansionSeedsUsed?: string[];
  expansionRawCount?: number;
  expansionNewCandidateCount?: number;
  expansionAddedToFinalCount?: number;
  expansionPerSeedStats?: Record<
    string,
    {
      status: "ok" | "empty" | "error";
      count: number;
      errMsg?: string;
      source?: "primary_candidate" | "uncapped_trusted_original" | "curated_rescue";
    }
  >;
  /** Landing 2d diversification (post-gate, pre-cap reorder) */
  diversificationApplied?: boolean;
  diversificationCluster?: string | null;
  eligiblePreDiversificationCount?: number;
  survivorBucketDistributionBefore?: Record<string, number>;
  survivorBucketDistributionAfter?: Record<string, number>;
  diversificationSkippedAtCap?: Array<{ name: string; bucket: string; group: string }>;
  /** Landing 2e rescue-seed priority + thin-pool recall */
  curatedRescueCandidatesConsidered?: string[];
  curatedRescueCandidatesPicked?: string[];
  underrepresentedBucketsBeforeExpansion?: Record<string, number>;
  rescueSeedPriorityOrder?: Array<{ name: string; bucket: string; group: string; missingWeight: number; priorityScore: number }>;
  thinPoolRecallBoostActive?: boolean;
  /** Landing 2f — diversification Phase 2 backfill preference */
  selectedPhase1BucketCounts?: Record<string, number>;
  selectedPhase2BucketCounts?: Record<string, number>;
}

// ── Enrichment via adinterestvalid (Landing 1 — primary pipeline step) ───────
// Calls Meta's adinterestvalid endpoint to get authoritative taxonomy metadata
// (path, audience_size) for every candidate ID. This is the source of truth
// for the structural taxonomy-root filter.
//
// Docs: https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-search/#interestvalidation
// Payload: interest_fbid_list=JSON array of ID strings. Returns { data: [{id, name, valid, audience_size, path?, ...}] }

export interface EnrichedInterest {
  id: string;
  name: string;
  valid: boolean;
  audienceSize: number;
  audienceSizeLower?: number;
  audienceSizeUpper?: number;
  path: string[];
  topic?: string;
  description?: string;
}

async function enrichCandidates(
  ids: string[],
  token: string,
  apiBase: string,
): Promise<{ enriched: Map<string, EnrichedInterest>; error?: string; httpStatus: number }> {
  const enriched = new Map<string, EnrichedInterest>();
  if (ids.length === 0) return { enriched, httpStatus: 0 };

  // Deduplicate, batch in groups of 50 (Meta's practical batch ceiling)
  const unique = Array.from(new Set(ids));
  const BATCH = 50;
  let lastHttpStatus = 0;
  let lastError: string | undefined;

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    const payload = JSON.stringify(batch);
    const url =
      `${apiBase}/search` +
      `?access_token=${encodeURIComponent(token)}` +
      `&type=adinterestvalid` +
      `&interest_fbid_list=${encodeURIComponent(payload)}`;

    const urlSafe = url.replace(token, token.slice(0, 12) + "…");
    console.info(
      `[interest-suggestions] ▶ enrichment call (batch ${i / BATCH + 1}):` +
      `\n  ids: ${batch.length}` +
      `\n  url (safe): ${urlSafe}`,
    );

    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[interest-suggestions] ✗ enrichment network error:`, err);
      continue;
    }
    lastHttpStatus = res.status;

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      lastError = (e.message as string) ?? `HTTP ${res.status}`;
      console.error(
        `[interest-suggestions] ✗ enrichment Meta error: ${lastError}` +
        `\n  full: ${JSON.stringify(e)}`,
      );
      continue;
    }

    const data = (json.data as Array<{
      id?: string;
      name?: string;
      valid?: boolean;
      audience_size?: number;
      audience_size_lower_bound?: number;
      audience_size_upper_bound?: number;
      path?: string[];
      topic?: string;
      description?: string;
    }>) ?? [];

    for (const row of data) {
      if (!row.id) continue;
      enriched.set(row.id, {
        id: row.id,
        name: row.name ?? "",
        valid: row.valid ?? true,
        audienceSize: row.audience_size ?? row.audience_size_upper_bound ?? 0,
        audienceSizeLower: row.audience_size_lower_bound,
        audienceSizeUpper: row.audience_size_upper_bound,
        path: row.path ?? [],
        topic: row.topic,
        description: row.description,
      });
    }
  }

  console.info(
    `[interest-suggestions] enrichment complete: ${enriched.size}/${unique.length} IDs resolved` +
    (lastError ? ` (with errors: ${lastError})` : ""),
  );

  return { enriched, httpStatus: lastHttpStatus, error: lastError };
}

// ── Landing 2b-i (patched): seed profiling + dominant cluster inference ──────
// OBSERVATION ONLY — these signals are logged and returned in debug, but
// DO NOT influence scoring yet. Scoring changes land in 2b-ii/iii/iv.
//
// Patch rationale: Meta often returns seeds under "Interests > Additional
// interests > [leaf]", which flattens path-based LCP to an empty consensus.
// This patch adds a domain/type-based cluster inference layer that works
// from entity dictionaries and deterministic name heuristics, with path
// overlap demoted to a fallback signal.

type SeedBucket = "trusted" | "weak" | "ambiguous" | "conflicting";

type NormalisedEntityType =
  | "platform"
  | "genre"
  | "artist"
  | "media_publication"
  | "fashion_brand"
  | "nightlife_event"
  | "lifestyle_brand"
  | "unknown";

type DomainFamily =
  | "music"
  | "electronic_music"
  | "music_platform"
  | "nightlife"
  | "fashion"
  | "fashion_editorial"
  | "media"
  | "literature"
  | "entertainment";

type ClusterKey =
  | "electronic_music_nightlife"
  | "music_platforms"
  | "music_general"
  | "fashion_editorial"
  | "fashion_brands"
  | "literature_media"
  | "unknown"
  | `taxonomy:${string}`;

type WatchlistClass = "none" | "soft" | "hard_ambiguous";

export interface SeedProfile {
  id: string;
  name: string;
  path: string[];
  audienceSize: number;
  domain: string;                       // legacy — last path node, retained for back-compat
  entityType: SuggestionType;           // legacy — classifyFromPath output
  normalisedEntityType: NormalisedEntityType;
  domainFamilies: DomainFamily[];
  watchlistClass: WatchlistClass;
  pathDepth: number;
  ambiguityScore: number;               // 0..1, higher = more ambiguous
  reliability: number;                  // 0..1
  reliabilityInputs: Record<string, number>; // per-factor contribution for debug
  bucket: SeedBucket;
  onDominantCluster: boolean;
  flags: string[];
}

export interface DominantCluster {
  clusterKey: ClusterKey;               // NEW — primary identity
  path: string[];                       // legacy / fallback path
  confidence: number;
  supporters: string[];
  depth: number;
  band: "high" | "medium" | "low";
  supportByDomain: Partial<Record<DomainFamily, number>>;
  supportByEntityType: Partial<Record<NormalisedEntityType, number>>;
  pathContributed: boolean;
  reason: string;                       // human-readable explanation
}

// ── Entity dictionaries ──────────────────────────────────────────────────────
// Hand-curated. Lowercase. Matched after normaliseName() strips suffixes
// like "(music)", "(magazine)". These are authoritative: a hit here overrides
// path-based classification for unambiguous entities.

const MUSIC_PLATFORMS = new Set([
  "spotify", "apple music", "soundcloud", "tidal", "bandcamp",
  "youtube music", "deezer", "mixcloud", "beatport", "amazon music",
  "pandora", "traxsource", "audius", "qobuz", "napster",
  "shazam", "last.fm", "itunes",
]);

const ELECTRONIC_GENRES = new Set([
  "techno", "hard techno", "minimal techno", "acid techno", "industrial techno",
  "house", "deep house", "tech house", "minimal house", "acid house",
  "progressive house", "melodic house", "melodic techno", "afro house",
  "electro house", "tropical house",
  "trance", "psytrance", "progressive trance", "goa trance",
  "drum and bass", "dnb", "drum n bass", "jungle", "liquid dnb",
  "dubstep", "bass music", "uk garage", "2-step", "2 step", "speed garage",
  "electro", "electroclash", "breakbeat", "breaks",
  "ambient", "idm", "glitch", "downtempo",
  "industrial", "ebm", "hardcore", "gabber", "hardstyle",
  "footwork", "juke", "grime", "trap",
  // Broad electronic-adjacent anchors — classify as electronic_genre so they
  // survive the cluster, but are demoted to primary +10 (not +20) via the
  // BROAD_GENRE_SOFT_DEMOTE table so tight anchors (Tech house, Deep house,
  // Techno) rank above them.
  "dance music", "club music",
]);

// Bare broad anchors that still belong to the electronic cluster but should
// NOT outrank tight anchors. Used only inside computeClusterFit for the
// electronic_music_nightlife cluster. Names are normaliseName() form.
const BROAD_GENRE_SOFT_DEMOTE = new Set([
  "house music",
  "dance music",
  "club music",
]);

const OTHER_GENRES = new Set([
  "jazz", "blues", "rock", "pop", "indie", "indie rock", "alternative rock",
  "hip hop", "hip-hop", "rap", "r&b", "soul", "funk", "disco",
  "folk", "country", "reggae", "dancehall", "latin", "salsa",
  "classical", "metal", "heavy metal", "punk", "hardcore punk",
  "k-pop", "j-pop", "afrobeats", "electronic music", "electronic dance music", "edm",
]);

const ELECTRONIC_ARTISTS = new Set([
  "carl cox", "richie hawtin", "jeff mills", "derrick may", "kevin saunderson",
  "sven väth", "sven vath", "laurent garnier", "dj hell", "dixon",
  "adam beyer", "nina kraviz", "amelie lens", "charlotte de witte",
  "i hate models", "dax j", "fjaak", "dvs1", "ben klock", "marcel dettmann",
  "rødhåd", "rodhad", "peggy gou", "honey dijon", "the blessed madonna",
  "daphni", "floating points", "four tet", "caribou", "bonobo",
  "fisher", "chris lake", "mk", "claude vonstroke",
  "jamie jones", "lee burridge", "hot since 82", "solomun", "tale of us",
  "mind against", "mathame", "sasha", "john digweed", "paul van dyk",
  "armin van buuren", "tiësto", "tiesto", "david guetta", "calvin harris",
  "disclosure", "bicep", "overmono", "skrillex", "deadmau5",
  "daft punk", "justice", "moderat", "modeselektor", "apparat",
  "boys noize", "erol alkan", "2manydjs", "sven marquardt",
  "fred again", "fred again..", "skream", "benga", "mala",
  "goldie", "dj hype", "dillinja", "sub focus", "andy c",
  "aphex twin", "autechre", "squarepusher", "burial", "actress",
  "mall grab", "denis sulta", "hammer",
  "999999999", "9999999999",
]);

const FASHION_BRANDS = new Set([
  "helmut lang", "rick owens", "raf simons", "maison margiela", "margiela",
  "balenciaga", "comme des garçons", "comme des garcons", "cdg",
  "yohji yamamoto", "issey miyake", "ann demeulemeester", "dries van noten",
  "alexander mcqueen", "vetements", "off-white", "off white",
  "supreme", "stüssy", "stussy", "palace skateboards", "bape", "a bathing ape",
  "acne studios", "ganni", "prada", "miu miu", "gucci", "louis vuitton",
  "chanel", "hermès", "hermes", "saint laurent", "ysl",
  "loewe", "jacquemus", "the row", "khaite", "lemaire",
  "bottega veneta", "valentino", "versace", "fendi", "celine",
  "burberry", "dior", "christian dior", "marni", "jil sander",
  "undercover", "junya watanabe", "sacai", "kiko kostadinov",
  "martine rose", "craig green", "our legacy", "studio nicholson",
  "martens", "dr martens", "doc martens",
  "nike", "adidas", "adidas originals", "new balance", "asics",
  "vans", "converse", "reebok", "puma",
  "birkenstock", "salomon",
  "patagonia", "arc'teryx", "arcteryx", "the north face",
  "carhartt", "carhartt wip", "dickies",
]);

const FASHION_MEDIA = new Set([
  "dazed", "dazed & confused", "dazed confused", "dazed and confused",
  "dazed & confused magazine", "i-d", "i.d.", "id magazine", "i-d magazine",
  "another magazine", "vogue magazine",
  "harper's bazaar", "harpers bazaar", "w magazine", "the gentlewoman",
  "purple magazine", "self service", "self service magazine",
  "032c", "fantastic man", "document journal", "system magazine",
  "metal magazine", "heavy metal magazine", // niche fashion-art publications
  "numero", "numéro", "l'officiel", "lofficiel",
  "ssense", "highsnobiety", "hypebeast", "hypebae",
  "business of fashion", "bof", "wwd",
  "list of fashion magazines",
]);

const MUSIC_MEDIA = new Set([
  "resident advisor", "ra", "mixmag", "dj mag", "dj magazine",
  "fact", "fact magazine", "the fader", "pitchfork",
  "rolling stone", "nme", "rock sound", "kerrang",
  "the wire", "the wire magazine", "ra sessions",
  "loud and quiet", "crack magazine", "crack",
  "clash", "clash magazine",
  "nts radio", "nts",
]);

// Tight electronic / underground music media. Used to distinguish tight
// electronic media (→ "music_media") from broader music journalism / rock
// rags / pop rags (→ "generic_music_media"). Names listed here take
// precedence; everything else in MUSIC_MEDIA falls to generic.
const ELECTRONIC_MUSIC_MEDIA = new Set([
  "resident advisor", "ra", "mixmag", "dj mag", "dj magazine",
  "fact", "fact magazine", "the wire", "the wire magazine",
  "ra sessions", "crack", "crack magazine",
  "clash", "clash magazine",
  "nts radio", "nts",
]);

// Tight editorial fashion media (high-end / avant-garde / art-fashion).
// These are treated as "fashion_editorial_media" (primary for editorial
// cluster). Broader fashion journalism / streetwear media (Highsnobiety,
// Hypebeast, BoF, WWD, SSENSE) still classifies as "fashion_media"
// (secondary for editorial cluster).
const FASHION_EDITORIAL_MEDIA = new Set([
  "vogue", "vogue magazine", "vogue italia", "vogue paris",
  "british vogue", "american vogue",
  "dazed", "dazed & confused", "dazed confused", "dazed and confused",
  "dazed & confused magazine",
  "i-d", "i.d.", "id magazine", "i-d magazine",
  "another magazine", "anOther magazine",
  "harper's bazaar", "harpers bazaar", "w magazine", "the gentlewoman",
  "purple magazine", "self service", "self service magazine",
  "032c", "fantastic man", "document journal", "system magazine",
  "numero", "numéro", "l'officiel", "lofficiel",
  "showstudio",
  "metal magazine", // editorial-adjacent art/fashion publication
  "pop magazine", "love magazine", "interview magazine",
  "wallpaper magazine", "wallpaper",
  "the face", "the face magazine",
  "re-edition", "buffalo zine",
]);

// Electronic / underground music festivals. When NIGHTLIFE_EVENTS matches
// a festival name, this refines the class: if the name is in
// ELECTRONIC_FESTIVALS → "electronic_music_festival", else
// → "generic_music_festival". Also used when the classifier detects
// festival context via keyword + music path.
const ELECTRONIC_FESTIVALS = new Set([
  "awakenings", "movement festival", "tomorrowland",
  "time warp", "dekmantel", "sonar", "sónar", "dgtl",
  "mysteryland",
  "dimensions festival", "unknown festival", "nuits sonores",
  "exit festival", "ultra music festival",
  "decibel festival",
  "freqs of nature", "fusion festival", "hospitality in the park",
  "gala festival",
  "boiler room festival",
  "amsterdam dance event", "ade",
  "creamfields",
]);

const NIGHTLIFE_EVENTS = new Set([
  // Venues — multi-word / distinct-name entries only.
  // Bare single words (fabric, concrete, output, fold, basement, ultra,
  // movement, meadows, gala) removed: too homonymous with unrelated Meta
  // nodes. If Meta surfaces them as real venues it uses the qualified form.
  "boiler room", "berghain", "panorama bar", "panoramabar",
  "fabric london", "tresor", "robert johnson",
  "concrete paris", "rex club", "printworks",
  "printworks london", "warehouse project", "the warehouse project",
  "halcyon", "smartbar", "corsica studios",
  "village underground", "bassiani", "khidi",
  "de school", "shelter amsterdam", "trouw", "thuishaven",
  "about blank", "about:blank", "sisyphos", "kater blau",
  "ritter butzke", "salon zur wilden renate", "griessmuehle",
  "nowadays nyc", "brooklyn mirage",
  "e1 london", "phonox",
  // Festivals
  "awakenings", "movement festival", "tomorrowland",
  "time warp", "dekmantel", "sonar", "sónar", "dgtl",
  "lowlands", "mysteryland", "creamfields",
  "dimensions festival", "unknown festival", "nuits sonores",
  "exit festival", "ultra music festival",
  "decibel festival", "meadows in the mountains",
  "freqs of nature", "fusion festival", "hospitality in the park",
  "gala festival", // qualified form only — "gala" bare is hard_ambiguous
  "boiler room festival",
]);

// ── Watchlists ────────────────────────────────────────────────────────────────
// HARD_AMBIGUOUS: single-word homonyms that should reduce reliability when
// they DON'T match any entity dictionary (i.e. we can't confirm the entity).
const HARD_AMBIGUOUS_NAMES = new Set([
  "gala", "metal", "id", "house", "garage", "wire",
  "fabric", "vice", "paper", "scene", "love", "dance",
  "eclipse", "apple", "cosmos", "prism", "venus", "eden",
  "atlas", "fact", "kid", "mood", "echo", "halo",
  "metro", "faith", "pure", "true", "icon", "nova",
  "zen", "rage", "stone", "mint", "cloud", "spark",
  "blaze", "noise", "fade", "culture", "vogue",
]);

// SOFT_WATCHLIST: known entities that shouldn't be penalised just for being
// on the list. Telemetry only — used to surface "needs extra scrutiny" in
// mixed-signal scenarios (logged, not scored).
const SOFT_WATCHLIST_NAMES = new Set([
  "metal magazine", "heavy metal magazine", "heavy metal (magazine)",
  "dazed & confused (magazine)", "i.d. (magazine)", "i-d (magazine)",
  "another magazine", "boiler room", "carl cox", "spotify", "apple music",
  "techno", "techno (music)", "literary magazine", "list of fashion magazines",
]);

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(
      // Strip trailing "(category)" noise that Meta adds to disambiguate nodes.
      /\s*\((?:music|magazine|fashion\s*brand|fashion|brand|clothing|clothing\s*brand|apparel|designer|fashion\s*label|retail|website|website\/service|company|business|product\/service|app|application|service|technology|technology\s*company|software|streaming|subscription|platform|tv\s*program|film|band|band\/musician|musician|artist|author|book|movie|publication|media|event|dj|record\s*label|genre|actor|actress|singer|rapper)\)\s*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic fuzzy-ish dictionary match.
 * Returns true when `name` (after normalisation) either:
 *   (a) matches an entry exactly, or
 *   (b) starts with an entry's full word sequence (word-boundary prefix).
 * Case b handles variants like "Spotify Music" / "SoundCloud App" that Meta
 * occasionally surfaces instead of the canonical entity name.
 *
 * Only full word prefixes count — "spotify" will NOT match "spotifan".
 */
function matchesDict(name: string, dict: Set<string>): boolean {
  const norm = normaliseName(name);
  if (!norm) return false;
  if (dict.has(norm)) return true;
  const nameWords = norm.split(" ").filter(Boolean);
  for (const entry of dict) {
    const entryWords = entry.split(" ").filter(Boolean);
    if (entryWords.length === 0 || entryWords.length > nameWords.length) continue;
    let match = true;
    for (let i = 0; i < entryWords.length; i++) {
      if (nameWords[i] !== entryWords[i]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

function lcpPaths(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a[n].toLowerCase() === b[n].toLowerCase()) n++;
  return n;
}

// ── Normalised entity-type inference (dictionary-first cascade) ──────────────

function inferNormalisedEntityType(
  rawName: string,
  path: string[],
): NormalisedEntityType {
  const norm = normaliseName(rawName);
  const pathJoined = path.map((p) => p.toLowerCase()).join(" > ");
  const nameHasMusicSuffix = /\(music\)/i.test(rawName);
  const musicContext = nameHasMusicSuffix ||
    /\bmusic\b/.test(pathJoined) ||
    /\belectronic\b/.test(pathJoined) ||
    /\bgenres?\b/.test(pathJoined);

  // All dictionary checks use matchesDict (exact or word-prefix match) so
  // variants like "Spotify Music" / "SoundCloud App" resolve correctly.

  // 1. Music platforms — unique entity names, dictionary authoritative
  if (matchesDict(rawName, MUSIC_PLATFORMS)) return "platform";

  // 2. Fashion brands — unique entity names, dictionary authoritative
  if (matchesDict(rawName, FASHION_BRANDS)) return "fashion_brand";

  // 3. Electronic artists/DJs — unique names
  if (matchesDict(rawName, ELECTRONIC_ARTISTS)) return "artist";

  // 4. Fashion media publications
  if (matchesDict(rawName, FASHION_MEDIA)) return "media_publication";

  // 5. Music media publications
  if (matchesDict(rawName, MUSIC_MEDIA)) return "media_publication";

  // 6. Nightlife venues/events — single-word homonyms intentionally removed
  //    from dict so bare "Gala" / "Fabric" fall through to hard_ambiguous.
  if (matchesDict(rawName, NIGHTLIFE_EVENTS)) return "nightlife_event";

  // 7. Genre match — require music context to guard against homonyms
  //    ("house" could be the genre, or anything else)
  if ((ELECTRONIC_GENRES.has(norm) || OTHER_GENRES.has(norm)) && musicContext) {
    return "genre";
  }

  // 8. Path-based fallback (Meta's taxonomy)
  const pathType = classifyFromPath(path);
  switch (pathType) {
    case "fashion_brand":    return "fashion_brand";
    case "fashion_media":    return "media_publication";
    case "music_media":      return "media_publication";
    case "music_platform":   return "platform";
    case "genre":            return "genre";
    case "artist":           return "artist";
    case "venue":
    case "festival":         return "nightlife_event";
    case "streetwear":       return "fashion_brand";
    case "lifestyle_brand":  return "lifestyle_brand";
    case "media":            return "media_publication";
    default:                 return "unknown";
  }
}

// ── Domain family inference ──────────────────────────────────────────────────

function inferDomainFamilies(
  rawName: string,
  path: string[],
  entityType: NormalisedEntityType,
): DomainFamily[] {
  const families = new Set<DomainFamily>();
  const norm = normaliseName(rawName);
  const pathJoined = path.map((p) => p.toLowerCase()).join(" > ");

  switch (entityType) {
    case "platform": {
      if (matchesDict(rawName, MUSIC_PLATFORMS) || /\bmusic\b/.test(pathJoined)) {
        families.add("music");
        families.add("music_platform");
      } else {
        families.add("media");
      }
      break;
    }
    case "genre": {
      families.add("music");
      if (ELECTRONIC_GENRES.has(norm)) {
        families.add("electronic_music");
        families.add("nightlife");
      }
      break;
    }
    case "artist": {
      families.add("music");
      if (matchesDict(rawName, ELECTRONIC_ARTISTS) || /electronic/.test(pathJoined)) {
        families.add("electronic_music");
        families.add("nightlife");
      }
      break;
    }
    case "media_publication": {
      families.add("media");
      // Literary publications: tag literature ONLY (do not also tag fashion).
      // Catches "Literary magazine" + path/name signals so it stays out of
      // fashion_editorial cluster matching.
      const isLiterary = /\bliterary\b/i.test(rawName) ||
                         /\bliterature\b/.test(pathJoined) ||
                         /\bbook\b/.test(pathJoined);
      if (isLiterary) {
        families.add("literature");
        break;
      }
      if (matchesDict(rawName, FASHION_MEDIA) ||
          /\bfashion\b/.test(pathJoined) ||
          /\beditorial\b/.test(pathJoined)) {
        families.add("fashion");
        families.add("fashion_editorial");
      } else if (matchesDict(rawName, MUSIC_MEDIA) || /\bmusic\b/.test(pathJoined)) {
        families.add("music");
      }
      break;
    }
    case "fashion_brand": {
      families.add("fashion");
      break;
    }
    case "nightlife_event": {
      families.add("nightlife");
      families.add("entertainment");
      if (matchesDict(rawName, NIGHTLIFE_EVENTS)) {
        families.add("music");
        families.add("electronic_music");
      }
      break;
    }
    case "lifestyle_brand": {
      // No family yet — reserved for future expansion
      break;
    }
    case "unknown":
    default: {
      // Last-ditch: look for family keywords in path only
      if (/\bmusic\b/.test(pathJoined)) families.add("music");
      if (/\bfashion\b/.test(pathJoined)) families.add("fashion");
      if (/\bnightlife\b/.test(pathJoined)) families.add("nightlife");
      break;
    }
  }

  return Array.from(families);
}

// ── Reliability computation (patched — no audience penalty) ─────────────────

function computeReliability(args: {
  entityType: NormalisedEntityType;
  domainFamilies: DomainFamily[];
  pathDepth: number;
  watchlistClass: WatchlistClass;
  audienceSize: number;
}): { value: number; inputs: Record<string, number> } {
  const inputs: Record<string, number> = { base: 0.55 };
  let r = 0.55;

  if (args.entityType !== "unknown") { r += 0.20; inputs.clear_entity_type = 0.20; }
  if (args.domainFamilies.length > 0) { r += 0.10; inputs.has_domain_family = 0.10; }

  if (args.watchlistClass === "hard_ambiguous") { r -= 0.30; inputs.hard_ambiguous = -0.30; }
  // soft watchlist: no reliability change (telemetry only)

  if (args.pathDepth === 0) { r -= 0.15; inputs.no_path = -0.15; }
  else if (args.pathDepth >= 3) { r += 0.10; inputs.deep_path = 0.10; }

  if (args.entityType === "unknown" && args.pathDepth < 3) {
    r -= 0.10;
    inputs.unknown_shallow = -0.10;
  }

  // Mild audience modifier — niche + clear identity gets a small boost.
  // We deliberately do NOT penalise huge audiences (Spotify / Techno etc.).
  if (args.audienceSize > 0 && args.audienceSize < 10_000_000 && args.entityType !== "unknown") {
    r += 0.05;
    inputs.niche_with_identity = 0.05;
  }

  return { value: Math.max(0, Math.min(1, r)), inputs };
}

// ── Seed profiling (patched) ─────────────────────────────────────────────────

function profileSeedPartial(
  id: string,
  name: string,
  enriched: Map<string, EnrichedInterest>,
): Omit<SeedProfile, "bucket" | "onDominantCluster"> {
  const e = enriched.get(id);
  const path = e?.path ?? [];
  const audienceSize = e?.audienceSize ?? 0;
  const pathDepth = path.length;
  const domain = path.length > 0 ? path[path.length - 1] : "(unknown)";
  const legacyEntityType: SuggestionType = path.length > 0 ? classifyFromPath(path) : "unknown";
  const nameLower = name.trim().toLowerCase();
  const norm = normaliseName(name);

  const normalisedEntityType = inferNormalisedEntityType(name, path);
  const domainFamilies = inferDomainFamilies(name, path, normalisedEntityType);

  // Watchlist classification — hierarchy: hard > soft > none.
  // Hard trigger is suppressed if the entity dictionary recognised it (e.g.
  // "Apple" ambiguous but "Apple Music" is in MUSIC_PLATFORMS → none).
  let watchlistClass: WatchlistClass = "none";
  if (normalisedEntityType === "unknown") {
    if (HARD_AMBIGUOUS_NAMES.has(nameLower) || HARD_AMBIGUOUS_NAMES.has(norm)) {
      watchlistClass = "hard_ambiguous";
    } else if (SOFT_WATCHLIST_NAMES.has(nameLower) || SOFT_WATCHLIST_NAMES.has(norm)) {
      watchlistClass = "soft";
    }
  } else if (SOFT_WATCHLIST_NAMES.has(nameLower) || SOFT_WATCHLIST_NAMES.has(norm)) {
    watchlistClass = "soft";
  }

  const flags: string[] = [];
  if (normalisedEntityType !== "unknown") flags.push(`type:${normalisedEntityType}`);
  if (domainFamilies.length > 0) flags.push(`families:${domainFamilies.join("+")}`);
  if (watchlistClass !== "none") flags.push(`watchlist:${watchlistClass}`);
  if (pathDepth === 0) flags.push("no_path");
  else if (pathDepth < 3) flags.push("shallow_path");
  if (nameLower.length <= 3) flags.push("short_name");

  const { value: reliability, inputs: reliabilityInputs } = computeReliability({
    entityType: normalisedEntityType,
    domainFamilies,
    pathDepth,
    watchlistClass,
    audienceSize,
  });

  // ambiguityScore retained for backward compat in debug output.
  const ambiguityScore = Math.max(0, Math.min(1,
    (watchlistClass === "hard_ambiguous" ? 0.40 : 0) +
    (normalisedEntityType === "unknown" ? 0.25 : 0) +
    (pathDepth === 0 ? 0.20 : pathDepth < 3 ? 0.10 : 0)
  ));

  return {
    id, name, path, audienceSize, domain,
    entityType: legacyEntityType,
    normalisedEntityType, domainFamilies, watchlistClass,
    pathDepth, ambiguityScore, reliability, reliabilityInputs, flags,
  };
}

// ── Domain-based dominant cluster inference (primary) ────────────────────────

const EMPTY_DOMINANT_CLUSTER: DominantCluster = {
  clusterKey: "unknown",
  path: ["Interests"],
  confidence: 0,
  supporters: [],
  depth: 0,
  band: "low",
  supportByDomain: {},
  supportByEntityType: {},
  pathContributed: false,
  reason: "no seeds or no domain signal",
};

function inferDominantClusterFromDomains(
  profiles: Array<Pick<SeedProfile, "id" | "reliability" | "normalisedEntityType" | "domainFamilies">>,
): DominantCluster {
  if (profiles.length === 0) return EMPTY_DOMINANT_CLUSTER;

  const totalReliability = profiles.reduce((sum, p) => sum + p.reliability, 0) || 1;

  const familyWeight = new Map<DomainFamily, number>();
  const familySupporters = new Map<DomainFamily, string[]>();
  const entityTypeWeight = new Map<NormalisedEntityType, number>();

  for (const p of profiles) {
    for (const f of p.domainFamilies) {
      familyWeight.set(f, (familyWeight.get(f) ?? 0) + p.reliability);
      const list = familySupporters.get(f) ?? [];
      list.push(p.id);
      familySupporters.set(f, list);
    }
    entityTypeWeight.set(
      p.normalisedEntityType,
      (entityTypeWeight.get(p.normalisedEntityType) ?? 0) + p.reliability,
    );
  }

  const share = (f: DomainFamily) => (familyWeight.get(f) ?? 0) / totalReliability;

  const supportByDomain: Partial<Record<DomainFamily, number>> = {};
  for (const [k, v] of familyWeight.entries()) supportByDomain[k] = v / totalReliability;

  const supportByEntityType: Partial<Record<NormalisedEntityType, number>> = {};
  for (const [k, v] of entityTypeWeight.entries()) supportByEntityType[k] = v / totalReliability;

  const unionSupporters = (fs: DomainFamily[]): string[] => {
    const set = new Set<string>();
    for (const f of fs) for (const id of (familySupporters.get(f) ?? [])) set.add(id);
    return Array.from(set);
  };

  let clusterKey: ClusterKey = "unknown";
  let confidence = 0;
  let supporters: string[] = [];
  let reason = "no family reached threshold";

  // Decision tree (ordered by specificity — first match wins)
  if (share("electronic_music") >= 0.40 && share("nightlife") >= 0.30) {
    clusterKey = "electronic_music_nightlife";
    confidence = Math.min(1, (share("electronic_music") + share("nightlife")) / 2 + 0.15);
    supporters = unionSupporters(["electronic_music", "nightlife"]);
    reason = `electronic_music share ${share("electronic_music").toFixed(2)} + nightlife share ${share("nightlife").toFixed(2)}`;
  } else if (share("music_platform") >= 0.50) {
    clusterKey = "music_platforms";
    confidence = share("music_platform");
    supporters = familySupporters.get("music_platform") ?? [];
    reason = `music_platform share ${share("music_platform").toFixed(2)}`;
  } else if (share("fashion_editorial") >= 0.40 ||
             (share("fashion") >= 0.40 && share("media") >= 0.40)) {
    clusterKey = "fashion_editorial";
    confidence = Math.max(
      share("fashion_editorial"),
      Math.min(share("fashion"), share("media")),
    );
    supporters = unionSupporters(["fashion_editorial", "fashion", "media"]);
    reason = `fashion_editorial share ${share("fashion_editorial").toFixed(2)} / fashion ${share("fashion").toFixed(2)} + media ${share("media").toFixed(2)}`;
  } else if (share("fashion") >= 0.50) {
    clusterKey = "fashion_brands";
    confidence = share("fashion");
    supporters = familySupporters.get("fashion") ?? [];
    reason = `fashion share ${share("fashion").toFixed(2)}`;
  } else if (share("music") >= 0.50) {
    clusterKey = "music_general";
    confidence = share("music");
    supporters = familySupporters.get("music") ?? [];
    reason = `music share ${share("music").toFixed(2)}`;
  } else if (share("literature") >= 0.50) {
    clusterKey = "literature_media";
    confidence = share("literature");
    supporters = familySupporters.get("literature") ?? [];
    reason = `literature share ${share("literature").toFixed(2)}`;
  }

  const band: DominantCluster["band"] =
    confidence >= 0.60 ? "high" : confidence >= 0.35 ? "medium" : "low";

  return {
    clusterKey,
    path: [clusterKey === "unknown" ? "Interests" : clusterKey],
    confidence,
    supporters,
    depth: 0,
    band,
    supportByDomain,
    supportByEntityType,
    pathContributed: false,
    reason,
  };
}

function inferDominantClusterFromPath(
  seeds: Array<{ id: string; reliability: number; path: string[] }>,
): Omit<DominantCluster, "supportByDomain" | "supportByEntityType" | "pathContributed"> {
  const empty = {
    clusterKey: "unknown" as ClusterKey,
    path: ["Interests"], confidence: 0, supporters: [] as string[], depth: 0,
    band: "low" as const, reason: "no path consensus",
  };
  if (seeds.length === 0) return empty;

  const totalReliability = seeds.reduce((sum, s) => sum + s.reliability, 0) || 1;

  for (const depth of [3, 2] as const) {
    const buckets = new Map<string, { weight: number; supporters: string[]; path: string[] }>();
    for (const s of seeds) {
      if (s.path.length < depth + 1) continue;
      const slice = s.path.slice(0, depth + 1);
      // Skip trivial "Interests > Additional interests" consensus — it's flat.
      if (slice.length >= 2 && slice[1].toLowerCase() === "additional interests") continue;
      const key = slice.map((v) => v.toLowerCase()).join(" > ");
      const existing = buckets.get(key) ?? { weight: 0, supporters: [], path: slice };
      existing.weight += s.reliability;
      existing.supporters.push(s.id);
      buckets.set(key, existing);
    }
    if (buckets.size === 0) continue;

    const sorted = [...buckets.values()].sort((a, b) => b.weight - a.weight);
    const winner = sorted[0];
    const confidence = winner.weight / totalReliability;

    const qualifies =
      depth === 2
        ? confidence >= 0.45
        : (winner.supporters.length >= 2 && confidence >= 0.50);

    if (qualifies) {
      const band = confidence >= 0.60 ? "high" : confidence >= 0.35 ? "medium" : "low";
      return {
        clusterKey: `taxonomy:${winner.path.join(">")}` as ClusterKey,
        path: winner.path,
        confidence,
        supporters: winner.supporters,
        depth,
        band,
        reason: `path LCP depth=${depth} share=${confidence.toFixed(2)}`,
      };
    }
  }
  return empty;
}

function inferDominantClusterHybrid(
  profiles: Array<Pick<SeedProfile, "id" | "reliability" | "normalisedEntityType" | "domainFamilies" | "path">>,
): DominantCluster {
  // Primary: domain-based
  const domainResult = inferDominantClusterFromDomains(profiles);
  if (domainResult.clusterKey !== "unknown" && domainResult.confidence >= 0.35) {
    return domainResult;
  }

  // Fallback: path LCP (skip "Additional interests" buckets)
  const pathResult = inferDominantClusterFromPath(
    profiles.map((p) => ({ id: p.id, reliability: p.reliability, path: p.path })),
  );
  if (pathResult.clusterKey !== "unknown" && pathResult.confidence >= 0.50) {
    return {
      ...pathResult,
      supportByDomain: domainResult.supportByDomain,
      supportByEntityType: domainResult.supportByEntityType,
      pathContributed: true,
    };
  }

  // No consensus — return the weak domain result for debug visibility
  return {
    ...domainResult,
    reason: domainResult.reason + "; path fallback " + pathResult.reason,
  };
}

// ── Map cluster key → which domain families count as on-cluster ──────────────
//
// Split into PRIMARY (must-have to be considered fully on-cluster) and
// SECONDARY (corroborating, but not sufficient on its own). A seed that only
// matches a secondary family is still rendered "weak" rather than "trusted",
// and onDominantCluster=false. This stops loose matches like "Literary
// magazine" (families: media, literature) from being absorbed into a
// fashion_editorial cluster on the strength of the generic "media" tag.

function primaryExpectedFamilies(clusterKey: ClusterKey): DomainFamily[] {
  switch (clusterKey) {
    case "electronic_music_nightlife": return ["electronic_music", "nightlife"];
    case "music_platforms":            return ["music_platform"];
    case "music_general":              return ["music", "electronic_music"];
    case "fashion_editorial":          return ["fashion_editorial", "fashion"];
    case "fashion_brands":             return ["fashion"];
    case "literature_media":           return ["literature"];
    default:                           return [];
  }
}

function secondaryExpectedFamilies(clusterKey: ClusterKey): DomainFamily[] {
  switch (clusterKey) {
    case "electronic_music_nightlife": return ["music", "entertainment"];
    case "music_platforms":            return ["music", "media"];
    case "music_general":              return ["nightlife", "media"];
    case "fashion_editorial":          return ["media"];
    case "fashion_brands":             return [];
    case "literature_media":           return ["media"];
    default:                           return [];
  }
}

function finaliseSeedBucket(
  profile: Omit<SeedProfile, "bucket" | "onDominantCluster">,
  cluster: DominantCluster,
): { bucket: SeedBucket; onDominantCluster: boolean } {
  // Hard-ambiguous watchlist always → ambiguous, regardless of cluster
  if (profile.watchlistClass === "hard_ambiguous") {
    return { bucket: "ambiguous", onDominantCluster: false };
  }

  // No reliable cluster — bucket by reliability alone
  if (cluster.clusterKey === "unknown" || cluster.confidence < 0.35) {
    const bucket: SeedBucket =
      profile.reliability >= 0.70 ? "trusted"
      : profile.reliability >= 0.40 ? "weak"
      : "ambiguous";
    return { bucket, onDominantCluster: false };
  }

  const seedFamilies = new Set(profile.domainFamilies);
  const primary = primaryExpectedFamilies(cluster.clusterKey);
  const secondary = secondaryExpectedFamilies(cluster.clusterKey);

  const primaryMatch = primary.length > 0 && primary.some((f) => seedFamilies.has(f));
  const secondaryMatch = secondary.length > 0 && secondary.some((f) => seedFamilies.has(f));

  // Fallback path-based match for taxonomy:* clusters with no families defined
  const pathMatch = primary.length === 0 && secondary.length === 0
    ? lcpPaths(profile.path, cluster.path) >= cluster.path.length - 1
    : false;

  // Primary match → fully on-cluster, normal bucket logic
  if (primaryMatch || pathMatch) {
    const bucket: SeedBucket =
      profile.reliability >= 0.70 ? "trusted"
      : profile.reliability >= 0.40 ? "weak"
      : "ambiguous";
    return { bucket, onDominantCluster: true };
  }

  // Secondary-only match → partially on-cluster: capped at "weak", and we
  // intentionally report onDominantCluster=false so downstream consumers
  // don't treat it as strong evidence.
  if (secondaryMatch) {
    return { bucket: "weak", onDominantCluster: false };
  }

  // Clear identity but no family overlap → conflicting
  if (profile.normalisedEntityType !== "unknown") {
    return { bucket: "conflicting", onDominantCluster: false };
  }

  // No identity, no overlap
  return { bucket: "ambiguous", onDominantCluster: false };
}

// ── Landing 2b-ii: candidate scoring helpers ─────────────────────────────────
//
// 2b-ii uses the seed profiles + dominantCluster from 2b-i to actually shape
// ranking. Three new signals join sizeBandScore + typeBonus:
//
//   1. S_agree_w   — reliability-weighted cross-seed agreement (replaces the
//                    flat S_agree count from 2a). A candidate surfaced by 2
//                    trusted seeds should outrank one surfaced by 4 ambiguous
//                    seeds.
//   2. S_cluster_fit — INTENT-aware fit between the candidate and the
//                    inferred dominant cluster. The candidate is first
//                    classified into a fine-grained CandidateClass, then
//                    matched against a per-cluster primary/secondary table.
//                    Broad family overlap alone (e.g. just "music") no longer
//                    grants secondary credit — adjacency must be meaningful.
//   3. S_seed_quality — bonus when ALL surfacing seeds are trusted+onCluster,
//                    penalty when ALL are ambiguous/conflicting.
//
// Plus a hard quarantine: candidates whose only surfacing seeds are ambiguous
// (e.g. surfaced ONLY by "Gala") are dropped before scoring.

// Fine-grained candidate classification. Distinct from NormalisedEntityType
// (which targets seeds): candidates can be any Meta interest taxonomy node,
// including films, sports, lifestyle, etc., that seeds rarely are.
type CandidateClass =
  | "music_platform"
  | "electronic_genre"
  | "music_genre_other"
  | "music_artist_electronic"
  | "music_artist_other"
  // Festivals split into electronic (tight primary) vs generic (Country music
  // festivals, classical music festivals, etc. — secondary at best)
  | "electronic_music_festival"
  | "generic_music_festival"
  | "nightlife_venue"
  // Music media split: "music_media" is the tight electronic/underground media
  // (RA, Mixmag, DJ Mag, FACT, The Wire). Broader music radio / Rolling Stone /
  // NME / Kerrang / concerts-and-live-music → "generic_music_media"
  | "music_media"
  | "generic_music_media"
  | "fashion_brand"
  | "fashion_designer"
  // Fashion media split: "fashion_editorial_media" is tight editorial
  // (Vogue, Dazed, i-D, Another, 032c, SHOWstudio, etc.). Broader fashion
  // journalism/streetwear (Highsnobiety, Hypebeast, BoF, SSENSE) →
  // "fashion_media". Fashion blogs, generic fashion models/bloggers →
  // "generic_fashion_media".
  | "fashion_editorial_media"
  | "fashion_media"
  | "fashion_photography"
  | "generic_fashion_media"
  | "art_design"
  // Interior/industrial/graphic design → off-cluster for fashion_editorial
  | "generic_design"
  | "film_tv"
  | "lifestyle"
  | "sports"
  | "gaming"
  | "food_drink"
  | "travel"
  | "literature"
  | "tech_general"
  | "general_other"
  | "unknown";

/**
 * Classify a candidate into a single CandidateClass using deterministic rules.
 *
 * Order of precedence:
 *   1. Specific entity dictionaries (most reliable — e.g. "Spotify" → music_platform)
 *   2. Leaf-name semantic markers that beat path context (e.g. leaf=Lifestyle
 *      wins over path containing "Fashion")
 *   3. Strong off-music categorical markers (film/tv, sports, gaming, food,
 *      travel, literature) — surfaced before music context so a "Crime drama"
 *      under Entertainment > Music compilations doesn't get mis-tagged
 *   4. Music context (after non-music has been ruled out)
 *   5. Fashion / art / tech path catch-alls
 *   6. Last resort: general_other / unknown
 */
function classifyCandidate(name: string, path: string[]): CandidateClass {
  const norm = normaliseName(name);
  const nameLower = name.toLowerCase();
  const pathJoined = path.map((p) => p.toLowerCase()).join(" > ");
  const leaf = (path[path.length - 1] ?? "").toLowerCase();

  // 1. Specific entities
  if (matchesDict(name, MUSIC_PLATFORMS)) return "music_platform";
  if (matchesDict(name, FASHION_BRANDS)) return "fashion_brand";
  if (matchesDict(name, ELECTRONIC_ARTISTS)) return "music_artist_electronic";

  // Fashion media: editorial takes precedence over broader fashion_media
  if (matchesDict(name, FASHION_EDITORIAL_MEDIA)) return "fashion_editorial_media";
  if (matchesDict(name, FASHION_MEDIA)) return "fashion_media";

  // Music media: tight electronic/underground takes precedence; broader
  // rags fall to generic_music_media
  if (matchesDict(name, MUSIC_MEDIA)) {
    return matchesDict(name, ELECTRONIC_MUSIC_MEDIA) ? "music_media" : "generic_music_media";
  }

  if (matchesDict(name, NIGHTLIFE_EVENTS)) {
    if (/festival/i.test(norm)) {
      return matchesDict(name, ELECTRONIC_FESTIVALS)
        ? "electronic_music_festival"
        : "generic_music_festival";
    }
    return "nightlife_venue";
  }

  // 1b. Explicit per-name refinement overrides for nodes that don't fit a
  //     dict but carry strong cluster meaning. These are Meta taxonomy nodes
  //     we've observed as useful refinement anchors for electronic/nightlife
  //     clusters. Keep the list small and deterministic.
  //
  // "Disc jockey(s)" → electronic-artist adjacent (same diversity bucket).
  if (/^disc\s+jockeys?$/.test(norm)) return "music_artist_electronic";
  // "Record label" → music_media (label is music-industry infrastructure;
  // classify alongside RA/Mixmag/DJ Mag so it survives the gate and joins
  // the "media" diversity bucket).
  if (/^record\s+labels?$/.test(norm)) return "music_media";
  // "Parties" (Meta's "Parties (event)" node) → nightlife_venue, but ONLY
  // when path confirms nightlife/events context so we don't catch political
  // parties or similar unrelated nodes.
  if (/^parties$/.test(norm) && /\b(nightlife|events?|social|entertainment|hobbies)\b/.test(pathJoined)) {
    return "nightlife_venue";
  }

  // 2. Leaf-name semantic markers — these beat path context.
  //    A node whose own name says "Lifestyle" should NOT inherit "fashion"
  //    from a parent path.
  if (/\blifestyle\b/.test(leaf) || /\blifestyle\b/.test(nameLower)) return "lifestyle";

  // 2a. Fashion photography — specific discipline, always primary for editorial
  if (/\bfashion\s+photography\b/.test(nameLower)) return "fashion_photography";

  // 2b. Generic design (interior / industrial / graphic) — off-cluster for
  //     fashion_editorial. Kept separate from "art_design" which is broader
  //     fine art / architecture / painting.
  if (/\b(interior|industrial|graphic|product)\s+design\b/.test(nameLower)) {
    return "generic_design";
  }

  // 2c. Fashion blogs / generic fashion models / fashion bloggers → demoted.
  //     These are legitimate fashion adjacencies but too broad to rank
  //     alongside real editorial/designer/brand nodes.
  if (
    /\b(fashion|style)\b/.test(nameLower) &&
    /\b(blog|blogs|bloggers?)\b/.test(nameLower)
  ) {
    return "generic_fashion_media";
  }
  if (/\bfashion\s+(models?|modelling|modeling)\b/.test(nameLower)) {
    return "generic_fashion_media";
  }

  // 3. Strong off-music categorical markers (check before music context)
  if (
    /\b(films?|movies?|cinema|tv\s*shows?|television|drama|sitcom|reality\s*tv|anime|animation|crime\s*(drama|films?|shows?))\b/.test(
      nameLower,
    ) ||
    /\b(films?|movies?|cinema|tv\s*shows?|television|drama|series|entertainment\s*shows?)\b/.test(pathJoined)
  ) {
    return "film_tv";
  }

  if (
    /\bsports?\b/.test(pathJoined) ||
    /\b(football|soccer|basketball|tennis|golf|hockey|baseball|cricket|rugby|formula\s*1|nfl|nba|mlb|nhl)\b/.test(
      nameLower,
    )
  ) {
    return "sports";
  }

  if (
    /\b(games?|gaming|video\s*games?|esports?|consoles?)\b/.test(pathJoined) ||
    /\b(video\s*games?|gaming|esports?|playstation|xbox|nintendo)\b/.test(nameLower)
  ) {
    return "gaming";
  }

  if (
    /\bfood\s*(and|&)?\s*drink\b/.test(pathJoined) ||
    /\b(cooking|cuisine|wine|beer|coffee|restaurants?|recipes?|baking)\b/.test(nameLower)
  ) {
    return "food_drink";
  }

  if (
    /\btravel\b/.test(pathJoined) ||
    /\b(travel|tourism|hotels?|airlines?|destinations?|vacations?)\b/.test(nameLower)
  ) {
    return "travel";
  }

  if (
    /\b(books?|literature|literary|reading)\b/.test(pathJoined) ||
    /\bliterary\b/i.test(name) ||
    /\b(novel|poetry|fiction|non[\s-]?fiction)\b/.test(nameLower)
  ) {
    return "literature";
  }

  // 4. Music context — only after non-music has been ruled out
  const musicContextInPath = /\bmusic\b/.test(pathJoined) || /\belectronic\b/.test(pathJoined);

  // 4a. Festival-in-name within music context. Split into electronic-tight
  //     vs generic based on dict membership + keyword signals.
  if (musicContextInPath && /\bfestivals?\b/.test(nameLower)) {
    // Explicit non-electronic genre markers (country/folk/classical/jazz/
    // metal/pop/rock) → generic
    if (/\b(country|folk|bluegrass|classical|jazz|pop|rock|metal|christian|gospel|reggae|hip[\s-]?hop)\b/.test(nameLower)) {
      return "generic_music_festival";
    }
    // Electronic markers in name or path → electronic festival
    if (
      matchesDict(name, ELECTRONIC_FESTIVALS) ||
      /\b(electronic|techno|house|rave|edm|dance\s+music|club)\b/.test(nameLower) ||
      /\b(electronic|techno|house|rave|edm|dance)\b/.test(pathJoined)
    ) {
      return "electronic_music_festival";
    }
    // Default for an unqualified "Music festivals" / "Festivals" node
    return "generic_music_festival";
  }

  // 4b. Generic music media by keyword (no specific dict match): music radio,
  //     concerts, live music, etc. — broadly adjacent but too generic for a
  //     tight cluster primary slot.
  if (
    musicContextInPath &&
    /\b(radio|concerts?|live\s+music|live\s+performances?|concerts?\s+and\s+live\s+music)\b/.test(nameLower)
  ) {
    return "generic_music_media";
  }

  if (ELECTRONIC_GENRES.has(norm) ||
      // catch a few common broad terms Meta returns that aren't in the strict dict
      /^(electronic music|electronic dance music|edm)$/i.test(norm)) {
    return "electronic_genre";
  }

  if (OTHER_GENRES.has(norm) && musicContextInPath) return "music_genre_other";

  if (musicContextInPath) {
    if (
      /\b(artist|band|singer|musician|rapper|dj)\b/.test(nameLower) ||
      /\bmusicians?\s*(and|&)?\s*bands?\b/.test(pathJoined)
    ) {
      return "music_artist_other";
    }
    return "music_genre_other";
  }

  // 5. Fashion / art / tech path catch-alls
  if (/\bfashion\b/.test(pathJoined) || /\bclothing\b/.test(pathJoined)) return "fashion_designer";

  if (/\b(art|design|architecture|painting|sculpture|photography|graphic\s*design)\b/.test(pathJoined)) {
    return "art_design";
  }

  if (/\b(technology|computers?|software|hardware|gadgets?)\b/.test(pathJoined)) return "tech_general";

  // 6. Last resort
  if (path.length > 0 && path[0] === "Interests") return "general_other";
  return "unknown";
}

/**
 * Per-cluster candidate-class expectations. Strict by design: only classes
 * that are genuinely on-cluster get primary/secondary. Anything else with a
 * known class → off_cluster. Only "general_other" / "unknown" stay neutral
 * so we don't punish sparse-path nodes.
 */
const CLUSTER_FIT_RULES: Partial<Record<ClusterKey, {
  primary: ReadonlyArray<CandidateClass>;
  secondary: ReadonlyArray<CandidateClass>;
}>> = {
  music_platforms: {
    primary: ["music_platform"],
    secondary: ["music_media"], // tight electronic/underground music journalism
    // Everything else (music genres, artists, festivals, nightlife, generic
    // music media, fashion) → off-cluster for a platforms cluster.
  },
  electronic_music_nightlife: {
    primary: [
      "electronic_genre",
      "music_artist_electronic",
      "nightlife_venue",
      "electronic_music_festival",
      "music_media", // tight electronic-specific media (RA, Mixmag, etc.)
    ],
    secondary: [
      "music_genre_other",          // broader genres (still music)
      "generic_music_festival",     // Country/classical/rock festivals — allowed but demoted
    ],
    // generic_music_media (Music radio, Concerts and live music),
    // music_platform, film_tv, lifestyle, fashion → off-cluster.
  },
  music_general: {
    primary: [
      "electronic_genre",
      "music_genre_other",
      "music_artist_electronic",
      "music_artist_other",
      "electronic_music_festival",
      "generic_music_festival",
      "music_media",
    ],
    secondary: [
      "music_platform",
      "nightlife_venue",
      "generic_music_media",       // radio/concerts are OK in a broad music cluster
    ],
  },
  fashion_editorial: {
    primary: [
      "fashion_brand",
      "fashion_designer",
      "fashion_editorial_media",   // Vogue, Dazed, i-D, SHOWstudio, etc.
      "fashion_photography",
    ],
    secondary: [
      "fashion_media",              // Highsnobiety, Hypebeast, BoF, SSENSE — allowed but demoted
      "generic_fashion_media",      // Fashion blog, Fashion models — allowed but demoted
      "art_design",
    ],
    // generic_design (interior/industrial/graphic design), film_tv, music,
    // literature → off-cluster.
  },
  fashion_brands: {
    primary: ["fashion_brand", "fashion_designer"],
    secondary: ["fashion_editorial_media", "fashion_media"],
  },
  literature_media: {
    primary: ["literature"],
    secondary: [],
  },
};

// ── Landing 2c — Stage R2 curated rescue seeds ──────────────────────────────
// Hand-curated, cluster-specific seed names used when first-pass per-seed
// retrieval is too thin to feed candidate_expansion. These seeds are NOT
// hardcoded as final suggestions — they go through Meta's adinterestsuggestion
// just like any other expansion seed and pass the full pipeline (enrichment,
// structural filter, blocklist, classifier, cluster fit, final gate). They
// only widen the input to that pipeline so on-cluster candidates have a chance
// to surface.
//
// Rules of thumb when adding entries:
//   - Use exact names that resolve cleanly via adinterestsuggestion.
//   - Bias toward strong, unambiguous nodes that anchor the cluster identity.
//   - Avoid anything that would self-classify off-cluster (would be wasted).
const CURATED_RESCUE_SEEDS: Partial<Record<ClusterKey, ReadonlyArray<string>>> = {
  music_platforms: [
    "SoundCloud",
    "TIDAL",
    "Deezer",
    "YouTube Music",
    "Amazon Music",
    "Mixmag",
    "Resident Advisor",
  ],
  music_general: [
    "Spotify",
    "Music festivals",
    "Live music",
    "Mixmag",
    "Resident Advisor",
  ],
  electronic_music_nightlife: [
    // media — widen non-genre refinement nodes first
    "Mixmag",
    "Resident Advisor",
    "DJ Mag",
    "NTS Radio",
    "Record label",
    // nightlife / misc — venues + DJ-centric refinement
    "Disc jockeys",
    "Parties",
    "Berghain",
    "Fabric",
    "Boiler Room",
    // festival
    "Awakenings",
    "Dekmantel",
    "Tomorrowland",
    "Time Warp",
    "Sonar",
    // genre (kept last — bucket-aware ordering promotes these only
    // when genre coverage is missing from the current eligible set)
    "Tech house",
    "Deep house",
    "Electro house",
    "Electro",
    "Dance music",
    "Club music",
    "House music",
  ],
  fashion_editorial: [
    // editorial — widen high-quality magazines first
    "Vogue",
    "Dazed",
    "i-D",
    "Another Magazine",
    "SHOWstudio",
    "Nylon",
    "Paper",
    "Elle",
    "Glamour",
    "Harper's Bazaar",
    "W Magazine",
    "Cosmopolitan",
    "The Face",
    "Purple",
    "Numéro",
    "Document Journal",
    "System Magazine",
    // brand_designer — widen beyond avant-garde into luxury
    "Rick Owens",
    "Raf Simons",
    "Maison Margiela",
    "Comme des Garçons",
    "Helmut Lang",
    "Prada",
    "Chanel",
    "Gucci",
    "Louis Vuitton",
    "Versace",
    "Burberry",
    "Dolce & Gabbana",
    // photography
    "Fashion photography",
    // generic_fashion catch
    "Editorial fashion",
  ],
  fashion_brands: [
    "Rick Owens",
    "Raf Simons",
    "Maison Margiela",
    "Comme des Garçons",
    "Yohji Yamamoto",
  ],
  literature_media: [
    "Literary magazine",
    "Independent magazine",
  ],
};

type ClusterFitClass = "primary" | "secondary" | "off_cluster" | "neutral" | "unknown_cluster";

// ── Hard-negative markers for specific clusters ──────────────────────────────
// When the cluster's intent is genuinely narrow (e.g. electronic music +
// nightlife), candidates whose name or path contains any of these markers —
// and NO corresponding electronic counter-marker — are forced off-cluster even
// if their class would otherwise classify as primary/secondary. This is the
// smallest possible override: it runs before the rules.primary/secondary
// check and otherwise leaves the fit rules alone.
const ELECTRONIC_CLUSTER_NON_ELECTRONIC_MARKERS =
  /\b(country|folk|bluegrass|jazz|classical|gospel|acoustic|singer[\s-]?songwriter|performing\s+arts|broadway|opera|reggae|latin\s+music|soul\s+music|blues)\b/i;
const ELECTRONIC_CLUSTER_ROCK_MARKERS =
  // Any form of rock music — standalone "rock", compound ("alternative rock",
  // "classic rock"), or rock-music / rock-bands / rock-festivals phrasing.
  /\brock\b/i;
const ELECTRONIC_CLUSTER_COUNTER_MARKERS =
  /\b(electronic|techno|house|rave|edm|dance\s+music|club\s+music|trance|drum\s+and\s+bass|dnb|drum\s*n\s*bass|dubstep|ambient|electro|electroclash|breakbeat|breaks|industrial\s+techno|minimal|idm|hardstyle|gabber|jungle|footwork|uk\s+garage)\b/i;

// ── Per-class weak-secondary override ────────────────────────────────────────
// Some CandidateClasses are technically allowed as "secondary" (they're too
// broadly adjacent to drop entirely) but should rank well below real
// secondaries. Assigning them a lower cluster-fit score is the smallest
// surgical change that keeps them surviving the strict gate while forcing
// them below electronic-specific / editorial-tight candidates.
const WEAK_SECONDARY_POINTS: Partial<Record<CandidateClass, number>> = {
  generic_fashion_media: 2,   // Fashion blog, Fashion models — survive but demoted
  generic_music_festival: 2,  // bare "Music festivals" — demoted vs electronic festivals
  generic_music_media: 2,     // radio/concerts in a broad music cluster — demoted
};

// ── Final diversification layer (post-gate, pre-cap) ────────────────────────
// The ranking model produces a score-ordered list. On narrow cultural
// clusters (electronic music / nightlife, fashion editorial) that list can
// end up dominated by one candidate family (e.g. all genres, no media /
// nightlife / festival). Meta Audience Manager's "similar interests" panel
// mixes families; we replicate that SHAPE here with a soft per-bucket cap.
//
// Soft behaviour:
//   phase 1 — walk the eligible list by score, pick into final slots, but
//             skip candidates whose family cap is already full.
//   phase 2 — if slots remain, fill with the skipped candidates in score
//             order so a thin pool never leaves us empty.
//
// This is purely a reorder — no new drops, no gate change, no score edits.

type DiversityBucket =
  | "genre" | "festival" | "media" | "nightlife" | "artist"          // EMN
  | "editorial" | "brand_designer" | "generic_fashion"
  | "photography" | "design"                                          // FED
  | "other";

function diversityDisplayBucket(
  candidateClass: CandidateClass | undefined,
  clusterKey: ClusterKey,
): DiversityBucket {
  if (clusterKey === "electronic_music_nightlife") {
    switch (candidateClass) {
      case "electronic_genre":
      case "music_genre_other":
        return "genre";
      case "electronic_music_festival":
      case "generic_music_festival":
        return "festival";
      case "music_media":
      case "generic_music_media":
        return "media";
      case "nightlife_venue":
        return "nightlife";
      case "music_artist_electronic":
      case "music_artist_other":
        return "artist";
      default:
        return "other";
    }
  }
  if (clusterKey === "fashion_editorial") {
    switch (candidateClass) {
      case "fashion_editorial_media":
        return "editorial";
      case "fashion_brand":
      case "fashion_designer":
        return "brand_designer";
      case "fashion_media":
      case "generic_fashion_media":
        return "generic_fashion";
      case "fashion_photography":
        return "photography";
      case "art_design":
      case "generic_design":
        return "design";
      default:
        return "other";
    }
  }
  return "other";
}

// Maps DisplayBucket → cap-group. Multiple display buckets can share one
// cap-group (e.g. nightlife/artist/other share EMN "misc" with cap 2).
type CapPlan = { group: Record<DiversityBucket, string>; limit: Record<string, number> };

const EMN_CAP_PLAN: CapPlan = {
  group: {
    genre: "genre",
    festival: "festival",
    media: "media",
    nightlife: "misc",
    artist: "misc",
    other: "misc",
    // unused in EMN but must be typed — route to "misc" as a safe default
    editorial: "misc", brand_designer: "misc", generic_fashion: "misc",
    photography: "misc", design: "misc",
  },
  limit: {
    genre: 4,
    festival: 2,
    media: 2,
    misc: 2, // nightlife + artist + other combined
  },
};

const FED_CAP_PLAN: CapPlan = {
  group: {
    editorial: "editorial",
    brand_designer: "brand_designer",
    generic_fashion: "generic_fashion",
    photography: "photo_design",
    design: "photo_design",
    other: "other",
    // unused in FED — safe default
    genre: "other", festival: "other", media: "other",
    nightlife: "other", artist: "other",
  },
  limit: {
    editorial: 3,
    brand_designer: 3,
    generic_fashion: 2,
    photo_design: 1,      // photography + design combined
    other: 2,
  },
};

function capPlanFor(clusterKey: ClusterKey): CapPlan | null {
  if (clusterKey === "electronic_music_nightlife") return EMN_CAP_PLAN;
  if (clusterKey === "fashion_editorial") return FED_CAP_PLAN;
  return null;
}

// ── Rescue-seed predicted buckets (Landing 2e) ──────────────────────────────
// When we pick curated rescue seeds for Stage R2, we want to bias toward
// seeds whose PREDICTED diversity bucket is under-represented in the current
// eligible set. The real bucket is only known AFTER the pipeline runs on the
// expansion results, so we use a deterministic hand-curated mapping here.
// Missing entries fall through to "other".
const RESCUE_SEED_PREDICTED_BUCKET: Partial<Record<ClusterKey, Record<string, DiversityBucket>>> = {
  electronic_music_nightlife: {
    // media
    "mixmag": "media",
    "resident advisor": "media",
    "dj mag": "media",
    "dj magazine": "media",
    "nts radio": "media",
    "nts": "media",
    "record label": "media",
    "the wire": "media",
    "fact": "media",
    "crack": "media",
    "clash": "media",
    // nightlife (venues) / artist (DJs) / other → all collapse to EMN "misc"
    "disc jockey": "artist",
    "disc jockeys": "artist",
    "parties": "nightlife",
    "berghain": "nightlife",
    "fabric": "nightlife",
    "fabric london": "nightlife",
    "boiler room": "nightlife",
    "tresor": "nightlife",
    "panorama bar": "nightlife",
    // festival
    "awakenings": "festival",
    "dekmantel": "festival",
    "tomorrowland": "festival",
    "time warp": "festival",
    "sonar": "festival",
    "sónar": "festival",
    "movement festival": "festival",
    "boiler room festival": "festival",
    "dgtl": "festival",
    "amsterdam dance event": "festival",
    "ade": "festival",
    "creamfields": "festival",
    "music festivals": "festival",
    // genre (kept broad — bucket-aware ordering will push these down when
    // genre slots are already filled)
    "house music": "genre",
    "tech house": "genre",
    "deep house": "genre",
    "electro house": "genre",
    "electro": "genre",
    "dance music": "genre",
    "club music": "genre",
    "techno": "genre",
    "live music": "media",
  },
  fashion_editorial: {
    // editorial
    "vogue": "editorial",
    "dazed": "editorial",
    "i-d": "editorial",
    "another magazine": "editorial",
    "showstudio": "editorial",
    "nylon": "editorial",
    "paper": "editorial",
    "elle": "editorial",
    "glamour": "editorial",
    "harper's bazaar": "editorial",
    "w magazine": "editorial",
    "cosmopolitan": "editorial",
    "the face": "editorial",
    "purple": "editorial",
    "numéro": "editorial",
    "numero": "editorial",
    "document journal": "editorial",
    "system magazine": "editorial",
    // brand_designer
    "rick owens": "brand_designer",
    "comme des garçons": "brand_designer",
    "comme des garcons": "brand_designer",
    "prada": "brand_designer",
    "chanel": "brand_designer",
    "gucci": "brand_designer",
    "louis vuitton": "brand_designer",
    "versace": "brand_designer",
    "burberry": "brand_designer",
    "dolce & gabbana": "brand_designer",
    "dolce and gabbana": "brand_designer",
    "helmut lang": "brand_designer",
    "raf simons": "brand_designer",
    "maison margiela": "brand_designer",
    // photography
    "fashion photography": "photography",
    // generic_fashion catch
    "editorial fashion": "generic_fashion",
  },
};

function predictRescueBucket(name: string, clusterKey: ClusterKey): DiversityBucket {
  const table = RESCUE_SEED_PREDICTED_BUCKET[clusterKey];
  if (!table) return "other";
  return table[name.toLowerCase()] ?? "other";
}

// ── Cluster-specific rescue group priority (Landing 2f) ─────────────────────
// Raw missingCapacity was too easily dominated by whichever group has the
// largest cap (EMN genre cap=4 → missingWeight=3 when empty, outranking
// media/misc/festival missing=2). This table encodes *intent* so non-genre
// refinement is preferred even when its cap is smaller. Higher = preferred.
//
// Used only for curated rescue seed ordering in Stage R2. Has NO effect on:
//   - first-pass retrieval
//   - the strict eligibility gate
//   - the diversification cap plan itself
//   - music_platforms (absent from this table → no reordering happens)
const CLUSTER_RESCUE_GROUP_PRIORITY: Partial<Record<ClusterKey, Record<string, number>>> = {
  electronic_music_nightlife: {
    media: 4,
    misc: 3,
    festival: 2,
    genre: 0,
  },
  fashion_editorial: {
    editorial: 4,
    brand_designer: 3,
    photo_design: 2,
    other: -1,
    generic_fashion: -2,
  },
};

// Saturation penalty — pushes a group's rescue seeds further down when the
// current eligible set already has enough of that group, so e.g. genre
// rescue seeds don't keep crowding out media/misc when genre is already
// represented.
function rescueSaturationPenalty(
  clusterKey: ClusterKey,
  group: string,
  currentByGroup: Record<string, number>,
): number {
  if (
    clusterKey === "electronic_music_nightlife" &&
    group === "genre" &&
    (currentByGroup["genre"] ?? 0) >= 2
  ) {
    return 5;
  }
  if (
    clusterKey === "fashion_editorial" &&
    group === "generic_fashion" &&
    (currentByGroup["generic_fashion"] ?? 0) >= 1
  ) {
    return 3;
  }
  return 0;
}

// Combined priority score for a curated rescue seed. Higher is better.
// When the seed's group has 0 missing capacity we drive the score deep
// negative (but preserve relative group order among saturated groups so
// the debug log still makes sense).
function computeRescuePriorityScore(
  clusterKey: ClusterKey,
  group: string,
  missingWeight: number,
  currentByGroup: Record<string, number>,
): number {
  const groupPriority = CLUSTER_RESCUE_GROUP_PRIORITY[clusterKey]?.[group] ?? 0;
  if (missingWeight <= 0) return -100 + groupPriority;
  const penalty = rescueSaturationPenalty(clusterKey, group, currentByGroup);
  return groupPriority + missingWeight - penalty;
}

function diversifyFinalSuggestions(
  eligible: SuggestedInterest[],
  clusterKey: ClusterKey,
  max: number,
): {
  picked: SuggestedInterest[];
  bucketByName: Record<string, DiversityBucket>;
  distributionBefore: Record<string, number>;
  distributionAfter: Record<string, number>;
  skippedAtCap: Array<{ name: string; bucket: DiversityBucket; group: string }>;
  applied: boolean;
  phase1GroupCounts: Record<string, number>;
  phase2GroupCounts: Record<string, number>;
} {
  const bucketByName: Record<string, DiversityBucket> = {};
  const distributionBefore: Record<string, number> = {};
  const distributionAfter: Record<string, number> = {};
  const phase1GroupCounts: Record<string, number> = {};
  const phase2GroupCounts: Record<string, number> = {};

  // Always compute display buckets so debug/logging is available even when
  // the cluster has no diversity plan.
  for (const s of eligible) {
    const b = diversityDisplayBucket(s.candidateClass, clusterKey);
    bucketByName[s.name] = b;
    distributionBefore[b] = (distributionBefore[b] ?? 0) + 1;
  }

  const plan = capPlanFor(clusterKey);
  if (!plan) {
    const picked = eligible.slice(0, max);
    for (const s of picked) {
      const b = bucketByName[s.name] ?? "other";
      distributionAfter[b] = (distributionAfter[b] ?? 0) + 1;
    }
    return {
      picked, bucketByName, distributionBefore, distributionAfter,
      skippedAtCap: [], applied: false,
      phase1GroupCounts, phase2GroupCounts,
    };
  }

  const picked: SuggestedInterest[] = [];
  const skipped: SuggestedInterest[] = [];
  const skippedAtCap: Array<{ name: string; bucket: DiversityBucket; group: string }> = [];
  const capCounts: Record<string, number> = {};

  // ── Phase 1 — score-ordered greedy pick, respecting per-group caps.
  for (const s of eligible) {
    if (picked.length >= max) break;
    const bucket = bucketByName[s.name] ?? "other";
    const group = plan.group[bucket] ?? "other";
    const limit = plan.limit[group] ?? max;
    const current = capCounts[group] ?? 0;
    if (current < limit) {
      picked.push(s);
      capCounts[group] = current + 1;
      phase1GroupCounts[group] = (phase1GroupCounts[group] ?? 0) + 1;
    } else {
      skipped.push(s);
      skippedAtCap.push({ name: s.name, bucket, group });
    }
  }

  // ── Phase 2 — fill remaining slots from skipped, preferring the group
  //     with the lowest current count in picked[]. This avoids all remaining
  //     fill going back to whichever group dominated Phase 1's score order.
  //     Tiebreak by score desc, then by original order.
  const skippedQueue = [...skipped];
  while (picked.length < max && skippedQueue.length > 0) {
    let bestIdx = -1;
    let bestCurrent = Number.POSITIVE_INFINITY;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < skippedQueue.length; i++) {
      const s = skippedQueue[i];
      const bucket = bucketByName[s.name] ?? "other";
      const group = plan.group[bucket] ?? "other";
      const cur = capCounts[group] ?? 0;
      if (cur < bestCurrent || (cur === bestCurrent && s.score > bestScore)) {
        bestCurrent = cur;
        bestScore = s.score;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const chosen = skippedQueue.splice(bestIdx, 1)[0];
    const bucket = bucketByName[chosen.name] ?? "other";
    const group = plan.group[bucket] ?? "other";
    capCounts[group] = (capCounts[group] ?? 0) + 1;
    phase2GroupCounts[group] = (phase2GroupCounts[group] ?? 0) + 1;
    picked.push(chosen);
  }

  for (const s of picked) {
    const b = bucketByName[s.name] ?? "other";
    distributionAfter[b] = (distributionAfter[b] ?? 0) + 1;
  }
  return {
    picked, bucketByName, distributionBefore, distributionAfter,
    skippedAtCap, applied: true,
    phase1GroupCounts, phase2GroupCounts,
  };
}

function computeClusterFit(
  candidateName: string,
  candidatePath: string[],
  cluster: DominantCluster,
): {
  fitClass: ClusterFitClass;
  points: number;
  candidateClass: CandidateClass;
  reason: string;
} {
  const candidateClass = classifyCandidate(candidateName, candidatePath);

  if (cluster.clusterKey === "unknown" || cluster.confidence < 0.35) {
    return { fitClass: "unknown_cluster", points: 0, candidateClass, reason: "no_dominant_cluster" };
  }

  const rules = CLUSTER_FIT_RULES[cluster.clusterKey];
  if (!rules) {
    // Cluster keys without explicit rules (e.g. taxonomy:* fallbacks) get a
    // neutral verdict — we don't have enough cluster definition to penalise.
    return { fitClass: "neutral", points: 0, candidateClass, reason: `no_rules_for_${cluster.clusterKey}` };
  }

  // ── Cluster-specific hard negatives (before primary/secondary lookup) ────
  if (cluster.clusterKey === "electronic_music_nightlife") {
    const nameLower = candidateName.toLowerCase();
    const pathJoined = candidatePath.map((p) => p.toLowerCase()).join(" > ");
    const hasElectronicCounter =
      ELECTRONIC_CLUSTER_COUNTER_MARKERS.test(nameLower) ||
      ELECTRONIC_CLUSTER_COUNTER_MARKERS.test(pathJoined);
    if (!hasElectronicCounter) {
      if (ELECTRONIC_CLUSTER_NON_ELECTRONIC_MARKERS.test(nameLower)) {
        return {
          fitClass: "off_cluster",
          points: -15,
          candidateClass,
          reason: `non_electronic_marker_in_name (${cluster.clusterKey})`,
        };
      }
      if (ELECTRONIC_CLUSTER_NON_ELECTRONIC_MARKERS.test(pathJoined)) {
        return {
          fitClass: "off_cluster",
          points: -15,
          candidateClass,
          reason: `non_electronic_marker_in_path (${cluster.clusterKey})`,
        };
      }
      if (ELECTRONIC_CLUSTER_ROCK_MARKERS.test(nameLower)) {
        return {
          fitClass: "off_cluster",
          points: -15,
          candidateClass,
          reason: `rock_marker_in_name (${cluster.clusterKey})`,
        };
      }
      // Rock in path alone (e.g. "Interests > Music > Alternative rock") is
      // also disqualifying — these are rock-rooted taxonomy nodes.
      if (/\brock\b/i.test(pathJoined)) {
        return {
          fitClass: "off_cluster",
          points: -15,
          candidateClass,
          reason: `rock_marker_in_path (${cluster.clusterKey})`,
        };
      }
    }
  }

  if (rules.primary.includes(candidateClass)) {
    // Per-name soft demote for broad genre anchors (bare "House music" /
    // "Dance music" / "Club music"). Still primary (survives strict gate)
    // but scored at +10 so tight anchors like Tech house / Deep house /
    // Techno (+20) and on-cluster refinement media (Mixmag, RA, NTS,
    // Record label → +20 primary or +20 via music_media primary) rank above.
    if (
      cluster.clusterKey === "electronic_music_nightlife" &&
      candidateClass === "electronic_genre" &&
      BROAD_GENRE_SOFT_DEMOTE.has(normaliseName(candidateName))
    ) {
      return {
        fitClass: "primary",
        points: 10,
        candidateClass,
        reason: `${candidateClass} ∈ primary[${cluster.clusterKey}] (broad_genre_soft_demote, +10)`,
      };
    }
    return {
      fitClass: "primary",
      points: 20,
      candidateClass,
      reason: `${candidateClass} ∈ primary[${cluster.clusterKey}]`,
    };
  }

  if (rules.secondary.includes(candidateClass)) {
    const weak = WEAK_SECONDARY_POINTS[candidateClass];
    if (weak !== undefined) {
      return {
        fitClass: "secondary",
        points: weak,
        candidateClass,
        reason: `${candidateClass} ∈ secondary[${cluster.clusterKey}] (weak_secondary, +${weak})`,
      };
    }
    return {
      fitClass: "secondary",
      points: 5,
      candidateClass,
      reason: `${candidateClass} ∈ secondary[${cluster.clusterKey}]`,
    };
  }

  // Sparse-signal candidate — neutral, no penalty
  if (candidateClass === "unknown" || candidateClass === "general_other") {
    return {
      fitClass: "neutral",
      points: 0,
      candidateClass,
      reason: `${candidateClass} (no signal)`,
    };
  }

  // Clearly belongs to another category → penalise
  return {
    fitClass: "off_cluster",
    points: -15,
    candidateClass,
    reason: `${candidateClass} ∉ rules[${cluster.clusterKey}]`,
  };
}

type SeedQualityClass = "all_good" | "all_bad" | "mixed" | "no_seeds";

function computeSeedQuality(
  sourceSeedIds: string[],
  seedProfiles: Map<string, SeedProfile>,
): { qualityClass: SeedQualityClass; points: number; quarantine: boolean } {
  if (sourceSeedIds.length === 0) {
    return { qualityClass: "no_seeds", points: 0, quarantine: false };
  }
  let trustedOnCluster = 0;
  let ambiguousOrConflicting = 0;
  let ambiguousOnly = 0;
  let resolved = 0;
  for (const sid of sourceSeedIds) {
    const p = seedProfiles.get(sid);
    if (!p) continue;
    resolved++;
    if (p.bucket === "trusted" && p.onDominantCluster) trustedOnCluster++;
    if (p.bucket === "ambiguous" || p.bucket === "conflicting") ambiguousOrConflicting++;
    if (p.bucket === "ambiguous") ambiguousOnly++;
  }
  if (resolved === 0) {
    return { qualityClass: "no_seeds", points: 0, quarantine: false };
  }
  // Quarantine: every surfacing seed was judged ambiguous (e.g. lone "Gala").
  // Conflicting seeds escape quarantine because they have clear identity, just
  // off-cluster — penalised via -25 instead.
  const quarantine = ambiguousOnly === resolved;
  if (trustedOnCluster === resolved) return { qualityClass: "all_good", points: 5, quarantine };
  if (ambiguousOrConflicting === resolved) return { qualityClass: "all_bad", points: -25, quarantine };
  return { qualityClass: "mixed", points: 0, quarantine };
}

function computeWeightedAgreement(
  sourceSeedIds: string[],
  retrievalSeedIds: string[],
  seedProfiles: Map<string, SeedProfile>,
): { value: number; weightSurfacing: number; weightTotal: number } {
  let weightTotal = 0;
  for (const sid of retrievalSeedIds) {
    const p = seedProfiles.get(sid);
    weightTotal += p ? Math.max(p.reliability, 0.05) : 0.05; // floor so weights never collapse to zero
  }
  let weightSurfacing = 0;
  for (const sid of sourceSeedIds) {
    const p = seedProfiles.get(sid);
    weightSurfacing += p ? Math.max(p.reliability, 0.05) : 0.05;
  }
  const value = weightTotal > 0 ? weightSurfacing / weightTotal : 0;
  return { value, weightSurfacing, weightTotal };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_ACCESS_TOKEN is not configured on the server" },
      { status: 500 },
    );
  }

  const params = req.nextUrl.searchParams;
  const ids = params.getAll("ids[]");
  const names = params.getAll("names[]");
  const cluster = params.get("cluster") ?? "";
  // ?debug=1 disables all local filtering so we can see raw Meta output
  const debugBypass = params.get("debug") === "1";
  // ?fallback=loose lets off_cluster + neutral candidates back into the final
  // output when the strict eligibility gate would otherwise return zero. Use
  // sparingly — the default is to return empty rather than show off-cluster
  // junk on a high-confidence cluster.
  const allowLooseFallback = params.get("fallback") === "loose";
  const excludeIds = new Set([
    ...ids,
    ...params.getAll("exclude[]"),
  ]);

  // ── Step 1: validate received params ──────────────────────────────────────
  console.info(
    `[interest-suggestions] ▶ request — cluster="${cluster}" debug=${debugBypass}` +
    `\n  ids received (${ids.length}): ${ids.join(", ") || "(none)"}` +
    `\n  names received (${names.length}): ${names.join(", ") || "(none)"}`,
  );

  if (ids.length === 0) {
    console.info("[interest-suggestions] ✗ no IDs received — returning empty");
    return NextResponse.json({
      suggestions: [], count: 0,
      emptyReason: "no_ids",
      debug: { receivedIds: [], receivedNames: [], validSeedCount: 0 },
    });
  }

  // ── Step 2: build seed name list ─────────────────────────────────────────
  // adinterestsuggestion uses interest_list = JSON array of plain name strings.
  // interest_fbid_list is for adinterestvalid (validation only) and causes
  // Meta 500 "unknown error" when sent to the suggestion endpoint.
  //
  // Sort: real Meta numeric IDs first (higher confidence), then name-only.

  const ID_RE = /^\d{5,}$/;
  const allSeeds = ids.map((id, i) => ({
    id,
    name: (names[i] ?? "").trim(),
    hasRealId: ID_RE.test(id),
  })).filter((s) => s.name.length > 0);

  const invalidIds = ids.filter((id) => !ID_RE.test(id));

  const sortedSeeds = [
    ...allSeeds.filter((s) => s.hasRealId),
    ...allSeeds.filter((s) => !s.hasRealId),
  ];

  console.info(
    `[interest-suggestions] seeds:` +
    `\n  total (${sortedSeeds.length}): ${sortedSeeds.map((s) => `${s.name}(id=${s.id},realId=${s.hasRealId})`).join(", ") || "(none)"}` +
    `\n  non-numeric IDs (${invalidIds.length}): ${invalidIds.join(", ") || "(none)"}`,
  );

  if (sortedSeeds.length === 0) {
    console.info("[interest-suggestions] ✗ no usable seed names — returning empty");
    return NextResponse.json({
      suggestions: [], count: 0,
      emptyReason: "no_valid_ids",
      debug: { receivedIds: ids, receivedNames: names, validSeedCount: 0, invalidSeedIds: invalidIds },
    });
  }

  // ── Step 3: Meta call helper ──────────────────────────────────────────────

  const tokenPrefix = token.slice(0, 12) + "…";

  function buildMetaUrl(seedNames: string[]): { url: string; urlSafe: string; payloadValue: string } {
    const payloadValue = JSON.stringify(seedNames);
    const url =
      `${BASE}/search` +
      `?access_token=${encodeURIComponent(token!)}` +
      `&type=adinterestsuggestion` +
      `&interest_list=${encodeURIComponent(payloadValue)}` +
      `&limit=30`;
    const urlSafe =
      `${BASE}/search` +
      `?access_token=${tokenPrefix}` +
      `&type=adinterestsuggestion` +
      `&interest_list=${encodeURIComponent(payloadValue)}` +
      `&limit=30`;
    return { url, urlSafe, payloadValue };
  }

  type MetaRaw = Array<{ id: string; name: string; audience_size?: number; path?: string[] }>;

  async function callMeta(seedNames: string[], attempt: string): Promise<
    | { ok: true; data: MetaRaw; httpStatus: number; urlSafe: string; payloadValue: string }
    | { ok: false; errMsg: string; errCode: unknown; errSubcode: unknown; httpStatus: number; urlSafe: string; payloadValue: string }
  > {
    const { url, urlSafe, payloadValue } = buildMetaUrl(seedNames);
    console.info(
      `[interest-suggestions] ▶ Meta call (${attempt}):` +
      `\n  token prefix: ${tokenPrefix}` +
      `\n  payload mode: interest_list` +
      `\n  seedCount: ${seedNames.length}` +
      `\n  seedNamesSent: ${JSON.stringify(seedNames)}` +
      `\n  url (safe): ${urlSafe}`,
    );

    let res: Response;
    let httpStatus = 0;
    try {
      res = await fetch(url, { cache: "no-store" });
      httpStatus = res.status;
    } catch (err) {
      console.error(`[interest-suggestions] ✗ network error (${attempt}):`, err);
      return { ok: false, errMsg: "Network error", errCode: null, errSubcode: null, httpStatus: 0, urlSafe, payloadValue };
    }

    const json = (await res.json()) as Record<string, unknown>;
    console.info(
      `[interest-suggestions] Meta response (${attempt}): HTTP ${httpStatus}` +
      `\n  has error: ${!!json.error}` +
      `\n  raw body preview: ${JSON.stringify(json).slice(0, 400)}`,
    );

    if (!res.ok || json.error) {
      const e = (json.error ?? {}) as Record<string, unknown>;
      const errMsg = (e.message as string) ?? `HTTP ${httpStatus}`;
      const errCode = e.code;
      const errSubcode = e.error_subcode;
      console.error(
        `[interest-suggestions] ✗ Meta error (${attempt}): message=${errMsg} code=${errCode} subcode=${errSubcode}` +
        `\n  full: ${JSON.stringify(e)}`,
      );
      return { ok: false, errMsg, errCode, errSubcode, httpStatus, urlSafe, payloadValue };
    }

    const data = (json.data as MetaRaw) ?? [];
    return { ok: true, data, httpStatus, urlSafe, payloadValue };
  }

  // ── Step 3.5: seed enrichment + profiling + cluster inference (2b-i) ─────
  // OBSERVATION ONLY — populates seedProfiles + dominantCluster in the debug
  // payload and logs them, but does not influence retrieval or scoring yet.
  // Graceful: if enrichment fails, every seed is profiled as "ambiguous" with
  // empty path and we fall back to a zero-confidence cluster.

  const seedIdsForEnrichment = sortedSeeds.filter((s) => s.hasRealId).map((s) => s.id);
  let seedEnriched = new Map<string, EnrichedInterest>();
  try {
    const res = await enrichCandidates(seedIdsForEnrichment, token, BASE);
    seedEnriched = res.enriched;
  } catch (err) {
    console.error(`[interest-suggestions] ✗ seed enrichment threw — proceeding with empty profiles:`, err);
  }

  const partialSeedProfiles = sortedSeeds.map((s) =>
    profileSeedPartial(s.id, s.name, seedEnriched),
  );

  const dominantCluster = inferDominantClusterHybrid(
    partialSeedProfiles.map((p) => ({
      id: p.id,
      reliability: p.reliability,
      normalisedEntityType: p.normalisedEntityType,
      domainFamilies: p.domainFamilies,
      path: p.path,
    })),
  );

  const seedProfiles = new Map<string, SeedProfile>();
  for (const p of partialSeedProfiles) {
    const { bucket, onDominantCluster } = finaliseSeedBucket(p, dominantCluster);
    seedProfiles.set(p.id, { ...p, bucket, onDominantCluster });
  }

  const bucketCounts = { trusted: 0, weak: 0, ambiguous: 0, conflicting: 0 };
  for (const p of seedProfiles.values()) bucketCounts[p.bucket]++;

  const fmtShare = (obj: Record<string, number | undefined>): string =>
    Object.entries(obj)
      .filter(([, v]) => typeof v === "number" && v > 0)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .map(([k, v]) => `${k}=${((v ?? 0) * 100).toFixed(0)}%`)
      .join(" ") || "(none)";

  // Compute primary/secondary family match for log display only — does NOT
  // affect ranking. Lets us see at a glance why a seed is on/off cluster.
  const clusterPrimaryFamilies = new Set(primaryExpectedFamilies(dominantCluster.clusterKey));
  const clusterSecondaryFamilies = new Set(secondaryExpectedFamilies(dominantCluster.clusterKey));
  const clusterMatchTag = (p: SeedProfile): string => {
    if (dominantCluster.clusterKey === "unknown" || dominantCluster.confidence < 0.35) return "";
    const fam = new Set(p.domainFamilies);
    const hasPrimary = Array.from(clusterPrimaryFamilies).some((f) => fam.has(f));
    const hasSecondary = Array.from(clusterSecondaryFamilies).some((f) => fam.has(f));
    if (hasPrimary) return " onCluster=primary";
    if (hasSecondary) return " onCluster=secondary";
    return " onCluster=no";
  };

  console.info(
    `[interest-suggestions] ── Stage S: seed profiling (Landing 2b-i patched, observation only) ──` +
    Array.from(seedProfiles.values()).map((p) =>
      `\n  • ${p.name.padEnd(28)} [${p.bucket.padEnd(11)}] r=${p.reliability.toFixed(2)} ` +
      `type=${p.normalisedEntityType.padEnd(18)} ` +
      `families=[${p.domainFamilies.join(",") || "-"}] ` +
      `watchlist=${p.watchlistClass} ` +
      `depth=${p.pathDepth}` +
      (p.path.length ? ` path=${p.path.join(" > ")}` : " path=(none)") +
      clusterMatchTag(p),
    ).join("") +
    `\n  Dominant cluster: ${dominantCluster.clusterKey}` +
    ` — confidence=${dominantCluster.confidence.toFixed(2)} (${dominantCluster.band.toUpperCase()})` +
    ` supporters=${dominantCluster.supporters.length}/${sortedSeeds.length}` +
    (dominantCluster.pathContributed ? " [path-fallback]" : " [domain-based]") +
    `\n    reason: ${dominantCluster.reason}` +
    `\n    supportByDomain: ${fmtShare(dominantCluster.supportByDomain as Record<string, number>)}` +
    `\n    supportByEntityType: ${fmtShare(dominantCluster.supportByEntityType as Record<string, number>)}` +
    `\n  Bucket counts: trusted=${bucketCounts.trusted} weak=${bucketCounts.weak} ambiguous=${bucketCounts.ambiguous} conflicting=${bucketCounts.conflicting}` +
    `\n  Enrichment: ${seedEnriched.size}/${seedIdsForEnrichment.length} seeds resolved`,
  );

  // ── Step 4: per-seed parallel retrieval (Landing 2a) ──────────────────────
  // Meta's adinterestsuggestion blends signal across seeds when called with the
  // full list, drowning per-seed neighbourhoods. Landing 2a runs one call per
  // seed in parallel, then unions the results while tracking which seeds
  // surfaced each candidate. Cross-seed agreement becomes the dominant
  // ranking signal (S_agree) downstream.

  const MAX_SEEDS_FOR_RETRIEVAL = 8;
  const retrievalSeeds = sortedSeeds.slice(0, MAX_SEEDS_FOR_RETRIEVAL);
  const maxSeedsCapped = sortedSeeds.length > MAX_SEEDS_FOR_RETRIEVAL;
  const allSeedNames = retrievalSeeds.map((s) => s.name);

  console.info(
    `[interest-suggestions] ── Stage R1: per-seed parallel retrieval (${retrievalSeeds.length} calls) ──` +
    (maxSeedsCapped ? ` [capped from ${sortedSeeds.length}]` : ""),
  );

  // Each entry is the result of a single-seed adinterestsuggestion call.
  type SeedCallOutcome = Awaited<ReturnType<typeof callMeta>>;
  const perSeedResults = await Promise.allSettled(
    retrievalSeeds.map((s) => callMeta([s.name], `seed:${s.id}(${s.name})`)),
  );

  interface CandidateAccumulator {
    item: { id: string; name: string; audience_size?: number; path?: string[] };
    sourceSeeds: Set<string>;
  }

  const pool = new Map<string, CandidateAccumulator>();
  const perSeedStats: Record<string, { seedName: string; status: "ok" | "empty" | "error"; count: number; errMsg?: string; errCode?: unknown }> = {};
  let anySuccess = false;
  let firstMetaError: { errMsg: string; errCode: unknown; httpStatus: number; urlSafe: string } | null = null;
  let firstMetaHttpStatus = 0;
  let firstMetaUrlSafe = "";

  for (let i = 0; i < retrievalSeeds.length; i++) {
    const seed = retrievalSeeds[i];
    const settled = perSeedResults[i];

    if (settled.status !== "fulfilled") {
      perSeedStats[seed.id] = {
        seedName: seed.name, status: "error", count: 0,
        errMsg: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
      };
      continue;
    }

    const r: SeedCallOutcome = settled.value;
    // Capture metadata from the first call (for debug)
    if (i === 0) {
      firstMetaHttpStatus = r.httpStatus;
      firstMetaUrlSafe = r.urlSafe;
    }

    if (!r.ok) {
      perSeedStats[seed.id] = {
        seedName: seed.name, status: "error", count: 0,
        errMsg: r.errMsg, errCode: r.errCode,
      };
      if (!firstMetaError) {
        firstMetaError = { errMsg: r.errMsg, errCode: r.errCode, httpStatus: r.httpStatus, urlSafe: r.urlSafe };
      }
      continue;
    }

    anySuccess = true;
    perSeedStats[seed.id] = {
      seedName: seed.name,
      status: r.data.length > 0 ? "ok" : "empty",
      count: r.data.length,
    };

    for (const item of r.data) {
      if (!item.id) continue;
      const existing = pool.get(item.id);
      if (existing) {
        existing.sourceSeeds.add(seed.id);
      } else {
        pool.set(item.id, { item, sourceSeeds: new Set([seed.id]) });
      }
    }
  }

  // Landing 2a keeps `fallbackUsed`/`fallbackSeedNames` in the debug shape for
  // backward compatibility; per-seed retrieval doesn't need the old fallback.
  const fallbackUsed = false;
  const fallbackSeedNames: string[] = [];
  const seedNamesSent = allSeedNames;

  console.info(
    `[interest-suggestions] per-seed retrieval complete:` +
    Object.entries(perSeedStats).map(([id, s]) =>
      `\n  • ${s.seedName}(${id}): ${s.status} — ${s.count} candidates` +
      (s.errMsg ? ` [error: ${s.errMsg}]` : ""),
    ).join("") +
    `\n  union pool size: ${pool.size} unique candidates`,
  );

  // All seeds errored — surface the first error (usually indicates token issue)
  if (!anySuccess) {
    const errCode = firstMetaError?.errCode;
    let emptyReason = "meta_500_all_seeds";
    if (typeof errCode === "number") {
      if (errCode === 190 || errCode === 102) emptyReason = "token_expired";
      else if (errCode === 200 || errCode === 10) emptyReason = "token_permission";
      else if (errCode === 100) emptyReason = "invalid_request";
    }
    return NextResponse.json({
      error: firstMetaError?.errMsg ?? "All per-seed calls failed", code: errCode, emptyReason,
      debug: {
        metaHttpStatus: firstMetaError?.httpStatus ?? 0, tokenPrefix,
        metaUrl: firstMetaError?.urlSafe ?? "", payloadMode: "interest_list",
        seedNamesSent, seedCount: seedNamesSent.length,
        fallbackUsed, fallbackSeedNames,
        perSeedStats,
      },
    }, { status: 502 });
  }

  // ── Step 5: unpack raw results ────────────────────────────────────────────
  // Reconstruct a raw-array view (for downstream code that iterates the pool).
  const raw = Array.from(pool.values()).map((entry) => entry.item);
  const metaHttpStatus = firstMetaHttpStatus;
  const metaUrlSafe = firstMetaUrlSafe;

  const top5Raw = raw.slice(0, 5).map((r) => `${r.name}(${r.id})`);
  console.info(
    `[interest-suggestions] ── Stage A: pooled raw results (${raw.length}) ──` +
    (raw.length > 0
      ? `\n  top names: ${raw.slice(0, 20).map((r) => r.name).join(" | ")}`
      : " (empty — all seeds returned 0 results)"),
  );

  if (raw.length === 0) {
    return NextResponse.json({
      suggestions: [], count: 0,
      emptyReason: "meta_returned_empty",
      debug: {
        validSeedCount: sortedSeeds.filter((s) => s.hasRealId).length,
        rawSuggestionCount: 0, tokenPrefix,
        payloadMode: "interest_list", seedNamesSent, seedCount: seedNamesSent.length,
        fallbackUsed, fallbackSeedNames,
        perSeedStats,
      },
    });
  }

  // ── Step 5b: enrichment — fetch authoritative taxonomy metadata ──────────
  // Landing 1: call adinterestvalid to get path[] for every raw candidate.
  // The path is the authoritative taxonomy root that tells us whether this
  // candidate is an Interest, a Behavior, or a Demographic. This replaces the
  // entire regex-based junk-filtering layer.

  const candidateIds = raw.map((r) => r.id).filter(Boolean);
  const { enriched } = await enrichCandidates(candidateIds, token, BASE);

  // ── Step 6: filter, classify, and score ──────────────────────────────────
  const typeScores = cluster
    ? (CLUSTER_TYPE_SCORES[cluster] ?? DEFAULT_TYPE_SCORES)
    : DEFAULT_TYPE_SCORES;
  const pathPattern = CLUSTER_PATH_PATTERNS[cluster];
  const blocklist = debugBypass ? [] : (CLUSTER_BLOCKLIST[cluster] ?? []);

  const suggestions: SuggestedInterest[] = [];
  const blockedNames: string[] = [];

  let excludedBySeed = 0;
  let droppedMissingPath = 0;
  let droppedNonInterest = 0;
  const droppedNonInterestRoots: Record<string, number> = {};
  let excludedJunk = 0;
  let excludedByCluster = 0;
  let excludedByType = 0;
  const excludedByTypeBreakdown: Record<string, number> = {};
  // Landing 2b-ii telemetry
  const quarantinedNames: string[] = [];
  const clusterFitDistribution: Record<string, number> = {};
  const seedQualityDistribution: Record<string, number> = {};

  for (const item of raw) {
    // 6a. Exclude already-selected IDs
    if (excludeIds.has(item.id)) { excludedBySeed++; continue; }

    // Landing 1: use authoritative enriched metadata when available, falling
    // back to the path Meta returned in the suggestion response.
    const enrichedMeta = enriched.get(item.id);
    const itemPath = (enrichedMeta?.path?.length ? enrichedMeta.path : item.path) ?? [];
    const size = enrichedMeta?.audienceSize ?? item.audience_size ?? 0;
    const text = [item.name, ...itemPath].join(" ");

    // 6b. STRUCTURAL FILTER — primary defence (Landing 1)
    // Drop candidates with no path[] at all. Meta's Interests taxonomy always
    // returns a path; missing path means the candidate is unresolvable or
    // deprecated and therefore unsafe to surface.
    if (!debugBypass && itemPath.length === 0) {
      droppedMissingPath++;
      blockedNames.push(item.name);
      console.info(`[interest-suggestions] Stage B drop (missing path): "${item.name}"`);
      continue;
    }

    // 6c. STRUCTURAL FILTER — taxonomy root must be "Interests"
    // This single check replaces UNIVERSAL_JUNK. Behaviors, Demographics, and
    // Life events all live under different taxonomy roots and get dropped here.
    if (!debugBypass && itemPath[0] !== "Interests") {
      droppedNonInterest++;
      const root = itemPath[0] || "(empty)";
      droppedNonInterestRoots[root] = (droppedNonInterestRoots[root] ?? 0) + 1;
      blockedNames.push(item.name);
      console.info(
        `[interest-suggestions] Stage B drop (non-Interests root): "${item.name}" ` +
        `→ path[0]="${root}" full path=${JSON.stringify(itemPath)}`,
      );
      continue;
    }

    // 6d. Zero / invalid audience size (inactive or deprecated interest)
    if (!debugBypass && size === 0 && enrichedMeta && !enrichedMeta.valid) {
      droppedMissingPath++; // bucket with missing-path for telemetry
      blockedNames.push(item.name);
      console.info(`[interest-suggestions] Stage B drop (invalid/zero-size): "${item.name}"`);
      continue;
    }

    // 6e. Cluster supplementary blocklist — handles within-Interests pollution
    // (e.g. video games under Interests > Games when cluster is Fashion).
    if (!debugBypass && blocklist.some((p) => p.test(text))) {
      excludedByCluster++;
      blockedNames.push(item.name);
      continue;
    }

    // 6f. Classify from path (primary) — name-based classifier only as a
    // last-resort fallback when path is unexpectedly short.
    const sType: SuggestionType = debugBypass
      ? "unknown"
      : (classifyFromPath(itemPath) !== "unknown"
          ? classifyFromPath(itemPath)
          : classifySuggestion(item.name, itemPath));

    const typeBonus = (typeScores as Record<string, number>)[sType] ?? 0;

    // With structural filter in place, type-score-based dropping is redundant
    // for junk types (they never reach here). Keep the guard for defence in
    // depth, but in practice it should rarely fire.
    if (!debugBypass && typeBonus <= -999) {
      excludedByType++;
      excludedByTypeBreakdown[sType] = (excludedByTypeBreakdown[sType] ?? 0) + 1;
      blockedNames.push(item.name);
      console.info(`[interest-suggestions] Stage C type-drop: "${item.name}" → type="${sType}" path=${JSON.stringify(itemPath)}`);
      continue;
    }

    // 6g. Source seeds — which retrieval seeds surfaced this candidate
    const accumulator = pool.get(item.id);
    const sourceSeedIds = accumulator ? Array.from(accumulator.sourceSeeds) : [];
    const S_agree = retrievalSeeds.length > 0 ? sourceSeedIds.length / retrievalSeeds.length : 0;

    // 6h. Landing 2b-ii: seed-quality + quarantine
    // Drop candidates whose surfacing seeds are ALL ambiguous (e.g. lone "Gala")
    // before scoring — they pollute the result set with no upside.
    const seedQualityResult = computeSeedQuality(sourceSeedIds, seedProfiles);
    if (!debugBypass && seedQualityResult.quarantine) {
      excludedBySeed++;
      blockedNames.push(item.name);
      quarantinedNames.push(item.name);
      console.info(
        `[interest-suggestions] Stage Q quarantine (ambiguous-only seeds): "${item.name}" ` +
        `surfaced by ${sourceSeedIds.length} seed(s), all bucket=ambiguous`,
      );
      continue;
    }

    // 6i. Landing 2b-ii: reliability-weighted agreement (replaces 2a flat S_agree
    // in scoring; we still expose the raw value for debugging continuity).
    const retrievalSeedIds = retrievalSeeds.map((s) => s.id);
    const weightedAgreement = computeWeightedAgreement(sourceSeedIds, retrievalSeedIds, seedProfiles);
    const S_agree_w = weightedAgreement.value;
    const S_agree_w_points = Math.round(S_agree_w * 35); // same magnitude as 2a's S_agree weight

    // 6j. Landing 2b-ii (intent-aware): candidate cluster fit
    // Classify the candidate into a fine-grained CandidateClass (music_platform
    // vs music_genre_other vs film_tv vs lifestyle, …) then look it up in a
    // per-cluster rules table. This replaces the old family-overlap fit, which
    // gave broad credit (e.g. "Alternative rock" had family=[music], scored
    // secondary on a music_platforms cluster). Now music genres are off_cluster
    // for music_platforms, films are off_cluster for electronic_music_nightlife,
    // and lifestyle leaves don't auto-inherit fashion from a parent path.
    const fit = computeClusterFit(item.name, itemPath, dominantCluster);
    const S_cluster_fit_points = debugBypass ? 0 : fit.points;

    // Track distributions for debug telemetry
    clusterFitDistribution[fit.fitClass] = (clusterFitDistribution[fit.fitClass] ?? 0) + 1;
    seedQualityDistribution[seedQualityResult.qualityClass] =
      (seedQualityDistribution[seedQualityResult.qualityClass] ?? 0) + 1;

    // 6k. Score components
    const sizeBandPoints = sizeBandScore(size);
    const rawTypeBonus = typeBonus;
    const rawSeedQualityPoints = debugBypass ? 0 : seedQualityResult.points;
    const rawPathPatternPoints = !debugBypass && pathPattern?.test(text) ? 10 : 0;
    const deprecated = !debugBypass && isKnownDeprecated(item.name);
    const deprecationPoints = deprecated ? -15 : 0;
    const genericNamePoints =
      !debugBypass && /^(music|fashion|art|travel|fitness|food|sports?)$/i.test(item.name) ? -10 : 0;

    // Off-cluster suppression: a candidate that's been classified as belonging
    // to another cluster cannot be rescued by legacy positive bonuses. Clamp
    // typeBonus, seedQuality, and pathPattern to ≤0 so the cluster-fit penalty
    // is the dominant signal. Negative components remain in effect.
    const isOffCluster = !debugBypass && fit.fitClass === "off_cluster";
    const typeBonusPoints = isOffCluster ? Math.min(rawTypeBonus, 0) : rawTypeBonus;
    const seedQualityPoints = isOffCluster ? Math.min(rawSeedQualityPoints, 0) : rawSeedQualityPoints;
    const pathPatternPoints = isOffCluster ? 0 : rawPathPatternPoints;

    const score =
      sizeBandPoints +
      typeBonusPoints +
      S_agree_w_points +
      S_cluster_fit_points +
      seedQualityPoints +
      pathPatternPoints +
      deprecationPoints +
      genericNamePoints;

    suggestions.push({
      id: item.id,
      name: enrichedMeta?.name || item.name,
      audienceSize: size > 0 ? size : null,
      path: itemPath,
      taxonomyRoot: itemPath[0],
      score,
      likelyDeprecated: deprecated || undefined,
      audienceSizeBand: audienceSizeBand(size),
      suggestionType: sType,
      seedAgreement: S_agree,
      sourceSeedIds,
      weightedSeedAgreement: S_agree_w,
      clusterFitClass: fit.fitClass,
      candidateClass: fit.candidateClass,
      clusterFitReason: fit.reason,
      seedQualityClass: seedQualityResult.qualityClass,
      scoreBreakdown: {
        sizeBand: sizeBandPoints,
        typeBonus: typeBonusPoints,
        weightedAgreement: S_agree_w_points,
        clusterFit: S_cluster_fit_points,
        seedQuality: seedQualityPoints,
        pathPattern: pathPatternPoints,
        deprecation: deprecationPoints,
        genericName: genericNamePoints,
        total: score,
      },
    });
  }

  // ── Landing 2c — Stage R2: expansion + seed rescue ─────────────────────────
  // First-pass retrieval is one-hop: each original seed produces ~5-30
  // suggestions. For tightly clustered seed sets that one hop often returns
  // too few on-cluster candidates (Meta's adinterestsuggestion is biased
  // toward broad audiences). Stage R2 widens the input to the same scoring
  // pipeline using one of two modes:
  //
  //   1. candidate_expansion — when first-pass produced primary candidates
  //      that aren't original seeds. We re-query Meta from those primary
  //      candidates to fan out into adjacent on-cluster nodes.
  //
  //   2. seed_rescue_expansion — when first-pass produced few/zero primary
  //      candidates. We rely on:
  //        (a) trusted+onCluster ORIGINALS that were never individually
  //            queried in pass 1 (only matters when seed count > MAX_SEEDS_FOR_RETRIEVAL)
  //        (b) hand-curated cluster-specific rescue seeds (CURATED_RESCUE_SEEDS).
  //      Re-querying an original seed that was already queried in pass 1 is
  //      wasted — adinterestsuggestion is deterministic and would return the
  //      same pool. Curated rescue is the actual lever that makes empty
  //      clusters productive.
  //
  // Both modes go through the same enrichment, structural filter, blocklist,
  // classifier, cluster-fit rules, and final eligibility gate. Synthetic
  // agreement is capped lower (×20 vs ×35) so expansion items can't outrank
  // well-corroborated first-pass items.

  const HIGH_CONFIDENCE_THRESHOLD = 0.60;
  const isHighConfidenceCluster =
    !debugBypass &&
    dominantCluster.clusterKey !== "unknown" &&
    dominantCluster.confidence >= HIGH_CONFIDENCE_THRESHOLD;

  type ExpansionMode = "candidate_expansion" | "seed_rescue_expansion" | "none";
  type ExpansionSeedSource = "primary_candidate" | "uncapped_trusted_original" | "curated_rescue";

  let expansionMode: ExpansionMode = "none";
  let expansionAttempted = false;
  let expansionTriggerReason = "";
  let expansionReasonSkipped: string | undefined;
  let expansionSeedNames: string[] = [];
  let expansionRawCount = 0;
  let expansionNewCandidateCount = 0;
  let expansionAddedToFinalCount = 0;
  const expansionPerSeedStats: Record<
    string,
    { status: "ok" | "empty" | "error"; count: number; errMsg?: string; source?: ExpansionSeedSource }
  > = {};
  const expansionSeedSourceBreakdown: Record<ExpansionSeedSource, number> = {
    primary_candidate: 0,
    uncapped_trusted_original: 0,
    curated_rescue: 0,
  };
  const curatedExpansionSeedsUsed: string[] = [];
  // Landing 2e telemetry — rescue seed priority / thin-pool recall boost
  let curatedRescueCandidatesConsidered: string[] = [];
  let underrepresentedBucketsBeforeExpansion: Record<string, number> = {};
  let rescueSeedPriorityOrder: Array<{
    name: string;
    bucket: DiversityBucket;
    group: string;
    missingWeight: number;
    priorityScore: number;
  }> = [];
  let thinPoolRecallBoostActive = false;

  const FIRST_PASS_PRIMARY_MIN = 10;
  const MAX_PRIMARY_CANDIDATES = 2;
  const MAX_UNCAPPED_TRUSTED = 2;
  const MAX_CURATED = 3;
  const MAX_TOTAL_EXPANSION_SEEDS = 5;

  // Determine mode + skip reason
  let onClusterFirstPassCount = 0;
  if (!isHighConfidenceCluster) {
    expansionReasonSkipped = dominantCluster.clusterKey === "unknown"
      ? "unknown_cluster"
      : `low_confidence_cluster (confidence=${dominantCluster.confidence.toFixed(2)} < ${HIGH_CONFIDENCE_THRESHOLD})`;
  } else if (debugBypass) {
    expansionReasonSkipped = "debug_bypass";
  } else {
    const onClusterFirstPass = suggestions.filter(
      (s) => s.clusterFitClass === "primary" || s.clusterFitClass === "secondary",
    );
    const primaryFirstPass = suggestions.filter((s) => s.clusterFitClass === "primary");
    onClusterFirstPassCount = onClusterFirstPass.length;

    if (onClusterFirstPass.length >= FIRST_PASS_PRIMARY_MIN) {
      expansionReasonSkipped =
        `first_pass_primary_secondary=${onClusterFirstPass.length} >= ${FIRST_PASS_PRIMARY_MIN}`;
    } else {
      // Eligible for expansion. Build a prioritised seed list across three
      // sources. The total is capped at MAX_TOTAL_EXPANSION_SEEDS.
      const seenLower = new Set<string>(seedNamesSent.map((n) => n.toLowerCase()));
      const queriedLower = new Set<string>(retrievalSeeds.map((s) => s.name.toLowerCase()));
      const descriptors: Array<{ name: string; source: ExpansionSeedSource }> = [];

      // (a) Top primary first-pass candidates (deduped vs sent seed names).
      //     Re-querying primary candidates fans out into adjacent on-cluster
      //     nodes that the original seeds didn't surface directly.
      const primaryCands = primaryFirstPass
        .filter((c) => !seenLower.has(c.name.toLowerCase()))
        .sort((a, b) => b.score - a.score);
      for (const c of primaryCands) {
        if (descriptors.filter((d) => d.source === "primary_candidate").length >= MAX_PRIMARY_CANDIDATES) break;
        descriptors.push({ name: c.name, source: "primary_candidate" });
        seenLower.add(c.name.toLowerCase());
      }

      // (b) Trusted+onCluster originals that were NOT queried individually
      //     in pass 1 (retrievalSeeds was capped at MAX_SEEDS_FOR_RETRIEVAL).
      //     Re-querying already-queried originals would be wasted —
      //     adinterestsuggestion is deterministic.
      const uncappedTrusted = Array.from(seedProfiles.values())
        .filter((p) => p.bucket === "trusted" && p.onDominantCluster)
        .filter((p) => !queriedLower.has(p.name.toLowerCase()))
        .filter((p) => !seenLower.has(p.name.toLowerCase()))
        .sort((a, b) => b.reliability - a.reliability);
      for (const p of uncappedTrusted) {
        if (descriptors.filter((d) => d.source === "uncapped_trusted_original").length >= MAX_UNCAPPED_TRUSTED) break;
        descriptors.push({ name: p.name, source: "uncapped_trusted_original" });
        seenLower.add(p.name.toLowerCase());
      }

      // (c) Curated cluster-specific rescue seeds. These are the actual lever
      //     that prevents empty results when first-pass primary candidates
      //     are sparse and all trusted originals were queried in pass 1.
      const curatedSource = CURATED_RESCUE_SEEDS[dominantCluster.clusterKey] ?? [];
      curatedRescueCandidatesConsidered = [...curatedSource];

      // Bucket-aware rescue ordering: prefer seeds whose PREDICTED diversity
      // bucket is under-represented AND whose cluster-intent priority is
      // higher. Applies only to EMN / FED where we have a cap plan + a
      // predicted-bucket table. Raw missingWeight alone was too easily
      // dominated by whichever group had the largest cap (EMN genre cap=4),
      // so we now score via:
      //     priorityScore = groupPriority + missingWeight - saturationPenalty
      // with -100 floor when missingWeight = 0. See CLUSTER_RESCUE_GROUP_PRIORITY.
      const plan = capPlanFor(dominantCluster.clusterKey);
      let curated: string[] = [...curatedSource];
      if (
        plan &&
        (dominantCluster.clusterKey === "electronic_music_nightlife" ||
          dominantCluster.clusterKey === "fashion_editorial")
      ) {
        const currentByGroup: Record<string, number> = {};
        for (const s of suggestions) {
          if (s.clusterFitClass !== "primary" && s.clusterFitClass !== "secondary") continue;
          const bucket = diversityDisplayBucket(s.candidateClass, dominantCluster.clusterKey);
          const group = plan.group[bucket] ?? "other";
          currentByGroup[group] = (currentByGroup[group] ?? 0) + 1;
        }
        const missingByGroup: Record<string, number> = {};
        for (const [group, limit] of Object.entries(plan.limit)) {
          missingByGroup[group] = Math.max(0, limit - (currentByGroup[group] ?? 0));
        }
        underrepresentedBucketsBeforeExpansion = missingByGroup;

        const scored = curatedSource.map((name, idx) => {
          const bucket = predictRescueBucket(name, dominantCluster.clusterKey);
          const group = plan.group[bucket] ?? "other";
          const missingWeight = missingByGroup[group] ?? 0;
          const priorityScore = computeRescuePriorityScore(
            dominantCluster.clusterKey,
            group,
            missingWeight,
            currentByGroup,
          );
          return { name, bucket, group, missingWeight, priorityScore, originalIdx: idx };
        });
        scored.sort((a, b) => {
          if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
          return a.originalIdx - b.originalIdx;
        });
        curated = scored.map((s) => s.name);
        rescueSeedPriorityOrder = scored.map(({ name, bucket, group, missingWeight, priorityScore }) => ({
          name, bucket, group, missingWeight, priorityScore,
        }));
      }

      // Thin-pool recall boost: allow +1 curated seed beyond the normal cap
      // ONLY for EMN/FED when high-confidence and first-pass primary/secondary
      // count is very thin. Keeps default behaviour identical everywhere else.
      let maxCuratedLocal: number = MAX_CURATED;
      let maxTotalLocal: number = MAX_TOTAL_EXPANSION_SEEDS;
      if (
        isHighConfidenceCluster &&
        (dominantCluster.clusterKey === "electronic_music_nightlife" ||
          dominantCluster.clusterKey === "fashion_editorial") &&
        onClusterFirstPass.length < 6
      ) {
        maxCuratedLocal = MAX_CURATED + 1;
        maxTotalLocal = MAX_TOTAL_EXPANSION_SEEDS + 1;
        thinPoolRecallBoostActive = true;
      }

      for (const name of curated) {
        if (descriptors.filter((d) => d.source === "curated_rescue").length >= maxCuratedLocal) break;
        if (descriptors.length >= maxTotalLocal) break;
        const lower = name.toLowerCase();
        if (seenLower.has(lower)) continue;
        descriptors.push({ name, source: "curated_rescue" });
        curatedExpansionSeedsUsed.push(name);
        seenLower.add(lower);
      }

      const finalDescriptors = descriptors.slice(0, maxTotalLocal);
      expansionSeedNames = finalDescriptors.map((d) => d.name);
      for (const d of finalDescriptors) {
        expansionSeedSourceBreakdown[d.source]++;
      }

      if (finalDescriptors.length === 0) {
        expansionReasonSkipped =
          `no_eligible_expansion_seeds (primaryCands=${primaryCands.length}, uncappedTrusted=${uncappedTrusted.length}, curated=${curated.length}, all deduped against ${seenLower.size} seen names)`;
      } else {
        expansionAttempted = true;
        expansionMode = expansionSeedSourceBreakdown.primary_candidate > 0
          ? "candidate_expansion"
          : "seed_rescue_expansion";
        expansionTriggerReason =
          `first_pass_primary_secondary=${onClusterFirstPass.length}<${FIRST_PASS_PRIMARY_MIN}; mode=${expansionMode}`;

        console.info(
          `[interest-suggestions] ── Stage R2: expansion (${finalDescriptors.length} seeds, mode=${expansionMode}) ──` +
          `\n  trigger: ${expansionTriggerReason}` +
          `\n  source breakdown: primary_candidate=${expansionSeedSourceBreakdown.primary_candidate}, uncapped_trusted_original=${expansionSeedSourceBreakdown.uncapped_trusted_original}, curated_rescue=${expansionSeedSourceBreakdown.curated_rescue}` +
          `\n  curated considered: ${curatedRescueCandidatesConsidered.length} | picked: ${curatedExpansionSeedsUsed.length > 0 ? curatedExpansionSeedsUsed.join(", ") : "(none)"}` +
          (Object.keys(underrepresentedBucketsBeforeExpansion).length > 0
            ? `\n  underrepresented buckets:   ${JSON.stringify(underrepresentedBucketsBeforeExpansion)}`
            : "") +
          (rescueSeedPriorityOrder.length > 0
            ? `\n  rescue priority:            ${rescueSeedPriorityOrder.slice(0, 8).map((r) => `${r.name}[${r.bucket}→${r.group}/miss=${r.missingWeight}/score=${r.priorityScore}]`).join(", ")}${rescueSeedPriorityOrder.length > 8 ? " …" : ""}`
            : "") +
          (thinPoolRecallBoostActive ? `\n  thin-pool recall boost: ACTIVE (+1 curated cap)` : "") +
          `\n  seeds: ${finalDescriptors.map((d) => `${d.name}[${d.source}]`).join(", ")}`,
        );

        const expansionResults = await Promise.allSettled(
          finalDescriptors.map((d) => callMeta([d.name], `expansion[${d.source}]:${d.name}`)),
        );

        // Pool expansion items separately — each entry tracks WHICH expansion
        // seeds surfaced it (for synthetic agreement).
        const expansionPool = new Map<
          string,
          {
            item: { id: string; name: string; audience_size?: number; path?: string[] };
            sourceSeeds: Set<string>;
          }
        >();

        expansionResults.forEach((result, idx) => {
          const descriptor = finalDescriptors[idx];
          const seedName = descriptor.name;
          const source = descriptor.source;
          if (result.status === "rejected") {
            expansionPerSeedStats[seedName] = { status: "error", count: 0, errMsg: String(result.reason), source };
            return;
          }
          const value = result.value;
          if (!value.ok) {
            expansionPerSeedStats[seedName] = {
              status: "error",
              count: 0,
              errMsg: value.errMsg ?? `http ${value.httpStatus}`,
              source,
            };
            return;
          }
          const items = value.data ?? [];
          if (items.length === 0) {
            expansionPerSeedStats[seedName] = { status: "empty", count: 0, source };
            return;
          }
          expansionPerSeedStats[seedName] = { status: "ok", count: items.length, source };
          for (const item of items) {
            if (!item || !item.id) continue;
            const existing = expansionPool.get(item.id);
            if (existing) {
              existing.sourceSeeds.add(seedName);
            } else {
              expansionPool.set(item.id, { item, sourceSeeds: new Set([seedName]) });
            }
          }
        });

        expansionRawCount = expansionPool.size;

        // Skip anything we've already scored, plus original seed IDs and any
        // explicit excludes.
        const firstPassIds = new Set(suggestions.map((s) => s.id));
        const originalSeedIds = new Set(sortedSeeds.map((s) => s.id));
        type ExpansionItem = { id: string; name: string; audience_size?: number; path?: string[] };
        const newExpansionEntries: Array<{ item: ExpansionItem; sources: string[] }> = [];
        for (const [id, entry] of expansionPool) {
          if (firstPassIds.has(id) || originalSeedIds.has(id) || excludeIds.has(id)) continue;
          newExpansionEntries.push({ item: entry.item, sources: Array.from(entry.sourceSeeds) });
        }
        expansionNewCandidateCount = newExpansionEntries.length;

        let mergedFromExpansion = 0;
        if (newExpansionEntries.length > 0) {
          // Enrich the new candidates so we have authoritative path[] for
          // structural filter + classification.
          const newIds = newExpansionEntries.map((e) => e.item.id);
          let newEnriched = new Map<string, EnrichedInterest>();
          try {
            const res = await enrichCandidates(newIds, token, BASE);
            newEnriched = res.enriched;
          } catch (err) {
            console.error(`[interest-suggestions] ✗ Stage R2 enrichment threw:`, err);
          }

          // Same scoring path as the first-pass loop, with synthetic agreement.
          for (const { item, sources } of newExpansionEntries) {
            const enrichedMeta = newEnriched.get(item.id);
            const itemPath = enrichedMeta?.path ?? item.path ?? [];
            const text = `${item.name} :: ${itemPath.join(" > ")}`.toLowerCase();
            const size = enrichedMeta?.audienceSize ?? item.audience_size ?? 0;

            // Structural filter: same rules as first pass
            if (!itemPath || itemPath.length === 0) continue;
            if (itemPath[0] !== "Interests") continue;
            if (size === 0 && enrichedMeta && !enrichedMeta.valid) continue;
            if (blocklist.some((p) => p.test(text))) continue;

            const sType: SuggestionType =
              classifyFromPath(itemPath) !== "unknown"
                ? classifyFromPath(itemPath)
                : classifySuggestion(item.name, itemPath);
            const rawTypeBonus = (typeScores as Record<string, number>)[sType] ?? 0;
            if (rawTypeBonus <= -999) continue; // hard type-drop, defence in depth

            const fit = computeClusterFit(item.name, itemPath, dominantCluster);

            // Synthetic agreement: cap at ×20 (vs ×35 for first-pass) so
            // expansion candidates can't outrank well-corroborated first-pass
            // ones. Even a 100% agreement rate among expansion seeds tops out
            // around the first-pass median.
            const expansionAgreement = sources.length / finalDescriptors.length; // 0..1
            const expansionAgreementPoints = Math.round(expansionAgreement * 20);

            const sizeBandPoints = sizeBandScore(size);
            const rawSeedQualityPoints = 5; // assume +5: only trusted-source expansion
            const rawPathPatternPoints = pathPattern?.test(text) ? 10 : 0;
            const deprecated = isKnownDeprecated(item.name);
            const deprecationPoints = deprecated ? -15 : 0;
            const genericNamePoints = /^(music|fashion|art|travel|fitness|food|sports?)$/i.test(item.name) ? -10 : 0;

            const isOffCluster = fit.fitClass === "off_cluster";
            const typeBonusPoints = isOffCluster ? Math.min(rawTypeBonus, 0) : rawTypeBonus;
            const seedQualityPoints = isOffCluster ? Math.min(rawSeedQualityPoints, 0) : rawSeedQualityPoints;
            const pathPatternPoints = isOffCluster ? 0 : rawPathPatternPoints;

            const score =
              sizeBandPoints +
              typeBonusPoints +
              expansionAgreementPoints +
              fit.points +
              seedQualityPoints +
              pathPatternPoints +
              deprecationPoints +
              genericNamePoints;

            // Track distributions consistent with first-pass telemetry
            clusterFitDistribution[fit.fitClass] = (clusterFitDistribution[fit.fitClass] ?? 0) + 1;
            seedQualityDistribution["all_good"] = (seedQualityDistribution["all_good"] ?? 0) + 1;

            suggestions.push({
              id: item.id,
              name: enrichedMeta?.name || item.name,
              audienceSize: size > 0 ? size : null,
              path: itemPath,
              taxonomyRoot: itemPath[0],
              score,
              likelyDeprecated: deprecated || undefined,
              audienceSizeBand: audienceSizeBand(size),
              suggestionType: sType,
              seedAgreement: 0,
              sourceSeedIds: [],
              weightedSeedAgreement: 0,
              clusterFitClass: fit.fitClass,
              candidateClass: fit.candidateClass,
              clusterFitReason: fit.reason,
              seedQualityClass: "all_good",
              expansionSourceSeeds: sources,
              scoreBreakdown: {
                sizeBand: sizeBandPoints,
                typeBonus: typeBonusPoints,
                weightedAgreement: expansionAgreementPoints,
                clusterFit: fit.points,
                seedQuality: seedQualityPoints,
                pathPattern: pathPatternPoints,
                deprecation: deprecationPoints,
                genericName: genericNamePoints,
                total: score,
              },
            });
            mergedFromExpansion++;
          }
        }

        console.info(
          `[interest-suggestions] ── Stage R2 done — ` +
          `pool=${expansionPool.size} new=${expansionNewCandidateCount} ` +
          `merged=${mergedFromExpansion} (filtered out ${expansionNewCandidateCount - mergedFromExpansion}) ` +
          `per-seed: ${JSON.stringify(expansionPerSeedStats)}`,
        );
      }
    }
  }

  // Stage R2 explicit skip log (only fires when we deliberately did not expand)
  if (!expansionAttempted && expansionReasonSkipped) {
    console.info(
      `[interest-suggestions] ── Stage R2 skipped — reason: ${expansionReasonSkipped}` +
      (onClusterFirstPassCount > 0 ? ` (first-pass primary/secondary=${onClusterFirstPassCount})` : ""),
    );
  }

  suggestions.sort((a, b) => b.score - a.score);

  // ── Landing 2b-ii final eligibility gate ────────────────────────────────────
  // High-confidence cluster: drop off_cluster candidates entirely. Off-cluster
  // junk should never appear in results when we're confident about the cluster
  // intent. If this leaves zero candidates, prefer empty over polluted output.
  // Set ?fallback=loose to opt back into off_cluster + neutral candidates.

  let droppedByFinalEligibility = 0;
  const droppedByFinalEligibilityNames: string[] = [];
  let droppedNeutralByFinalEligibility = 0;
  const droppedNeutralByFinalEligibilityNames: string[] = [];
  let fallbackModeUsed = false;

  let eligibleSuggestions = suggestions;
  if (isHighConfidenceCluster && !allowLooseFallback) {
    // Strict gate: only primary + secondary survive. Both off_cluster AND
    // neutral are dropped — neutral candidates are taxonomy nodes we can't
    // confidently place (Doctor Who, Social science, …) and have no business
    // appearing on a high-confidence cluster.
    eligibleSuggestions = suggestions.filter((s) => {
      if (s.clusterFitClass === "off_cluster") {
        droppedByFinalEligibility++;
        droppedByFinalEligibilityNames.push(s.name);
        return false;
      }
      if (s.clusterFitClass === "neutral") {
        droppedNeutralByFinalEligibility++;
        droppedNeutralByFinalEligibilityNames.push(s.name);
        return false;
      }
      return true;
    });
    // If the gate emptied the list, do NOT silently re-admit junk. The caller
    // sees zero results and can either expand seeds or pass ?fallback=loose.
  } else if (isHighConfidenceCluster && allowLooseFallback) {
    fallbackModeUsed = true;
  }

  // Cap at top 10 — show fewer strong suggestions rather than a noisy list
  const MAX_SUGGESTIONS = 10;

  // ── Final diversification layer (Landing 2d) ──────────────────────────────
  // For electronic_music_nightlife and fashion_editorial, mix families so the
  // top-N isn't dominated by a single bucket (e.g. all genres, no media).
  // Purely a reorder — no drops, no gate change, no score edits.
  const diversification = diversifyFinalSuggestions(
    eligibleSuggestions,
    dominantCluster.clusterKey,
    MAX_SUGGESTIONS,
  );
  const finalSuggestions = diversification.picked;
  const diversityBucketByName = diversification.bucketByName;

  // Distribution of cluster-fit classes among the surviving final suggestions
  const survivorFitDistribution: Record<string, number> = {};
  for (const s of finalSuggestions) {
    const k = s.clusterFitClass ?? "unknown";
    survivorFitDistribution[k] = (survivorFitDistribution[k] ?? 0) + 1;
  }

  if (droppedByFinalEligibility > 0 || droppedNeutralByFinalEligibility > 0) {
    console.info(
      `[interest-suggestions] ── Stage G: final eligibility gate ──` +
      `\n  cluster: ${dominantCluster.clusterKey} (confidence=${dominantCluster.confidence.toFixed(2)}, threshold=${HIGH_CONFIDENCE_THRESHOLD})` +
      `\n  dropped (off_cluster): ${droppedByFinalEligibility}` +
      (droppedByFinalEligibility > 0
        ? `\n    names: ${droppedByFinalEligibilityNames.slice(0, 20).join(", ")}`
        : "") +
      `\n  dropped (neutral):     ${droppedNeutralByFinalEligibility}` +
      (droppedNeutralByFinalEligibility > 0
        ? `\n    names: ${droppedNeutralByFinalEligibilityNames.slice(0, 20).join(", ")}`
        : "") +
      (fallbackModeUsed ? `\n  fallback=loose was active — off_cluster + neutral re-admitted` : ""),
    );
  }

  // Build type frequency map for debug output
  const finalSuggestionTypes: Record<string, number> = {};
  for (const s of finalSuggestions) {
    finalSuggestionTypes[s.suggestionType] = (finalSuggestionTypes[s.suggestionType] ?? 0) + 1;
  }

  const top10ScoreBreakdown = finalSuggestions.map((s) => ({
    name: s.name,
    type: s.suggestionType,
    score: s.score,
    sizeBand: s.audienceSizeBand ?? "unknown",
    path: s.path ?? [],
    seedAgreement: s.seedAgreement,
    sources: s.sourceSeedIds,
    weightedAgreement: s.weightedSeedAgreement,
    clusterFit: s.clusterFitClass,
    candidateClass: s.candidateClass,
    clusterFitReason: s.clusterFitReason,
    seedQuality: s.seedQualityClass,
    expansionSourceSeeds: s.expansionSourceSeeds,
    components: s.scoreBreakdown
      ? {
          sizeBand: s.scoreBreakdown.sizeBand,
          typeBonus: s.scoreBreakdown.typeBonus,
          weightedAgreement: s.scoreBreakdown.weightedAgreement,
          clusterFit: s.scoreBreakdown.clusterFit,
          seedQuality: s.scoreBreakdown.seedQuality,
          pathPattern: s.scoreBreakdown.pathPattern,
          deprecation: s.scoreBreakdown.deprecation,
          genericName: s.scoreBreakdown.genericName,
        }
      : undefined,
  }));

  const finalInterestOnlyCount = finalSuggestions.length;
  expansionAddedToFinalCount = finalSuggestions.filter((s) => (s.expansionSourceSeeds?.length ?? 0) > 0).length;

  // Compact one-liner per final suggestion showing the full 2b-ii score
  // breakdown — this is the ranking debugging surface.
  const fmtBreakdown = (s: SuggestedInterest): string => {
    const b = s.scoreBreakdown;
    if (!b) return `score=${s.score}`;
    const parts = [
      `size=${b.sizeBand}`,
      `type=${b.typeBonus}`,
      `agreeW=${b.weightedAgreement}`,
      `fit=${b.clusterFit}(${s.clusterFitClass}|${s.candidateClass ?? "?"})`,
      `seedQ=${b.seedQuality}(${s.seedQualityClass})`,
    ];
    if (b.pathPattern) parts.push(`path=${b.pathPattern}`);
    if (b.deprecation) parts.push(`dep=${b.deprecation}`);
    if (b.genericName) parts.push(`gen=${b.genericName}`);
    const reason = s.clusterFitReason ? `  reason: ${s.clusterFitReason}` : "";
    return `${parts.join(" ")} → ${b.total}${reason}`;
  };

  console.info(
    `[interest-suggestions] ── Stage D: pipeline summary (Landing 2b-ii) ──` +
    `\n  retrieval seeds:            ${retrievalSeeds.length}${maxSeedsCapped ? ` (capped from ${sortedSeeds.length})` : ""}` +
    `\n  union pool size:            ${pool.size}` +
    `\n  raw (from pool):            ${raw.length}` +
    `\n  enriched (adinterestvalid): ${enriched.size}/${candidateIds.length}` +
    `\n  excluded by seed:           ${excludedBySeed} (incl. ${quarantinedNames.length} quarantined)` +
    `\n  dropped (missing path):     ${droppedMissingPath}` +
    `\n  dropped (non-Interests):    ${droppedNonInterest} — roots: ${JSON.stringify(droppedNonInterestRoots)}` +
    `\n  excluded (cluster list):    ${excludedByCluster}` +
    `\n  excluded (type):            ${excludedByType} ${JSON.stringify(excludedByTypeBreakdown)}` +
    `\n  scored (post-expansion):    ${suggestions.length}` +
    `\n  expansion (Stage R2):       ${expansionAttempted ? `ON mode=${expansionMode} [${expansionTriggerReason}] seeds=${expansionSeedNames.length} raw=${expansionRawCount} new=${expansionNewCandidateCount}` : `OFF (${expansionReasonSkipped ?? "n/a"})`}` +
    (expansionAttempted
      ? `\n    source breakdown:          ${JSON.stringify(expansionSeedSourceBreakdown)}` +
        (curatedExpansionSeedsUsed.length > 0
          ? `\n    curated seeds used:        ${curatedExpansionSeedsUsed.join(", ")}`
          : "") +
        (curatedRescueCandidatesConsidered.length > 0
          ? `\n    curated considered:        ${curatedRescueCandidatesConsidered.length} (picked ${curatedExpansionSeedsUsed.length})`
          : "") +
        (Object.keys(underrepresentedBucketsBeforeExpansion).length > 0
          ? `\n    underrepresented buckets:  ${JSON.stringify(underrepresentedBucketsBeforeExpansion)}`
          : "") +
        (thinPoolRecallBoostActive ? `\n    thin-pool recall boost:    ACTIVE (+1 curated cap)` : "") +
        `\n    expansion seeds:           ${expansionSeedNames.join(", ")}` +
        `\n    per-seed:                  ${JSON.stringify(expansionPerSeedStats)}`
      : "") +
    `\n  high-conf cluster gate:     ${isHighConfidenceCluster ? "ACTIVE" : "off"} (cluster confidence=${dominantCluster.confidence.toFixed(2)})` +
    `\n  dropped (off_cluster):      ${droppedByFinalEligibility}${fallbackModeUsed ? " [fallback=loose ACTIVE]" : ""}` +
    `\n  dropped (neutral):          ${droppedNeutralByFinalEligibility}` +
    `\n  eligible after gate:        ${eligibleSuggestions.length}` +
    `\n  returned (capped):          ${finalSuggestions.length}` +
    `\n  cluster fit dist (scored):  ${JSON.stringify(clusterFitDistribution)}` +
    `\n  cluster fit dist (final):   ${JSON.stringify(survivorFitDistribution)}` +
    `\n  seed quality dist:          ${JSON.stringify(seedQualityDistribution)}` +
    `\n  debug-bypass:               ${debugBypass}` +
    `\n  expansion in final:         ${expansionAddedToFinalCount}` +
    `\n  diversification:            ${diversification.applied ? `ON (cluster=${dominantCluster.clusterKey})` : "off"}` +
    `\n    eligible (pre-diversify):  ${eligibleSuggestions.length}` +
    `\n    bucket dist (before):      ${JSON.stringify(diversification.distributionBefore)}` +
    `\n    bucket dist (after):       ${JSON.stringify(diversification.distributionAfter)}` +
    `\n    phase1 groups picked:      ${JSON.stringify(diversification.phase1GroupCounts)}` +
    `\n    phase2 groups picked:      ${JSON.stringify(diversification.phase2GroupCounts)}` +
    (diversification.skippedAtCap.length > 0
      ? `\n    skipped at cap:            ${diversification.skippedAtCap.slice(0, 20).map((x) => `${x.name}[${x.bucket}→${x.group}]`).join(", ")}`
      : "") +
    (finalSuggestions.length > 0
      ? `\n  Stage E final (top ${finalSuggestions.length}):` +
        finalSuggestions
          .map((s) => {
            const tag = (s.expansionSourceSeeds?.length ?? 0) > 0
              ? ` [R2:${s.expansionSourceSeeds!.join("|")}]`
              : "";
            const bucket = diversityBucketByName[s.name];
            const bucketTag = bucket ? ` [bucket=${bucket}]` : "";
            return `\n    • "${s.name}" [${s.suggestionType}]${bucketTag}${tag} ${fmtBreakdown(s)}`;
          })
          .join("")
      : ""),
  );

  // ── Junk-leak assertion (telemetry) — fires if the structural filter missed
  // anything or if the path-based classifier accepted a non-Interests root.
  // This should NEVER fire after Landing 1; if it does, it's a real bug.
  if (!debugBypass) {
    const JUNK_LEAK_PATTERNS = [
      /\bservices?\b/i, /\bfriends?\s+of\b/i, /\bbirthday\b/i,
      /\b(lived|living)\s+in\b/i, /\bfrequent\s*travel\b/i, /\bnewlywed\b/i,
      /\bfacebook\s*access\b/i, /\b(mobile|browser)\s*access\b/i,
      /\bprotective\b/i, /\bhealthcare\b/i, /\binstallation\b/i, /\brepair\b/i,
    ];
    for (const s of finalSuggestions) {
      // Structural assertion — primary check
      if (s.taxonomyRoot !== "Interests") {
        console.error(
          `[interest-suggestions] ⚠ STRUCTURAL LEAK: "${s.name}" has taxonomyRoot="${s.taxonomyRoot}" ` +
          `(should be "Interests"). path=${JSON.stringify(s.path)}. ` +
          `This is a bug in the enrichment/structural filter.`,
        );
      }
      // Regex telemetry — secondary check (should be redundant now)
      const leakHit = JUNK_LEAK_PATTERNS.find((p) => p.test(s.name));
      if (leakHit) {
        console.error(
          `[interest-suggestions] ⚠ JUNK LEAK (regex telemetry): "${s.name}" ` +
          `[type=${s.suggestionType}|root=${s.taxonomyRoot}] matched ${leakHit} — ` +
          `this should not happen with taxonomy-root filtering. Inspect path: ${JSON.stringify(s.path)}`,
        );
      }
    }
  }

  // Classify emptyReason
  let emptyReason: string | undefined;
  if (finalSuggestions.length === 0 && raw.length > 0) {
    if (
      (droppedByFinalEligibility > 0 || droppedNeutralByFinalEligibility > 0) &&
      eligibleSuggestions.length === 0
    ) {
      // The eligibility gate emptied the list. Caller should expand seeds or
      // pass ?fallback=loose to opt back into off_cluster + neutral candidates.
      emptyReason = "no_oncluster_candidates";
    } else {
      const droppedAll = droppedMissingPath + droppedNonInterest + excludedByCluster + excludedByType;
      if (droppedAll >= raw.length - excludedBySeed)
        emptyReason = "blocklist_filtered";
      else
        emptyReason = "scored_out";
    }
  } else if (finalSuggestions.length > 0 && fallbackUsed) {
    emptyReason = "success_after_fallback";
  } else if (finalSuggestions.length > 0 && fallbackModeUsed) {
    emptyReason = "success_after_loose_fallback";
  }

  const debugInfo: SuggestionsDebugInfo = {
    receivedIds: ids,
    receivedNames: names,
    validSeedCount: sortedSeeds.filter((s) => s.hasRealId).length,
    invalidSeedIds: invalidIds,
    metaUrl: metaUrlSafe,
    metaHttpStatus,
    payloadMode: "interest_list",
    seedNamesSent,
    seedCount: seedNamesSent.length,
    fallbackUsed,
    fallbackSeedNames,
    rawSuggestionCount: raw.length,
    enrichedCandidateCount: enriched.size,
    droppedMissingPathCount: droppedMissingPath,
    droppedNonInterestCount: droppedNonInterest,
    droppedNonInterestRoots,
    finalInterestOnlyCount,
    excludedBySeedCount: excludedBySeed,
    excludedJunkCount: excludedJunk,
    excludedByClusterBlocklistCount: excludedByCluster,
    excludedByTypeCount: excludedByType,
    excludedByTypeBreakdown,
    finalCount: finalSuggestions.length,
    finalSuggestionTypes,
    blockedNames,
    tokenPrefix,
    top5Raw,
    top10ScoreBreakdown,
    perSeedStats,
    unionPoolSize: pool.size,
    maxSeedsCapped,
    retrievalSeedCount: retrievalSeeds.length,
    seedProfiles: Object.fromEntries(
      Array.from(seedProfiles.entries()).map(([id, p]) => [
        id,
        {
          name: p.name,
          bucket: p.bucket,
          reliability: p.reliability,
          reliabilityInputs: p.reliabilityInputs,
          ambiguityScore: p.ambiguityScore,
          domain: p.domain,
          entityType: p.entityType,
          normalisedEntityType: p.normalisedEntityType,
          domainFamilies: p.domainFamilies,
          watchlistClass: p.watchlistClass,
          pathDepth: p.pathDepth,
          path: p.path,
          audienceSize: p.audienceSize,
          onDominantCluster: p.onDominantCluster,
          flags: p.flags,
        },
      ]),
    ),
    dominantCluster,
    trustedSeedCount: bucketCounts.trusted,
    weakSeedCount: bucketCounts.weak,
    ambiguousSeedCount: bucketCounts.ambiguous,
    conflictingSeedCount: bucketCounts.conflicting,
    seedEnrichmentRequested: seedIdsForEnrichment.length,
    seedEnrichmentResolved: seedEnriched.size,
    quarantinedCount: quarantinedNames.length,
    quarantinedNames,
    clusterFitDistribution,
    seedQualityDistribution,
    droppedByFinalEligibilityCount: droppedByFinalEligibility,
    droppedByFinalEligibilityNames,
    droppedNeutralByFinalEligibilityCount: droppedNeutralByFinalEligibility,
    droppedNeutralByFinalEligibilityNames,
    fallbackModeUsed,
    survivorFitDistribution,
    highConfidenceClusterGate: isHighConfidenceCluster,
    expansionAttempted,
    expansionMode,
    expansionTriggerReason,
    expansionReasonSkipped,
    expansionSeedNames,
    expansionSeedSourceBreakdown,
    curatedExpansionSeedsUsed,
    expansionRawCount,
    expansionNewCandidateCount,
    expansionAddedToFinalCount,
    expansionPerSeedStats,
    diversificationApplied: diversification.applied,
    diversificationCluster: diversification.applied ? dominantCluster.clusterKey : null,
    eligiblePreDiversificationCount: eligibleSuggestions.length,
    survivorBucketDistributionBefore: diversification.distributionBefore,
    survivorBucketDistributionAfter: diversification.distributionAfter,
    diversificationSkippedAtCap: diversification.skippedAtCap,
    selectedPhase1BucketCounts: diversification.phase1GroupCounts,
    selectedPhase2BucketCounts: diversification.phase2GroupCounts,
    curatedRescueCandidatesConsidered,
    curatedRescueCandidatesPicked: curatedExpansionSeedsUsed,
    underrepresentedBucketsBeforeExpansion,
    rescueSeedPriorityOrder,
    thinPoolRecallBoostActive,
  };

  return NextResponse.json({
    suggestions: finalSuggestions,
    count: finalSuggestions.length,
    ...(emptyReason ? { emptyReason } : {}),
    debug: debugInfo,
  });
}
