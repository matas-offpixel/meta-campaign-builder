/**
 * Unit tests for the read-time aggregator that powers the internal
 * `/clients/[id]/campaigns` tab.
 *
 * Pin the load-bearing rules:
 *   1. Spend-share allocation: ad-set rows split campaign metaRegs
 *      and estSales by their share of campaign spend.
 *   2. Sibling-event dedup: only the freshest snapshot per event_code
 *      contributes (sibling events would N-count campaigns).
 *   3. Cross-event campaigns inherit the worst child attribution
 *      state.
 *   4. The ⚠️ divergence flag fires for both >3× ratio mismatches
 *      and the capi_missing case (Meta CPA null, est CPA populated).
 *   5. Empty / no-snapshot inputs return an empty list, not a
 *      throw — the table renders an empty state.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCampaignsFromSnapshots,
  isDivergent,
  selectFreshestPerEventCode,
  type CampaignsSnapshotInput,
} from "../campaigns-aggregator.ts";
import {
  computeAttributionState,
  type AttributionClassification,
} from "../attribution-state.ts";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";

function group(overrides: Partial<ConceptGroupRow>): ConceptGroupRow {
  return {
    group_key: overrides.group_key ?? "g1",
    display_name: overrides.display_name ?? "Concept",
    creative_id_count: 1,
    ad_count: 1,
    adsets: [{ id: "as-1", name: "Ad set 1" }],
    campaigns: [{ id: "c-1", name: "Campaign 1" }],
    representative_ad_id: "ad-1",
    representative_thumbnail: null,
    representative_thumbnail_ad_id: null,
    representative_thumbnail_source: { video_id: null, image_hash: null },
    representative_headline: null,
    representative_body_preview: null,
    representative_preview: {
      image_url: null,
      video_id: null,
      instagram_permalink_url: null,
      headline: null,
      body: null,
      call_to_action_type: null,
      link_url: null,
    },
    spend: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    registrations: 0,
    purchases: 0,
    landingPageViews: 0,
    ctr: null,
    cpm: null,
    cpc: null,
    cpr: null,
    cpp: null,
    cplpv: null,
    frequency: null,
    fatigueScore: "ok",
    inline_link_clicks: 0,
    any_ad_active: true,
    ad_names: [],
    underlying_creative_ids: [],
    reasons: [],
    ...overrides,
  };
}

function snapshot(overrides: {
  eventId: string;
  eventCode: string | null;
  fetchedAt?: string;
  groups?: ConceptGroupRow[];
  /** Allow null to test missing-snapshot path. */
  payloadKind?: "ok" | "skip" | null;
}): CampaignsSnapshotInput {
  if (overrides.payloadKind === null) {
    return {
      eventId: overrides.eventId,
      eventCode: overrides.eventCode,
      payload: null,
      fetchedAt: overrides.fetchedAt ?? "2026-05-13T12:00:00.000Z",
    };
  }
  if (overrides.payloadKind === "skip") {
    const skipPayload: ShareActiveCreativesResult = {
      kind: "skip",
      reason: "no_linked_campaigns",
    };
    return {
      eventId: overrides.eventId,
      eventCode: overrides.eventCode,
      payload: skipPayload,
      fetchedAt: overrides.fetchedAt ?? "2026-05-13T12:00:00.000Z",
    };
  }
  const okPayload: ShareActiveCreativesResult = {
    kind: "ok",
    groups: overrides.groups ?? [],
    ad_account_id: "act_1",
    event_code: overrides.eventCode ?? "",
    fetched_at: overrides.fetchedAt ?? "2026-05-13T12:00:00.000Z",
    meta: {
      campaigns_total: 1,
      campaigns_failed: 0,
      ads_fetched: 0,
      dropped_no_creative: 0,
      truncated: false,
      unattributed: {
        ads_count: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        inline_link_clicks: 0,
        landingPageViews: 0,
        registrations: 0,
        purchases: 0,
      },
    },
  };
  return {
    eventId: overrides.eventId,
    eventCode: overrides.eventCode,
    payload: okPayload,
    fetchedAt: overrides.fetchedAt ?? "2026-05-13T12:00:00.000Z",
  };
}

describe("selectFreshestPerEventCode", () => {
  it("picks the most-recent snapshot per event_code (sibling dedup)", () => {
    const snaps = [
      snapshot({
        eventId: "e1",
        eventCode: "WC26-MANCHESTER",
        fetchedAt: "2026-05-13T10:00:00.000Z",
      }),
      snapshot({
        eventId: "e2",
        eventCode: "WC26-MANCHESTER",
        fetchedAt: "2026-05-13T18:00:00.000Z",
      }),
      snapshot({
        eventId: "e3",
        eventCode: "WC26-BRIGHTON",
        fetchedAt: "2026-05-13T12:00:00.000Z",
      }),
    ];
    const result = selectFreshestPerEventCode(snaps);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((s) => s.eventId).sort(),
      ["e2", "e3"].sort(),
    );
  });

  it("drops snapshots with null event_code", () => {
    const snaps = [
      snapshot({ eventId: "e1", eventCode: null }),
      snapshot({ eventId: "e2", eventCode: "WC26-X" }),
    ];
    const result = selectFreshestPerEventCode(snaps);
    assert.equal(result.length, 1);
    assert.equal(result[0].eventCode, "WC26-X");
  });
});

describe("aggregateCampaignsFromSnapshots", () => {
  it("returns an empty list when no snapshots are supplied", () => {
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [],
      ticketsTrueByEventCode: new Map(),
      attributionByEventCode: new Map(),
    });
    assert.deepEqual(result, []);
  });

  it("returns an empty list when every snapshot is missing / skipped", () => {
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({ eventId: "e1", eventCode: "WC26-X", payloadKind: null }),
        snapshot({ eventId: "e2", eventCode: "WC26-Y", payloadKind: "skip" }),
      ],
      ticketsTrueByEventCode: new Map(),
      attributionByEventCode: new Map(),
    });
    assert.deepEqual(result, []);
  });

  it("aggregates one campaign from a single-event snapshot, distributes adset metaRegs by spend share", () => {
    const groups: ConceptGroupRow[] = [
      group({
        group_key: "g1",
        spend: 600,
        impressions: 60_000,
        clicks: 600,
        registrations: 30,
        adsets: [{ id: "as-A", name: "Ad set A" }],
        campaigns: [{ id: "c-1", name: "Campaign 1" }],
      }),
      group({
        group_key: "g2",
        spend: 200,
        impressions: 20_000,
        clicks: 200,
        registrations: 10,
        adsets: [{ id: "as-B", name: "Ad set B" }],
        campaigns: [{ id: "c-1", name: "Campaign 1" }],
      }),
    ];
    const ticketsTrue = new Map<string, number>([["WC26-MANCHESTER", 800]]);
    const attribution = new Map<string, AttributionClassification>([
      [
        "WC26-MANCHESTER",
        computeAttributionState({ metaRegs: 40, ticketsTrue: 800 }),
      ],
    ]);
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({
          eventId: "e1",
          eventCode: "WC26-MANCHESTER",
          groups,
        }),
      ],
      ticketsTrueByEventCode: ticketsTrue,
      attributionByEventCode: attribution,
    });
    assert.equal(result.length, 1);
    const c = result[0];
    assert.equal(c.campaignId, "c-1");
    assert.equal(c.spend, 800);
    assert.equal(c.impressions, 80_000);
    assert.equal(c.clicks, 800);
    assert.equal(c.metaRegs, 40);
    assert.equal(c.metaCpa, 800 / 40);
    // estSales = ticketsTrue × (campaignSpend / eventTotalSpend)
    //          = 800 × (800 / 800) = 800
    assert.equal(c.estSales, 800);
    assert.equal(c.adSets.length, 2);
    const a = c.adSets.find((x) => x.adSetId === "as-A");
    const b = c.adSets.find((x) => x.adSetId === "as-B");
    assert(a && b);
    // Spend-share split: as-A 75%, as-B 25%
    assert.equal(a!.spend, 600);
    assert.equal(b!.spend, 200);
    // metaRegs split by spend share, NOT raw underlying registrations
    assert.equal(a!.metaRegs, 40 * 0.75);
    assert.equal(b!.metaRegs, 40 * 0.25);
    // estSales also split by spend share
    assert.equal(a!.estSales, 800 * 0.75);
    assert.equal(b!.estSales, 800 * 0.25);
  });

  it("inherits the worst attribution state across child events on a multi-event campaign", () => {
    // Same campaign appears in both Manchester and Brighton.
    // Brighton is over_attributed; Manchester is tracked-green.
    // Campaign badge inherits over_attributed (worst child).
    const sharedCampaign = { id: "c-shared", name: "World Cup 2026" };
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({
          eventId: "e-mcr",
          eventCode: "WC26-MANCHESTER",
          fetchedAt: "2026-05-13T10:00:00.000Z",
          groups: [
            group({
              spend: 100,
              registrations: 10,
              campaigns: [sharedCampaign],
              adsets: [{ id: "as-mcr", name: "Mcr" }],
            }),
          ],
        }),
        snapshot({
          eventId: "e-brn",
          eventCode: "WC26-BRIGHTON",
          fetchedAt: "2026-05-13T11:00:00.000Z",
          groups: [
            group({
              spend: 100,
              registrations: 10,
              campaigns: [sharedCampaign],
              adsets: [{ id: "as-brn", name: "Brn" }],
            }),
          ],
        }),
      ],
      ticketsTrueByEventCode: new Map([
        ["WC26-MANCHESTER", 800],
        ["WC26-BRIGHTON", 1_700],
      ]),
      attributionByEventCode: new Map([
        [
          "WC26-MANCHESTER",
          computeAttributionState({ metaRegs: 700, ticketsTrue: 800 }),
        ],
        [
          "WC26-BRIGHTON",
          computeAttributionState({
            metaRegs: 14_696,
            ticketsTrue: 1_700,
          }),
        ],
      ]),
    });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].eventCodes, [
      "WC26-BRIGHTON",
      "WC26-MANCHESTER",
    ]);
    assert.equal(result[0].attribution.state, "over_attributed");
  });

  it("flags ⚠️ divergence when metaCpa is null (capi_missing) but estCpa is populated (Shepherd's Bush)", () => {
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({
          eventId: "e1",
          eventCode: "WC26-LONDON-SHEPHERDS",
          groups: [
            group({
              spend: 500,
              registrations: 0,
              campaigns: [{ id: "c-shep", name: "Shepherds" }],
            }),
          ],
        }),
      ],
      ticketsTrueByEventCode: new Map([["WC26-LONDON-SHEPHERDS", 61]]),
      attributionByEventCode: new Map([
        [
          "WC26-LONDON-SHEPHERDS",
          computeAttributionState({ metaRegs: 0, ticketsTrue: 61 }),
        ],
      ]),
    });
    assert.equal(result.length, 1);
    const c = result[0];
    assert.equal(c.metaCpa, null);
    assert(c.estCpa != null);
    assert.equal(c.cpaDivergent, true);
    assert.equal(c.attribution.state, "capi_missing");
  });

  it("flags ⚠️ divergence when metaCpa and estCpa differ by > 3× (Brighton)", () => {
    // Brighton over-attribution: Meta says CPA = £0.34 (cheap), real
    // CPA = a lot more.
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({
          eventId: "e-brn",
          eventCode: "WC26-BRIGHTON",
          groups: [
            group({
              spend: 5_000,
              registrations: 14_696,
              campaigns: [{ id: "c-brn", name: "Brighton" }],
            }),
          ],
        }),
      ],
      ticketsTrueByEventCode: new Map([["WC26-BRIGHTON", 1_709]]),
      attributionByEventCode: new Map([
        [
          "WC26-BRIGHTON",
          computeAttributionState({
            metaRegs: 14_696,
            ticketsTrue: 1_709,
          }),
        ],
      ]),
    });
    assert.equal(result.length, 1);
    const c = result[0];
    assert(c.metaCpa != null);
    assert(c.estCpa != null);
    // metaCpa ≈ 0.34, estCpa ≈ 5000 / 1709 ≈ 2.93. Ratio ≈ 8.6×.
    assert.equal(c.cpaDivergent, true);
    assert.equal(c.attribution.state, "over_attributed");
  });

  it("does NOT flag divergence when metaCpa and estCpa are within 3×", () => {
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({
          eventId: "e1",
          eventCode: "WC26-X",
          groups: [
            group({
              spend: 1_000,
              registrations: 100,
              campaigns: [{ id: "c-1", name: "C1" }],
            }),
          ],
        }),
      ],
      ticketsTrueByEventCode: new Map([["WC26-X", 200]]),
      attributionByEventCode: new Map([
        [
          "WC26-X",
          computeAttributionState({ metaRegs: 100, ticketsTrue: 200 }),
        ],
      ]),
    });
    // metaCpa = 1000/100 = 10; estCpa = 1000/200 = 5; ratio = 2× → not divergent.
    assert.equal(result[0].cpaDivergent, false);
  });

  it("dedups sibling events under a shared event_code (only freshest snapshot wins)", () => {
    const sharedCampaign = { id: "c-1", name: "C1" };
    const result = aggregateCampaignsFromSnapshots({
      snapshots: [
        snapshot({
          eventId: "e-1",
          eventCode: "WC26-MANCHESTER",
          fetchedAt: "2026-05-13T10:00:00.000Z",
          groups: [
            group({
              spend: 999,
              registrations: 999,
              campaigns: [sharedCampaign],
            }),
          ],
        }),
        snapshot({
          eventId: "e-2",
          eventCode: "WC26-MANCHESTER",
          fetchedAt: "2026-05-13T18:00:00.000Z",
          groups: [
            group({
              spend: 100,
              registrations: 5,
              campaigns: [sharedCampaign],
            }),
          ],
        }),
      ],
      ticketsTrueByEventCode: new Map([["WC26-MANCHESTER", 1_000]]),
      attributionByEventCode: new Map([
        [
          "WC26-MANCHESTER",
          computeAttributionState({ metaRegs: 5, ticketsTrue: 1_000 }),
        ],
      ]),
    });
    assert.equal(result.length, 1);
    // Only the fresher snapshot's spend (100) contributes.
    assert.equal(result[0].spend, 100);
    assert.equal(result[0].metaRegs, 5);
  });
});

describe("isDivergent", () => {
  it("is true on >3× upward divergence", () => {
    assert.equal(isDivergent(10, 1), true);
  });

  it("is true on >3× downward divergence", () => {
    assert.equal(isDivergent(1, 10), true);
  });

  it("is false on ≤3× divergence", () => {
    assert.equal(isDivergent(3, 1), false);
    assert.equal(isDivergent(1, 3), false);
    assert.equal(isDivergent(2, 1), false);
  });

  it("is true when only metaCpa is populated", () => {
    assert.equal(isDivergent(5, null), true);
  });

  it("is true when only estCpa is populated (Shepherd's Bush case)", () => {
    assert.equal(isDivergent(null, 5), true);
  });

  it("is false when both null", () => {
    assert.equal(isDivergent(null, null), false);
  });

  it("treats NaN / Infinity / non-positive as 'not populated' so single-side cases still flag", () => {
    // Mirrors the capi_missing branch: NaN / Infinity / 0 / negative
    // on one side is functionally the same as null — the surface
    // can't compute a real CPA, so the divergence flag fires when
    // the OTHER side is populated.
    assert.equal(isDivergent(Number.NaN, 5), true);
    assert.equal(isDivergent(5, Number.POSITIVE_INFINITY), true);
    assert.equal(isDivergent(-1, 5), true);
    // Both bad → no divergence to flag.
    assert.equal(isDivergent(Number.NaN, Number.NaN), false);
    assert.equal(isDivergent(0, -1), false);
  });
});
