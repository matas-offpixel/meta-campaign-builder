/**
 * Tests for the sitelink helpers — defaults, validation, and the
 * char-limit enforcement that gates push.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { defaultSitelinkSeeds } from "../sitelink-defaults.ts";
import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchPlan,
  type GoogleSearchPlanTree,
  type GoogleSearchSitelink,
} from "../types.ts";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
} from "../validation.ts";

// ─── Fixtures ────────────────────────────────────────────────────────

function sitelink(overrides: Partial<GoogleSearchSitelink> = {}): GoogleSearchSitelink {
  return {
    id: "sl-1",
    plan_id: "plan-1",
    link_text: "Tickets",
    description1: "Secure your place",
    description2: "Limited availability",
    final_url: null,
    sort_order: 0,
    pushed_resource_name: null,
    created_at: "2026-05-21T00:00:00Z",
    ...overrides,
  };
}

function basePlan(): GoogleSearchPlan {
  return {
    id: "plan-1",
    user_id: "user-1",
    event_id: "evt-1",
    google_ads_account_id: "acct-1",
    name: "Junction 2 Melodic",
    status: "draft",
    total_budget: 500,
    bidding_strategy: "maximize_clicks",
    structure_mode: "single_campaign",
    geo_targets: [],
    geo_target_type: "PRESENCE",
    date_range: null,
    pushed_at: null,
    created_at: "2026-05-21T00:00:00Z",
    updated_at: "2026-05-21T00:00:00Z",
  };
}

function treeWith(sitelinks: GoogleSearchSitelink[]): GoogleSearchPlanTree {
  // Provide one fully-valid campaign + RSA so we isolate sitelink validation
  // from the unrelated campaign/RSA validation errors.
  return {
    plan: basePlan(),
    campaigns: [
      {
        id: "c-1",
        plan_id: "plan-1",
        name: "C1 Brand",
        priority: null,
        monthly_budget: 100,
        daily_budget: null,
        bid_adjustments: {},
        notes: null,
        sort_order: 0,
        pushed_resource_name: null,
        created_at: "2026-05-21T00:00:00Z",
        ad_groups: [
          {
            id: "ag-1",
            campaign_id: "c-1",
            name: "Brand",
            default_cpc: null,
            sort_order: 0,
            pushed_resource_name: null,
            created_at: "2026-05-21T00:00:00Z",
            keywords: [
              {
                id: "kw-1",
                ad_group_id: "ag-1",
                keyword: "junction 2 tickets",
                match_type: "EXACT",
                est_cpc_low: null,
                est_cpc_high: null,
                intent: null,
                notes: null,
                pushed_resource_name: null,
                created_at: "2026-05-21T00:00:00Z",
              },
            ],
            rsas: [
              {
                id: "rsa-1",
                ad_group_id: "ag-1",
                headlines: [
                  { text: "Junction 2 Festival" },
                  { text: "Melodic Stage" },
                  { text: "Get Tickets" },
                ],
                descriptions: [
                  { text: "Tickets limited." },
                  { text: "Don't miss it." },
                ],
                final_url: "https://offpixel.com/j2",
                path1: null,
                path2: null,
                pushed_resource_name: null,
                created_at: "2026-05-21T00:00:00Z",
              },
            ],
          },
        ],
        negatives: [],
      },
    ],
    plan_negatives: [],
    sitelinks,
  };
}

// ─── defaultSitelinkSeeds ────────────────────────────────────────────

describe("defaultSitelinkSeeds", () => {
  it("seeds 4 sitelinks with sensible link_text + NULL final_url so push falls back to the plan URL", () => {
    const seeds = defaultSitelinkSeeds();
    assert.equal(seeds.length, 4);
    assert.deepEqual(
      seeds.map((s) => s.link_text),
      ["Tickets", "Lineup", "Venue Info", "FAQ"],
    );
    for (const seed of seeds) {
      assert.equal(seed.final_url, null, `${seed.link_text} should default to NULL final_url`);
      assert.ok(seed.link_text.length <= GOOGLE_SEARCH_LIMITS.SITELINK_LINK_TEXT_MAX_CHARS);
      if (seed.description1) {
        assert.ok(
          seed.description1.length <= GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS,
        );
      }
      if (seed.description2) {
        assert.ok(
          seed.description2.length <= GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS,
        );
      }
    }
  });

  it("uses the event venue name in the Venue Info sitelink when provided", () => {
    const seeds = defaultSitelinkSeeds({ venueName: "Boston Manor Park" });
    const venueSeed = seeds.find((s) => s.link_text === "Venue Info");
    assert.ok(venueSeed);
    assert.equal(venueSeed!.description1, "Boston Manor Park");
  });

  it("truncates a too-long venue name to the 35-char description cap", () => {
    const veryLong = "A".repeat(60);
    const seeds = defaultSitelinkSeeds({ venueName: veryLong });
    const venueSeed = seeds.find((s) => s.link_text === "Venue Info");
    assert.ok(venueSeed);
    assert.ok(
      (venueSeed!.description1 ?? "").length <=
        GOOGLE_SEARCH_LIMITS.SITELINK_DESCRIPTION_MAX_CHARS,
    );
  });

  it("seeds in sort_order 0..3 so the wizard renders them in the expected order", () => {
    const seeds = defaultSitelinkSeeds();
    assert.deepEqual(
      seeds.map((s) => s.sort_order),
      [0, 1, 2, 3],
    );
  });
});

// ─── validation: sitelink char limits ────────────────────────────────

describe("validateGoogleSearchPlan — sitelinks", () => {
  it("flags an over-25-char link_text as a hard error (blocks push)", () => {
    const issues = validateGoogleSearchPlan(
      treeWith([
        sitelink({
          link_text: "A".repeat(26),
        }),
      ]),
    );
    const err = issues.find((i) => i.code === "sitelink_link_text_too_long");
    assert.ok(err, "should flag long link_text");
    assert.equal(err!.severity, "error");
    assert.equal(hasHardErrors(issues), true);
  });

  it("flags an over-35-char description as a hard error (blocks push)", () => {
    const issues = validateGoogleSearchPlan(
      treeWith([
        sitelink({
          description1: "A".repeat(36),
        }),
      ]),
    );
    const err = issues.find((i) => i.code === "sitelink_description_too_long");
    assert.ok(err, "should flag long description");
    assert.equal(err!.severity, "error");
  });

  it("flags an empty link_text as a hard error", () => {
    const issues = validateGoogleSearchPlan(
      treeWith([
        sitelink({
          link_text: "",
        }),
      ]),
    );
    const err = issues.find((i) => i.code === "sitelink_link_text_missing");
    assert.ok(err, "should flag missing link_text");
    assert.equal(err!.severity, "error");
  });

  it("flags an invalid override URL as a hard error", () => {
    const issues = validateGoogleSearchPlan(
      treeWith([
        sitelink({
          final_url: "not-a-url",
        }),
      ]),
    );
    const err = issues.find((i) => i.code === "sitelink_final_url_invalid");
    assert.ok(err, "should flag bad override URL");
    assert.equal(err!.severity, "error");
  });

  it("allows a NULL override URL — push will fall back to the plan URL", () => {
    const issues = validateGoogleSearchPlan(treeWith([sitelink({ final_url: null })]));
    const err = issues.find((i) => i.code === "sitelink_final_url_invalid");
    assert.equal(err, undefined, "NULL override is fine");
  });

  it("emits a soft warning (not a hard error) when sitelink count is below the recommended minimum", () => {
    const issues = validateGoogleSearchPlan(treeWith([sitelink({})]));
    const warn = issues.find((i) => i.code === "sitelinks_below_minimum");
    assert.ok(warn);
    assert.equal(warn!.severity, "warning");
  });

  it("does not warn when at-or-above the recommended minimum", () => {
    const tree = treeWith([
      sitelink({ id: "sl-1", link_text: "Tickets" }),
      sitelink({ id: "sl-2", link_text: "Lineup" }),
    ]);
    const issues = validateGoogleSearchPlan(tree);
    const warn = issues.find((i) => i.code === "sitelinks_below_minimum");
    assert.equal(warn, undefined);
  });

  it("accepts the 4 auto-generated default sitelinks without error", () => {
    const defaults = defaultSitelinkSeeds({ venueName: "Boston Manor Park" });
    const tree = treeWith(
      defaults.map((d, i) => sitelink({ ...d, id: `sl-${i}`, plan_id: "plan-1" })),
    );
    const sitelinkIssues = validateGoogleSearchPlan(tree).filter((i) =>
      i.code.startsWith("sitelink"),
    );
    assert.equal(
      sitelinkIssues.filter((i) => i.severity === "error").length,
      0,
      `defaults should validate cleanly; got: ${JSON.stringify(sitelinkIssues, null, 2)}`,
    );
  });
});
