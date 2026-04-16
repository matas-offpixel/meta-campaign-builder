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
 *   cluster   — optional cluster label for blocklist + path-pattern scoring
 *   exclude[] — optional additional IDs to exclude from results
 *
 * Returns:
 *   { suggestions: SuggestedInterest[], count: number }
 *
 * Meta endpoint reference:
 *   GET /search?type=adinterestsuggestion
 *              &interest_list=[{"id":"...","name":"..."},...]
 *              &limit=25
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ── Cluster path patterns (keeps suggestions on-theme) ───────────────────────

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

// ── Per-cluster blocklists — prevents low-quality or off-topic suggestions ───

const CLUSTER_BLOCKLIST: Record<string, RegExp[]> = {
  "Music & Nightlife": [
    /\b(video.?game|gaming|esport|the\s*sims|fortnite|minecraft)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(stock.?market|cryptocurrency|forex|bitcoin)\b/i,
    /\b(performing\s*arts|classical\s*music|opera|ballet|orchestra)\b/i,
    /\b(fashion\s*brand|luxury\s*brand|haute\s*couture)\b/i,
  ],
  "Fashion & Streetwear": [
    /\b(video.?game|gaming|esport|the\s*sims)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(gym|fitness|bodybuilding|crossfit)\b/i,
    /\b(sports?\s*team|football\s*club|cricket)\b/i,
    // Block music artists/DJs/venues from Fashion results
    /\b(disc\s*jockey|nightclub|music\s*festival|record\s*label)\b/i,
    /\b(Boiler\s*Room|Resident\s*Advisor|Mixmag|DJ\s*Mag)\b/i,
    /\b(techno\s*music|electronic\s*dance\s*music|house\s*music)\b/i,
  ],
  "Lifestyle & Nightlife": [
    /\b(video.?game|gaming|esport|the\s*sims|fortnite|expansion\s*pack)\b/i,
    /\b(TV\s*series|soap\s*opera|sitcom|anime|manga|superhero)\b/i,
    /\b(parenting|mommy|toddler|pregnancy)\b/i,
    /\b(stock.?market|cryptocurrency|forex)\b/i,
    /\b(record\s*label|disc\s*jockey|music\s*production)\b/i,
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

// ── Known-deprecated names — flagged in the response so the UI can warn ─────

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

export interface SuggestedInterest {
  id: string;
  name: string;
  audienceSize: number | null;
  path?: string[];
  /** Score: higher = more relevant to the current cluster */
  score: number;
  /** Whether this name matches the known-deprecated list */
  likelyDeprecated?: boolean;
  /** Human-readable audience size band */
  audienceSizeBand?: string;
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

export interface SuggestionsDebugInfo {
  receivedIds: string[];
  receivedNames: string[];
  validSeedCount: number;
  invalidSeedIds: string[];
  metaUrl: string;
  metaHttpStatus: number;
  /** Always "interest_list" — adinterestsuggestion is documented name-based */
  payloadMode: "interest_list";
  seedNamesSent: string[];
  seedCount: number;
  fallbackUsed: boolean;
  fallbackSeedNames: string[];
  rawCount: number;
  afterExcludeCount: number;
  afterBlocklistCount: number;
  finalCount: number;
  blockedNames: string[];
  tokenPrefix: string;
  metaError?: string;
  top5Raw: string[];
}

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
  // adinterestsuggestion is documented to use interest_list = array of name
  // strings. interest_fbid_list is for adinterestvalid (validation), not
  // suggestions — sending it here causes Meta 500 "unknown error".
  //
  // Strategy: pair each received id with its name. Prefer seeds that have a
  // real Meta numeric ID (they were searched/discovered and are known-valid).
  // Fall back to name-only seeds if no real IDs exist (e.g. manually typed).

  const ID_RE = /^\d{5,}$/;
  const allSeeds = ids.map((id, i) => ({
    id,
    name: (names[i] ?? "").trim(),
    hasRealId: ID_RE.test(id),
  })).filter((s) => s.name.length > 0);

  const invalidIds = ids.filter((id) => !ID_RE.test(id));

  // Sort: real-ID seeds first (higher confidence), then name-only
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
  // adinterestsuggestion: interest_list = JSON array of plain name strings.
  // Use encodeURIComponent (not URLSearchParams) to avoid encoding spaces as +.

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
  // Triggered when: Meta 500 or empty result on full seed list.
  // Strongest seeds = real-ID seeds, capped at 2 for minimal payload.
  const needsFallback =
    !metaResult.ok ||
    (metaResult.ok && metaResult.data.length === 0 && sortedSeeds.length > 1);

  if (needsFallback) {
    const topSeeds = sortedSeeds.filter((s) => s.hasRealId).slice(0, 2);
    // If no real-ID seeds, fall back to first 1 named seed
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
      // Both attempts failed — surface a specific emptyReason
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

  // ── Step 5: parse raw results ─────────────────────────────────────────────
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
        validSeedCount: sortedSeeds.length, rawCount: 0, tokenPrefix,
        payloadMode: "interest_list", seedNamesSent, seedCount: seedNamesSent.length,
        fallbackUsed, fallbackSeedNames,
      },
    });
  }

  // ── Step 6: filter and score ──────────────────────────────────────────────
  const pathPattern = CLUSTER_PATH_PATTERNS[cluster];
  const blocklist = debugBypass ? [] : (CLUSTER_BLOCKLIST[cluster] ?? []);

  const suggestions: SuggestedInterest[] = [];
  const blockedNames: string[] = [];
  let afterExclude = 0;

  for (const item of raw) {
    // 6a. Exclude already-selected IDs
    if (excludeIds.has(item.id)) continue;
    afterExclude++;

    // 6b. Apply cluster blocklist (disabled in debug bypass)
    const text = [item.name, ...(item.path ?? [])].join(" ");
    if (!debugBypass && blocklist.some((p) => p.test(text))) {
      blockedNames.push(item.name);
      continue;
    }

    const size = item.audience_size ?? 0;
    let score = sizeBandScore(size);

    // Reward if the interest's path/name matches the cluster
    if (!debugBypass && pathPattern?.test(text)) score += 20;

    // Penalise known-deprecated names (still score, but don't drop)
    const deprecated = !debugBypass && isKnownDeprecated(item.name);
    if (deprecated) score -= 15;

    // Penalise mega-broad single-word generics
    if (!debugBypass && /^(music|fashion|art|travel|fitness|food|sports?)$/i.test(item.name)) score -= 10;

    suggestions.push({
      id: item.id,
      name: item.name,
      audienceSize: size > 0 ? size : null,
      path: item.path,
      score,
      likelyDeprecated: deprecated || undefined,
      audienceSizeBand: audienceSizeBand(size),
    });
  }

  suggestions.sort((a, b) => b.score - a.score);

  console.info(
    `[interest-suggestions] filtering pipeline:` +
    `\n  raw:              ${raw.length}` +
    `\n  after exclude:    ${afterExclude}` +
    `\n  blocked by list:  ${blockedNames.length} (${blockedNames.slice(0, 5).join(", ")})` +
    `\n  final:            ${suggestions.length}` +
    `\n  debug-bypass:     ${debugBypass}` +
    (suggestions.length > 0
      ? `\n  top5 final: ${suggestions.slice(0, 5).map((s) => `${s.name}(score=${s.score})`).join(", ")}`
      : ""),
  );

  // Classify emptyReason when suggestions are 0 but raw > 0
  let emptyReason: string | undefined;
  if (suggestions.length === 0 && raw.length > 0) {
    if (blockedNames.length > 0 && afterExclude === 0) emptyReason = "all_excluded";
    else if (blockedNames.length > 0) emptyReason = "blocklist_filtered";
    else emptyReason = "scored_out";
  } else if (suggestions.length > 0 && fallbackUsed) {
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
    rawCount: raw.length,
    afterExcludeCount: afterExclude,
    afterBlocklistCount: afterExclude - blockedNames.length,
    finalCount: suggestions.length,
    blockedNames,
    tokenPrefix,
    top5Raw,
  };

  return NextResponse.json({
    suggestions,
    count: suggestions.length,
    ...(emptyReason ? { emptyReason } : {}),
    debug: debugInfo,
  });
}
