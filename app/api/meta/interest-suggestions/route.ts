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

// ── Universal junk hard-exclusion ────────────────────────────────────────────
// Patterns that match Meta's junk behavioural / demographic categories which
// should NEVER appear in interest-cluster suggestion panels.

const UNIVERSAL_JUNK: RegExp[] = [
  // Facebook access / browser / device usage
  /\bfacebook\s*(access|lite|for\s*(android|ios|blackberry)|stories)\b/i,
  /\b(mobile|browser)\s*(app\s*)?access\b/i,
  /\bsmartphone\s*users?\b/i,
  /\bfeature\s*phone\b/i,
  // Device ownership
  /\bown(s|er|ing|ed)?\s*(an?\s*)?(iphone|ipad|samsung|galaxy|android|kindle|tablet|pc|mac|blackberry|apple\s*device|ios\s*device)\b/i,
  /\b(iphone|galaxy)\s*owner\b/i,
  // Life events
  /\bnewlywed\b/i,
  /\brecently\s*(married|moved|graduated|started\s*a\s*(new\s*)?(job|business))\b/i,
  /\bnew\s*(parent|baby|job|home)\b/i,
  /\bexpecting\s*(a\s*)?(baby|child)\b/i,
  /\bengaged\s+(to|couple)\b/i,
  /\bfriends?\s+of\s+(people|someone)\b/i,
  /\b(birth)?day\s*(this\s*week|coming\s*up|soon|of\s*the\s*week)\b/i,
  // Demographic / behavioural proxies
  /\bfrequent\s*travel(l?er|ling)\b/i,
  /\bbusiness\s*travel(l?er)\b/i,
  /\bcommuter\b/i,
  /\bexpat\b/i,
  /\breturned\s+from\b/i,
  /\baway\s+from\s+(home|family)\b/i,
  /\bearly\s*(technology\s*)?adopter\b/i,
  // Service industries
  /\b(legal|healthcare|medical|administrative|protective|installation|repair|cleaning|financial|insurance)\s*service\b/i,
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

  // Explicitly behavioural / demographic categories
  if (/\b(iphone|android|galaxy|tablet|kindle|blackberry)\b/i.test(text) &&
      !/magazine|music\s*app|film|band|fashion|record/i.test(text)) return "device_owner";
  if (/\bnewlywed|recently\s*(married|moved|graduated)\b/i.test(text)) return "life_event";
  if (/\bfrequent\s*travel|commuter|expat\b/i.test(text)) return "demographic_proxy";
  if (/\bservice\b/i.test(text) &&
      /\b(legal|healthcare|medical|admin|protective|installation|repair|cleaning|financial)\b/i.test(text))
    return "services";

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

// ── Exported types ────────────────────────────────────────────────────────────

export interface SuggestedInterest {
  id: string;
  name: string;
  audienceSize: number | null;
  path?: string[];
  score: number;
  likelyDeprecated?: boolean;
  audienceSizeBand?: string;
  /** Classified suggestion type for client-side display and diagnostics */
  suggestionType: SuggestionType;
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
  top10ScoreBreakdown: Array<{ name: string; type: string; score: number; sizeBand: string }>;
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

  // ── Step 4: attempt 1 — all seeds ─────────────────────────────────────────
  const allSeedNames = sortedSeeds.map((s) => s.name);
  let metaResult = await callMeta(allSeedNames, "attempt-1/all-seeds");

  let fallbackUsed = false;
  let fallbackSeedNames: string[] = [];

  // ── Step 4b: fallback — retry with top 1-2 highest-confidence seeds ───────
  // Triggered when Meta returns 500 or empty result on the full seed list.
  const needsFallback =
    !metaResult.ok ||
    (metaResult.ok && metaResult.data.length === 0 && sortedSeeds.length > 1);

  if (needsFallback) {
    const topSeeds = sortedSeeds.filter((s) => s.hasRealId).slice(0, 2);
    const fallbackPool = topSeeds.length > 0 ? topSeeds : sortedSeeds.slice(0, 1);
    fallbackSeedNames = fallbackPool.map((s) => s.name);

    console.info(
      `[interest-suggestions] fallback triggered (${!metaResult.ok ? "Meta error" : "empty result"})` +
      ` — retrying with top seeds: ${JSON.stringify(fallbackSeedNames)}`,
    );

    const fallbackResult = await callMeta(fallbackSeedNames, "attempt-2/fallback-seeds");
    fallbackUsed = true;

    if (fallbackResult.ok) {
      metaResult = fallbackResult;
    } else {
      const errCode = fallbackResult.errCode;
      let emptyReason = "meta_500_fallback_seeds";
      if (typeof errCode === "number") {
        if (errCode === 190 || errCode === 102) emptyReason = "token_expired";
        else if (errCode === 200 || errCode === 10) emptyReason = "token_permission";
        else if (errCode === 100) emptyReason = "invalid_request";
      }
      return NextResponse.json({
        error: fallbackResult.errMsg, code: errCode, emptyReason,
        debug: {
          metaHttpStatus: fallbackResult.httpStatus, tokenPrefix,
          metaUrl: fallbackResult.urlSafe, payloadMode: "interest_list",
          seedNamesSent: fallbackSeedNames, seedCount: fallbackSeedNames.length,
          fallbackUsed: true, fallbackSeedNames,
        },
      }, { status: 502 });
    }
  }

  // Surface error from attempt-1 when fallback wasn't triggered but it failed
  if (!metaResult.ok) {
    const errCode = metaResult.errCode;
    let emptyReason = "meta_500_all_seeds";
    if (typeof errCode === "number") {
      if (errCode === 190 || errCode === 102) emptyReason = "token_expired";
      else if (errCode === 200 || errCode === 10) emptyReason = "token_permission";
      else if (errCode === 100) emptyReason = "invalid_request";
    }
    return NextResponse.json({
      error: metaResult.errMsg, code: errCode, emptyReason,
      debug: {
        metaHttpStatus: metaResult.httpStatus, tokenPrefix,
        metaUrl: metaResult.urlSafe, payloadMode: "interest_list",
        seedNamesSent: allSeedNames, seedCount: allSeedNames.length,
        fallbackUsed, fallbackSeedNames,
      },
    }, { status: 502 });
  }

  // ── Step 5: unpack raw results ────────────────────────────────────────────
  const raw = metaResult.data;
  const metaHttpStatus = metaResult.httpStatus;
  const metaUrlSafe = metaResult.urlSafe;
  const payloadValue = metaResult.payloadValue;
  const seedNamesSent = fallbackUsed ? fallbackSeedNames : allSeedNames;

  const top5Raw = raw.slice(0, 5).map((r) => `${r.name}(${r.id})`);
  console.info(
    `[interest-suggestions] raw results: ${raw.length}` +
    (raw.length > 0 ? `\n  top5: ${top5Raw.join(", ")}` : " (empty — Meta returned nothing)"),
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
      },
    });
  }

  // ── Step 6: classify, filter, and score ───────────────────────────────────
  const typeScores = cluster
    ? (CLUSTER_TYPE_SCORES[cluster] ?? DEFAULT_TYPE_SCORES)
    : DEFAULT_TYPE_SCORES;
  const pathPattern = CLUSTER_PATH_PATTERNS[cluster];
  const blocklist = debugBypass ? [] : (CLUSTER_BLOCKLIST[cluster] ?? []);

  const suggestions: SuggestedInterest[] = [];
  const blockedNames: string[] = [];

  let excludedBySeed = 0;
  let excludedJunk = 0;
  let excludedByCluster = 0;
  let excludedByType = 0;
  const excludedByTypeBreakdown: Record<string, number> = {};

  for (const item of raw) {
    const itemPath = item.path ?? [];
    const text = [item.name, ...itemPath].join(" ");

    // 6a. Exclude already-selected IDs
    if (excludeIds.has(item.id)) { excludedBySeed++; continue; }

    // 6b. Universal junk hard-exclusion (device ownership, life events, FB access…)
    if (!debugBypass && isUniversalJunk(item.name, itemPath)) {
      excludedJunk++;
      blockedNames.push(item.name);
      continue;
    }

    // 6c. Cluster supplementary blocklist
    if (!debugBypass && blocklist.some((p) => p.test(text))) {
      excludedByCluster++;
      blockedNames.push(item.name);
      continue;
    }

    // 6d. Type classification + type-score gating
    const sType = debugBypass ? "unknown" : classifySuggestion(item.name, itemPath);
    const typeBonus = (typeScores as Record<string, number>)[sType] ?? 0;

    if (!debugBypass && typeBonus <= -999) {
      excludedByType++;
      excludedByTypeBreakdown[sType] = (excludedByTypeBreakdown[sType] ?? 0) + 1;
      blockedNames.push(item.name);
      continue;
    }

    // 6e. Compute score
    const size = item.audience_size ?? 0;
    let score = sizeBandScore(size);
    score += typeBonus;

    // Bonus for cluster path match (secondary signal — avoids double-counting
    // when type score already captured the right lane)
    if (!debugBypass && pathPattern?.test(text)) score += 10;

    // Deprecation penalty
    const deprecated = !debugBypass && isKnownDeprecated(item.name);
    if (deprecated) score -= 15;

    // Penalise mega-broad single-word generics with no path context
    if (!debugBypass && /^(music|fashion|art|travel|fitness|food|sports?)$/i.test(item.name)) score -= 10;

    suggestions.push({
      id: item.id,
      name: item.name,
      audienceSize: size > 0 ? size : null,
      path: itemPath.length > 0 ? itemPath : undefined,
      score,
      likelyDeprecated: deprecated || undefined,
      audienceSizeBand: audienceSizeBand(size),
      suggestionType: sType,
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
  }));

  console.info(
    `[interest-suggestions] pipeline results:` +
    `\n  raw:                    ${raw.length}` +
    `\n  excluded by seed:       ${excludedBySeed}` +
    `\n  excluded junk:          ${excludedJunk}` +
    `\n  excluded cluster list:  ${excludedByCluster}` +
    `\n  excluded by type:       ${excludedByType} (${JSON.stringify(excludedByTypeBreakdown)})` +
    `\n  scored:                 ${suggestions.length}` +
    `\n  returned (capped):      ${finalSuggestions.length}` +
    `\n  debug-bypass:           ${debugBypass}` +
    (finalSuggestions.length > 0
      ? `\n  top10: ${finalSuggestions.slice(0, 10).map((s) => `${s.name}[${s.suggestionType}](${s.score})`).join(", ")}`
      : ""),
  );

  // Classify emptyReason
  let emptyReason: string | undefined;
  if (finalSuggestions.length === 0 && raw.length > 0) {
    if (excludedJunk + excludedByType + excludedByCluster >= raw.length - excludedBySeed)
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
  };

  return NextResponse.json({
    suggestions: finalSuggestions,
    count: finalSuggestions.length,
    ...(emptyReason ? { emptyReason } : {}),
    debug: debugInfo,
  });
}
