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
  const excludeIds = new Set([
    ...ids,
    ...params.getAll("exclude[]"),
  ]);

  // Need at least one selected interest to build suggestions
  if (ids.length === 0) {
    return NextResponse.json({ suggestions: [], count: 0 });
  }

  // Build interest_list payload (parallel id/name arrays → object array)
  const interestList = ids
    .map((id, i) => ({ id, name: names[i] ?? "" }))
    .filter((x) => /^\d{5,}$/.test(x.id)); // only real Meta IDs

  if (interestList.length === 0) {
    return NextResponse.json({ suggestions: [], count: 0 });
  }

  const url = new URL(`${BASE}/search`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("type", "adinterestsuggestion");
  url.searchParams.set("interest_list", JSON.stringify(interestList));
  url.searchParams.set("limit", "30");

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    console.error("[/api/meta/interest-suggestions] Network error:", err);
    return NextResponse.json({ error: "Network error contacting Meta API" }, { status: 502 });
  }

  const json = (await res.json()) as Record<string, unknown>;

  if (!res.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    console.error("[/api/meta/interest-suggestions] Meta error:", JSON.stringify(json));
    return NextResponse.json(
      { error: (e.message as string) ?? `HTTP ${res.status}`, code: e.code },
      { status: 502 },
    );
  }

  const raw = (json.data as Array<{
    id: string;
    name: string;
    audience_size?: number;
    path?: string[];
  }>) ?? [];

  // ── Filter and score ──────────────────────────────────────────────────────

  const pathPattern = CLUSTER_PATH_PATTERNS[cluster];
  const blocklist = CLUSTER_BLOCKLIST[cluster] ?? [];

  const suggestions: SuggestedInterest[] = [];

  for (const item of raw) {
    // Exclude already-selected or explicitly excluded IDs
    if (excludeIds.has(item.id)) continue;

    // Apply cluster blocklist
    const text = [item.name, ...(item.path ?? [])].join(" ");
    if (blocklist.some((p) => p.test(text))) continue;

    const size = item.audience_size ?? 0;
    let score = sizeBandScore(size);

    // Reward if the interest's path/name matches the cluster
    if (pathPattern?.test(text)) score += 20;

    // Penalise known-deprecated names
    const deprecated = isKnownDeprecated(item.name);
    if (deprecated) score -= 15;

    // Penalise mega-broad generic terms
    if (/^(music|fashion|art|travel|fitness|food|sports?)$/i.test(item.name)) score -= 10;

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

  // Sort by score descending (Meta already sorts by semantic relevance;
  // our re-sort refines by cluster-fit and size discipline on top)
  suggestions.sort((a, b) => b.score - a.score);

  console.info(
    `[interest-suggestions] cluster="${cluster}" seed-interests=${interestList.length}` +
    ` raw=${raw.length} after-filter=${suggestions.length}` +
    ` top5: ${suggestions.slice(0, 5).map((s) => `${s.name}(${s.score})`).join(", ")}`,
  );

  return NextResponse.json({ suggestions, count: suggestions.length });
}
