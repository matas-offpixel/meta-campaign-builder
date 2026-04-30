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

import type { PreviewTier } from "@/lib/reporting/preview-tier";

// ─── Input + output shapes ──────────────────────────────────────────────────
//
// Re-declared structurally (rather than `import type` from
// active-creatives-group.ts) so this helper can run in environments
// where the active-creatives-group module's `server-only`-adjacent
// siblings would pull in dead deps. The exported `CreativeRow` from
// that module satisfies this shape by structural typing. `PreviewTier`
// is imported from a tiny leaf file for parity with
// `CreativePreview.tier`.

export interface ConceptInputPreview {
  image_url: string | null;
  video_id: string | null;
  instagram_permalink_url: string | null;
  headline: string | null;
  body: string | null;
  call_to_action_type: string | null;
  link_url: string | null;
  /**
   * Mirror of `CreativePreview.is_low_res_fallback` (see
   * `lib/reporting/active-creatives-group.ts`). Set when `image_url`
   * is a 64×64 thumbnail / Advantage+ poster / `video_id` Graph
   * fallback rather than a full-size asset, so the share modal can
   * upscale + caption the preview instead of rendering it at native
   * size. Optional for backward-compat with grouping-test fixtures.
   */
  is_low_res_fallback?: boolean;
  /** @see `CreativePreview.tier` (optional for fixture compatibility). */
  tier?: PreviewTier;
}

export interface ActiveCreativeThumbnailSource {
  video_id: string | null;
  image_hash: string | null;
}

export interface ConceptInputRow {
  creative_id: string;
  creative_name: string | null;
  /**
   * Distinct trimmed ad-level names rolled up from the per-ad rows
   * that share this creative_id, ordered by descending cumulative
   * ad spend. Drives the name tier of the grouping waterfall and
   * the modal title — Meta's auto-generated `creative.name` is too
   * polluted by feed templates ("{{product.name}} 2026-...") to be
   * trustworthy as a label or grouping signal.
   */
  ad_names: string[];
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  /** Ad that supplied `thumbnail_url`; null when no thumbnail was resolved. */
  thumbnail_ad_id?: string | null;
  /** Spend for the ad that supplied `thumbnail_url`; null when no thumbnail resolved. */
  thumbnail_spend?: number | null;
  thumbnail_source?: ActiveCreativeThumbnailSource;
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
  /**
   * Landing-page views — present on every CreativeRow we receive
   * from `groupAdsByCreative`. Carried through structurally so the
   * second-layer grouper can sum across re-uploads of the same
   * concept.
   */
  landingPageViews: number;
  /**
   * Cost per landing-page view. Recomputed from summed numerator
   * + denominator at the bucket level — the per-row value here is
   * informational only.
   */
  cplpv: number | null;
  frequency: number | null;
  /**
   * Sum of `inline_link_clicks` across the underlying ads — the
   * funnel-aligned click metric (excludes social / share / expand
   * clicks that Meta lumps into `clicks`). Plumbed through so the
   * second-layer grouper can emit a true link-CTR for the share
   * health-badge scorer. Optional for backwards-compat with older
   * fixtures; treated as 0 when absent.
   */
  inline_link_clicks?: number;
  /**
   * True iff at least one underlying ad in this concept has
   * `effective_status === "ACTIVE"`. Drives the "PAUSED" pill on
   * the new health badge so a historical-spend-only concept doesn't
   * surface a SCALE / KILL recommendation. Optional for backwards-
   * compat with older fixtures; treated as `true` when absent so
   * the badge degrades gracefully (i.e. no spurious "PAUSED" pills
   * for callers that haven't plumbed the field through yet).
   */
  any_ad_active?: boolean;
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
  /** Ad that supplied `representative_thumbnail`; null when no thumbnail resolved. */
  representative_thumbnail_ad_id: string | null;
  representative_thumbnail_source: ActiveCreativeThumbnailSource;
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
   * Sum of landing-page views across the underlying ConceptInputRows.
   * Drives the LPV column on the share creative card and the
   * derived `cplpv` rate metric below.
   */
  landingPageViews: number;
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
  /** Cost per landing-page view. null when `landingPageViews = 0`. */
  cplpv: number | null;
  frequency: number | null;
  /**
   * Three-bucket fatigue score derived from the bucket-level
   * frequency (`< 3` ok, `3..5` warning, `> 5` critical). Same
   * scale as `lib/meta/creative-insights.ts` so the share card and
   * the internal heatmap pill agree on what each bucket means.
   * Always set — `"ok"` when frequency is null / non-finite so the
   * UI can render the pill without a separate empty branch.
   *
   * NOTE PR #56: kept on the row for the internal heatmap path
   * (`components/intelligence/creative-heatmap.tsx`) which still
   * surfaces the single-axis pill. The share-card "Active
   * creatives" UI now renders a richer two-axis health badge —
   * see `lib/reporting/creative-health.ts` and the `inline_link
   * _clicks` / `any_ad_active` fields below.
   */
  fatigueScore: "ok" | "warning" | "critical";
  /**
   * Sum of `inline_link_clicks` across the underlying ads. Source
   * for the "Attention" axis on the share card's health badge
   * (link CTR = `inline_link_clicks / impressions × 100`). Optional
   * for backwards compat with the fixture-driven heatmap consumer
   * — defaults to 0 when missing.
   */
  inline_link_clicks: number;
  /**
   * Same provenance as the field on `ConceptInputRow` — true iff
   * any underlying ad is `effective_status === "ACTIVE"`. False
   * means the concept is rolled-up historical spend only; the
   * health badge collapses to a neutral "PAUSED" pill in that
   * case so we don't recommend SCALE / KILL on dormant ads.
   */
  any_ad_active: boolean;
  /**
   * Distinct ad-level names across the rows in this concept group,
   * ordered by descending cumulative ad spend. The first entry is
   * the "dominant" name and is preferred for `display_name`; any
   * extra entries surface in the modal subtitle as variants.
   * Empty array when no underlying ad surfaced a non-empty name.
   */
  ad_names: string[];
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

// Meta's Ads Manager duplicates ads with " – Copy" using en-dash
// (U+2013) not ASCII hyphen-minus (U+002D). Accept both plus em-dash
// (U+2014) defensively so "LINEUP PROMO EDIT – Copy" collapses into
// the same concept as "LINEUP PROMO EDIT" regardless of which dash
// Meta, a freelancer, or a clipboard paste introduced.
const DASH_CLASS = "[-–—]";
const COPY_SUFFIX_RE = new RegExp(
  `\\s+${DASH_CLASS}\\s+copy(\\s+\\d+)?\\s*$`,
  "i",
);
const VERSION_SUFFIX_RE = new RegExp(
  `\\s+(?:\\(\\s*\\d+\\s*\\)|${DASH_CLASS}\\s+v\\s*\\d+)\\s*$`,
  "i",
);
const TRAILING_ISO_DATE_RE = /\s+\d{4}-\d{2}-\d{2}.*$/;
/** Mustache-style placeholder left by Meta's product feed templates. */
const TEMPLATE_TOKEN_RE = /\{\{[^{}]*\}\}/;
const TEMPLATE_TOKEN_GLOBAL_RE = /\{\{[^{}]*\}\}/g;
/** Trailing UUID-ish hex tail (Meta append a 6+ char id to feed names). */
const TRAILING_UUID_RE = /[\s\-_]+[a-f0-9]{6,}\s*$/i;
/**
 * Standalone hex/alphanum token left over after the prior strips
 * pulled away the surrounding separators. Used in sanitiseCreative
 * Name to catch the "2026-03-31-abc1234ef" → "abc1234ef" residue.
 */
const STANDALONE_HEX_TOKEN_RE = /^[a-z0-9]{6,}$/i;

/**
 * Strip the suffix ladder Meta appends when ads are duplicated
 * (`- Copy [N]`, ` (N)`, ` - vN`, trailing ISO date) while
 * PRESERVING casing. Used as the case-preserving sibling of
 * `normaliseAdName` — the latter lowercases the result for grouping
 * keys, this one keeps "Motion V2" looking like "Motion V2" for the
 * card title.
 *
 * Empty input → empty string (caller decides whether to fall back).
 */
function cleanAdName(raw: string | null | undefined): string {
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
  return s;
}

/**
 * Normalise an ad name into the bucket key shared across re-uploads
 * of the same concept. Empty input → empty string (caller decides
 * whether to fall back to the next waterfall tier).
 *
 * Lowercased to make the key case-insensitive — "Motion V2" and
 * "motion v2" share a bucket. Display names are derived separately
 * via `cleanAdName` / `pickDisplayName` so casing survives there.
 */
export function normaliseAdName(raw: string | null | undefined): string {
  return cleanAdName(raw).toLowerCase();
}

/**
 * Sanitise a `creative_name` for *display* (not grouping). Strips
 * Meta's feed-template tokens (`{{...}}`), trailing ISO dates, and
 * trailing UUID-ish hex tails — the noise that turns
 * "{{product.name}} 2026-03-31-abc1234" into something a marketer
 * won't recognise. Returns null when nothing usable remains.
 */
/**
 * Greedier ISO-date stripper than `TRAILING_ISO_DATE_RE`. After
 * dropping a template token from a creative.name, the residue
 * usually opens with a date stamp ("2026-03-31-abc"), so we strip
 * ISO dates anywhere they appear and let the surrounding noise be
 * cleaned up separately. The `[-_T]?[\d:.]*` tail eats the optional
 * time portion / dash-separator that often follows.
 */
const ANY_ISO_DATE_RE = /\d{4}-\d{2}-\d{2}[-_T]?[\d:.]*/g;

export function sanitiseCreativeName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  // Template tokens come out first so any date / UUID tails they
  // were guarding now sit at the edges where the next strips can
  // see them.
  s = s.replace(TEMPLATE_TOKEN_GLOBAL_RE, " ").trim();
  s = s.replace(ANY_ISO_DATE_RE, " ").trim();
  // Iterate UUID / hex tail strip — chained UUIDs on either side
  // of a separator (rare but happens in feed templates) need more
  // than one pass to fully drop.
  for (let i = 0; i < 5 && TRAILING_UUID_RE.test(s); i += 1) {
    s = s.replace(TRAILING_UUID_RE, "").trim();
  }
  // Strip leading orphan separators left behind by the above ("- abc"
  // → "abc"). Defensive: avoids shipping a label that opens with a
  // dash from a removed prefix.
  s = s.replace(/^[\s\-_:.]+/, "").trim();
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  // If the remainder is a single 6+ char hex/alphanum token (i.e.
  // the date strip pulled the surrounding separators with it,
  // leaving the UUID stranded at the start of the string), reject
  // the whole result — it's noise, not a concept label.
  if (STANDALONE_HEX_TOKEN_RE.test(s)) return null;
  return s;
}

const NON_DIGIT_RE_LOCAL = /[^\d]/;

/**
 * Decide whether a normalised ad name is acceptable as a grouping
 * key OR as a display label. Rejection rules (any one fails):
 *   (a) zero non-digit characters (pure Meta auto-ID like
 *       "120230049821210568"),
 *   (b) contains a `{{...}}` template token (un-rendered feed
 *       placeholder — feed templates produce per-row unique strings
 *       so grouping by them defeats the purpose, and they're
 *       unreadable to a human),
 *   (c) shorter than 3 chars after the prior strips (too short to
 *       be a meaningful concept label).
 */
function isAcceptableNameToken(normalised: string): boolean {
  if (!normalised) return false;
  if (normalised.length < 3) return false;
  if (TEMPLATE_TOKEN_RE.test(normalised)) return false;
  if (!NON_DIGIT_RE_LOCAL.test(normalised)) return false;
  return true;
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

/**
 * Derive the grouping key + reason for a single row.
 *
 * Waterfall (first non-null wins):
 *   1. normaliseAdName(ad_names[0]) IF acceptable token →
 *        `name:${normalised}` / "name"
 *   2. effective_object_story_id → `post:${id}` / "post_id"
 *   3. object_story_id           → `post:${id}` / "post_id"
 *   4. primary_asset_signature   → signature  / "asset_hash"
 *   5. thumbnail_url (normalised) → `thumb:${...}` / "thumbnail"
 *   6. creative_id literal       → `id:${id}` / "creative_id"
 *
 * Tier 1 (name) reads the dominant *ad-level* name (not
 * creative.name) — Meta auto-generates polluted creative.name
 * values from product feeds (e.g. "{{product.name}} 2026-03-31-
 * <uuid>") that are per-row unique and defeat grouping. Ad-level
 * names are what marketers type into Ads Manager and what they
 * want collapsed.
 *
 * Tier 1 also rejects names that are pure-numeric (Meta auto-IDs),
 * contain unrendered `{{...}}` template tokens, or are too short
 * (< 3 chars) — see `isAcceptableNameToken` for the canonical rules.
 *
 * PR #50: name tier promoted to the very top, above post_id and
 * asset_hash. Event-scoped reports (share page, internal panel)
 * consider marketer-intended ad names authoritative. Meta mints
 * fresh post_ids and asset signatures per re-upload of the same
 * concept ("LINEUP PROMO EDIT" was rendering as ~10 separate
 * cards because each upload spawned a fresh dark-post id), so
 * keying on those splits same-named re-uploads.
 * `isAcceptableNameToken` already rejects pure-numeric IDs,
 * template tokens, and < 3-char strings — the residual risk is
 * two unrelated concepts sharing a marketer name inside one
 * event report, which is a trade-off Matas has explicitly
 * accepted as the lesser evil vs the current fragmentation.
 *
 * `normaliseAdName` already strips Meta's auto-suffixes (" - Copy
 * [N]", " (N)", " - vN", trailing ISO dates) so the name tier is
 * safe-by-default for re-uploads. post_id / asset_hash now serve
 * as fallbacks for ads with unacceptable names (e.g. headless /
 * numeric-name re-uploads, template-token names that never
 * rendered).
 */
export function deriveGroupKey(row: ConceptInputRow): {
  key: string;
  reason: GroupKeyReason;
} {
  const dominantAdName = row.ad_names[0]?.trim();
  if (dominantAdName) {
    const name = normaliseAdName(dominantAdName);
    if (isAcceptableNameToken(name)) {
      return { key: `name:${name}`, reason: "name" };
    }
  }

  const eosi = row.effective_object_story_id?.trim();
  if (eosi) return { key: `post:${eosi}`, reason: "post_id" };

  const osi = row.object_story_id?.trim();
  if (osi) return { key: `post:${osi}`, reason: "post_id" };

  const sig = row.primary_asset_signature?.trim();
  if (sig) return { key: sig, reason: "asset_hash" };

  const thumb = normaliseThumbnailUrl(row.thumbnail_url);
  if (thumb) return { key: `thumb:${thumb}`, reason: "thumbnail" };

  return { key: `id:${row.creative_id}`, reason: "creative_id" };
}

// ─── Display-name waterfall ─────────────────────────────────────────────────

/**
 * Semantic fallback when neither the dominant ad.name nor the
 * sanitised creative.name is acceptable. Picks a label from the
 * waterfall reason so the user sees something meaningful instead
 * of a raw Meta numeric ID.
 */
function semanticFallbackDisplayName(
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
      // Only reached when the dominant ad.name passed the gate AND
      // we somehow have no clean version — defensive only; in
      // practice tier 1 of `pickDisplayName` already covered it.
      const n = groupKey.startsWith("name:")
        ? groupKey.slice("name:".length)
        : groupKey;
      return n;
    }
    case "creative_id":
      return "Untitled creative";
  }
}

/**
 * Pick a human-readable display name for a concept group.
 *
 * Waterfall (first non-empty wins):
 *   1. cleanAdName(dominant ad-level name) IF it passes
 *      `isAcceptableNameToken` — preserves casing so "Motion V2"
 *      surfaces verbatim.
 *   2. sanitiseCreativeName(representative creative_name) IF ≥ 3
 *      chars after stripping `{{...}}` tokens / ISO dates / UUID
 *      tails — covers headline-only / no-ad-name corner cases.
 *   3. semanticFallbackDisplayName(reason) — "Dark post · N",
 *      "Video creative", "Creative · {hash6}", etc.
 *
 * Never surfaces a raw numeric Meta ID as a display label.
 *
 * Exported so the dashboard panel's "Group by concept = OFF" path
 * (which wraps a single ConceptInputRow into a synthetic group) can
 * reuse the same waterfall — toggling the grouping switch must
 * never make the title worse.
 */
export function pickDisplayName(
  adNames: readonly string[],
  representativeCreativeName: string | null,
  reason: GroupKeyReason,
  groupKey: string,
  groupIndex: number,
): string {
  // Tier 1 — dominant ad.name (case-preserved).
  const dominant = adNames[0]?.trim();
  if (dominant) {
    const normalised = normaliseAdName(dominant);
    if (isAcceptableNameToken(normalised)) {
      const cleaned = cleanAdName(dominant);
      if (cleaned.length >= 3) return cleaned;
    }
  }

  // Tier 2 — sanitised representative creative_name. Gate with the
  // same acceptance rules as tier 1 so a pure-numeric Meta auto-ID
  // ("120230049821210568") never escapes here as a display label.
  const sanitised = sanitiseCreativeName(representativeCreativeName);
  if (sanitised && isAcceptableNameToken(sanitised.toLowerCase())) {
    return sanitised;
  }

  // Tier 3 — semantic fallback.
  return semanticFallbackDisplayName(reason, groupKey, groupIndex);
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
  landingPageViews: number;
  inline_link_clicks: number;
  any_ad_active: boolean;
  /**
   * Distinct trimmed ad.name → cumulative row spend across all
   * underlying ConceptInputRows in this bucket. Sorted DESC at
   * materialisation to produce the public `ad_names` array — the
   * first entry is the dominant label, the tail is shown as
   * variants in the modal subtitle.
   */
  ad_names_spend: Map<string, number>;
  /** Top-spend row picked from the group (for representative_* fields). */
  topSpend: number;
  representative_ad_id: string;
  representative_thumbnail: string | null;
  representative_thumbnail_ad_id: string | null;
  representative_thumbnail_source: ActiveCreativeThumbnailSource;
  /** Spend attached to the ad that supplied `representative_thumbnail`. */
  representative_thumbnail_spend: number;
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

function emptyThumbnailSource(): ActiveCreativeThumbnailSource {
  return {
    video_id: null,
    image_hash: null,
  };
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
        landingPageViews: 0,
        inline_link_clicks: 0,
        any_ad_active: false,
        ad_names_spend: new Map<string, number>(),
        topSpend: -Infinity,
        representative_ad_id: row.representative_ad_id,
        representative_thumbnail: row.thumbnail_url,
        representative_thumbnail_ad_id: row.thumbnail_url
          ? (row.thumbnail_ad_id ?? row.representative_ad_id)
          : null,
        representative_thumbnail_source:
          row.thumbnail_source ?? emptyThumbnailSource(),
        representative_thumbnail_spend: row.thumbnail_url
          ? (row.thumbnail_spend ?? row.spend)
          : -Infinity,
        representative_headline: row.headline,
        representative_body_preview: row.body,
        representative_creative_name: row.creative_name,
        representative_preview: row.preview,
      } as Accumulator);

    acc.reasons.add(reason);
    acc.underlying_creative_ids.push(row.creative_id);
    acc.ad_count += row.ad_count;
    // Merge distinct ad-level names. Weight each name by the row's
    // total spend so a name appearing only in a low-spend row ranks
    // below one that dominates the bucket. Doesn't double-count
    // across rows: a name appearing in two rows accumulates the
    // sum of those row spends, which is what we want.
    for (const n of row.ad_names) {
      acc.ad_names_spend.set(
        n,
        (acc.ad_names_spend.get(n) ?? 0) + row.spend,
      );
    }
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
    acc.landingPageViews += row.landingPageViews;
    acc.inline_link_clicks += row.inline_link_clicks ?? 0;
    if (row.any_ad_active) acc.any_ad_active = true;

    if (row.spend > acc.topSpend) {
      acc.topSpend = row.spend;
      acc.representative_ad_id = row.representative_ad_id;
      acc.representative_thumbnail = row.thumbnail_url;
      acc.representative_headline = row.headline;
      acc.representative_body_preview = row.body;
      acc.representative_creative_name = row.creative_name;
      acc.representative_preview = row.preview;
    }

    const rowThumbnailSpend = row.thumbnail_url
      ? (row.thumbnail_spend ?? row.spend)
      : -Infinity;
    if (row.thumbnail_url && rowThumbnailSpend > acc.representative_thumbnail_spend) {
      acc.representative_thumbnail_spend = rowThumbnailSpend;
      acc.representative_thumbnail = row.thumbnail_url;
      acc.representative_thumbnail_ad_id =
        row.thumbnail_ad_id ?? row.representative_ad_id;
      acc.representative_thumbnail_source =
        row.thumbnail_source ?? emptyThumbnailSource();
    }

    buckets.set(key, acc);
  }

  // Materialise the buckets into the public shape. Display name is
  // computed in a second pass so we have a stable group_index for
  // the "Dark post · N" fallback (1-based, in spend-DESC order).
  const out: ConceptGroupRow[] = [];
  for (const acc of buckets.values()) {
    // Sort distinct ad.names by descending cumulative row spend.
    // Tie-break on insertion order (Map preserves it) so the result
    // is deterministic across calls with identical input.
    const ad_names = [...acc.ad_names_spend.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0]);

    // Per-bucket diagnostic — one line per concept group, surfaces
    // which ad.name strings rolled into this bucket and their spend
    // share. Lets us trace from the share page back to the raw row
    // set without rebuilding the input fixture: greppable in Vercel
    // as `[asset-grouping]`. Logging-only, no behaviour change. Runs
    // on every caller of `groupByAssetSignature`, but in practice the
    // share/internal report routes are the only callers and the log
    // volume is bounded by SHARE_GROUPS_CAP=30 per request.
    console.info(
      `[asset-grouping] group_key=${acc.group_key} reason=${acc.reason} creative_ids=${acc.underlying_creative_ids.length} ad_count=${acc.ad_count} spend=${acc.spend.toFixed(2)} top_ad_names=${JSON.stringify(
        [...acc.ad_names_spend.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([n, s]) => ({ n, spend: +s.toFixed(2) })),
      )}`,
    );

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
      representative_thumbnail_ad_id: acc.representative_thumbnail_ad_id,
      representative_thumbnail_source: acc.representative_thumbnail_source,
      representative_headline: acc.representative_headline,
      representative_body_preview: acc.representative_body_preview,
      representative_preview: acc.representative_preview,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      reach: acc.reach,
      registrations: acc.registrations,
      purchases: acc.purchases,
      landingPageViews: acc.landingPageViews,
      // Weighted rate metrics — ratio of sums, NOT average of ratios.
      ctr: safeRate(acc.clicks, acc.impressions, 100),
      cpm: safeRate(acc.spend, acc.impressions, 1000),
      cpc: safeRate(acc.spend, acc.clicks),
      cpr: safeRate(acc.spend, acc.registrations),
      cpp: safeRate(acc.spend, acc.purchases),
      cplpv: safeRate(acc.spend, acc.landingPageViews),
      frequency: safeRate(acc.impressions, acc.reach),
      // Mirror the three-bucket scale from
      // `lib/meta/creative-insights.ts` (and the active-creatives
      // group helper) so the share card and the internal heatmap
      // pill stay in lock-step. Implemented inline rather than
      // importing `fatigueFromFrequency` to keep this module
      // dep-free for client-component consumers.
      fatigueScore: ((freq: number | null) => {
        if (freq == null || !Number.isFinite(freq) || freq < 3) return "ok";
        if (freq <= 5) return "warning";
        return "critical";
      })(safeRate(acc.impressions, acc.reach)),
      inline_link_clicks: acc.inline_link_clicks,
      any_ad_active: acc.any_ad_active,
      ad_names,
      underlying_creative_ids: acc.underlying_creative_ids,
      reasons: [...acc.reasons],
    });
  }

  out.sort((a, b) => b.spend - a.spend);

  // Pass 2: pick display names. Re-walk the bucket to recover the
  // top-spend representative creative_name (kept out of the public
  // shape — would just duplicate display_name).
  for (let i = 0; i < out.length; i += 1) {
    const g = out[i];
    const acc = buckets.get(g.group_key);
    g.display_name = pickDisplayName(
      g.ad_names,
      acc?.representative_creative_name ?? null,
      acc?.reason ?? g.reasons[0] ?? "creative_id",
      g.group_key,
      i,
    );
  }

  return out;
}
