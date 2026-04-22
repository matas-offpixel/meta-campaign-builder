/**
 * lib/reporting/group-creatives-by-name.test.ts
 *
 * node:test suite for the second-layer concept grouping helper.
 * No network, no Supabase — fixtures are hand-rolled so the math
 * is verifiable by eye when a case fails.
 *
 * Run with:
 *   node --test --experimental-strip-types \
 *     lib/reporting/group-creatives-by-name.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupByNormalisedName,
  normaliseAdName,
  type ConceptInputRow,
} from "./group-creatives-by-name.ts";

function row(overrides: Partial<ConceptInputRow>): ConceptInputRow {
  // Spread + override pattern so callers can pass `null` explicitly
  // for fields like `headline` without `null ?? "default"` coercing
  // it back. Mirrors the pattern used in active-creatives-group.test.ts.
  const base: ConceptInputRow = {
    creative_id: "cid-default",
    creative_name: null,
    headline: "Default Headline",
    body: "Default body",
    thumbnail_url: null,
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
  // Exact ladder of suffixes the helper has to handle, per spec
  // section 1. Eyeballing each transformation here doubles as the
  // canonical example for anyone reading the regex source later.
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

test("copy-suffix collapse: 3 ads share one concept across distinct creative_ids", () => {
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-A",
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

  const groups = groupByNormalisedName(rows);
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
  // Display name picker: shortest unsuffixed headline wins → the
  // parent "Innervisions London", not either of the copies.
  assert.equal(g.display_name, "Innervisions London");
  // Group key is the normalised form.
  assert.equal(g.group_key, "innervisions london");
  // Top-spend representative = first row (£100, the highest).
  assert.equal(g.representative_ad_id, "ad-default");
  assert.equal(g.representative_headline, "Innervisions London");
});

test("dynamic product date strip: ISO-stamped variants collapse to one group", () => {
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      headline: "{{product.name}} 2026-03-31-abc",
      spend: 60,
      impressions: 600,
      clicks: 12,
      reach: 500,
    }),
    row({
      creative_id: "cid-2",
      headline: "{{product.name}} 2026-03-24-xyz",
      spend: 40,
      impressions: 400,
      clicks: 8,
      reach: 350,
    }),
  ];

  const groups = groupByNormalisedName(rows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].group_key, "{{product.name}}");
  assert.equal(groups[0].creative_id_count, 2);
  assert.equal(groups[0].spend, 100);
});

test("distinct creatives stay split into separate rows", () => {
  const rows: ConceptInputRow[] = [
    row({
      creative_id: "cid-1",
      headline: "Innervisions London",
      spend: 200,
    }),
    row({
      creative_id: "cid-2",
      headline: "Jimi Jules",
      spend: 80,
    }),
  ];

  const groups = groupByNormalisedName(rows);
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
      headline: "Same Concept",
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
      headline: "Same Concept - Copy",
      spend: 50,
      impressions: 1000,
      clicks: 100,
      reach: 800,
      registrations: 25,
      ctr: 10, // ignored
      cpr: 2, // ignored
    }),
  ];

  const groups = groupByNormalisedName(rows);
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
      headline: "Concept",
      spend: 50,
      impressions: 1000,
      clicks: 10,
      reach: 800,
      registrations: 0,
      purchases: 0,
    }),
  ];
  const groups = groupByNormalisedName(rows);
  assert.equal(groups[0].cpr, null);
  assert.equal(groups[0].cpp, null);
});

function round(v: number | null, digits: number): number | null {
  if (v == null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
