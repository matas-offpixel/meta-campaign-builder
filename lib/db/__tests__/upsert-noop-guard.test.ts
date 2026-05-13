// ─────────────────────────────────────────────────────────────────────────────
// Skip-noop guard tests for event-daily-rollups + creative-insight-snapshots.
//
// Run with:  node --experimental-strip-types --test lib/db/__tests__
//
// Each upsert function does a SELECT first, then only writes rows where a
// DATA field actually differs. Timestamps (source_*_at, snapshot_at) are
// intentionally excluded from comparison. These tests verify:
//   1. First write (no existing row) → upsert called
//   2. Identical values → skipped (skipped_noop counter incremented)
//   3. One DATA field changed → upsert called
//   4. Only timestamp differs → skipped (timestamps not compared)
//   5. force / skipIfUnchanged=false → always writes
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  upsertMetaRollups,
  upsertEventbriteRollups,
  upsertAllocatedSpendRollups,
  type MetaUpsertRow,
} from "../event-daily-rollups.ts";

import {
  upsertCreativeSnapshots,
} from "../creative-insight-snapshots.ts";

import type { CreativeInsightRow } from "../../types/intelligence.ts";

// ── mock builder ─────────────────────────────────────────────────────────────

/**
 * Builds a minimal chained Supabase mock that supports two consecutive
 * `from()` calls in sequence: the first is a SELECT (returns `selectData`),
 * the second is an UPSERT (records payload, returns `{ error: null }`).
 *
 * The SELECT builder handles arbitrary depth chains of `.eq()` before `.in()`.
 */
function makeSelectThenUpsertStub(selectData: unknown[]): {
  client: SupabaseClient;
  upserts: unknown[][];
} {
  const upserts: unknown[][] = [];
  let callIndex = 0;

  // A chainable builder: any .eq() returns itself; .in() resolves with selectData.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeEqChain(): any {
    const chain = {
      eq(_col: string, _val: unknown) { return chain; },
      in(_col: string, _vals: unknown[]) {
        return Promise.resolve({ data: selectData, error: null });
      },
    };
    return chain;
  }

  const client = {
    from(_table: string) {
      const idx = callIndex++;
      if (idx === 0) {
        return {
          select(_cols: string) { return makeEqChain(); },
        };
      }
      // UPSERT builder
      return {
        upsert(payload: unknown, _opts: unknown) {
          upserts.push(payload as unknown[]);
          return {
            select(_cols: string) {
              return Promise.resolve({
                data: Array.isArray(payload)
                  ? (payload as unknown[]).map((_, i) => ({ id: String(i) }))
                  : [{ id: "0" }],
                error: null,
              });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, upserts };
}

// ── Meta rollup tests ─────────────────────────────────────────────────────────

describe("upsertMetaRollups – skip-noop guard", () => {
  const BASE_ROW: MetaUpsertRow = {
    date: "2026-01-01",
    ad_spend: 100.0,
    ad_spend_presale: 0,
    link_clicks: 50,
    meta_regs: 5,
    meta_impressions: 1000,
    meta_reach: 800,
    meta_video_plays_3s: 200,
    meta_video_plays_15s: 100,
    meta_video_plays_p100: 50,
    meta_engagements: 30,
  };

  it("first write (no existing row) — upserts the row", async () => {
    const { client, upserts } = makeSelectThenUpsertStub([]);
    const result = await upsertMetaRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE_ROW],
    });
    assert.equal(result.upserted, 1);
    assert.equal(result.skipped_noop, 0);
    assert.equal(upserts.length, 1);
  });

  it("identical values — skips the upsert", async () => {
    const existing = {
      date: BASE_ROW.date,
      ad_spend: BASE_ROW.ad_spend,
      ad_spend_presale: BASE_ROW.ad_spend_presale,
      link_clicks: BASE_ROW.link_clicks,
      meta_regs: BASE_ROW.meta_regs,
      meta_impressions: BASE_ROW.meta_impressions,
      meta_reach: BASE_ROW.meta_reach,
      meta_video_plays_3s: BASE_ROW.meta_video_plays_3s,
      meta_video_plays_15s: BASE_ROW.meta_video_plays_15s,
      meta_video_plays_p100: BASE_ROW.meta_video_plays_p100,
      meta_engagements: BASE_ROW.meta_engagements,
    };
    const { client, upserts } = makeSelectThenUpsertStub([existing]);
    const result = await upsertMetaRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE_ROW],
    });
    assert.equal(result.upserted, 0);
    assert.equal(result.skipped_noop, 1);
    assert.equal(upserts.length, 0, "upsert should not be called when data is identical");
  });

  it("one DATA field changed — upserts the row", async () => {
    const existing = {
      date: BASE_ROW.date,
      ad_spend: 99.0, // different
      ad_spend_presale: BASE_ROW.ad_spend_presale,
      link_clicks: BASE_ROW.link_clicks,
      meta_regs: BASE_ROW.meta_regs,
      meta_impressions: BASE_ROW.meta_impressions,
      meta_reach: BASE_ROW.meta_reach,
      meta_video_plays_3s: BASE_ROW.meta_video_plays_3s,
      meta_video_plays_15s: BASE_ROW.meta_video_plays_15s,
      meta_video_plays_p100: BASE_ROW.meta_video_plays_p100,
      meta_engagements: BASE_ROW.meta_engagements,
    };
    const { client, upserts } = makeSelectThenUpsertStub([existing]);
    const result = await upsertMetaRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE_ROW],
    });
    assert.equal(result.upserted, 1);
    assert.equal(result.skipped_noop, 0);
    assert.equal(upserts.length, 1);
  });

  it("only source_meta_at would differ (timestamp) — skips the upsert", async () => {
    // The existing row has all data fields equal; source_meta_at is a timestamp
    // and is NOT in the SELECT or comparison — so this should be treated as noop.
    const existing = {
      date: BASE_ROW.date,
      ad_spend: BASE_ROW.ad_spend,
      ad_spend_presale: BASE_ROW.ad_spend_presale,
      link_clicks: BASE_ROW.link_clicks,
      meta_regs: BASE_ROW.meta_regs,
      meta_impressions: BASE_ROW.meta_impressions,
      meta_reach: BASE_ROW.meta_reach,
      meta_video_plays_3s: BASE_ROW.meta_video_plays_3s,
      meta_video_plays_15s: BASE_ROW.meta_video_plays_15s,
      meta_video_plays_p100: BASE_ROW.meta_video_plays_p100,
      meta_engagements: BASE_ROW.meta_engagements,
      // source_meta_at deliberately omitted from select — not compared
    };
    const { client, upserts } = makeSelectThenUpsertStub([existing]);
    const result = await upsertMetaRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE_ROW],
    });
    assert.equal(result.skipped_noop, 1, "timestamp-only change should be treated as noop");
    assert.equal(upserts.length, 0);
  });

  it("MONEY_TOL — sub-penny difference is treated as identical", async () => {
    const existing = {
      date: BASE_ROW.date,
      ad_spend: 100.004, // within 0.005 tolerance
      ad_spend_presale: BASE_ROW.ad_spend_presale,
      link_clicks: BASE_ROW.link_clicks,
      meta_regs: BASE_ROW.meta_regs,
      meta_impressions: BASE_ROW.meta_impressions,
      meta_reach: BASE_ROW.meta_reach,
      meta_video_plays_3s: BASE_ROW.meta_video_plays_3s,
      meta_video_plays_15s: BASE_ROW.meta_video_plays_15s,
      meta_video_plays_p100: BASE_ROW.meta_video_plays_p100,
      meta_engagements: BASE_ROW.meta_engagements,
    };
    const { client, upserts } = makeSelectThenUpsertStub([existing]);
    const result = await upsertMetaRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE_ROW],
    });
    assert.equal(result.skipped_noop, 1, "sub-penny float diff should be treated as noop");
    assert.equal(upserts.length, 0);
  });
});

// ── Eventbrite rollup tests ───────────────────────────────────────────────────

describe("upsertEventbriteRollups – skip-noop guard", () => {
  it("first write — upserts", async () => {
    const { client, upserts } = makeSelectThenUpsertStub([]);
    const result = await upsertEventbriteRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [{ date: "2026-01-01", tickets_sold: 10, revenue: 500.0 }],
    });
    assert.equal(result.upserted, 1);
    assert.equal(result.skipped_noop, 0);
    assert.equal(upserts.length, 1);
  });

  it("identical values — skips", async () => {
    const { client, upserts } = makeSelectThenUpsertStub([
      { date: "2026-01-01", tickets_sold: 10, revenue: 500.0 },
    ]);
    const result = await upsertEventbriteRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [{ date: "2026-01-01", tickets_sold: 10, revenue: 500.0 }],
    });
    assert.equal(result.skipped_noop, 1);
    assert.equal(upserts.length, 0);
  });

  it("tickets_sold changed — upserts", async () => {
    const { client, upserts } = makeSelectThenUpsertStub([
      { date: "2026-01-01", tickets_sold: 9, revenue: 500.0 },
    ]);
    const result = await upsertEventbriteRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [{ date: "2026-01-01", tickets_sold: 10, revenue: 500.0 }],
    });
    assert.equal(result.upserted, 1);
    assert.equal(upserts.length, 1);
  });
});

// ── Allocated spend rollup tests ──────────────────────────────────────────────

describe("upsertAllocatedSpendRollups – skip-noop guard", () => {
  const BASE: Parameters<typeof upsertAllocatedSpendRollups>[1]["rows"][0] = {
    date: "2026-01-01",
    ad_spend_allocated: 50.0,
    ad_spend_specific: 30.0,
    ad_spend_generic_share: 20.0,
    ad_spend_presale: 0,
  };

  it("first write — upserts", async () => {
    const { client, upserts } = makeSelectThenUpsertStub([]);
    const result = await upsertAllocatedSpendRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE],
    });
    assert.equal(result.upserted, 1);
    assert.equal(upserts.length, 1);
  });

  it("identical values — skips", async () => {
    const { client, upserts } = makeSelectThenUpsertStub([
      {
        date: "2026-01-01",
        ad_spend_allocated: 50.0,
        ad_spend_specific: 30.0,
        ad_spend_generic_share: 20.0,
        ad_spend_presale: 0,
        link_clicks: null,
      },
    ]);
    const result = await upsertAllocatedSpendRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE],
    });
    assert.equal(result.skipped_noop, 1);
    assert.equal(upserts.length, 0);
  });

  it("force:true — always upserts regardless of existing data", async () => {
    // When force=true the SELECT is skipped — first from() call goes to upsert.
    const upserts: unknown[][] = [];
    const client = {
      from(_table: string) {
        return {
          upsert(payload: unknown, _opts: unknown) {
            upserts.push(payload as unknown[]);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await upsertAllocatedSpendRollups(client, {
      userId: "u1",
      eventId: "e1",
      rows: [BASE],
      force: true,
    });
    assert.equal(result.upserted, 1, "force:true should bypass skip-noop guard");
    assert.equal(result.skipped_noop, 0);
    assert.equal(upserts.length, 1);
  });
});

// ── Creative snapshots tests ──────────────────────────────────────────────────

function makeCreativeRow(overrides: Partial<CreativeInsightRow> = {}): CreativeInsightRow {
  return {
    adId: "ad_001",
    adName: "Test Ad",
    status: "ACTIVE",
    campaignId: "camp_1",
    campaignName: "Campaign",
    campaignObjective: "OUTCOME_TRAFFIC",
    adsetId: "adset_1",
    creativeId: "creative_1",
    creativeName: "Creative",
    thumbnailUrl: "https://example.com/thumb.jpg",
    spend: 100.0,
    impressions: 1000,
    clicks: 50,
    ctr: 5.0,
    cpm: 10.0,
    cpc: 2.0,
    frequency: 1.5,
    reach: 800,
    linkClicks: 45,
    purchases: 3,
    registrations: 10,
    cpl: null,
    cpr: null,
    fatigueScore: "ok",
    tags: [],
    ...overrides,
  };
}

/**
 * Creative snapshots need a `.eq().eq().eq().in()` SELECT chain
 * and then a separate `.upsert().select()` on the next `from()` call.
 * Uses the same flexible eq-chain approach as makeSelectThenUpsertStub.
 */
function makeCreativeStub(selectData: unknown[]): {
  client: SupabaseClient;
  upserts: unknown[][];
} {
  // Reuse the same stub — identical query shape.
  return makeSelectThenUpsertStub(selectData);
}

describe("upsertCreativeSnapshots – skip-noop guard", () => {
  it("first write (no existing row) — writes the snapshot", async () => {
    const { client, upserts } = makeCreativeStub([]);
    const result = await upsertCreativeSnapshots({
      supabase: client,
      userId: "u1",
      adAccountId: "act_123",
      datePreset: "last_30d",
      rows: [makeCreativeRow()],
    });
    assert.equal(result.written, 1);
    assert.equal(result.skipped_noop, 0);
    assert.equal(upserts.length, 1);
  });

  it("identical values — skips the write", async () => {
    const row = makeCreativeRow();
    const existing = {
      ad_id: row.adId,
      ad_name: row.adName,
      ad_status: row.status,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      campaign_objective: row.campaignObjective,
      adset_id: row.adsetId,
      creative_id: row.creativeId,
      creative_name: row.creativeName,
      thumbnail_url: row.thumbnailUrl,
      fatigue_score: row.fatigueScore,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      cpm: row.cpm,
      cpc: row.cpc,
      frequency: row.frequency,
      reach: row.reach,
      link_clicks: row.linkClicks,
      purchases: row.purchases,
      registrations: row.registrations,
      cpl: row.cpl,
    };
    const { client, upserts } = makeCreativeStub([existing]);
    const result = await upsertCreativeSnapshots({
      supabase: client,
      userId: "u1",
      adAccountId: "act_123",
      datePreset: "last_30d",
      rows: [row],
    });
    assert.equal(result.skipped_noop, 1, "identical snapshot should be skipped");
    assert.equal(upserts.length, 0);
  });

  it("one metric changed — writes the snapshot", async () => {
    const row = makeCreativeRow();
    const existing = {
      ad_id: row.adId,
      ad_name: row.adName,
      ad_status: row.status,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      campaign_objective: row.campaignObjective,
      adset_id: row.adsetId,
      creative_id: row.creativeId,
      creative_name: row.creativeName,
      thumbnail_url: row.thumbnailUrl,
      fatigue_score: row.fatigueScore,
      spend: 90.0, // different from row.spend = 100
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      cpm: row.cpm,
      cpc: row.cpc,
      frequency: row.frequency,
      reach: row.reach,
      link_clicks: row.linkClicks,
      purchases: row.purchases,
      registrations: row.registrations,
      cpl: row.cpl,
    };
    const { client, upserts } = makeCreativeStub([existing]);
    const result = await upsertCreativeSnapshots({
      supabase: client,
      userId: "u1",
      adAccountId: "act_123",
      datePreset: "last_30d",
      rows: [row],
    });
    assert.equal(result.written, 1);
    assert.equal(upserts.length, 1);
  });

  it("only snapshot_at would differ (timestamp) — skips the write", async () => {
    // snapshot_at is set to new Date() at write time — it will always differ
    // from existing. But we do NOT compare it, so identical-data rows skip.
    const row = makeCreativeRow();
    const existing = {
      ad_id: row.adId,
      ad_name: row.adName,
      ad_status: row.status,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      campaign_objective: row.campaignObjective,
      adset_id: row.adsetId,
      creative_id: row.creativeId,
      creative_name: row.creativeName,
      thumbnail_url: row.thumbnailUrl,
      fatigue_score: row.fatigueScore,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      cpm: row.cpm,
      cpc: row.cpc,
      frequency: row.frequency,
      reach: row.reach,
      link_clicks: row.linkClicks,
      purchases: row.purchases,
      registrations: row.registrations,
      cpl: row.cpl,
      snapshot_at: "2020-01-01T00:00:00.000Z", // old timestamp, not compared
    };
    const { client, upserts } = makeCreativeStub([existing]);
    const result = await upsertCreativeSnapshots({
      supabase: client,
      userId: "u1",
      adAccountId: "act_123",
      datePreset: "last_30d",
      rows: [row],
    });
    assert.equal(result.skipped_noop, 1, "timestamp-only diff should not trigger write");
    assert.equal(upserts.length, 0);
  });

  it("skipIfUnchanged:false — always writes even when data is identical", async () => {
    const row = makeCreativeRow();
    const existing = {
      ad_id: row.adId,
      ad_name: row.adName,
      ad_status: row.status,
      campaign_id: row.campaignId,
      campaign_name: row.campaignName,
      campaign_objective: row.campaignObjective,
      adset_id: row.adsetId,
      creative_id: row.creativeId,
      creative_name: row.creativeName,
      thumbnail_url: row.thumbnailUrl,
      fatigue_score: row.fatigueScore,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      cpm: row.cpm,
      cpc: row.cpc,
      frequency: row.frequency,
      reach: row.reach,
      link_clicks: row.linkClicks,
      purchases: row.purchases,
      registrations: row.registrations,
      cpl: row.cpl,
    };
    // When skipIfUnchanged=false, no SELECT is made — the first from() call
    // goes directly to the upsert path.
    const upserts: unknown[][] = [];
    const client = {
      from(_table: string) {
        return {
          upsert(payload: unknown, _opts: unknown) {
            upserts.push(payload as unknown[]);
            return {
              select(_cols: string) {
                return Promise.resolve({
                  data: [{ id: "0" }],
                  error: null,
                });
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await upsertCreativeSnapshots({
      supabase: client,
      userId: "u1",
      adAccountId: "act_123",
      datePreset: "last_30d",
      rows: [row],
      skipIfUnchanged: false,
    });
    assert.equal(result.written, 1, "skipIfUnchanged:false should always write");
    assert.equal(result.skipped_noop, 0);
    assert.equal(upserts.length, 1);

    void existing; // silence unused-var lint
  });
});
