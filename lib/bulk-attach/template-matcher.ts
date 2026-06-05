/**
 * lib/bulk-attach/template-matcher.ts
 *
 * Pure functions for matching a template's `match_pattern` against a set of
 * live campaigns and ad sets. No I/O — fully testable in isolation.
 *
 * Field semantics:
 *   campaign_name_contains  — OR logic: campaign name must contain ANY of the strings
 *   ad_set_name_contains    — OR logic: ad set name must contain ANY of the strings
 *
 * An empty pattern array for a field means "no filter" (match all).
 * Both fields are independent — campaign and ad set matching are separate concerns.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchPattern {
  /** Case-insensitive substrings. An ad/campaign name matches if it contains ANY of these. */
  campaign_name_contains?: string[];
  /** Case-insensitive substrings. An ad set name matches if it contains ANY of these. */
  ad_set_name_contains?: string[];
}

export interface CreativeConfig {
  headline?: string;
  description?: string;
  cta?: string;
  destination_url?: string;
}

export interface CampaignRef {
  id: string;
  name: string;
}

export interface AdSetRef {
  id: string;
  name: string;
}

export interface CampaignMatchResult {
  /** IDs of campaigns that matched the pattern. */
  matchedCampaignIds: string[];
  /**
   * Pattern terms from `campaign_name_contains` that matched no campaign.
   * Non-empty when the user applied a template on a different event that
   * doesn't have the same campaign naming.
   */
  unmatchedCampaignPatterns: string[];
  /** "high" when ≥1 campaign matched; "low" otherwise. */
  suggestionConfidence: "high" | "low";
}

export interface AdSetMatchResult {
  /** IDs of ad sets that matched the pattern. */
  matchedAdSetIds: string[];
  /**
   * Pattern terms from `ad_set_name_contains` that matched no ad set in
   * this campaign's list.
   */
  unmatchedAdSetPatterns: string[];
}

// ─── Campaign matching ────────────────────────────────────────────────────────

/**
 * Returns the subset of `campaigns` whose names match `pattern.campaign_name_contains`.
 *
 * If the pattern has no `campaign_name_contains` (or an empty array), every
 * campaign is returned — "no filter" semantics.
 */
export function matchCampaigns(
  pattern: MatchPattern,
  campaigns: CampaignRef[],
): CampaignMatchResult {
  const terms = (pattern.campaign_name_contains ?? []).filter(Boolean);

  // No filter → return all
  if (terms.length === 0) {
    return {
      matchedCampaignIds: campaigns.map((c) => c.id),
      unmatchedCampaignPatterns: [],
      suggestionConfidence: campaigns.length > 0 ? "high" : "low",
    };
  }

  const matched = campaigns.filter((c) =>
    terms.some((t) => c.name.toLowerCase().includes(t.toLowerCase())),
  );

  const unmatchedCampaignPatterns = terms.filter(
    (t) => !campaigns.some((c) => c.name.toLowerCase().includes(t.toLowerCase())),
  );

  return {
    matchedCampaignIds: matched.map((c) => c.id),
    unmatchedCampaignPatterns,
    suggestionConfidence: matched.length > 0 ? "high" : "low",
  };
}

// ─── Ad set matching ──────────────────────────────────────────────────────────

/**
 * Returns the subset of `adSets` whose names match `pattern.ad_set_name_contains`.
 *
 * If the pattern has no `ad_set_name_contains` (or empty array), ALL ad sets
 * are returned — preserving the existing "select all by default" behaviour.
 */
export function matchAdSets(pattern: MatchPattern, adSets: AdSetRef[]): AdSetMatchResult {
  const terms = (pattern.ad_set_name_contains ?? []).filter(Boolean);

  // No filter → select all (mirrors original AdSetPicker default)
  if (terms.length === 0) {
    return {
      matchedAdSetIds: adSets.map((a) => a.id),
      unmatchedAdSetPatterns: [],
    };
  }

  const matched = adSets.filter((a) =>
    terms.some((t) => a.name.toLowerCase().includes(t.toLowerCase())),
  );

  const unmatchedAdSetPatterns = terms.filter(
    (t) => !adSets.some((a) => a.name.toLowerCase().includes(t.toLowerCase())),
  );

  return {
    matchedAdSetIds: matched.map((a) => a.id),
    unmatchedAdSetPatterns,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True if a campaign name matches any term in the pattern (case-insensitive). */
export function campaignNameMatches(pattern: MatchPattern, name: string): boolean {
  const terms = (pattern.campaign_name_contains ?? []).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((t) => name.toLowerCase().includes(t.toLowerCase()));
}

/** True if an ad set name matches any term in the pattern (case-insensitive). */
export function adSetNameMatches(pattern: MatchPattern, name: string): boolean {
  const terms = (pattern.ad_set_name_contains ?? []).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((t) => name.toLowerCase().includes(t.toLowerCase()));
}

// ─── Pattern derivation ───────────────────────────────────────────────────────

/**
 * Builds a simple match pattern from a free-form text string entered by the
 * user in the "Save as template" form.
 * Splits on commas; trims and deduplicates.
 */
export function parsePatternTerms(input: string): string[] {
  return [
    ...new Set(
      input
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
