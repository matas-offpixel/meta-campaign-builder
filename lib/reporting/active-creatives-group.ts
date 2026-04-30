import type { PreviewTier } from "@/lib/reporting/preview-tier";

/**
 * lib/reporting/active-creatives-group.ts
 *
 * Pure grouping helper for the per-event "Active Creatives" panel.
 * Takes a flat list of ad-level rows pulled from Meta and collapses
 * them by `creative_id` so the UI shows one card per creative
 * (instead of one card per ad — a single creative is typically
 * deployed across several ad sets, sometimes several campaigns).
 *
 * Why "pure": the route handler is responsible for fetching from
 * Meta, dealing with rate limits, and resolving the user's token.
 * This module knows nothing about HTTP or Supabase, which is what
 * makes it cheap to unit-test in `lib/reporting/active-creatives-
 * group.test.ts` without mocking the Meta client.
 *
 * Aggregation rules:
 * - Spend / impressions / clicks / reach / actions are summed.
 * - Rate metrics (CTR, CPM, CPC, CPR, CPP) are computed AFTER
 *   summation from the summed numerator + denominator. We never
 *   average a rate of rates — that's the canonical "Simpson's
 *   paradox" footgun for ad reporting.
 * - Frequency = sum_impressions / sum_reach. This over-counts
 *   reach when ads share users (Meta's `unique_users` API is the
 *   only authoritative source) but it's the best estimate we
 *   can make from per-ad rows.
 * - Ad sets are deduplicated by id. The first non-null name wins
 *   (Meta returns the same name for the same id, so order doesn't
 *   matter in practice).
 * - The representative ad id used for the Ads Manager deep-link
 *   is the one with the most spend in the group — that's the row
 *   the user is most likely to want to inspect.
 * - Ads with `creative_id == null` are dropped. They surface in
 *   the summary count via `meta.dropped_no_creative` upstream;
 *   the grouping layer doesn't try to be clever about them.
 *
 * Sort order on output: spend DESC. The UI may re-sort client-
 * side (CTR DESC, CPR ASC, etc) — having the default ordering
 * here keeps server response stable for snapshot tests.
 */

export interface AdInsightAction {
  action_type: string;
  /** Coerced to number at fetch time so the helper stays pure. */
  value: number;
}

/**
 * Full preview payload for the click-to-expand modal. Carried as a
 * sub-object on every ad / creative row so the modal can render
 * without a second Meta round-trip.
 *
 * Fields are independent of the grouping layer — they're surfaced
 * exactly as Meta returned them (already normalised to first-non-
 * empty by `extractPreview` in creative-preview-extract.ts) so the
 * modal can pick which ones to show based on what's present.
 */
export interface CreativePreview {
  image_url: string | null;
  video_id: string | null;
  instagram_permalink_url: string | null;
  headline: string | null;
  body: string | null;
  call_to_action_type: string | null;
  link_url: string | null;
  /**
   * `true` when the only `image_url` we could resolve is a low-
   * resolution fallback (Meta's 64×64 `thumbnail_url`, Advantage+
   * video poster, or `video_id` Graph endpoint) rather than a
   * marketer-supplied full-size asset. The share / dashboard modal
   * uses this flag to upscale + caption the preview instead of
   * rendering a tiny postage-stamp at native size. Optional for
   * backward-compat with fixtures that pre-date PR #84.
   */
  is_low_res_fallback?: boolean;
  /**
   * Which `extractPreview` waterfall tier supplied `image_url`
   * (diagnostic, optional for legacy fixtures / snapshots).
   */
  tier?: PreviewTier;
}

export interface ActiveCreativeThumbnailSource {
  video_id: string | null;
  image_hash: string | null;
}

export interface AdInput {
  ad_id: string;
  ad_name: string | null;
  status: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  creative_id: string | null;
  creative_name: string | null;
  /** Headline (Meta's `creative.title`). */
  headline: string | null;
  /** Body / primary text. */
  body: string | null;
  thumbnail_url: string | null;
  thumbnail_source?: ActiveCreativeThumbnailSource;
  /**
   * Meta's stable post identifier. Two different `creative_id`s
   * pointing at the SAME page post (e.g. an ad that was duplicated
   * into a new creative but kept the same dark post) share this
   * value, so the grouping waterfall keys on it before falling back
   * to asset hashes / names.
   */
  effective_object_story_id: string | null;
  object_story_id: string | null;
  /**
   * Pre-computed at fetch time from the ad's creative payload:
   *   "video:${video_id}" | "image:${image_hash}" | "assetset:${sortedHashes}"
   * `null` when the creative has no probe-able asset signal (e.g.
   * a placeholder shell). The waterfall's third tier consumes this
   * directly.
   */
  primary_asset_signature: string | null;
  /** Modal preview payload — see `CreativePreview` JSDoc. */
  preview: CreativePreview;
  /** Per-ad insights. Null when Meta returned no insight rows for the ad. */
  insights: {
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    /**
     * Per-ad frequency from Meta. Captured for parity but not used
     * in the aggregate — we recompute frequency from the summed
     * impressions / reach so the row math is self-consistent.
     */
    frequency: number;
    actions: AdInsightAction[];
    /**
     * Inline link clicks (the funnel-aligned click metric, distinct
     * from `clicks` which Meta inflates with social/expand/share
     * clicks). Optional because legacy callers / tests may not set
     * it; the grouping layer reads it via `?? 0` so missing == 0.
     * Plumbed by PR #47 from the dedicated /insights endpoint where
     * the field is finally requested.
     */
    inline_link_clicks?: number;
    /**
     * Per-action revenue values (e.g. `omni_purchase` →
     * conversion-value sum). Same provenance + optionality story as
     * `inline_link_clicks`. The grouping layer doesn't sum these
     * yet — added now so a future ROAS column can land without
     * touching the fetch path again.
     */
    action_values?: AdInsightAction[];
  } | null;
}

export interface CreativeRowAdSet {
  id: string;
  name: string | null;
}

export interface CreativeRowCampaign {
  id: string;
  name: string | null;
}

export interface CreativeRow {
  creative_id: string;
  creative_name: string | null;
  /**
   * Distinct trimmed `ad.name` values seen across the ads in this
   * group, ordered by descending cumulative ad-level spend (so
   * `ad_names[0]` is the "dominant" name to label the card by).
   * Empty array when no ad in the group surfaced a non-empty name —
   * the second-layer grouper / display-name picker then falls back
   * to creative_name / semantic labels.
   *
   * Why ad.name not creative.name: Meta auto-generates noisy
   * placeholder creative.name values from product feeds (e.g.
   * "{{product.name}} 2026-03-31-<uuid>") that defeat both the
   * name tier of the grouping waterfall AND human-readable labels.
   * The ad-level name is what marketers actually type into Ads
   * Manager and what they recognise in the panel.
   */
  ad_names: string[];
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  /** Ad that supplied `thumbnail_url`; null when no thumbnail was resolved. */
  thumbnail_ad_id: string | null;
  /** Spend for the ad that supplied `thumbnail_url`; null when no thumbnail resolved. */
  thumbnail_spend: number | null;
  thumbnail_source: ActiveCreativeThumbnailSource;
  /** Same-post identifier used by the second-layer asset-hash grouper. */
  effective_object_story_id: string | null;
  object_story_id: string | null;
  /** Asset signature (video / image-hash / asset-set hash bag). */
  primary_asset_signature: string | null;
  /** Top-spend ad's preview payload — drives the modal. */
  preview: CreativePreview;
  ad_count: number;
  adsets: CreativeRowAdSet[];
  campaigns: CreativeRowCampaign[];
  /** Highest-spend ad in the group — used for the Ads Manager deep link. */
  representative_ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  /** Percent (0-100). null when impressions = 0. */
  ctr: number | null;
  /** Account currency. null when impressions = 0. */
  cpm: number | null;
  /** Account currency. null when clicks = 0. */
  cpc: number | null;
  registrations: number;
  /** Account currency. null when registrations = 0. */
  cpr: number | null;
  purchases: number;
  /** Account currency. null when purchases = 0. */
  cpp: number | null;
  /**
   * Landing-page views. Sum of every action whose `action_type`
   * is in `LANDING_PAGE_VIEW_ACTION_TYPES` — covers the pixel
   * (`landing_page_view`), Conversions API
   * (`offsite_conversion.fb_pixel_landing_page_view`), and the
   * de-duplicated cross-surface variant (`omni_landing_page_view`).
   * Zero is a meaningful value (the ad's LP isn't pixelled / the
   * fire didn't happen yet), so we keep it numeric rather than
   * nullable.
   */
  landingPageViews: number;
  /**
   * Cost per landing-page view. Account currency. null when
   * `landingPageViews = 0` — same convention as `cpr` / `cpp`.
   */
  cplpv: number | null;
  /** sum_impressions / sum_reach. null when reach = 0. */
  frequency: number | null;
  /**
   * Three-bucket frequency-derived fatigue score, computed via
   * {@link fatigueFromFrequency}. Surfaces as a pill on the share
   * card so a marketer can spot saturated creatives without
   * mentally translating the frequency number.
   */
  fatigueScore: FatigueScore;
  /**
   * Sum of `insights.inline_link_clicks` across the underlying ads.
   * Distinct from `clicks` (which Meta inflates with social /
   * expand / share clicks). Plumbed PR #56 so the second-layer
   * grouper can emit a true link-CTR for the share-card health
   * badge. Zero when no ad in the bucket reported a value.
   */
  inline_link_clicks: number;
  /**
   * True iff at least one underlying ad has `effective_status ===
   * "ACTIVE"`. False when every ad is paused / paused-by-campaign
   * / paused-by-adset. Drives the "PAUSED" pill state on the
   * share-card health badge — historical-spend-only creatives
   * shouldn't surface a SCALE / KILL recommendation.
   */
  any_ad_active: boolean;
}

// ─── Action-type priority lists ─────────────────────────────────────────────
//
// PR #49: Meta returns the SAME conversion event under multiple
// overlapping `action_type` keys in a single insights row, e.g. a
// purchase shows up as `omni_purchase` (deduped total) AND
// `offsite_conversion.fb_pixel_purchase` (pixel-only subset) AND
// `purchase` (generic fallback subset). Summing across the whole
// allowlist (the previous Set+sum approach) triple-counts. Worse,
// which variants Meta returns varies by attribution window and
// date range — so the inflation factor changes per timeframe and
// the share report's purchase / LPV numbers drift non-monotonically
// as the window widens. Last-7d sometimes printed higher purchases
// than last-30d for the same creative — impossible for cumulative
// metrics.
//
// Fix: pick exactly ONE variant per ad in priority order, preferring
// Meta's most-deduplicated tier first. The priority order is the
// load-bearing data — keep it tight and document the rationale per
// list. {@link pickActionValue} consumes these.

const PURCHASE_ACTION_PRIORITY = [
  // Meta's already-deduped total across pixel + CAPI + app.
  "omni_purchase",
  // Pixel-only subset of omni — used as a fallback for accounts that
  // haven't enabled CAPI yet.
  "offsite_conversion.fb_pixel_purchase",
  // Generic last-resort label.
  "purchase",
] as const;

const LANDING_PAGE_VIEW_ACTION_PRIORITY = [
  // Cross-surface deduped (web + app).
  "omni_landing_page_view",
  // Pixel-only subset.
  "offsite_conversion.fb_pixel_landing_page_view",
  // Generic fallback for older accounts.
  "landing_page_view",
] as const;

const REGISTRATION_ACTION_PRIORITY = [
  // Meta's deduped on-site leads bucket — the "correct" value when
  // both lead-gen forms and pixel events are firing for the same
  // submission.
  "onsite_conversion.lead_grouped",
  // Pixel CAPI variants that the older 4thefans accounts report
  // under. Two distinct event names (registration vs lead) and we
  // prefer registration where present.
  "offsite_conversion.fb_pixel_complete_registration",
  "offsite_conversion.fb_pixel_lead",
  // Generic fallbacks.
  "complete_registration",
  "lead",
  "registration",
] as const;

/**
 * Pick the first matching `action_type` from the priority list.
 * Stops at the first hit so overlapping Meta variants don't
 * triple-count. Returns `0` when no priority entry is present
 * (or the value is non-numeric / non-finite).
 *
 * The priority list itself is the canonical de-dup contract —
 * see the rationale on each `*_ACTION_PRIORITY` const. Same
 * helper handles `actions[]` (counts) and `action_values[]`
 * (revenue) since both arrays share the
 * `{ action_type, value }` shape.
 */
function pickActionValue(
  actions: readonly AdInsightAction[] | undefined,
  priorityList: readonly string[],
): number {
  if (!actions || actions.length === 0) return 0;
  for (const type of priorityList) {
    const hit = actions.find((a) => a.action_type === type);
    if (!hit) continue;
    return Number.isFinite(hit.value) ? hit.value : 0;
  }
  return 0;
}

/**
 * Map a frequency value into the same three-bucket fatigue scale
 * used by `lib/meta/creative-insights.ts` so the share card and
 * the internal heatmap agree on what "warning" / "critical"
 * means. Boundaries:
 *   - `< 3.0` → "ok"
 *   - `3.0..5.0` (inclusive) → "warning"
 *   - `> 5.0` → "critical"
 *
 * Returns "ok" for null / non-finite frequencies so callers can
 * always render a pill without a separate empty branch — the
 * card downstream already shows a muted fallback when reach is
 * zero.
 */
export type FatigueScore = "ok" | "warning" | "critical";

export function fatigueFromFrequency(
  freq: number | null | undefined,
): FatigueScore {
  if (freq == null || !Number.isFinite(freq) || freq < 3) return "ok";
  if (freq <= 5) return "warning";
  return "critical";
}

function safeRate(num: number, denom: number, scale = 1): number | null {
  // Defensive: denom must be a positive finite number. NaN / Infinity
  // / 0 / negative spend rows (Meta can return -0 on weird credit
  // adjustments) all collapse to null so the UI can render "—" and
  // the response never includes Infinity / NaN tokens that JSON.parse
  // turns into nonsense.
  if (!Number.isFinite(denom) || denom <= 0) return null;
  if (!Number.isFinite(num)) return null;
  return (num / denom) * scale;
}

interface Accumulator {
  creative_id: string;
  creative_name: string | null;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  thumbnail_ad_id: string | null;
  thumbnail_source: ActiveCreativeThumbnailSource;
  effective_object_story_id: string | null;
  object_story_id: string | null;
  primary_asset_signature: string | null;
  /** Top-spend ad's preview payload — refreshed whenever a higher-spend ad lands. */
  preview: CreativePreview;
  /**
   * Distinct trimmed ad.name → cumulative ad-level spend. Spend
   * weighting lets the materialised `ad_names` array sort dominant
   * names first even when they appear across multiple ads.
   */
  ad_names_spend: Map<string, number>;
  ad_ids: string[];
  /** Per-ad spend tracked alongside ad_ids so we can pick the top spender. */
  ad_spends: number[];
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
  /** Highest-spend value seen so far — drives the preview-refresh check. */
  topSpend: number;
  /** Highest-spend ad with a non-null thumbnail. */
  thumbnailSpend: number;
}

function emptyPreview(): CreativePreview {
  return {
    image_url: null,
    video_id: null,
    instagram_permalink_url: null,
    headline: null,
    body: null,
    call_to_action_type: null,
    link_url: null,
  };
}

function emptyThumbnailSource(): ActiveCreativeThumbnailSource {
  return {
    video_id: null,
    image_hash: null,
  };
}

/**
 * Group a flat list of ad rows by `creative_id`.
 *
 * Drops ads with `creative_id == null` (Meta surfaces these for
 * dynamic creative experiments and a handful of legacy ad types
 * — they'd just create a noisy "(no creative)" bucket the user
 * can't act on).
 */
export function groupAdsByCreative(ads: readonly AdInput[]): CreativeRow[] {
  const buckets = new Map<string, Accumulator>();

  for (const ad of ads) {
    if (!ad.creative_id) continue;
    const ins = ad.insights;
    const adSpend = ins?.spend ?? 0;
    const adImpressions = ins?.impressions ?? 0;
    const adClicks = ins?.clicks ?? 0;
    const adReach = ins?.reach ?? 0;

    // Per-ad: pick ONE variant in priority order so overlapping Meta
    // labels (omni_* vs pixel vs generic) don't triple-count. Cross-ad
    // sums still happen below — different ads with the same single
    // event type contribute additively as expected.
    const registrations = pickActionValue(
      ins?.actions,
      REGISTRATION_ACTION_PRIORITY,
    );
    const purchases = pickActionValue(
      ins?.actions,
      PURCHASE_ACTION_PRIORITY,
    );
    const landingPageViews = pickActionValue(
      ins?.actions,
      LANDING_PAGE_VIEW_ACTION_PRIORITY,
    );

    const acc = buckets.get(ad.creative_id) ?? {
      creative_id: ad.creative_id,
      creative_name: ad.creative_name,
      headline: ad.headline,
      body: ad.body,
      thumbnail_url: ad.thumbnail_url,
      thumbnail_ad_id: ad.thumbnail_url ? ad.ad_id : null,
      thumbnail_source: ad.thumbnail_source ?? emptyThumbnailSource(),
      effective_object_story_id: ad.effective_object_story_id,
      object_story_id: ad.object_story_id,
      primary_asset_signature: ad.primary_asset_signature,
      preview: emptyPreview(),
      ad_names_spend: new Map<string, number>(),
      ad_ids: [] as string[],
      ad_spends: [] as number[],
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
      topSpend: -Infinity,
      thumbnailSpend: ad.thumbnail_url ? adSpend : -Infinity,
    };

    // First-seen wins for the descriptive fields. If two ads sharing
    // a creative_id have different names / headlines (rare — usually
    // an admin renamed mid-flight) we keep the first; anything more
    // creative would silently mask the divergence.
    if (!acc.creative_name && ad.creative_name) acc.creative_name = ad.creative_name;
    if (!acc.headline && ad.headline) acc.headline = ad.headline;
    if (!acc.body && ad.body) acc.body = ad.body;
    if (!acc.effective_object_story_id && ad.effective_object_story_id) {
      acc.effective_object_story_id = ad.effective_object_story_id;
    }
    if (!acc.object_story_id && ad.object_story_id) {
      acc.object_story_id = ad.object_story_id;
    }
    if (!acc.primary_asset_signature && ad.primary_asset_signature) {
      acc.primary_asset_signature = ad.primary_asset_signature;
    }

    acc.ad_ids.push(ad.ad_id);
    acc.ad_spends.push(adSpend);
    // Collect distinct ad.names with cumulative spend weighting. Use
    // the trimmed string as the canonical key so "Motion V2" and
    // "Motion V2 " merge; we deliberately keep casing so the dominant
    // entry can be surfaced as the human-readable display label.
    const adName = ad.ad_name?.trim();
    if (adName) {
      acc.ad_names_spend.set(
        adName,
        (acc.ad_names_spend.get(adName) ?? 0) + adSpend,
      );
    }
    if (ad.adset_id) {
      const existing = acc.adsets.get(ad.adset_id);
      if (existing == null && ad.adset_name) {
        acc.adsets.set(ad.adset_id, ad.adset_name);
      } else if (!acc.adsets.has(ad.adset_id)) {
        acc.adsets.set(ad.adset_id, ad.adset_name);
      }
    }
    if (ad.campaign_id) {
      if (!acc.campaigns.has(ad.campaign_id)) {
        acc.campaigns.set(ad.campaign_id, ad.campaign_name);
      }
    }
    acc.spend += adSpend;
    acc.impressions += adImpressions;
    acc.clicks += adClicks;
    acc.reach += adReach;
    acc.registrations += registrations;
    acc.purchases += purchases;
    acc.landingPageViews += landingPageViews;
    acc.inline_link_clicks += ins?.inline_link_clicks ?? 0;
    if (ad.status === "ACTIVE") acc.any_ad_active = true;

    // Deterministic thumbnail picker: choose the thumbnail from the
    // highest-spend ad that actually has a thumbnail. If the top-spend
    // ad's own thumbnail is null / expired, this falls through to the
    // next highest-spend thumbnail produced by the fetcher's fallback
    // chain (top thumbnail_url → preview.image_url).
    if (ad.thumbnail_url && adSpend > acc.thumbnailSpend) {
      acc.thumbnailSpend = adSpend;
      acc.thumbnail_url = ad.thumbnail_url;
      acc.thumbnail_ad_id = ad.ad_id;
      acc.thumbnail_source = ad.thumbnail_source ?? emptyThumbnailSource();
    }

    // Preview tracking: top-spend ad's payload wins. Tie on first-seen
    // (no need for stable sort — the modal viewer can't tell which of
    // two equally-spending ads is shown).
    if (adSpend > acc.topSpend) {
      acc.topSpend = adSpend;
      acc.preview = ad.preview;
    }

    buckets.set(ad.creative_id, acc);
  }

  const rows: CreativeRow[] = [];
  for (const acc of buckets.values()) {
    let representative = acc.ad_ids[0];
    let topSpend = -Infinity;
    for (let i = 0; i < acc.ad_ids.length; i += 1) {
      if (acc.ad_spends[i] > topSpend) {
        topSpend = acc.ad_spends[i];
        representative = acc.ad_ids[i];
      }
    }

    // Sort distinct ad.names by descending cumulative spend so the
    // first entry is the dominant label. Tie-break on insertion order
    // (Map preserves it), which matches Meta's pagination order —
    // good enough for a stable UI when two names have identical spend.
    const ad_names = [...acc.ad_names_spend.entries()]
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0]);

    const frequency = safeRate(acc.impressions, acc.reach);
    rows.push({
      creative_id: acc.creative_id,
      creative_name: acc.creative_name,
      ad_names,
      headline: acc.headline,
      body: acc.body,
      thumbnail_url: acc.thumbnail_url,
      thumbnail_ad_id: acc.thumbnail_ad_id,
      thumbnail_spend: Number.isFinite(acc.thumbnailSpend)
        ? acc.thumbnailSpend
        : null,
      thumbnail_source: acc.thumbnail_source,
      effective_object_story_id: acc.effective_object_story_id,
      object_story_id: acc.object_story_id,
      primary_asset_signature: acc.primary_asset_signature,
      preview: acc.preview,
      ad_count: acc.ad_ids.length,
      adsets: [...acc.adsets.entries()].map(([id, name]) => ({ id, name })),
      campaigns: [...acc.campaigns.entries()].map(([id, name]) => ({ id, name })),
      representative_ad_id: representative,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      reach: acc.reach,
      ctr: safeRate(acc.clicks, acc.impressions, 100),
      cpm: safeRate(acc.spend, acc.impressions, 1000),
      cpc: safeRate(acc.spend, acc.clicks),
      registrations: acc.registrations,
      cpr: safeRate(acc.spend, acc.registrations),
      purchases: acc.purchases,
      cpp: safeRate(acc.spend, acc.purchases),
      landingPageViews: acc.landingPageViews,
      cplpv: safeRate(acc.spend, acc.landingPageViews),
      frequency,
      fatigueScore: fatigueFromFrequency(frequency),
      inline_link_clicks: acc.inline_link_clicks,
      any_ad_active: acc.any_ad_active,
    });
  }

  // Default ordering: spend DESC. The UI sort dropdown can re-sort
  // client-side for CTR / CPR / Frequency views.
  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}
