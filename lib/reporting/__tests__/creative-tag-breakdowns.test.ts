import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildCreativeTagBreakdowns,
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
        assignment("Offer Static", "visual_format", "Headline"),
        assignment("Offer Static", "visual_format", "Offer-first banner"),
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
