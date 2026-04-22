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
  // Spread + override pattern so callers can pass `null` explicitly
  // for fields like `creative_name` without `null ?? "default"`
  // coercing it back. Mirrors the pattern used in active-creatives-
  // group.test.ts.
  const base: ConceptInputRow = {
    creative_id: "cid-default",
    creative_name: "Default Concept",
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
    ctr: 1,
    cpm: 100,
    cpc: 10,
    cpr: null,
    cpp: null,
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

test("name-tier collapse: 3 ads share one concept across distinct creative_ids", () => {
  // No post id, no asset sig, no thumbnail — waterfall falls all
  // the way to tier 5 (name) and collapses on the normalised
  // creative_name.
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-A",
      creative_name: "Innervisions London",
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
      creative_name: "Innervisions London - Copy",
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
      creative_name: "Innervisions London - Copy 2",
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
  // Adsets dedupe — as-1 appears in two underlying rows, should
  // still only show once in the aggregated list.
  assert.deepEqual(
    g.adsets.map((s) => s.id).sort(),
    ["as-1", "as-2"],
  );
  // Display name = chosen rep's creative_name (top-spend row's
  // un-normalised name, "Innervisions London" — the parent).
  assert.equal(g.display_name, "Innervisions London");
  // Group key derives from the normalised name with the "name:" prefix.
  assert.equal(g.group_key, "name:innervisions london");
  assert.deepEqual(g.reasons, ["name"]);
  // Top-spend representative = first row (£100, the highest).
  assert.equal(g.representative_ad_id, "ad-default");
  assert.equal(g.representative_headline, "Innervisions London");
});

test("dynamic product date strip: ISO-stamped variants collapse to one group", () => {
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "{{product.name}} 2026-03-31-abc",
      headline: "{{product.name}} 2026-03-31-abc",
      spend: 60,
      impressions: 600,
      clicks: 12,
      reach: 500,
    }),
    row({
      creative_id: "cid-2",
      creative_name: "{{product.name}} 2026-03-24-xyz",
      headline: "{{product.name}} 2026-03-24-xyz",
      spend: 40,
      impressions: 400,
      clicks: 8,
      reach: 350,
    }),
  ];

  const groups = groupByAssetSignature(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].group_key, "name:{{product.name}}");
  assert.equal(groups[0].creative_id_count, 2);
  assert.equal(groups[0].spend, 100);
  assert.deepEqual(groups[0].reasons, ["name"]);
});

test("distinct creatives stay split into separate rows", () => {
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      creative_name: "Innervisions London",
      spend: 200,
    }),
    row({
      creative_id: "cid-2",
      creative_name: "Jimi Jules",
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
      spend: 1000,
      impressions: 100_000,
      clicks: 1000,
      reach: 80_000,
      registrations: 100,
      ctr: 1, // ignored — recomputed from sums
      cpr: 10, // ignored
    }),
    row({
      creative_id: "cid-2",
      creative_name: "Same Concept - Copy",
      spend: 50,
      impressions: 1000,
      clicks: 100,
      reach: 800,
      registrations: 25,
      ctr: 10, // ignored
      cpr: 2, // ignored
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

function round(v: number | null, digits: number): number | null {
  if (v == null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
