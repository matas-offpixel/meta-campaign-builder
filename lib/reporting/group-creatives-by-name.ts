/**
 * lib/reporting/group-creatives-by-name.ts
 *
 * Second-layer grouping on top of `groupAdsByCreative`. Where the
 * first layer collapses ads → one row per `creative_id`, this layer
 * collapses re-uploads of the same concept that Meta minted as
 * separate `creative_id`s (e.g. "Innervisions London" plus
 * "Innervisions London - Copy 2", or two dynamic-product ads
 * tagged "{{product.name}} 2026-03-31-abc" and "{{product.name}}
 * 2026-03-24-xyz").
 *
 * The grouping key is a normalised form of the ad's headline (or
 * body, or creative_id as a degenerate fallback). Same name-after-
 * normalisation = same concept.
 *
 * All math here mirrors the rules from `active-creatives-group.ts`:
 * weighted rate metrics computed from summed numerator + denominator,
 * ad sets / campaigns deduped, top-spend ad picked as representative.
 *
 * Pure module — no Supabase, no Meta. Safe to import from server
 * routes, server components, AND client components (the internal
 * panel pipes the API rows through here client-side under the
 * "Group by concept" toggle).
 */

// Input shape: a row produced by `groupAdsByCreative` from
// active-creatives-group.ts. We re-declare the structural shape
// here (rather than `import type` from that module) so this helper
// can run in environments where the active-creatives-group module's
// `server-only`-adjacent siblings would pull in dead deps. Pure
// structural typing means the existing CreativeRow satisfies it.
export interface ConceptInputRow {
  creative_id: string;
  creative_name: string | null;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
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

export interface ConceptGroupRow {
  /** The normalised name used as the bucket key. */
  group_key: string;
  /** Best display name picked from underlying rows (un-normalised). */
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
}

// ─── Normalisation ──────────────────────────────────────────────────────────
//
// Order matters. Each pass operates on the result of the previous.
// Stripping date stamps before collapsing whitespace ensures the
// trailing whitespace left behind by the strip doesn't leak into the
// final key. Lowercasing is the last step so the regexes can stay
// case-insensitive (matching " - Copy" with a /i flag) without
// having to handle every casing variant up front.

// Trailing " - Copy", " - Copy 3", " - copy", " - copy 12" — applied
// in a loop because Meta cheerfully nests them when an asset is
// duplicated more than once ("X - Copy - Copy - Copy 2").
const COPY_SUFFIX_RE = /\s+-\s+copy(\s+\d+)?\s*$/i;

// Trailing " (3)", " - v2", " - V 12" — version markers humans add
// when iterating on a creative ("Headline (2)", "Headline - v3").
// Like the copy suffix this loops to handle stacked markers.
const VERSION_SUFFIX_RE = /\s+(?:\(\s*\d+\s*\)|-\s+v\s*\d+)\s*$/i;

// First ISO date encountered in the trailing portion + everything
// after. Catches "{{product.name}} 2026-03-31-abc" → strips
// " 2026-03-31-abc". Single pass — there's never more than one
// trailing ISO stamp per real-world ad name.
const TRAILING_ISO_DATE_RE = /\s+\d{4}-\d{2}-\d{2}.*$/;

// For displayName picking — an "obviously suffixed" headline is
// either a copy or a version, and we'd prefer to surface its parent.
const HAS_VISIBLE_SUFFIX_RE =
  /(?:\s+-\s+copy(\s+\d+)?|\s+\(\s*\d+\s*\)|\s+-\s+v\s*\d+)\s*$/i;

/**
 * Normalise an ad name into the bucket key shared across re-uploads
 * of the same concept. Empty input → empty string (caller decides
 * whether to fall back to bodyPreview or creative_id).
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

// ─── Display-name picker ────────────────────────────────────────────────────

function isObviouslySuffixed(s: string | null): boolean {
  return !!s && HAS_VISIBLE_SUFFIX_RE.test(s);
}

interface CandidateName {
  /** Original (un-normalised) string. */
  text: string;
  /** Whether this came from the headline field. */
  fromHeadline: boolean;
}

/**
 * Pick the cleanest display name for a concept group:
 *   1. Shortest unsuffixed headline.
 *   2. Shortest headline overall (every option had a suffix).
 *   3. Shortest body preview (no headline anywhere).
 *
 * "Shortest" is a proxy for "least decorated" — duplicates like
 * "Headline - Copy 2" are strictly longer than the parent. Ties
 * (rare) resolve in deterministic insertion order.
 */
function pickDisplayName(candidates: CandidateName[]): string {
  if (candidates.length === 0) return "";
  const headlines = candidates.filter((c) => c.fromHeadline);
  const cleanHeadlines = headlines.filter((c) => !isObviouslySuffixed(c.text));
  if (cleanHeadlines.length > 0) {
    return cleanHeadlines.sort((a, b) => a.text.length - b.text.length)[0].text;
  }
  if (headlines.length > 0) {
    return headlines.sort((a, b) => a.text.length - b.text.length)[0].text;
  }
  return candidates.sort((a, b) => a.text.length - b.text.length)[0].text;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

interface Accumulator {
  group_key: string;
  candidates: CandidateName[];
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
}

function safeRate(num: number, denom: number, scale = 1): number | null {
  if (!Number.isFinite(denom) || denom <= 0) return null;
  if (!Number.isFinite(num)) return null;
  return (num / denom) * scale;
}

/**
 * Group rows by their normalised name.
 *
 * Bucket key resolution per row, in priority order:
 *   1. `normaliseAdName(headline)` if non-empty.
 *   2. `normaliseAdName(body)` if non-empty.
 *   3. `creative_id` literal — guarantees rows with no copy at all
 *      stay in their own bucket rather than collapsing into a giant
 *      "(no name)" row that the panel can't act on.
 */
export function groupByNormalisedName(
  rows: readonly ConceptInputRow[],
): ConceptGroupRow[] {
  const buckets = new Map<string, Accumulator>();

  for (const row of rows) {
    const headlineKey = normaliseAdName(row.headline);
    const bodyKey = normaliseAdName(row.body);
    const groupKey = headlineKey || bodyKey || row.creative_id;

    const acc = buckets.get(groupKey) ?? {
      group_key: groupKey,
      candidates: [] as CandidateName[],
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
    };

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

    if (row.headline) {
      acc.candidates.push({ text: row.headline, fromHeadline: true });
    }
    if (row.body) {
      acc.candidates.push({ text: row.body, fromHeadline: false });
    }

    if (row.spend > acc.topSpend) {
      acc.topSpend = row.spend;
      acc.representative_ad_id = row.representative_ad_id;
      acc.representative_thumbnail = row.thumbnail_url;
      acc.representative_headline = row.headline;
      acc.representative_body_preview = row.body;
    }

    buckets.set(groupKey, acc);
  }

  const out: ConceptGroupRow[] = [];
  for (const acc of buckets.values()) {
    out.push({
      group_key: acc.group_key,
      display_name: pickDisplayName(acc.candidates) || acc.group_key,
      creative_id_count: acc.underlying_creative_ids.length,
      ad_count: acc.ad_count,
      adsets: [...acc.adsets.entries()].map(([id, name]) => ({ id, name })),
      campaigns: [...acc.campaigns.entries()].map(([id, name]) => ({ id, name })),
      representative_ad_id: acc.representative_ad_id,
      representative_thumbnail: acc.representative_thumbnail,
      representative_headline: acc.representative_headline,
      representative_body_preview: acc.representative_body_preview,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      reach: acc.reach,
      registrations: acc.registrations,
      purchases: acc.purchases,
      // Weighted rate metrics — ratio of sums, NOT average of ratios.
      // See JSDoc on ConceptGroupRow for why this matters.
      ctr: safeRate(acc.clicks, acc.impressions, 100),
      cpm: safeRate(acc.spend, acc.impressions, 1000),
      cpc: safeRate(acc.spend, acc.clicks),
      cpr: safeRate(acc.spend, acc.registrations),
      cpp: safeRate(acc.spend, acc.purchases),
      frequency: safeRate(acc.impressions, acc.reach),
      underlying_creative_ids: acc.underlying_creative_ids,
    });
  }

  out.sort((a, b) => b.spend - a.spend);
  return out;
}
