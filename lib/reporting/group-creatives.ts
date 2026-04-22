/**
 * lib/reporting/group-creatives.ts
 *
 * Second-layer grouping on top of `groupAdsByCreative`. Where the
 * first layer collapses ads → one row per `creative_id`, this layer
 * collapses re-uploads of the same concept that Meta minted as
 * separate `creative_id`s — including the cases the previous
 * name-only grouper missed:
 *
 *   1. Re-uploaded video assets that kept the same Meta video_id but
 *      got a fresh creative_id and a numeric auto-name.
 *   2. Page-post (dark-post) ads that share an `effective_object_
 *      story_id` across multiple creative wrappers.
 *   3. Advantage+ creatives sharing the same `asset_feed_spec` image
 *      hashes in different orders.
 *
 * The grouping key is derived by a waterfall over Meta's own asset
 * signals (post id → asset signature → thumbnail → name → fallback)
 * — see `deriveGroupKey`. Name-based grouping is now the second-to-
 * last fallback, not the primary key. The waterfall reason is
 * surfaced on every group via `reasons: string[]` for debug.
 *
 * All math here mirrors the rules from `active-creatives-group.ts`:
 * weighted rate metrics computed from summed numerator + denominator,
 * ad sets / campaigns deduped, top-spend row picks the
 * `representative_*` fields and modal preview payload.
 *
 * Pure module — no Supabase, no Meta. Safe to import from server
 * routes, server components, AND client components.
 */

// ─── Input + output shapes ──────────────────────────────────────────────────
//
// Re-declared structurally (rather than `import type` from
// active-creatives-group.ts) so this helper can run in environments
// where the active-creatives-group module's `server-only`-adjacent
// siblings would pull in dead deps. The exported `CreativeRow` from
// that module satisfies this shape by structural typing.

export interface ConceptInputPreview {
  image_url: string | null;
  video_id: string | null;
  instagram_permalink_url: string | null;
  headline: string | null;
  body: string | null;
  call_to_action_type: string | null;
  link_url: string | null;
}

export interface ConceptInputRow {
  creative_id: string;
  creative_name: string | null;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  /** Stable post identifier — first tier of the grouping waterfall. */
  effective_object_story_id: string | null;
  object_story_id: string | null;
  /** Pre-computed asset signature (video / image-hash / asset-set). */
  primary_asset_signature: string | null;
  /** Modal preview payload — passed through to ConceptGroupRow.representative_preview. */
  preview: ConceptInputPreview;
  ad_count: number;
  adsets: ReadonlyArray<{ id: string; name: string | null }>;
  campaigns: ReadonlyArray<{ id: string; name: string | null }>;
  representative_ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  registrations: number;
  cpr: number | null;
  purchases: number;
  cpp: number | null;
  frequency: number | null;
}

export type GroupKeyReason =
  | "post_id"
  | "asset_hash"
  | "thumbnail"
  | "name"
  | "creative_id";

export interface ConceptGroupRow {
  /** The waterfall-derived bucket key. */
  group_key: string;
  /** Best display name picked from the chosen group member, or a
   *  semantic fallback when the chosen creative_name is empty / pure
   *  numeric. Never a raw Meta numeric ID. */
  display_name: string;
  /** Number of distinct creative_ids in this group. */
  creative_id_count: number;
  /** Sum of `ad_count` across underlying rows. */
  ad_count: number;
  /** Deduplicated ad sets across all underlying rows. */
  adsets: Array<{ id: string; name: string | null }>;
  /** Deduplicated campaigns across all underlying rows. */
  campaigns: Array<{ id: string; name: string | null }>;
  /** Top-spend underlying row supplies these representative fields. */
  representative_ad_id: string;
  representative_thumbnail: string | null;
  representative_headline: string | null;
  representative_body_preview: string | null;
  /** Top-spend underlying row's modal preview payload. */
  representative_preview: ConceptInputPreview;
  /** Spend / volume metrics — straight sums. */
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  registrations: number;
  purchases: number;
  /**
   * Rate metrics — recomputed from summed numerator + denominator
   * across the group. We do NOT average the per-row ctr/cpr/etc; that
   * would be the canonical Simpson's-paradox ad-reporting bug.
   */
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  cpr: number | null;
  cpp: number | null;
  frequency: number | null;
  /** Underlying creative_ids — useful for telemetry / debug links. */
  underlying_creative_ids: string[];
  /**
   * Unique waterfall reasons observed across the rows in this group.
   * Almost always a single-element array (every row in a bucket
   * shares the same reason by construction); arrays longer than 1
   * indicate the bucket merged via different signals (e.g. one row
   * matched on post_id, another on a co-incident asset_hash). Surfaced
   * for debug — the UI never displays it directly.
   */
  reasons: GroupKeyReason[];
}

// ─── Name normalisation ─────────────────────────────────────────────────────
//
// Order matters. Each pass operates on the result of the previous.
// Stripping date stamps before collapsing whitespace ensures the
// trailing whitespace left behind by the strip doesn't leak into the
// final key. Lowercasing is the last step so the regexes can stay
// case-insensitive (matching " - Copy" with a /i flag) without
// having to handle every casing variant up front.

const COPY_SUFFIX_RE = /\s+-\s+copy(\s+\d+)?\s*$/i;
const VERSION_SUFFIX_RE = /\s+(?:\(\s*\d+\s*\)|-\s+v\s*\d+)\s*$/i;
const TRAILING_ISO_DATE_RE = /\s+\d{4}-\d{2}-\d{2}.*$/;

/**
 * Normalise an ad name into the bucket key shared across re-uploads
 * of the same concept. Empty input → empty string (caller decides
 * whether to fall back to the next waterfall tier).
 */
export function normaliseAdName(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  // Iteratively strip stacked " - Copy [N]" suffixes. Cap iterations
  // defensively in case some weird input loops the regex (it
  // shouldn't, but a corrupted Unicode space could).
  for (let i = 0; i < 10 && COPY_SUFFIX_RE.test(s); i += 1) {
    s = s.replace(COPY_SUFFIX_RE, "").trimEnd();
  }
  for (let i = 0; i < 10 && VERSION_SUFFIX_RE.test(s); i += 1) {
    s = s.replace(VERSION_SUFFIX_RE, "").trimEnd();
  }
  s = s.replace(TRAILING_ISO_DATE_RE, "").trimEnd();
  s = s.replace(/\s+/g, " ");
  return s.toLowerCase();
}

// ─── Thumbnail normalisation ────────────────────────────────────────────────
//
// Meta's CDN URLs carry a query string (`?_nc_cache=...&...`) that
// rotates whenever the URL is re-signed, plus a path-segment size
// suffix (e.g. `/p480x480/`, `/s600x600/`) chosen at fetch time. Two
// requests against the same underlying asset routinely return URLs
// that differ in both — we strip both so the thumbnail tier of the
// waterfall actually collapses re-fetches of the same image.

const THUMB_SIZE_SEGMENT_RE = /\/[ps]\d+x\d+\//gi;

function normaliseThumbnailUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip query string (Meta's CDN cache-buster lives there).
  const noQuery = raw.split("?")[0]?.trim();
  if (!noQuery) return null;
  // Collapse the size segment to a stable token. We replace rather
  // than remove so two `/p480x480/foo.jpg` and `/s600x600/foo.jpg`
  // URLs with otherwise-identical paths share one normalised form.
  const stripped = noQuery.replace(THUMB_SIZE_SEGMENT_RE, "/_size_/");
  return stripped;
}

/**
 * Compact display token for the thumbnail-tier display-name fallback.
 * Picks the last 8 chars of the path basename so the user sees a
 * non-empty bucket label without leaking the full signed URL.
 */
function shortThumbHash(normalisedThumb: string): string {
  const last = normalisedThumb.split("/").filter(Boolean).pop() ?? "thumb";
  // Strip extension noise then trim.
  const noExt = last.replace(/\.[a-z0-9]{2,5}$/i, "");
  return noExt.slice(-8) || "thumb";
}

// ─── Waterfall ──────────────────────────────────────────────────────────────

const NON_DIGIT_RE = /[^\d]/;

/**
 * Derive the grouping key + reason for a single row.
 *
 * Waterfall (first non-null wins):
 *   1. effective_object_story_id → `post:${id}` / "post_id"
 *   2. object_story_id           → `post:${id}` / "post_id"
 *   3. primary_asset_signature   → signature  / "asset_hash"
 *   4. thumbnail_url (normalised) → `thumb:${...}` / "thumbnail"
 *   5. normaliseAdName(creative_name) IF non-pure-digit →
 *        `name:${normalised}` / "name"
 *   6. creative_id literal       → `id:${id}` / "creative_id"
 *
 * Step 5 explicitly skips pure-numeric normalised names — those are
 * Meta's auto-generated ad IDs (e.g. "120230049821210568") that
 * carry no human-meaningful concept information, and grouping
 * them by name would just collide unrelated creatives that
 * happen to share an opaque ID-digit pattern.
 */
export function deriveGroupKey(row: ConceptInputRow): {
  key: string;
  reason: GroupKeyReason;
} {
  const eosi = row.effective_object_story_id?.trim();
  if (eosi) return { key: `post:${eosi}`, reason: "post_id" };

  const osi = row.object_story_id?.trim();
  if (osi) return { key: `post:${osi}`, reason: "post_id" };

  const sig = row.primary_asset_signature?.trim();
  if (sig) return { key: sig, reason: "asset_hash" };

  const thumb = normaliseThumbnailUrl(row.thumbnail_url);
  if (thumb) return { key: `thumb:${thumb}`, reason: "thumbnail" };

  const name = normaliseAdName(row.creative_name);
  if (name && NON_DIGIT_RE.test(name)) {
    return { key: `name:${name}`, reason: "name" };
  }

  return { key: `id:${row.creative_id}`, reason: "creative_id" };
}

// ─── Display-name fallback ──────────────────────────────────────────────────

const PURE_DIGIT_RE = /^\d+$/;

function isUsableCreativeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  // Reject pure-numeric Meta auto-names. We also reject names that
  // are nothing but digits + separators (e.g. "120230049821210568"
  // or "120-2300-4982" — neither is human-meaningful).
  return !PURE_DIGIT_RE.test(trimmed.replace(/[\s\-_]/g, ""));
}

function fallbackDisplayName(
  reason: GroupKeyReason,
  groupKey: string,
  groupIndex: number,
): string {
  switch (reason) {
    case "post_id":
      return `Dark post · ${groupIndex + 1}`;
    case "asset_hash":
      if (groupKey.startsWith("video:")) return "Video creative";
      if (groupKey.startsWith("image:")) return "Image creative";
      if (groupKey.startsWith("assetset:")) return "Advantage+ creative";
      return "Asset creative";
    case "thumbnail": {
      // groupKey = "thumb:${normalisedUrl}" — strip the prefix then
      // reduce to a short token so we don't leak the full URL.
      const normalised = groupKey.startsWith("thumb:")
        ? groupKey.slice("thumb:".length)
        : groupKey;
      return `Creative · ${shortThumbHash(normalised)}`;
    }
    case "name": {
      // groupKey = "name:${normalisedName}" — surface the normalised
      // form (lowercase, suffixes already stripped). Caller never
      // reaches this branch when the chosen creative_name was usable.
      const n = groupKey.startsWith("name:")
        ? groupKey.slice("name:".length)
        : groupKey;
      return n;
    }
    case "creative_id":
      return "Untitled creative";
  }
}

// ─── Grouping ───────────────────────────────────────────────────────────────

interface Accumulator {
  group_key: string;
  reason: GroupKeyReason;
  reasons: Set<GroupKeyReason>;
  underlying_creative_ids: string[];
  ad_count: number;
  adsets: Map<string, string | null>;
  campaigns: Map<string, string | null>;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  registrations: number;
  purchases: number;
  /** Top-spend row picked from the group (for representative_* fields). */
  topSpend: number;
  representative_ad_id: string;
  representative_thumbnail: string | null;
  representative_headline: string | null;
  representative_body_preview: string | null;
  representative_creative_name: string | null;
  representative_preview: ConceptInputPreview;
}

function safeRate(num: number, denom: number, scale = 1): number | null {
  if (!Number.isFinite(denom) || denom <= 0) return null;
  if (!Number.isFinite(num)) return null;
  return (num / denom) * scale;
}

/**
 * Group rows by the asset-signal waterfall.
 *
 * Output rows preserve the existing ConceptGroupRow public shape
 * (rate metrics weighted, ad sets / campaigns deduped, top-spend
 * row supplies representative fields) and add `reasons: GroupKey
 * Reason[]` for debug introspection.
 */
export function groupByAssetSignature(
  rows: readonly ConceptInputRow[],
): ConceptGroupRow[] {
  const buckets = new Map<string, Accumulator>();

  for (const row of rows) {
    const { key, reason } = deriveGroupKey(row);

    const acc =
      buckets.get(key) ??
      ({
        group_key: key,
        reason,
        reasons: new Set<GroupKeyReason>(),
        underlying_creative_ids: [] as string[],
        ad_count: 0,
        adsets: new Map<string, string | null>(),
        campaigns: new Map<string, string | null>(),
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        registrations: 0,
        purchases: 0,
        topSpend: -Infinity,
        representative_ad_id: row.representative_ad_id,
        representative_thumbnail: row.thumbnail_url,
        representative_headline: row.headline,
        representative_body_preview: row.body,
        representative_creative_name: row.creative_name,
        representative_preview: row.preview,
      } as Accumulator);

    acc.reasons.add(reason);
    acc.underlying_creative_ids.push(row.creative_id);
    acc.ad_count += row.ad_count;
    for (const a of row.adsets) {
      if (!acc.adsets.has(a.id)) acc.adsets.set(a.id, a.name);
    }
    for (const c of row.campaigns) {
      if (!acc.campaigns.has(c.id)) acc.campaigns.set(c.id, c.name);
    }
    acc.spend += row.spend;
    acc.impressions += row.impressions;
    acc.clicks += row.clicks;
    acc.reach += row.reach;
    acc.registrations += row.registrations;
    acc.purchases += row.purchases;

    if (row.spend > acc.topSpend) {
      acc.topSpend = row.spend;
      acc.representative_ad_id = row.representative_ad_id;
      acc.representative_thumbnail = row.thumbnail_url;
      acc.representative_headline = row.headline;
      acc.representative_body_preview = row.body;
      acc.representative_creative_name = row.creative_name;
      acc.representative_preview = row.preview;
    }

    buckets.set(key, acc);
  }

  // Materialise the buckets into the public shape. Display name is
  // computed in two passes so we have a stable group_index for the
  // "Dark post · N" fallback (1-based, in spend-DESC sorted order).
  const out: ConceptGroupRow[] = [];
  for (const acc of buckets.values()) {
    out.push({
      group_key: acc.group_key,
      display_name: "", // set after sort
      creative_id_count: acc.underlying_creative_ids.length,
      ad_count: acc.ad_count,
      adsets: [...acc.adsets.entries()].map(([id, name]) => ({ id, name })),
      campaigns: [...acc.campaigns.entries()].map(([id, name]) => ({
        id,
        name,
      })),
      representative_ad_id: acc.representative_ad_id,
      representative_thumbnail: acc.representative_thumbnail,
      representative_headline: acc.representative_headline,
      representative_body_preview: acc.representative_body_preview,
      representative_preview: acc.representative_preview,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      reach: acc.reach,
      registrations: acc.registrations,
      purchases: acc.purchases,
      // Weighted rate metrics — ratio of sums, NOT average of ratios.
      ctr: safeRate(acc.clicks, acc.impressions, 100),
      cpm: safeRate(acc.spend, acc.impressions, 1000),
      cpc: safeRate(acc.spend, acc.clicks),
      cpr: safeRate(acc.spend, acc.registrations),
      cpp: safeRate(acc.spend, acc.purchases),
      frequency: safeRate(acc.impressions, acc.reach),
      underlying_creative_ids: acc.underlying_creative_ids,
      reasons: [...acc.reasons],
    });
  }

  out.sort((a, b) => b.spend - a.spend);

  // Pass 2: pick display names. Re-walk the original Accumulator to
  // recover the chosen-rep creative_name (which we don't surface on
  // ConceptGroupRow — it'd be redundant with display_name).
  for (let i = 0; i < out.length; i += 1) {
    const g = out[i];
    const acc = buckets.get(g.group_key);
    const repName = acc?.representative_creative_name;
    if (isUsableCreativeName(repName)) {
      g.display_name = repName!.trim();
    } else {
      g.display_name = fallbackDisplayName(
        acc?.reason ?? g.reasons[0] ?? "creative_id",
        g.group_key,
        i,
      );
    }
  }

  return out;
}
