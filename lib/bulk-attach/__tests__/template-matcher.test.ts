/**
 * Unit tests for lib/bulk-attach/template-matcher.ts
 *
 * All functions are pure — no I/O, no mocking needed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  matchCampaigns,
  matchAdSets,
  campaignNameMatches,
  adSetNameMatches,
  parsePatternTerms,
} from "../../../lib/bulk-attach/template-matcher.ts";
import type { MatchPattern, CampaignRef, AdSetRef } from "../../../lib/bulk-attach/template-matcher.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const campaigns: CampaignRef[] = [
  { id: "c1", name: "UTB Summer Lookalike" },
  { id: "c2", name: "UTB Winter Remarketing" },
  { id: "c3", name: "Awareness Brand Campaign" },
  { id: "c4", name: "UTB Brighton August" },
];

const adSets: AdSetRef[] = [
  { id: "as1", name: "Lookalike 1% UK" },
  { id: "as2", name: "Lookalike 3% UK" },
  { id: "as3", name: "Remarketing 30d" },
  { id: "as4", name: "Broad Interest Music" },
];

// ─── matchCampaigns ───────────────────────────────────────────────────────────

describe("matchCampaigns", () => {
  it("matches campaigns whose name contains any of the terms (OR logic)", () => {
    const pattern: MatchPattern = { campaign_name_contains: ["UTB"] };
    const result = matchCampaigns(pattern, campaigns);
    assert.deepEqual(result.matchedCampaignIds.sort(), ["c1", "c2", "c4"]);
    assert.equal(result.unmatchedCampaignPatterns.length, 0);
    assert.equal(result.suggestionConfidence, "high");
  });

  it("is case-insensitive", () => {
    const pattern: MatchPattern = { campaign_name_contains: ["utb"] };
    const result = matchCampaigns(pattern, campaigns);
    assert.equal(result.matchedCampaignIds.length, 3);
  });

  it("returns all campaigns when pattern is empty array", () => {
    const pattern: MatchPattern = { campaign_name_contains: [] };
    const result = matchCampaigns(pattern, campaigns);
    assert.equal(result.matchedCampaignIds.length, campaigns.length);
  });

  it("returns all campaigns when campaign_name_contains is absent", () => {
    const result = matchCampaigns({}, campaigns);
    assert.equal(result.matchedCampaignIds.length, campaigns.length);
  });

  it("reports unmatched patterns when no campaign matches a term", () => {
    const pattern: MatchPattern = { campaign_name_contains: ["UTB", "NONEXISTENT"] };
    const result = matchCampaigns(pattern, campaigns);
    assert.ok(result.unmatchedCampaignPatterns.includes("NONEXISTENT"));
    assert.ok(!result.unmatchedCampaignPatterns.includes("UTB"));
  });

  it("returns low confidence when nothing matches", () => {
    const pattern: MatchPattern = { campaign_name_contains: ["NOMATCHWHATSOEVER"] };
    const result = matchCampaigns(pattern, campaigns);
    assert.equal(result.matchedCampaignIds.length, 0);
    assert.equal(result.suggestionConfidence, "low");
  });

  it("uses OR across multiple terms — matches any containing 'Awareness' or 'UTB'", () => {
    const pattern: MatchPattern = { campaign_name_contains: ["Awareness", "UTB"] };
    const result = matchCampaigns(pattern, campaigns);
    assert.equal(result.matchedCampaignIds.length, 4); // all four
  });

  it("handles empty campaign list gracefully", () => {
    const result = matchCampaigns({ campaign_name_contains: ["UTB"] }, []);
    assert.equal(result.matchedCampaignIds.length, 0);
    assert.equal(result.suggestionConfidence, "low");
  });
});

// ─── matchAdSets ──────────────────────────────────────────────────────────────

describe("matchAdSets", () => {
  it("matches ad sets whose name contains any of the terms", () => {
    const pattern: MatchPattern = { ad_set_name_contains: ["Lookalike"] };
    const result = matchAdSets(pattern, adSets);
    assert.deepEqual(result.matchedAdSetIds.sort(), ["as1", "as2"]);
    assert.equal(result.unmatchedAdSetPatterns.length, 0);
  });

  it("OR logic: 'Lookalike' OR 'Remarketing'", () => {
    const pattern: MatchPattern = { ad_set_name_contains: ["Lookalike", "Remarketing"] };
    const result = matchAdSets(pattern, adSets);
    assert.deepEqual(result.matchedAdSetIds.sort(), ["as1", "as2", "as3"]);
  });

  it("returns all ad sets when ad_set_name_contains is absent (no-filter fallback)", () => {
    const result = matchAdSets({}, adSets);
    assert.equal(result.matchedAdSetIds.length, adSets.length);
  });

  it("returns all ad sets when ad_set_name_contains is empty array", () => {
    const result = matchAdSets({ ad_set_name_contains: [] }, adSets);
    assert.equal(result.matchedAdSetIds.length, adSets.length);
  });

  it("reports unmatched patterns", () => {
    const pattern: MatchPattern = { ad_set_name_contains: ["Lookalike", "UNKNOWN_PATTERN"] };
    const result = matchAdSets(pattern, adSets);
    assert.ok(result.unmatchedAdSetPatterns.includes("UNKNOWN_PATTERN"));
    assert.ok(!result.unmatchedAdSetPatterns.includes("Lookalike"));
  });

  it("returns empty when pattern matches nothing and reports it", () => {
    const pattern: MatchPattern = { ad_set_name_contains: ["ZZZZZZ"] };
    const result = matchAdSets(pattern, adSets);
    assert.equal(result.matchedAdSetIds.length, 0);
    assert.equal(result.unmatchedAdSetPatterns.length, 1);
  });
});

// ─── campaignNameMatches / adSetNameMatches ───────────────────────────────────

describe("campaignNameMatches", () => {
  it("returns true when name contains a term (case-insensitive)", () => {
    assert.equal(campaignNameMatches({ campaign_name_contains: ["utb"] }, "UTB Summer"), true);
  });

  it("returns false when name contains no term", () => {
    assert.equal(campaignNameMatches({ campaign_name_contains: ["XYZ"] }, "UTB Summer"), false);
  });

  it("returns true (no filter) when pattern is empty", () => {
    assert.equal(campaignNameMatches({}, "anything"), true);
  });
});

describe("adSetNameMatches", () => {
  it("returns true when name contains any term", () => {
    assert.equal(adSetNameMatches({ ad_set_name_contains: ["Lookalike"] }, "Lookalike 1% UK"), true);
  });

  it("returns true (no filter) when pattern is empty", () => {
    assert.equal(adSetNameMatches({}, "Broad Interest"), true);
  });

  it("returns false when name contains no term", () => {
    assert.equal(adSetNameMatches({ ad_set_name_contains: ["Lookalike"] }, "Broad Interest"), false);
  });
});

// ─── parsePatternTerms ────────────────────────────────────────────────────────

describe("parsePatternTerms", () => {
  it("splits on commas and trims", () => {
    assert.deepEqual(parsePatternTerms("UTB, Summer , Brighton"), ["UTB", "Summer", "Brighton"]);
  });

  it("deduplicates", () => {
    assert.deepEqual(parsePatternTerms("UTB, UTB, Brighton"), ["UTB", "Brighton"]);
  });

  it("ignores empty tokens", () => {
    assert.deepEqual(parsePatternTerms("UTB,,Brighton"), ["UTB", "Brighton"]);
  });

  it("returns empty array for blank input", () => {
    assert.deepEqual(parsePatternTerms(""), []);
    assert.deepEqual(parsePatternTerms("   "), []);
  });
});
