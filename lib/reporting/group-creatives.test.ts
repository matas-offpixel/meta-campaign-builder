/**
 * lib/reporting/group-creatives.test.ts
 *
 * node:test suite for the asset-signal grouping waterfall.
 * No network, no Supabase — fixtures are hand-rolled so the math
 * is verifiable by eye when a case fails.
 *
 * Run with:
 *   node --test --experimental-strip-types \
 *     lib/reporting/group-creatives.test.ts
 *
 * Coverage:
 *   1. normaliseAdName — same suffix-stripping rules as before
 *      (kept verbatim from PR #39).
 *   2. Tier 5 (name) collapse: copy / version / ISO-date suffixes
 *      land in one bucket via the name fallback when no asset
 *      signal is present.
 *   3. Distinct-concept rows split.
 *   4. Rate-metric weighting (ratio of sums vs avg of rates).
 *   5. Zero-denominator → null (no NaN / Infinity leakage).
 *   6. Tier 1 (post_id) collapse — different creative_ids that
 *      share a Meta post.
 *   7. Tier 3 (asset_hash) collapse — different creative_ids that
 *      share a video re-upload signature.
 *   8. Tier 4 (thumbnail) collapse — same image, different cache-
 *      bust query strings.
 *   9. Numeric-name no-false-positive — different ads named purely
 *      with Meta auto-generated numeric IDs stay in separate
 *      buckets via tier 6 (creative_id).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupByAssetSignature,
  normaliseAdName,
  type ConceptInputRow,
  type ConceptInputPreview,
} from "./group-creatives.ts";

function emptyPreview(): ConceptInputPreview {
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

function row(overrides: Partial<ConceptInputRow>): ConceptInputRow {
  // Spread + override pattern so callers can pass `null` / [] explicitly
  // for fields like `creative_name` / `ad_names` without `null ?? "x"`
  // coercing them back. Mirrors the pattern in active-creatives-
  // group.test.ts.
  const base: ConceptInputRow = {
    creative_id: "cid-default",
    creative_name: "Default Concept",
    ad_names: [],
    headline: "Default Headline",
    body: "Default body",
    thumbnail_url: null,
    effective_object_story_id: null,
    object_story_id: null,
    primary_asset_signature: null,
    preview: emptyPreview(),
    ad_count: 1,
    adsets: [{ id: "as-1", name: "Adset 1" }],
    campaigns: [{ id: "c-1", name: "Camp 1" }],
    representative_ad_id: "ad-default",
    spend: 100,
    impressions: 1000,
    clicks: 10,
    reach: 800,
    registrations: 0,
    purchases: 0,
    landingPageViews: 0,
    ctr: 1,
    cpm: 100,
    cpc: 10,
    cpr: null,
    cpp: null,
    cplpv: null,
    frequency: 1.25,
  };
  return { ...base, ...overrides };
}

test("normaliseAdName strips copy / version / ISO date suffixes", () => {
  // Exact ladder of suffixes the helper has to handle. Eyeballing
  // each transformation here doubles as the canonical example for
  // anyone reading the regex source later.
  assert.equal(normaliseAdName("Innervisions London"), "innervisions london");
  assert.equal(
    normaliseAdName("Innervisions London - Copy"),
    "innervisions london",
  );
  assert.equal(
    normaliseAdName("Innervisions London - Copy 2"),
    "innervisions london",
  );
  assert.equal(
    normaliseAdName("Innervisions London - copy 12"),
    "innervisions london",
  );
  // Stacked copy suffixes (Meta lets users duplicate duplicates).
  assert.equal(
    normaliseAdName("Innervisions London - Copy - Copy 3"),
    "innervisions london",
  );
  assert.equal(normaliseAdName("Headline (3)"), "headline");
  assert.equal(normaliseAdName("Headline - v2"), "headline");
  assert.equal(normaliseAdName("Headline - V 12"), "headline");
  assert.equal(
    normaliseAdName("{{product.name}} 2026-03-31-abc"),
    "{{product.name}}",
  );
  // Internal whitespace runs collapse, then lowercase.
  assert.equal(
    normaliseAdName("  Innervisions   London   "),
    "innervisions london",
  );
  // Empty / null fall through to "" so callers can fall back to
  // body / creative_id without a NaN-shaped key.
  assert.equal(normaliseAdName(""), "");
  assert.equal(normaliseAdName(null), "");
  assert.equal(normaliseAdName(undefined), "");
});

// Meta's Ads Manager UI duplicates ads with " – Copy" using en-dash
// (U+2013), not the ASCII hyphen (U+002D) the original regex matched.
// Without these the two cards rendered as separate concepts on the
// share report (observed: "LINEUP PROMO EDIT" + "LINEUP PROMO EDIT –
// Copy" both surfacing on the Innervisions share).
test("normaliseAdName strips en-dash copy suffix", () => {
  assert.equal(
    normaliseAdName("LINEUP PROMO EDIT \u2013 Copy"),
    "lineup promo edit",
  );
  assert.equal(
    normaliseAdName("LINEUP PROMO EDIT \u2013 Copy 2"),
    "lineup promo edit",
  );
});

test("normaliseAdName strips hyphen copy suffix (regression)", () => {
  assert.equal(normaliseAdName("Motion V2 - Copy"), "motion v2");
});

test("normaliseAdName strips en-dash v-version suffix", () => {
  assert.equal(normaliseAdName("UGC \u2013 v2"), "ugc");
});

test("name-tier collapse: 3 rows share one concept via dominant ad.name", () => {
  // No post id, no asset sig, no thumbnail — waterfall falls to tier
  // 5 (name) and collapses on `normaliseAdName(ad_names[0])`.
  // Underlying creative.name is template-polluted (the bug PR #41
  // fixes); ad.name is the canonical Ads-Manager label.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-A",
      creative_name: "{{product.name}} 2026-03-31-aaa",
      ad_names: ["Innervisions London"],
      headline: "Innervisions London",
      ad_count: 2,
      adsets: [{ id: "as-1", name: "Adset 1" }],
      spend: 100,
      impressions: 1000,
      clicks: 30,
      reach: 800,
      registrations: 5,
    }),
    row({
      creative_id: "cid-B",
      creative_name: "{{product.name}} 2026-03-31-bbb",
      ad_names: ["Innervisions London - Copy"],
      headline: "Innervisions London - Copy",
      ad_count: 1,
      adsets: [{ id: "as-2", name: "Adset 2" }],
      spend: 50,
      impressions: 500,
      clicks: 10,
      reach: 400,
      registrations: 2,
    }),
    row({
      creative_id: "cid-C",
      creative_name: "{{product.name}} 2026-03-31-ccc",
      ad_names: ["Innervisions London - Copy 2"],
      headline: "Innervisions London - Copy 2",
      ad_count: 3,
      adsets: [{ id: "as-1", name: "Adset 1" }],
      spend: 25,
      impressions: 250,
      clicks: 6,
      reach: 200,
      registrations: 1,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1, "expected one concept bucket");
  const g = groups[0];
  assert.equal(g.creative_id_count, 3);
  assert.equal(g.ad_count, 6);
  assert.equal(g.spend, 175);
  assert.equal(g.impressions, 1750);
  assert.equal(g.clicks, 46);
  assert.equal(g.reach, 1400);
  assert.equal(g.registrations, 8);
  assert.deepEqual(
    g.adsets.map((s) => s.id).sort(),
    ["as-1", "as-2"],
  );
  // Display name = dominant ad.name (cleaned, case preserved).
  assert.equal(g.display_name, "Innervisions London");
  // Group key uses the lowercase normalised form.
  assert.equal(g.group_key, "name:innervisions london");
  assert.deepEqual(g.reasons, ["name"]);
  // Top-spend representative = first row (£100).
  assert.equal(g.representative_ad_id, "ad-default");
});

test("template-token creative_name + no ad_names → rows split at tier 6", () => {
  // Both rows have feed-template polluted creative.names AND no
  // ad_names. The previous (PR #40) behaviour collapsed these via
  // tier 5 (name) on the normalised creative_name, but that's exactly
  // the bug — the template token is per-row unique noise. PR #41
  // rejects template tokens at tier 5 and falls through to tier 6
  // (creative_id), so each row now lands in its own bucket.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "{{product.name}} 2026-03-31-abcdef12",
      ad_names: [],
      spend: 60,
      impressions: 600,
      clicks: 12,
      reach: 500,
    }),
    row({
      creative_id: "cid-2",
      creative_name: "{{product.name}} 2026-03-24-fedcba98",
      ad_names: [],
      spend: 40,
      impressions: 400,
      clicks: 8,
      reach: 350,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 2, "template-only names must not collapse");
  for (const g of groups) {
    assert.deepEqual(g.reasons, ["creative_id"]);
    assert.equal(g.creative_id_count, 1);
    assert.equal(g.display_name, "Untitled creative");
  }
});

test("distinct creatives stay split into separate rows", () => {
  // Different ad.names → tier 5 derives different bucket keys.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "Innervisions London",
      ad_names: ["Innervisions London"],
      spend: 200,
    }),
    row({
      creative_id: "cid-2",
      creative_name: "Jimi Jules",
      ad_names: ["Jimi Jules"],
      spend: 80,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 2);
  // Output sorted by spend DESC.
  assert.equal(groups[0].display_name, "Innervisions London");
  assert.equal(groups[1].display_name, "Jimi Jules");
  assert.equal(groups[0].creative_id_count, 1);
  assert.equal(groups[1].creative_id_count, 1);
});

test("rate metrics are weighted (ratio of sums), not averaged across rows", () => {
  // Per-row CTRs would be 1% and 10% respectively. The naive
  // "average the rates" answer would be 5.5%. The correct answer
  // is sum_clicks / sum_impressions = 1100 / 101000 ≈ 1.0891%.
  // CPR uses similarly distinct denominators per row so the
  // average-of-rates wrong answer is meaningfully different from
  // the ratio-of-sums right answer.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "Same Concept",
      ad_names: ["Same Concept"],
      spend: 1000,
      impressions: 100_000,
      clicks: 1000,
      reach: 80_000,
      registrations: 100,
      landingPageViews: 400,
      ctr: 1, // ignored — recomputed from sums
      cpr: 10, // ignored
      cplpv: 2.5, // ignored
    }),
    row({
      creative_id: "cid-2",
      creative_name: "Same Concept - Copy",
      ad_names: ["Same Concept - Copy"],
      spend: 50,
      impressions: 1000,
      clicks: 100,
      reach: 800,
      registrations: 25,
      landingPageViews: 80,
      ctr: 10, // ignored
      cpr: 2, // ignored
      cplpv: 0.625, // ignored
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1);
  const g = groups[0];

  // CTR sanity: 1100 / 101000 * 100 ≈ 1.0891. The wrong answer
  // (1+10)/2 = 5.5% would be wildly off.
  const expectedCtr = (1100 / 101_000) * 100;
  assert.equal(round(g.ctr, 4), round(expectedCtr, 4));
  assert.notEqual(round(g.ctr, 4), 5.5, "must NOT be the avg-of-rates wrong answer");

  // CPR sanity: 1050 / 125 = 8.4. The wrong answer (10+2)/2 = 6 is
  // off enough that an int rounding can't accidentally pass it.
  const expectedCpr = 1050 / 125;
  assert.equal(round(g.cpr, 4), round(expectedCpr, 4));
  assert.notEqual(round(g.cpr, 4), 6);

  // CPM and frequency should likewise be ratio-of-sums.
  assert.equal(round(g.cpm, 4), round((1050 / 101_000) * 1000, 4));
  assert.equal(round(g.frequency, 4), round(101_000 / 80_800, 4));

  // LPV is summed; CPLPV is ratio-of-sums (1050 / 480 = 2.1875).
  // The wrong avg-of-rates would be (2.5 + 0.625)/2 = 1.5625.
  assert.equal(g.landingPageViews, 480);
  assert.equal(round(g.cplpv, 4), round(1050 / 480, 4));
  assert.notEqual(round(g.cplpv, 4), round(1.5625, 4));

  // Frequency 1.25× → fatigue stays in the "ok" bucket.
  assert.equal(g.fatigueScore, "ok");
});

test("fatigueScore tracks bucket-level frequency, not per-row", () => {
  // Two rows: a tiny row with a high frequency, and a huge row
  // with a fresh frequency. The naive "max of per-row" would land
  // on critical; the correct ratio-of-sums frequency is 1.026 → ok.
  const groups = groupByAssetSignature([
    row({
      creative_id: "cid-tiny",
      ad_names: ["Combined"],
      effective_object_story_id: "post:fatigue-1",
      spend: 5,
      impressions: 600,
      clicks: 1,
      reach: 100,
      // per-row freq 6 → critical alone, but it gets diluted in
      // the bucket below.
      frequency: 6,
    }),
    row({
      creative_id: "cid-huge",
      ad_names: ["Combined"],
      effective_object_story_id: "post:fatigue-1",
      spend: 1000,
      impressions: 100_000,
      clicks: 1000,
      reach: 98_000,
      frequency: 1.02,
    }),
  ]);
  assert.equal(groups.length, 1);
  // (600 + 100_000) / (100 + 98_000) = 100_600 / 98_100 ≈ 1.025
  assert.equal(round(groups[0].frequency, 3), round(100_600 / 98_100, 3));
  assert.equal(groups[0].fatigueScore, "ok");
});

test("fatigueScore: warning + critical buckets at the boundary", () => {
  const groups = groupByAssetSignature([
    row({
      creative_id: "cid-warn",
      effective_object_story_id: "post:warn",
      // 4000 / 1000 = 4.0 → warning (3..5 inclusive)
      impressions: 4000,
      reach: 1000,
    }),
    row({
      creative_id: "cid-crit",
      effective_object_story_id: "post:crit",
      // 6000 / 1000 = 6.0 → critical (>5)
      impressions: 6000,
      reach: 1000,
    }),
  ]);
  const byKey = new Map(groups.map((g) => [g.group_key, g]));
  assert.equal(byKey.get("post:post:warn")?.fatigueScore, "warning");
  assert.equal(byKey.get("post:post:crit")?.fatigueScore, "critical");
});

test("zero-denominator rate metrics return null, not Infinity / NaN", () => {
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "Concept",
      spend: 50,
      impressions: 1000,
      clicks: 10,
      reach: 800,
      registrations: 0,
      purchases: 0,
    }),
  ];
  const groups = groupByAssetSignature(rows);
  assert.equal(groups[0].cpr, null);
  assert.equal(groups[0].cpp, null);
});

// ─── Asset-signal waterfall coverage (PR #40) ───────────────────────────────

test("post-id collapse: shared effective_object_story_id beats names", () => {
  // Same dark post wrapped by two different creative_ids with
  // unrelated numeric auto-names. Tier 1 of the waterfall should
  // collapse them despite the names having no overlap.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-X",
      creative_name: "120230049821210568",
      headline: null,
      effective_object_story_id: "1234567890_999",
      thumbnail_url: "https://cdn.example.com/p480x480/foo.jpg",
      spend: 200,
      impressions: 2000,
      clicks: 40,
      reach: 1500,
    }),
    row({
      creative_id: "cid-Y",
      creative_name: "120230049821210569",
      headline: null,
      effective_object_story_id: "1234567890_999",
      thumbnail_url: "https://cdn.example.com/p480x480/bar.jpg",
      spend: 50,
      impressions: 500,
      clicks: 8,
      reach: 400,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1, "post_id should collapse the bucket");
  assert.equal(groups[0].group_key, "post:1234567890_999");
  assert.deepEqual(groups[0].reasons, ["post_id"]);
  assert.equal(groups[0].creative_id_count, 2);
  // Display name falls back to "Dark post · 1" — never a raw numeric ID.
  assert.equal(groups[0].display_name, "Dark post · 1");
});

test("asset-hash collapse: shared video signature merges renamed re-uploads", () => {
  // Two ads, no post id, different creative_ids and names, but the
  // upstream Meta video_id is identical. Tier 3 should collapse.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-V1",
      creative_name: "Stage Video v1",
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: "video:9988776655",
      thumbnail_url: "https://cdn.example.com/p480x480/v1.jpg",
      spend: 300,
      impressions: 3000,
      clicks: 60,
      reach: 2400,
    }),
    row({
      creative_id: "cid-V2",
      creative_name: "Stage Video v1 - Copy",
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: "video:9988776655",
      thumbnail_url: "https://cdn.example.com/s600x600/v1.jpg",
      spend: 100,
      impressions: 1000,
      clicks: 20,
      reach: 800,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].group_key, "video:9988776655");
  assert.deepEqual(groups[0].reasons, ["asset_hash"]);
  assert.equal(groups[0].creative_id_count, 2);
  // Top-spend rep's creative_name wins — "Stage Video v1" is non-numeric.
  assert.equal(groups[0].display_name, "Stage Video v1");
});

test("thumbnail collapse: cache-bust query strings normalise to one bucket", () => {
  // Same image, two cache-bust query strings + different size
  // segments. Waterfall tiers 1-3 don't fire (no post id, no
  // asset sig); tier 4 should collapse on the normalised thumb.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-T1",
      creative_name: null,
      headline: null,
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: null,
      thumbnail_url:
        "https://scontent.example.com/t45/p480x480/headliner.jpg?_nc_cache=A1B2C3",
      spend: 80,
      impressions: 800,
      clicks: 12,
      reach: 600,
    }),
    row({
      creative_id: "cid-T2",
      creative_name: null,
      headline: null,
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: null,
      thumbnail_url:
        "https://scontent.example.com/t45/s600x600/headliner.jpg?_nc_cache=Z9Y8X7",
      spend: 20,
      impressions: 200,
      clicks: 3,
      reach: 150,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1, "thumbnail tier should collapse");
  assert.deepEqual(groups[0].reasons, ["thumbnail"]);
  assert.equal(groups[0].creative_id_count, 2);
  // Display name falls back to "Creative · ${shortHash}" — never a
  // raw URL or numeric ID.
  assert.match(groups[0].display_name, /^Creative · /);
});

test("numeric-name no-false-positive: different opaque IDs stay split", () => {
  // No post id, no asset sig, distinct thumbnails, names purely
  // numeric. The name tier explicitly rejects pure-digit normalised
  // names, so these must NOT collapse — they're two separate ads.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-N1",
      creative_name: "120230049821210568",
      headline: null,
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: null,
      thumbnail_url:
        "https://cdn.example.com/p480x480/numeric-1.jpg",
      spend: 40,
      impressions: 400,
      clicks: 8,
      reach: 300,
    }),
    row({
      creative_id: "cid-N2",
      creative_name: "120230049821210569",
      headline: null,
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: null,
      thumbnail_url:
        "https://cdn.example.com/p480x480/numeric-2.jpg",
      spend: 30,
      impressions: 300,
      clicks: 6,
      reach: 250,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  // Thumbnail differs → each lands in its own tier-4 bucket. Reason
  // should be "thumbnail" for both. Display name falls back to
  // "Creative · ${shortHash}" since the creative_name is pure-numeric
  // and therefore unusable as a display label.
  assert.equal(groups.length, 2);
  for (const g of groups) {
    assert.deepEqual(g.reasons, ["thumbnail"]);
    assert.equal(g.creative_id_count, 1);
    assert.match(
      g.display_name,
      /^Creative · /,
      "must never surface raw numeric ID as display name",
    );
  }
});

// ─── ad.name-driven grouping coverage (PR #41) ──────────────────────────────

test("ad.name drives grouping when creative_name is template-polluted", () => {
  // Two rows with distinct unique creative.names (per-row UUID tail
  // means tier 5 of PR #40 saw them as different concepts), but the
  // dominant ad.name is the same after Copy-suffix stripping. Tier 5
  // now reads from ad_names[0] so the bucket collapses.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-A",
      creative_name: "{{product.name}} 2026-03-31-aaa",
      ad_names: ["Motion V2"],
      spend: 120,
      impressions: 1200,
      clicks: 24,
      reach: 950,
    }),
    row({
      creative_id: "cid-B",
      creative_name: "{{product.name}} 2026-03-31-bbb",
      ad_names: ["Motion V2 - Copy"],
      spend: 60,
      impressions: 600,
      clicks: 12,
      reach: 480,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1, "ad.name should collapse the bucket");
  const g = groups[0];
  assert.deepEqual(g.reasons, ["name"]);
  assert.equal(g.group_key, "name:motion v2");
  assert.equal(g.creative_id_count, 2);
  // Dominant ad.name (top-spend row's) wins display, case preserved.
  assert.equal(g.display_name, "Motion V2");
  // Both distinct ad.name variants surface for the modal subtitle,
  // ordered by descending row spend.
  assert.deepEqual(g.ad_names, ["Motion V2", "Motion V2 - Copy"]);
});

test("name-above-thumbnail: same ad.name + different thumbnails collapse on name (PR #49)", () => {
  // Regression: pre-PR #49, the waterfall ran thumbnail BEFORE name,
  // so Meta's CDN URL rotation (different per creative_id even when
  // the underlying asset is byte-identical) split same-concept
  // re-uploads into separate cards. After PR #49, name precedes
  // thumbnail — so distinct CDN URLs no longer mask a shared
  // marketer-intended name.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-A",
      creative_name: null,
      ad_names: ["Pre-Sale Push"],
      // Pre-fix: thumbnail tier would have keyed this as
      //   thumb:scontent.example.com/.../presale-cdn-A.jpg
      thumbnail_url: "https://scontent.example.com/t45/p480x480/presale-cdn-A.jpg",
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: null,
      spend: 200,
      impressions: 2000,
      clicks: 40,
      reach: 1500,
    }),
    row({
      creative_id: "cid-B",
      creative_name: null,
      ad_names: ["Pre-Sale Push - Copy"],
      // Different CDN URL — same image asset post-rotation.
      thumbnail_url: "https://scontent.example.com/t45/p480x480/presale-cdn-B.jpg",
      effective_object_story_id: null,
      object_story_id: null,
      primary_asset_signature: null,
      spend: 100,
      impressions: 1000,
      clicks: 20,
      reach: 800,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1, "name tier must collapse before thumbnail");
  const g = groups[0];
  assert.deepEqual(g.reasons, ["name"]);
  assert.equal(g.group_key, "name:pre-sale push");
  assert.equal(g.creative_id_count, 2);
  assert.equal(g.spend, 300);
  assert.equal(g.display_name, "Pre-Sale Push");
});

test("name-above-post-and-asset: same ad.name + different post_id + different asset_signature collapse on name (PR #50)", () => {
  // Regression for the live "LINEUP PROMO EDIT" failure: each
  // re-upload of the concept minted a fresh dark post
  // (effective_object_story_id) and Meta sometimes also assigned
  // a fresh asset signature, so pre-PR-#50 the post_id tier (and
  // failing that, the asset_hash tier) won the waterfall and
  // split same-named re-uploads into ~10 separate cards.
  //
  // After PR #50 the name tier sits ABOVE post_id + asset_hash,
  // so an acceptable marketer-intended name collapses these
  // back into a single concept. The trade-off (two unrelated
  // concepts could in theory share a marketer name inside one
  // event report) was explicitly accepted as the lesser evil
  // vs the current fragmentation.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-LP-1",
      creative_name: null,
      ad_names: ["Lineup Promo Edit"],
      // Distinct dark-post ids — pre-fix would have each row win
      // the post_id tier and split.
      effective_object_story_id: "1234567890_111",
      object_story_id: null,
      // Also distinct asset signatures — second-tier fallback
      // would also have split.
      primary_asset_signature: "video:1111111111",
      thumbnail_url: "https://scontent.example.com/p480x480/lp-A.jpg",
      spend: 200,
      impressions: 2000,
      clicks: 40,
      reach: 1500,
    }),
    row({
      creative_id: "cid-LP-2",
      creative_name: null,
      ad_names: ["Lineup Promo Edit"],
      effective_object_story_id: "1234567890_222",
      object_story_id: null,
      primary_asset_signature: "video:2222222222",
      thumbnail_url: "https://scontent.example.com/p480x480/lp-B.jpg",
      spend: 100,
      impressions: 1000,
      clicks: 20,
      reach: 800,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(
    groups.length,
    1,
    "name tier must collapse before post_id + asset_hash",
  );
  const g = groups[0];
  assert.deepEqual(g.reasons, ["name"]);
  assert.equal(g.group_key, "name:lineup promo edit");
  assert.equal(g.creative_id_count, 2);
  assert.equal(g.spend, 300);
  assert.equal(g.display_name, "Lineup Promo Edit");
});

test("token-polluted ad.name is rejected → falls through to tier 6", () => {
  // ad_names[0] contains a `{{...}}` token. Even though tier 5 has
  // input, isAcceptableNameToken rejects the template-token form so
  // we land on tier 6 (creative_id) — each row gets its own bucket.
  // Display tier 1 fails the same gate; tier 2 sanitises the matching
  // creative.name (template + ISO date + UUID tail all stripped) and
  // returns null, so we end up on the semantic fallback.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "{{product.name}} 2026-03-31-abc1234ef",
      ad_names: ["{{product.name}} 2026-03-31-abc1234ef"],
      spend: 50,
    }),
    row({
      creative_id: "cid-2",
      creative_name: "{{product.name}} 2026-04-01-deadbeef99",
      ad_names: ["{{product.name}} 2026-04-01-deadbeef99"],
      spend: 25,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 2, "template-token names must not collapse");
  for (const g of groups) {
    assert.deepEqual(g.reasons, ["creative_id"]);
    assert.equal(g.display_name, "Untitled creative");
  }
});

test("multi-variant ad.names: distinct variants merge to 2 concepts", () => {
  // Three rows, three ad.name strings. "UGC - Dixon - V4" and
  // "UGC - Dixon - V4 - Copy" both normalise to "ugc - dixon" (the
  // suffix-stripping canonicaliser drops "- Copy" then "- V4"), so
  // they collapse into one bucket. "Feed - Dixon" stays separate.
  // Result: 2 groups, the UGC group preserves both variant strings
  // in its ad_names array (spend-DESC ordered).
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-ugc-1",
      creative_name: null,
      ad_names: ["UGC - Dixon - V4"],
      spend: 100,
      impressions: 1000,
      clicks: 20,
      reach: 800,
    }),
    row({
      creative_id: "cid-ugc-2",
      creative_name: null,
      ad_names: ["UGC - Dixon - V4 - Copy"],
      spend: 60,
      impressions: 600,
      clicks: 12,
      reach: 500,
    }),
    row({
      creative_id: "cid-feed",
      creative_name: null,
      ad_names: ["Feed - Dixon"],
      spend: 40,
      impressions: 400,
      clicks: 8,
      reach: 350,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 2, "expected one UGC bucket + one Feed bucket");
  // Spend DESC order: UGC (160) before Feed (40).
  const ugc = groups[0];
  const feed = groups[1];
  assert.equal(ugc.creative_id_count, 2);
  assert.equal(ugc.spend, 160);
  // Both distinct variants survive the merge, dominant first.
  assert.deepEqual(ugc.ad_names, [
    "UGC - Dixon - V4",
    "UGC - Dixon - V4 - Copy",
  ]);
  assert.equal(feed.creative_id_count, 1);
  assert.deepEqual(feed.ad_names, ["Feed - Dixon"]);
});

function round(v: number | null, digits: number): number | null {
  if (v == null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
