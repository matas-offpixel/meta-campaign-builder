import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildEventIdToCodeMap,
  dedupVenueRollupsByEventCode,
} from "../venue-rollup-dedup.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

/**
 * Build a fixture row with the same null-stable defaults as
 * `venue-stats-grid-aggregator.test.ts`. Keeping them parallel so a
 * future change to `DailyRollupRow` lights up both test suites
 * together — the dedup helper and the aggregator share the input
 * shape.
 */
function row(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    event_id: "evt-1",
    date: "2026-04-01",
    tickets_sold: null,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    ad_spend_allocated: null,
    revenue: null,
    link_clicks: null,
    meta_regs: null,
    tiktok_clicks: null,
    ad_spend_specific: null,
    ad_spend_generic_share: null,
    ad_spend_presale: null,
    ...overrides,
  };
}

describe("dedupVenueRollupsByEventCode", () => {
  it("collapses 4-sibling WC26 group to 1× the campaign-wide value", () => {
    // Shepherd's Bush in miniature — four sibling events under the
    // WC26-LONDON-SHEPHERDS code, each storing the SAME campaign-wide
    // Meta values for the same calendar day.
    const rows: DailyRollupRow[] = [
      row({
        event_id: "shp-aus",
        date: "2026-04-15",
        meta_impressions: 250_000,
        meta_reach: 175_330,
        meta_video_plays_3s: 60_000,
        meta_engagements: 9_000,
        meta_regs: 120,
      }),
      row({
        event_id: "shp-nl",
        date: "2026-04-15",
        meta_impressions: 250_000,
        meta_reach: 175_330,
        meta_video_plays_3s: 60_000,
        meta_engagements: 9_000,
        meta_regs: 120,
      }),
      row({
        event_id: "shp-fr",
        date: "2026-04-15",
        meta_impressions: 250_000,
        meta_reach: 175_330,
        meta_video_plays_3s: 60_000,
        meta_engagements: 9_000,
        meta_regs: 120,
      }),
      row({
        event_id: "shp-de",
        date: "2026-04-15",
        meta_impressions: 250_000,
        meta_reach: 175_330,
        meta_video_plays_3s: 60_000,
        meta_engagements: 9_000,
        meta_regs: 120,
      }),
    ];
    const map = buildEventIdToCodeMap(
      rows.map((r) => ({
        id: r.event_id,
        event_code: "WC26-LONDON-SHEPHERDS",
      })),
    );
    const { rows: out, diagnostics } = dedupVenueRollupsByEventCode(rows, map);
    let reachSum = 0;
    let impressionsSum = 0;
    let videoSum = 0;
    let engagementsSum = 0;
    let regsSum = 0;
    for (const r of out) {
      reachSum += r.meta_reach ?? 0;
      impressionsSum += r.meta_impressions ?? 0;
      videoSum += r.meta_video_plays_3s ?? 0;
      engagementsSum += r.meta_engagements ?? 0;
      regsSum += r.meta_regs ?? 0;
    }
    assert.equal(reachSum, 175_330, "reach sum collapses to 1× campaign-wide");
    assert.equal(impressionsSum, 250_000);
    assert.equal(videoSum, 60_000);
    assert.equal(engagementsSum, 9_000);
    assert.equal(regsSum, 120);
    assert.equal(diagnostics.groupsCollapsed, 1);
    assert.equal(diagnostics.rowsZeroed, 3);
  });

  it("picks the MAX value when siblings differ (defensive against fetch jitter)", () => {
    // Per PR #410: the rollup-sync runs per-event and Meta's `reach`
    // can drift a few hundred units between the four sibling syncs
    // depending on `fetched_at`. The dedup must take the freshest
    // (highest) reading — same rationale as `resolveLpvByEventIds`.
    const rows: DailyRollupRow[] = [
      row({
        event_id: "a",
        date: "2026-04-15",
        meta_reach: 175_330,
      }),
      row({
        event_id: "b",
        date: "2026-04-15",
        meta_reach: 175_280, // earlier sync caught a slightly lower total
      }),
      row({
        event_id: "c",
        date: "2026-04-15",
        meta_reach: 174_900,
      }),
      row({
        event_id: "d",
        date: "2026-04-15",
        meta_reach: 175_330,
      }),
    ];
    const map = buildEventIdToCodeMap(
      rows.map((r) => ({ id: r.event_id, event_code: "X" })),
    );
    const { rows: out } = dedupVenueRollupsByEventCode(rows, map);
    let reachSum = 0;
    for (const r of out) reachSum += r.meta_reach ?? 0;
    assert.equal(reachSum, 175_330);
  });

  it("preserves per-event allocator output (ad_spend_allocated, presale, link_clicks)", () => {
    // When the allocator HAS run, link_clicks is per-event-correct
    // (allocator overwrites it with the WC26 opponent split or the
    // non-WC26 equal-split). Sum across siblings must equal the venue
    // total — NOT the per-sibling MAX. Same goes for the allocated
    // spend columns.
    const rows: DailyRollupRow[] = [
      row({
        event_id: "a",
        date: "2026-04-15",
        ad_spend_allocated: 100,
        ad_spend_presale: 25,
        link_clicks: 596,
        meta_reach: 175_330,
      }),
      row({
        event_id: "b",
        date: "2026-04-15",
        ad_spend_allocated: 1_500,
        ad_spend_presale: 25,
        link_clicks: 10_411,
        meta_reach: 175_330,
      }),
      row({
        event_id: "c",
        date: "2026-04-15",
        ad_spend_allocated: 100,
        ad_spend_presale: 25,
        link_clicks: 596,
        meta_reach: 175_330,
      }),
      row({
        event_id: "d",
        date: "2026-04-15",
        ad_spend_allocated: 100,
        ad_spend_presale: 25,
        link_clicks: 596,
        meta_reach: 175_330,
      }),
    ];
    const map = buildEventIdToCodeMap(
      rows.map((r) => ({ id: r.event_id, event_code: "X" })),
    );
    const { rows: out } = dedupVenueRollupsByEventCode(rows, map);
    let alloc = 0;
    let presale = 0;
    let clicks = 0;
    let reach = 0;
    for (const r of out) {
      alloc += r.ad_spend_allocated ?? 0;
      presale += r.ad_spend_presale ?? 0;
      clicks += r.link_clicks ?? 0;
      reach += r.meta_reach ?? 0;
    }
    assert.equal(alloc, 1_800, "allocated spend stays per-event SUM");
    assert.equal(presale, 100, "presale stays per-event SUM");
    assert.equal(clicks, 12_199, "post-allocator link_clicks stays SUM");
    assert.equal(reach, 175_330, "campaign-wide reach collapses to MAX");
  });

  it("dedups raw ad_spend + link_clicks when allocator hasn't run", () => {
    // Pre-allocator state: every sibling holds the campaign-wide
    // ad_spend and link_clicks because the Meta leg is the only
    // writer. Dedup falls back to MAX-by-key for both columns.
    const rows: DailyRollupRow[] = [
      row({
        event_id: "a",
        date: "2026-04-15",
        ad_spend: 1_800,
        link_clicks: 12_199,
        meta_reach: 175_330,
      }),
      row({
        event_id: "b",
        date: "2026-04-15",
        ad_spend: 1_800,
        link_clicks: 12_199,
        meta_reach: 175_330,
      }),
    ];
    const map = buildEventIdToCodeMap(
      rows.map((r) => ({ id: r.event_id, event_code: "X" })),
    );
    const { rows: out } = dedupVenueRollupsByEventCode(rows, map);
    let spend = 0;
    let clicks = 0;
    let reach = 0;
    for (const r of out) {
      spend += r.ad_spend ?? 0;
      clicks += r.link_clicks ?? 0;
      reach += r.meta_reach ?? 0;
    }
    assert.equal(spend, 1_800);
    assert.equal(clicks, 12_199);
    assert.equal(reach, 175_330);
  });

  it("does not touch tickets_sold / revenue (per-event by construction)", () => {
    // tickets_sold and revenue come from the ticketing provider and
    // ARE per-event. Dedup must never collapse them — would silently
    // erase 75% of a 4-sibling venue's tickets.
    const rows: DailyRollupRow[] = [
      row({
        event_id: "a",
        date: "2026-04-15",
        tickets_sold: 200,
        revenue: 4_000,
      }),
      row({
        event_id: "b",
        date: "2026-04-15",
        tickets_sold: 350,
        revenue: 7_000,
      }),
      row({
        event_id: "c",
        date: "2026-04-15",
        tickets_sold: 100,
        revenue: 2_000,
      }),
    ];
    const map = buildEventIdToCodeMap(
      rows.map((r) => ({ id: r.event_id, event_code: "X" })),
    );
    const { rows: out } = dedupVenueRollupsByEventCode(rows, map);
    let tickets = 0;
    let revenue = 0;
    for (const r of out) {
      tickets += r.tickets_sold ?? 0;
      revenue += r.revenue ?? 0;
    }
    assert.equal(tickets, 650);
    assert.equal(revenue, 13_000);
  });

  it("treats events with no event_code as ungrouped pass-through", () => {
    // Synthetic event row (no code yet) should never get folded into
    // a group with another event. Bug surface: the WC26-LONDON-ONSALE
    // synthetic event must NOT silently dedup against any real event
    // — it carries its own campaign total which the venue table reads
    // separately.
    const rows: DailyRollupRow[] = [
      row({
        event_id: "synthetic",
        date: "2026-04-15",
        ad_spend: 999,
      }),
      row({
        event_id: "real",
        date: "2026-04-15",
        ad_spend: 100,
      }),
    ];
    const map = new Map<string, string | null>([
      ["synthetic", null],
      ["real", "WC26-X"],
    ]);
    const { rows: out, diagnostics } = dedupVenueRollupsByEventCode(rows, map);
    let spend = 0;
    for (const r of out) spend += r.ad_spend ?? 0;
    assert.equal(spend, 1_099);
    assert.equal(diagnostics.groupsCollapsed, 0);
    assert.equal(diagnostics.rowsUngrouped, 1);
  });

  it("groups by date — different dates dedup independently", () => {
    // Day-by-day aggregation: each (code, date) is its own group.
    // A 4-fixture venue with rollups across 2 days produces 2 groups,
    // each independently MAX'd.
    const rows: DailyRollupRow[] = [
      row({ event_id: "a", date: "2026-04-15", meta_reach: 100 }),
      row({ event_id: "b", date: "2026-04-15", meta_reach: 100 }),
      row({ event_id: "a", date: "2026-04-16", meta_reach: 250 }),
      row({ event_id: "b", date: "2026-04-16", meta_reach: 250 }),
    ];
    const map = buildEventIdToCodeMap([
      { id: "a", event_code: "X" },
      { id: "b", event_code: "X" },
    ]);
    const { rows: out, diagnostics } = dedupVenueRollupsByEventCode(rows, map);
    let reach = 0;
    for (const r of out) reach += r.meta_reach ?? 0;
    assert.equal(reach, 350, "MAX(100) + MAX(250) = 350");
    assert.equal(diagnostics.groupsCollapsed, 2);
  });

  it("preserves null on every sibling when the source had null on every sibling", () => {
    // Empty state — none of the siblings have a Meta value yet (e.g.
    // pre-launch or backfill in progress). Dedup must keep the
    // canonical row's column NULL rather than silently coercing to
    // 0, because the stats grid surfaces "—" for null and "0" for 0
    // and the former is the right empty-state copy.
    const rows: DailyRollupRow[] = [
      row({ event_id: "a", date: "2026-04-15", meta_reach: null }),
      row({ event_id: "b", date: "2026-04-15", meta_reach: null }),
    ];
    const map = buildEventIdToCodeMap([
      { id: "a", event_code: "X" },
      { id: "b", event_code: "X" },
    ]);
    const { rows: out } = dedupVenueRollupsByEventCode(rows, map);
    for (const r of out) assert.equal(r.meta_reach, null);
  });

  it("invariant: scope SUM after dedup ≤ scope SUM before dedup", () => {
    // Property test mirroring PR #410's invariant: dedup MUST shrink
    // (or hold) the venue total — never expand it. Any expansion is
    // a regression in the dedup logic.
    const rows: DailyRollupRow[] = [
      row({ event_id: "a", date: "2026-04-15", meta_reach: 200 }),
      row({ event_id: "b", date: "2026-04-15", meta_reach: 195 }),
      row({ event_id: "c", date: "2026-04-15", meta_reach: 205 }),
      row({ event_id: "d", date: "2026-04-15", meta_reach: 210 }),
    ];
    const before = rows.reduce((s, r) => s + (r.meta_reach ?? 0), 0);
    const map = buildEventIdToCodeMap([
      { id: "a", event_code: "X" },
      { id: "b", event_code: "X" },
      { id: "c", event_code: "X" },
      { id: "d", event_code: "X" },
    ]);
    const { rows: out } = dedupVenueRollupsByEventCode(rows, map);
    const after = out.reduce((s, r) => s + (r.meta_reach ?? 0), 0);
    assert.ok(after <= before, "dedup must never inflate the venue total");
    assert.equal(after, 210, "and equals the MAX of the four siblings");
  });
});
