import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildCreativeTagBreakdowns,
  buildCreativeTagTiles,
  type CreativeTagAssignmentWithTag,
} from "../creative-tag-breakdowns.ts";
import type { ConceptGroupRow } from "../group-creatives.ts";

describe("buildCreativeTagBreakdowns", () => {
  it("returns no tables when there are no assignments", () => {
    assert.deepEqual(buildCreativeTagBreakdowns([group("Hero")], []), []);
  });

  it("aggregates a single tag across multiple matching creatives", () => {
    const rows = buildCreativeTagBreakdowns(
      [
        group("[EVT] Hero", { spend: 100, impressions: 1_000, clicks: 50 }),
        group("Hero Variant", { spend: 50, impressions: 500, clicks: 10 }),
      ],
      [
        assignment("Hero", "asset_type", "UGC"),
        assignment("Hero Variant", "asset_type", "UGC"),
      ],
    );

    assert.equal(rows[0].dimension, "asset_type");
    assert.deepEqual(rows[0].rows[0], {
      value_key: "ugc",
      value_label: "UGC",
      ad_count: 2,
      spend: 150,
      impressions: 1_500,
      reach: 800,
      clicks: 60,
      ctr: 4,
      cpr: 37.5,
      registrations: 4,
      purchases: 0,
    });
  });

  it("allows one creative to appear in two rows for the same dimension", () => {
    const rows = buildCreativeTagBreakdowns(
      [group("Offer Static", { spend: 200, registrations: 4, purchases: 1 })],
      [
        assignment("Offer Static", "hook_tactic", "Headline"),
        assignment("Offer Static", "hook_tactic", "Offer-first banner"),
      ],
    );

    assert.equal(rows.length, 1);
    assert.deepEqual(
      rows[0].rows.map((row) => [row.value_label, row.spend, row.cpr]),
      [
        ["Headline", 200, 50],
        ["Offer-first banner", 200, 50],
      ],
    );
  });

  it("exposes both awareness and ticketed metrics for render gating", () => {
    const rows = buildCreativeTagBreakdowns(
      [
        group("Awareness Video", {
          spend: 75,
          impressions: 3_000,
          reach: 2_500,
          clicks: 30,
          registrations: 0,
          purchases: 0,
        }),
      ],
      [assignment("Awareness Video", "hook_tactic", "Urgency")],
    );

    assert.equal(rows[0].rows[0].ctr, 1);
    assert.equal(rows[0].rows[0].cpr, null);
    assert.equal(rows[0].rows[0].purchases, 0);
  });

  it("omits low-trust dimensions from per-event share breakdowns", () => {
    assert.deepEqual(
      buildCreativeTagBreakdowns(
        [group("Static")],
        [assignment("Static", "visual_format", "Static image")],
      ),
      [],
    );
  });

  it("builds tile data with top thumbnails and fallback labels", () => {
    const tiles = buildCreativeTagTiles(
      [
        group("Hero A", {
          spend: 50,
          purchases: 1,
          representative_thumbnail: "https://img.example/a.jpg",
        }),
        group("Hero B", {
          spend: 200,
          purchases: 3,
          representative_thumbnail: "https://img.example/b.jpg",
        }),
        group("Hero C", {
          spend: 75,
          purchases: 2,
          representative_thumbnail: "https://img.example/c.jpg",
        }),
        group("Hero D", {
          spend: 25,
          purchases: 1,
          representative_thumbnail: "https://img.example/d.jpg",
        }),
        group("Hero E", {
          spend: 150,
          purchases: 5,
          representative_thumbnail: "https://img.example/e.jpg",
        }),
        group("No Thumb", { spend: 10, representative_thumbnail: null }),
      ],
      [
        assignment("Hero A", "asset_type", "UGC"),
        assignment("Hero B", "asset_type", "UGC"),
        assignment("Hero C", "asset_type", "UGC"),
        assignment("Hero D", "asset_type", "UGC"),
        assignment("Hero E", "asset_type", "UGC"),
        assignment("No Thumb", "messaging_angle", "Urgency"),
      ],
    );

    assert.deepEqual(
      tiles.find((tile) => tile.value_key === "ugc")?.thumbnails,
      [
        "https://img.example/b.jpg",
        "https://img.example/e.jpg",
        "https://img.example/c.jpg",
        "https://img.example/a.jpg",
      ],
    );
    assert.equal(tiles.find((tile) => tile.value_key === "ugc")?.spend, 500);
    assert.deepEqual(
      tiles.find((tile) => tile.value_key === "urgency"),
      {
        dimension: "messaging_angle",
        value_key: "urgency",
        value_label: "Urgency",
        spend: 10,
        registrations: 2,
        impressions: 1_000,
        reach: 400,
        clicks: 20,
        purchases: 0,
        thumbnails: [],
        fallbackLabel: "Urgency",
      },
    );
  });
});

function assignment(
  creativeName: string,
  dimension: string,
  valueLabel: string,
): CreativeTagAssignmentWithTag {
  return {
    id: `${creativeName}-${dimension}-${valueLabel}`,
    user_id: "user-1",
    event_id: "event-1",
    creative_name: creativeName,
    tag_id: "tag-1",
    source: "manual",
    confidence: null,
    model_version: null,
    created_at: "2026-05-02T00:00:00Z",
    updated_at: "2026-05-02T00:00:00Z",
    tag: {
      dimension,
      value_key: valueLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""),
      value_label: valueLabel,
    },
  } as CreativeTagAssignmentWithTag;
}

function group(
  displayName: string,
  overrides: Partial<ConceptGroupRow> = {},
): ConceptGroupRow {
  return {
    group_key: `g:${displayName}`,
    display_name: displayName,
    creative_id_count: 1,
    ad_count: 1,
    adsets: [],
    campaigns: [],
    representative_ad_id: "ad-1",
    representative_thumbnail: null,
    representative_thumbnail_ad_id: null,
    representative_thumbnail_source: { video_id: null, image_hash: null },
    representative_headline: displayName,
    representative_body_preview: null,
    representative_preview: {
      image_url: null,
      video_id: null,
      instagram_permalink_url: null,
      headline: displayName,
      body: null,
      call_to_action_type: null,
      link_url: null,
    },
    spend: 100,
    impressions: 1_000,
    clicks: 20,
    reach: 400,
    registrations: 2,
    purchases: 0,
    landingPageViews: 0,
    ctr: 2,
    cpm: 100,
    cpc: 5,
    cpr: 50,
    cpp: null,
    cplpv: null,
    frequency: 2.5,
    fatigueScore: "ok",
    inline_link_clicks: 20,
    any_ad_active: true,
    ad_names: [displayName],
    underlying_creative_ids: ["creative-1"],
    reasons: ["name"],
    ...overrides,
  };
}
