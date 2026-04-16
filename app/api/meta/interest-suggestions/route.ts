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
    ambiguityScore: number;
    domain: string;
    entityType: SuggestionType;
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

// ── Landing 2b-i: seed profiling + dominant cluster inference ────────────────
// OBSERVATION ONLY — these signals are logged and returned in debug, but
// DO NOT influence scoring yet. Scoring changes land in 2b-ii/iii/iv.

type SeedBucket = "trusted" | "weak" | "ambiguous" | "conflicting";

export interface SeedProfile {
  id: string;
  name: string;
  path: string[];
  audienceSize: number;
  domain: string;
  entityType: SuggestionType;
  pathDepth: number;
  ambiguityScore: number;  // 0..1, higher = more ambiguous
  reliability: number;     // 0..1
  bucket: SeedBucket;
  onDominantCluster: boolean;
  flags: string[];
}

export interface DominantCluster {
  path: string[];
  confidence: number;
  supporters: string[];
  depth: number;
  band: "high" | "medium" | "low";
}

// Hand-curated list of interest names that collide with unrelated Meta interests.
// Grows empirically from exclusionReason telemetry. Lowercased, exact-match.
const AMBIGUOUS_NAME_LIST = new Set([
  "gala", "id", "i.d.", "i-d", "dance", "metal", "eclipse", "apple",
  "cosmos", "prism", "venus", "eden", "atlas", "vice", "fact", "kid",
  "love", "mood", "echo", "halo", "metro", "faith", "pure", "true",
  "icon", "nova", "zen", "vogue", "rage", "stone", "mint", "cloud",
  "spark", "blaze", "palace", "supreme", "culture", "noise", "fade",
]);

// Single-word common-English terms that match too many Meta nodes. Lowercase.
const COMMON_WORD_PATTERN = /^[a-z]{1,5}$/;

function lcpPaths(a: readonly string[], b: readonly string[]): number {
  let n = 0;
  const max = Math.min(a.length, b.length);
  while (n < max && a[n].toLowerCase() === b[n].toLowerCase()) n++;
  return n;
}

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
  const entityType: SuggestionType = path.length > 0 ? classifyFromPath(path) : "unknown";
  const nameLower = name.trim().toLowerCase();

  const flags: string[] = [];
  let ambiguity = 0;

  if (AMBIGUOUS_NAME_LIST.has(nameLower)) {
    ambiguity += 0.35;
    flags.push("ambiguous_name");
  }
  if (nameLower.length <= 3) {
    ambiguity += 0.30;
    flags.push("short_name");
  } else if (COMMON_WORD_PATTERN.test(nameLower) && !nameLower.match(/\d/)) {
    ambiguity += 0.20;
    flags.push("common_word");
  }
  if (pathDepth === 0) {
    ambiguity += 0.25;
    flags.push("no_path");
  } else if (pathDepth < 3) {
    ambiguity += 0.15;
    flags.push("shallow_path");
  }
  if (audienceSize > 100_000_000) {
    ambiguity += 0.15;
    flags.push("very_broad_audience");
  }
  if (/\b(magazine|media|network|records?|group)\b/i.test(name) && pathDepth < 4) {
    ambiguity += 0.10;
    flags.push("generic_media_label");
  }

  const ambiguityScore = Math.max(0, Math.min(1, ambiguity));

  let reliability = 0.55;
  reliability -= ambiguityScore;
  if (pathDepth >= 4) reliability += 0.15;
  else if (pathDepth >= 3) reliability += 0.05;
  else reliability -= 0.10;
  if (audienceSize > 0 && audienceSize < 10_000_000) reliability += 0.10;
  if (entityType !== "unknown") reliability += 0.10;
  else reliability -= 0.05;

  reliability = Math.max(0, Math.min(1, reliability));

  return { id, name, path, audienceSize, domain, entityType, pathDepth, ambiguityScore, reliability, flags };
}

function inferDominantCluster(
  seeds: Array<{ id: string; reliability: number; path: string[] }>,
): DominantCluster {
  const empty: DominantCluster = {
    path: ["Interests"], confidence: 0, supporters: [], depth: 0, band: "low",
  };
  if (seeds.length === 0) return empty;

  const totalReliability = seeds.reduce((sum, s) => sum + s.reliability, 0) || 1;

  for (const depth of [3, 2] as const) {
    const buckets = new Map<string, { weight: number; supporters: string[]; path: string[] }>();
    for (const s of seeds) {
      if (s.path.length < depth + 1) continue;
      const slice = s.path.slice(0, depth + 1);
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
        ? confidence >= 0.35
        : (winner.supporters.length >= 2 || confidence >= 0.60);

    if (qualifies) {
      const band: DominantCluster["band"] =
        confidence >= 0.60 ? "high" : confidence >= 0.35 ? "medium" : "low";
      return { path: winner.path, confidence, supporters: winner.supporters, depth, band };
    }
  }

  return empty;
}

function finaliseSeedBucket(
  profile: Omit<SeedProfile, "bucket" | "onDominantCluster">,
  cluster: DominantCluster,
): { bucket: SeedBucket; onDominantCluster: boolean } {
  if (cluster.confidence < 0.35 || cluster.path.length === 0) {
    // No reliable cluster — use reliability alone
    const bucket: SeedBucket =
      profile.reliability >= 0.70 ? "trusted"
      : profile.reliability >= 0.40 ? "weak"
      : "ambiguous";
    return { bucket, onDominantCluster: false };
  }

  const common = lcpPaths(profile.path, cluster.path);
  const onDominantCluster = profile.path.length > 0 && common >= cluster.path.length - 1;

  // Conflicting: seed has a real path that clearly diverges from the dominant cluster
  if (profile.pathDepth >= 3 && common <= Math.max(1, cluster.path.length - 2)) {
    return { bucket: "conflicting", onDominantCluster: false };
  }

  const bucket: SeedBucket =
    onDominantCluster && profile.reliability >= 0.70 ? "trusted"
    : onDominantCluster && profile.reliability >= 0.40 ? "weak"
    : "ambiguous";

  return { bucket, onDominantCluster };
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

  const dominantCluster = inferDominantCluster(
    partialSeedProfiles.map((p) => ({ id: p.id, reliability: p.reliability, path: p.path })),
  );

  const seedProfiles = new Map<string, SeedProfile>();
  for (const p of partialSeedProfiles) {
    const { bucket, onDominantCluster } = finaliseSeedBucket(p, dominantCluster);
    seedProfiles.set(p.id, { ...p, bucket, onDominantCluster });
  }

  const bucketCounts = { trusted: 0, weak: 0, ambiguous: 0, conflicting: 0 };
  for (const p of seedProfiles.values()) bucketCounts[p.bucket]++;

  console.info(
    `[interest-suggestions] ── Stage S: seed profiling (Landing 2b-i, observation only) ──` +
    Array.from(seedProfiles.values()).map((p) =>
      `\n  • ${p.name.padEnd(26)} [${p.bucket.padEnd(11)}] r=${p.reliability.toFixed(2)} amb=${p.ambiguityScore.toFixed(2)} ` +
      `depth=${p.pathDepth} type=${p.entityType}` +
      (p.flags.length ? ` flags=${p.flags.join(",")}` : "") +
      (p.path.length ? ` path=${p.path.join(" > ")}` : " path=(none)"),
    ).join("") +
    `\n  Dominant cluster: ${dominantCluster.path.join(" > ") || "(none)"}` +
    ` — confidence=${dominantCluster.confidence.toFixed(2)} (${dominantCluster.band.toUpperCase()})` +
    ` depth=${dominantCluster.depth}` +
    ` supporters=${dominantCluster.supporters.length}/${sortedSeeds.length}` +
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

    // 6g. Cross-seed agreement (Landing 2a) — primary relevance signal
    // S_agree = (seeds that surfaced this candidate) / (total retrieval seeds)
    // Range [0, 1]. A candidate surfaced by 3/3 seeds is overwhelmingly more
    // relevant than one surfaced by 1/3 — this is the main quality unlock.
    const accumulator = pool.get(item.id);
    const sourceSeedIds = accumulator ? Array.from(accumulator.sourceSeeds) : [];
    const S_agree = retrievalSeeds.length > 0 ? sourceSeedIds.length / retrievalSeeds.length : 0;

    // 6h. Compute score
    const S_agree_points = Math.round(S_agree * 35); // weight = 35 (per Landing 2 design)
    let score = sizeBandScore(size);
    score += typeBonus;
    score += S_agree_points;
    if (!debugBypass && pathPattern?.test(text)) score += 10;

    const deprecated = !debugBypass && isKnownDeprecated(item.name);
    if (deprecated) score -= 15;

    if (!debugBypass && /^(music|fashion|art|travel|fitness|food|sports?)$/i.test(item.name)) score -= 10;

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
    });
  }

  suggestions.sort((a, b) => b.score - a.score);

  // Cap at top 10 — show fewer strong suggestions rather than a noisy list
  const MAX_SUGGESTIONS = 10;
  const finalSuggestions = suggestions.slice(0, MAX_SUGGESTIONS);

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
  }));

  const finalInterestOnlyCount = finalSuggestions.length;

  console.info(
    `[interest-suggestions] ── Stage D: pipeline summary (Landing 2a) ──` +
    `\n  retrieval seeds:            ${retrievalSeeds.length}${maxSeedsCapped ? ` (capped from ${sortedSeeds.length})` : ""}` +
    `\n  union pool size:            ${pool.size}` +
    `\n  raw (from pool):            ${raw.length}` +
    `\n  enriched (adinterestvalid): ${enriched.size}/${candidateIds.length}` +
    `\n  excluded by seed:           ${excludedBySeed}` +
    `\n  dropped (missing path):     ${droppedMissingPath}` +
    `\n  dropped (non-Interests):    ${droppedNonInterest} — roots: ${JSON.stringify(droppedNonInterestRoots)}` +
    `\n  excluded (cluster list):    ${excludedByCluster}` +
    `\n  excluded (type):            ${excludedByType} ${JSON.stringify(excludedByTypeBreakdown)}` +
    `\n  scored:                     ${suggestions.length}` +
    `\n  returned (capped):          ${finalSuggestions.length}` +
    `\n  debug-bypass:               ${debugBypass}` +
    (finalSuggestions.length > 0
      ? `\n  Stage E final: ${finalSuggestions.map((s) => `"${s.name}"[${s.suggestionType}|agree=${((s.seedAgreement ?? 0) * 100).toFixed(0)}%|score=${s.score}]`).join(", ")}`
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
    const droppedAll = droppedMissingPath + droppedNonInterest + excludedByCluster + excludedByType;
    if (droppedAll >= raw.length - excludedBySeed)
      emptyReason = "blocklist_filtered";
    else
      emptyReason = "scored_out";
  } else if (finalSuggestions.length > 0 && fallbackUsed) {
    emptyReason = "success_after_fallback";
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
          ambiguityScore: p.ambiguityScore,
          domain: p.domain,
          entityType: p.entityType,
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
  };

  return NextResponse.json({
    suggestions: finalSuggestions,
    count: finalSuggestions.length,
    ...(emptyReason ? { emptyReason } : {}),
    debug: debugInfo,
  });
}
