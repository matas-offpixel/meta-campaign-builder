/**
 * lib/reporting/group-tiktok-creatives.ts
 *
 * Groups TikTok active-creative snapshot rows into "concept" buckets,
 * mirroring what group-creatives.ts does for Meta. The rows from
 * tiktok_active_creatives_snapshots are already per-ad lifetime totals;
 * this layer collapses ads that represent the same creative concept
 * (e.g. the same video run across multiple ad sets or campaigns).
 *
 * Grouping key waterfall (first non-null wins):
 *   1. VideoID extracted from thumbnail_url query string
 *        → `video:${VideoID}` — the most precise signal: TikTok CDN
 *        URLs carry `?...&VideoID=v10033...` for every video thumbnail.
 *        Ads sharing the same VideoID are the same video concept.
 *   2. thumbnail_url path (query string stripped)
 *        → `thumb:${path}` — same static thumbnail image = same creative.
 *   3. Normalised ad_name (date stamps, file extensions, and trailing
 *        hash tokens stripped; lowercased)
 *        → `name:${normalised}` — agencies name identical concepts the
 *        same way across ad sets. Rejected when < 3 chars, pure-numeric,
 *        or a bare ISO date.
 *   4. ad_id literal → `id:${ad_id}` — last-resort fallback.
 *
 * Rate metrics are recomputed from summed numerator + denominator
 * (ratio of sums) — NOT averaged over the input rows — to avoid
 * Simpson's-paradox weighting errors.
 *
 * Pure module — no Supabase, no TikTok API, no side effects.
 */

// ─── Input / output shapes ────────────────────────────────────────────────

export interface TikTokCreativeInput {
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  video_views_2s: number | null;
  video_views_6s: number | null;
  video_views_100p: number | null;
  thumbnail_url: string | null;
  deeplink_url: string | null;
}

export interface TikTokCreativeGroup {
  /** Waterfall-derived bucket key. */
  group_key: string;
  /** Human-readable display name for the concept. */
  display_name: string;
  /** Number of individual ads rolled into this group. */
  ad_count: number;
  /** Number of distinct campaigns that ran this concept. */
  campaign_count: number;
  /** Deduplicated campaign names, sorted by spend share. */
  campaign_names: string[];
  /** Cumulative sums across all ads in the group. */
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  video_views_2s: number | null;
  video_views_6s: number | null;
  video_views_100p: number | null;
  /** Rate metrics — recomputed from sums, not averaged. */
  ctr: number | null;
  cpm: number | null;
  cost_per_video_play: number | null;
  /** Card visual — highest-spend ad's thumbnail URL. */
  thumbnail_url: string | null;
  /** Deeplink from the highest-spend ad. */
  deeplink_url: string | null;
}

// ─── Waterfall helpers ────────────────────────────────────────────────────

/**
 * Extract TikTok's VideoID from a CDN thumbnail URL query string.
 * TikTok CDN URLs carry a `VideoID=v100...` parameter that identifies
 * the underlying video asset — stable across re-uploads and ad sets
 * for the same video.
 *
 * @example
 * extractVideoId("https://...?x-expires=...&VideoID=v10033g500abc")
 * // "v10033g500abc"
 */
export function extractVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /[?&]VideoID=([^&]+)/i.exec(url);
  return match?.[1] ?? null;
}

/**
 * Strip the query string from a TikTok CDN URL to get a stable path
 * key for the thumbnail tier.
 */
function normaliseThumbnailPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split("?")[0]?.trim();
  return path && path.length > 10 ? path : null;
}

// Trailing ISO date: "2026-05-27" or "_2026-05-27 19:26:22"
const TT_TRAILING_DATE_RE = /[\s_\-]+\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?\s*$/;
// File extension
const TT_EXT_RE = /\.[a-z0-9]{2,5}$/i;
// Trailing hash/randomised token (≥ 6 alphanumeric after separator)
const TT_HASH_TAIL_RE = /[\s_\-]+[a-zA-Z0-9]{6,}\s*$/;
// Pure ISO date string (entire value is a date/datetime)
const TT_PURE_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?$/;
// Pure-numeric
const TT_PURE_NUMERIC_RE = /^\d+$/;

/**
 * Normalise a TikTok ad name for use as a grouping key.
 * Strips agency filename conventions so "AMAAD_EDIT 5_VHS_LdEMKpkc.mp4_2026-05-27 19:26:22"
 * and a sibling ad with the same video share one bucket.
 *
 * Returns "" when nothing usable remains (caller falls through to
 * the next waterfall tier).
 */
export function normaliseTikTokAdName(raw: string | null | undefined): string {
  if (!raw) return "";
  const s0 = raw.trim();
  // Reject entire string if it IS an ISO date/datetime before any stripping
  if (TT_PURE_DATE_RE.test(s0)) return "";
  let s = s0;
  // Strip trailing ISO date stamp (with optional time component)
  s = s.replace(TT_TRAILING_DATE_RE, "").trimEnd();
  // Strip file extension
  s = s.replace(TT_EXT_RE, "").trimEnd();
  // Strip trailing hash/random token (repeat to handle chained tokens)
  for (let i = 0; i < 5 && TT_HASH_TAIL_RE.test(s); i++) {
    s = s.replace(TT_HASH_TAIL_RE, "").trimEnd();
  }
  // Normalise separators → spaces, collapse whitespace, lowercase
  s = s
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s;
}

/** Whether a normalised name is an acceptable grouping key. */
function isAcceptableName(normalised: string): boolean {
  if (normalised.length < 3) return false;
  if (TT_PURE_DATE_RE.test(normalised)) return false;
  if (TT_PURE_NUMERIC_RE.test(normalised)) return false;
  return true;
}

type KeyReason = "video_id" | "thumbnail" | "name" | "ad_id";

function deriveGroupKey(row: TikTokCreativeInput): {
  key: string;
  reason: KeyReason;
} {
  // Tier 1 — VideoID (most precise TikTok signal)
  const videoId = extractVideoId(row.thumbnail_url);
  if (videoId) return { key: `video:${videoId}`, reason: "video_id" };

  // Tier 2 — thumbnail path
  const thumbPath = normaliseThumbnailPath(row.thumbnail_url);
  if (thumbPath) return { key: `thumb:${thumbPath}`, reason: "thumbnail" };

  // Tier 3 — normalised ad_name
  const name = normaliseTikTokAdName(row.ad_name);
  if (isAcceptableName(name)) return { key: `name:${name}`, reason: "name" };

  // Tier 4 — fallback to individual ad
  return { key: `id:${row.ad_id}`, reason: "ad_id" };
}

// ─── Display name ─────────────────────────────────────────────────────────

/**
 * Pick a human-readable display name for a concept group.
 * Uses the original (non-lowercased) ad name after stripping the same
 * technical suffixes as `normaliseTikTokAdName`, so "VID 2" stays
 * "VID 2" while the grouping key is "vid 2".
 */
function pickDisplayName(
  representative: TikTokCreativeInput,
  reason: KeyReason,
): string {
  const raw = representative.ad_name?.trim();
  if (raw) {
    // Apply the same suffix strips but keep original casing
    let s = raw;
    s = s.replace(TT_TRAILING_DATE_RE, "").trimEnd();
    s = s.replace(TT_EXT_RE, "").trimEnd();
    for (let i = 0; i < 5 && TT_HASH_TAIL_RE.test(s); i++) {
      s = s.replace(TT_HASH_TAIL_RE, "").trimEnd();
    }
    s = s.trim();
    if (s.length >= 3 && !TT_PURE_DATE_RE.test(s.toLowerCase()) && !TT_PURE_NUMERIC_RE.test(s)) {
      return s;
    }
  }
  if (reason === "video_id") return "Video creative";
  if (reason === "thumbnail") return "Image creative";
  return `Ad ${representative.ad_id.slice(-6)}`;
}

// ─── Grouper ─────────────────────────────────────────────────────────────

function safeRate(
  num: number,
  denom: number,
  scale = 1,
): number | null {
  if (!Number.isFinite(denom) || denom <= 0) return null;
  if (!Number.isFinite(num)) return null;
  return (num / denom) * scale;
}

/**
 * Group TikTok active-creative rows into concept buckets.
 * Output is sorted by total spend descending.
 *
 * Rate metrics (CTR, CPM, Cost per Video Play) are recomputed from
 * summed numerators and denominators — never averaged per row.
 */
export function groupTikTokCreatives(
  rows: readonly TikTokCreativeInput[],
): TikTokCreativeGroup[] {
  interface Acc {
    key: string;
    reason: KeyReason;
    representative: TikTokCreativeInput;
    topSpend: number;
    ad_count: number;
    campaigns: Map<string, string | null>;
    spend: number;
    impressions: number;
    reach: number;
    clicks: number;
    video_views_2s: number;
    video_views_6s: number;
    video_views_100p: number;
    has_video_views: boolean;
    thumbnail_url: string | null;
    thumbnail_spend: number;
    deeplink_url: string | null;
  }

  const buckets = new Map<string, Acc>();

  for (const row of rows) {
    const { key, reason } = deriveGroupKey(row);
    const rowSpend = Number(row.spend ?? 0);

    const acc: Acc = buckets.get(key) ?? {
      key,
      reason,
      representative: row,
      topSpend: -Infinity,
      ad_count: 0,
      campaigns: new Map(),
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      video_views_2s: 0,
      video_views_6s: 0,
      video_views_100p: 0,
      has_video_views: false,
      thumbnail_url: null,
      thumbnail_spend: -Infinity,
      deeplink_url: null,
    };

    acc.ad_count += 1;
    if (row.campaign_id) acc.campaigns.set(row.campaign_id, row.campaign_name ?? null);
    acc.spend += rowSpend;
    acc.impressions += Number(row.impressions ?? 0);
    acc.reach += Number(row.reach ?? 0);
    acc.clicks += Number(row.clicks ?? 0);
    if (row.video_views_2s != null) {
      acc.video_views_2s += row.video_views_2s;
      acc.has_video_views = true;
    }
    if (row.video_views_6s != null) {
      acc.video_views_6s += row.video_views_6s;
    }
    if (row.video_views_100p != null) {
      acc.video_views_100p += row.video_views_100p;
    }

    // Representative = highest-spend ad for display fields
    if (rowSpend > acc.topSpend) {
      acc.topSpend = rowSpend;
      acc.representative = row;
      acc.deeplink_url = row.deeplink_url ?? null;
    }

    // Thumbnail = highest-spend ad that has a thumbnail
    if (row.thumbnail_url && rowSpend > acc.thumbnail_spend) {
      acc.thumbnail_url = row.thumbnail_url;
      acc.thumbnail_spend = rowSpend;
    }

    buckets.set(key, acc);
  }

  const groups: TikTokCreativeGroup[] = [];
  for (const acc of buckets.values()) {
    const campaigns = [...acc.campaigns.entries()]
      .map(([, name]) => name)
      .filter((n): n is string => n != null);

    groups.push({
      group_key: acc.key,
      display_name: pickDisplayName(acc.representative, acc.reason),
      ad_count: acc.ad_count,
      campaign_count: acc.campaigns.size,
      campaign_names: campaigns,
      spend: acc.spend,
      impressions: acc.impressions,
      reach: acc.reach,
      clicks: acc.clicks,
      video_views_2s: acc.has_video_views ? acc.video_views_2s : null,
      video_views_6s: acc.has_video_views ? acc.video_views_6s : null,
      video_views_100p: acc.has_video_views ? acc.video_views_100p : null,
      ctr: safeRate(acc.clicks, acc.impressions, 100),
      cpm: safeRate(acc.spend, acc.impressions, 1000),
      cost_per_video_play: acc.has_video_views
        ? safeRate(acc.spend, acc.video_views_2s)
        : null,
      thumbnail_url: acc.thumbnail_url,
      deeplink_url: acc.deeplink_url,
    });
  }

  groups.sort((a, b) => b.spend - a.spend);
  return groups;
}
