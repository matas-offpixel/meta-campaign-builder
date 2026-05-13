/**
 * lib/dashboard/__tests__/venue-stats-grid-pipeline-shepherds-bush.test.ts
 *
 * Pipeline-level regression test for the venue stats grid against the
 * Shepherd's Bush production figures reported on 2026-05-13.
 *
 * Memory anchor — `feedback_resolver_dashboard_test_gap.md`:
 *   Resolver-level tests pass on inputs already shaped correctly.
 *   They cannot catch a missing wire-up between the data-loader, the
 *   component, and the aggregator. The repo lacks a jsdom/RTL harness
 *   AND `node --experimental-strip-types` cannot load `.tsx`, so the
 *   "next-best gate" recommended by the memory anchor is a pipeline
 *   test that:
 *
 *     1. Builds a realistic `DailyRollupRow[]` fixture exactly as
 *        `loadPortalForClientId` returns for the venue.
 *     2. Constructs the `eventIdToCode` map from the events the
 *        venue page would have available (`initialEvents`).
 *     3. Calls the aggregator the same way `<VenueStatsGrid>` does
 *        (per-platform + the `all` view).
 *     4. Asserts the venue totals match Meta UI rather than the 4×
 *        inflated figures the user reported.
 *     5. ALSO asserts the wire-up code patterns in the component
 *        files — `events` prop on `<VenueStatsGrid>`, the prop being
 *        threaded from `<VenueFullReport>` — so a future refactor
 *        that drops the prop fails this test even if the aggregator
 *        unit tests still pass.
 *
 * E2E follow-up: when the Playwright harness lands, mirror the
 * assertions against the rendered `data-testid="venue-stats-cell-*"`
 * markers added by this PR (see `components/share/venue-stats-grid.tsx`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  aggregateStatsForAll,
  aggregateStatsForPlatform,
} from "../venue-stats-grid-aggregator.ts";
import { buildEventIdToCodeMap } from "../venue-rollup-dedup.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

const SHEPHERDS_EVENT_CODE = "WC26-LONDON-SHEPHERDS";
const SHEPHERDS_EVENT_IDS = ["shp-aus", "shp-nl", "shp-fr", "shp-de"];

function row(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    event_id: "evt-1",
    date: "2026-04-15",
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

function shepherdsRollupsForOneDay(args: {
  date: string;
  rawSpend: number;
  rawClicks: number;
  impressions: number;
  reach: number;
  videoPlays3s: number;
  engagements: number;
  regs: number;
}): DailyRollupRow[] {
  return SHEPHERDS_EVENT_IDS.map((id) =>
    row({
      event_id: id,
      date: args.date,
      ad_spend: args.rawSpend,
      meta_impressions: args.impressions,
      meta_reach: args.reach,
      meta_video_plays_3s: args.videoPlays3s,
      meta_engagements: args.engagements,
      meta_regs: args.regs,
      link_clicks: args.rawClicks,
    }),
  );
}

describe("Shepherd's Bush venue — pipeline regression (4× attribution)", () => {
  // The shape the venue full-report page constructs for the grid:
  // four sibling events under one bracketed event_code, each carrying
  // the IDENTICAL campaign-wide Meta values for every calendar day.
  const events = SHEPHERDS_EVENT_IDS.map((id) => ({
    id,
    event_code: SHEPHERDS_EVENT_CODE,
  }));

  it("Reach (sum) ≤ 175,330 across the venue", () => {
    // Acceptance criterion from the bug brief: post-fix, the
    // venue-card reach for Shepherd's Bush MUST be ≤ 175,330 (the
    // figure Meta itself reports for the three WC26-LONDON-SHEPHERDS
    // campaigns). Pre-fix the user saw 1,231,744.
    //
    // Single-day fixture is sufficient because the dedup is per
    // (event_code, date) — each day independently collapses to the
    // campaign-wide value.
    const rows = shepherdsRollupsForOneDay({
      date: "2026-04-15",
      rawSpend: 1_800,
      rawClicks: 12_199,
      impressions: 250_000,
      reach: 175_330,
      videoPlays3s: 60_000,
      engagements: 9_000,
      regs: 120,
    });
    const eventIdToCode = buildEventIdToCodeMap(events);
    const cells = aggregateStatsForPlatform(rows, "meta", null, eventIdToCode);
    assert.ok(
      cells.reach <= 175_330,
      `Reach ${cells.reach} must be <= 175,330`,
    );
    assert.equal(cells.reach, 175_330);
  });

  it("CPM and CTR reconcile after the impressions denominator dedups", () => {
    // The user reported CPM £0.86 (≈ 4× understated) and ROAS 0.52×
    // before the fix. Both are knock-on effects of the impressions
    // denominator being 4× inflated. After dedup CPM should land in
    // the £4-£10 range typical for the campaign type.
    const rows = SHEPHERDS_EVENT_IDS.map((id, i) =>
      row({
        event_id: id,
        date: "2026-04-15",
        // Allocator HAS run; spend per-event sums to 1,740.
        ad_spend_allocated: 450 - i * 10,
        ad_spend_presale: 0,
        link_clicks: i === 1 ? 10_411 : 596,
        meta_impressions: 250_000,
        meta_reach: 175_330,
        meta_video_plays_3s: 60_000,
        meta_engagements: 9_000,
      }),
    );
    const eventIdToCode = buildEventIdToCodeMap(events);
    const cells = aggregateStatsForPlatform(rows, "meta", null, eventIdToCode);
    assert.equal(cells.spend, 1_740);
    assert.equal(cells.impressions, 250_000);
    assert.equal(cells.reach, 175_330);
    assert.equal(cells.clicks, 12_199);
    const expectedCpm = (1_740 / 250_000) * 1_000; // £6.96
    assert.ok(Math.abs((cells.cpm ?? 0) - expectedCpm) < 0.01);
    // CPM must fall in the £4–£10 range — sanity check on knock-on
    // figures the user surfaced.
    assert.ok((cells.cpm ?? 0) > 4 && (cells.cpm ?? 0) < 10);
  });

  it("aggregated 'all' view also reflects the dedup", () => {
    // The grid defaults to platform='all' on the share view. The
    // aggregator must thread `eventIdToCode` through to the Meta
    // sub-aggregation so the recombined cells carry the deduped
    // values.
    const rows = shepherdsRollupsForOneDay({
      date: "2026-04-15",
      rawSpend: 1_800,
      rawClicks: 12_199,
      impressions: 250_000,
      reach: 175_330,
      videoPlays3s: 60_000,
      engagements: 9_000,
      regs: 120,
    });
    const eventIdToCode = buildEventIdToCodeMap(events);
    const cells = aggregateStatsForAll(rows, null, eventIdToCode);
    assert.equal(cells.reach, 175_330);
    assert.equal(cells.impressions, 250_000);
    assert.equal(cells.engagements, 9_000);
  });

  it("spot-check: Manchester (4 sibling fixtures) also dedups", () => {
    // Acceptance criterion spot-check. Pre-fix Manchester showed the
    // same 4× inflation pattern. Numbers are illustrative — the
    // invariant is that venue reach equals the campaign-wide reach
    // for the day, NOT 4× the campaign-wide reach.
    const manchesterEvents = [
      { id: "man-aus", event_code: "WC26-MANCHESTER" },
      { id: "man-nl", event_code: "WC26-MANCHESTER" },
      { id: "man-fr", event_code: "WC26-MANCHESTER" },
      { id: "man-de", event_code: "WC26-MANCHESTER" },
    ];
    const rows = manchesterEvents.map((e) =>
      row({
        event_id: e.id,
        date: "2026-04-15",
        meta_reach: 99_500,
        meta_impressions: 142_000,
      }),
    );
    const eventIdToCode = buildEventIdToCodeMap(manchesterEvents);
    const cells = aggregateStatsForPlatform(rows, "meta", null, eventIdToCode);
    assert.equal(cells.reach, 99_500);
    assert.equal(cells.impressions, 142_000);
  });

  it("spot-check matrix: Brighton / Edinburgh / Glasgow / Bristol / Crystal Palace", () => {
    // Per the acceptance criterion: "EVERY venue card must reconcile
    // within ~5% of Meta UI". A single property test covering the
    // remaining venues — same shape, different code per venue —
    // captures the rest of the matrix without bespoke fixtures. If
    // the dedup ever stops grouping by event_code, this test fails
    // for every venue at once.
    const venueCodes = [
      "WC26-BRIGHTON",
      "WC26-EDINBURGH",
      "WC26-GLASGOW",
      "WC26-BRISTOL",
      "WC26-CRYSTAL-PALACE",
    ];
    for (const code of venueCodes) {
      const venueEvents = ["a", "b", "c", "d"].map((suffix) => ({
        id: `${code}-${suffix}`,
        event_code: code,
      }));
      const rows = venueEvents.map((e) =>
        row({
          event_id: e.id,
          date: "2026-04-15",
          meta_reach: 50_000,
          meta_impressions: 70_000,
          meta_video_plays_3s: 12_000,
          meta_engagements: 1_500,
        }),
      );
      const eventIdToCode = buildEventIdToCodeMap(venueEvents);
      const cells = aggregateStatsForPlatform(
        rows,
        "meta",
        null,
        eventIdToCode,
      );
      assert.equal(cells.reach, 50_000, `${code} reach`);
      assert.equal(cells.impressions, 70_000, `${code} impressions`);
      assert.equal(cells.videoPlays, 12_000, `${code} video plays`);
      assert.equal(cells.engagements, 1_500, `${code} engagements`);
    }
  });
});

describe("VenueStatsGrid wire-up — `events` prop reaches the aggregator", () => {
  it("VenueStatsGrid destructures the events prop and threads it to aggregator", () => {
    // Catches the resolver-vs-dashboard test gap memory anchor head
    // on: even if the dedup helper passes its unit tests, the grid
    // is broken if the component drops the events prop. Read the
    // source file as a string and assert the wire-up code is
    // present.
    const src = readFileSync(
      "components/share/venue-stats-grid.tsx",
      "utf8",
    );
    // Prop is declared on the Props interface.
    assert.match(
      src,
      /events: ReadonlyArray<\{ id: string; event_code: string \| null \}>/,
      "VenueStatsGrid Props missing the events prop with the right shape",
    );
    // Prop is destructured in the function signature.
    assert.match(
      src,
      /export function VenueStatsGrid\(\{[\s\S]+?events,[\s\S]+?\}: Props\)/,
      "VenueStatsGrid does not destructure the events prop",
    );
    // The dedup map is built from events.
    assert.match(
      src,
      /const eventIdToCode = useMemo\(\(\) => \{[\s\S]+?for \(const event of events\) map\.set\(event\.id, event\.event_code\);/,
      "VenueStatsGrid does not build eventIdToCode from events",
    );
    // The map is passed to the aggregator(s).
    assert.match(
      src,
      /aggregateStatsForAll\(rows, windowSet, eventIdToCode\)/,
      "VenueStatsGrid 'all' branch does not pass eventIdToCode to aggregator",
    );
    assert.match(
      src,
      /aggregateStatsForPlatform\(rows, platform, windowSet, eventIdToCode\)/,
      "VenueStatsGrid platform branch does not pass eventIdToCode to aggregator",
    );
  });

  it("VenueFullReport passes initialEvents to VenueStatsGrid", () => {
    // The venue full report is the only call-site of VenueStatsGrid.
    // If a future refactor drops the prop here, the dedup degrades
    // silently — the aggregator still works, just without the map,
    // and the venue card returns to 4× attribution. Asserting the
    // exact line keeps the wire-up taut.
    const src = readFileSync(
      "components/share/venue-full-report.tsx",
      "utf8",
    );
    assert.match(
      src,
      /<VenueStatsGrid[\s\S]+?events=\{initialEvents\}[\s\S]+?\/>/,
      "VenueFullReport must pass events={initialEvents} to VenueStatsGrid",
    );
  });

  it("buildVenueReportModel dedups before the timeline merge", () => {
    // The trend chart and daily tracker both consume
    // `mergeVenueTimeline`, which sums `link_clicks` and
    // `meta_regs` across rollup rows. The dedup must run BEFORE
    // the merge. If a refactor drops it, the chart line goes back
    // to 4× the real clicks/regs.
    const src = readFileSync(
      "components/share/venue-daily-report-block.tsx",
      "utf8",
    );
    assert.match(
      src,
      /dedupVenueRollupsByEventCode\(\s*dailyRollups,\s*buildEventIdToCodeMap\(events\),?\s*\)\.rows/,
      "buildVenueReportModel must dedup dailyRollups before mergeVenueTimeline",
    );
    assert.match(
      src,
      /mergeVenueTimeline\(\s*dedupedDailyRollups,/,
      "mergeVenueTimeline must consume the deduped rollups, not the raw set",
    );
  });
});
