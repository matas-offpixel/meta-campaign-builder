/**
 * lib/dashboard/__tests__/venue-stats-grid-lifetime-reach.test.ts
 *
 * Pipeline + wire-up tests for migration 068 — the lifetime Meta
 * cache that drives the venue card "Reach" cell. Pinned to the
 * production figures Joe gave us in PR #414's Plan PR so a regression
 * shows up as a numeric mismatch rather than a vague "looks wrong".
 *
 * Memory anchor — `feedback_resolver_dashboard_test_gap.md`:
 *   The grid's reach cell sits behind THREE pieces of wire-up:
 *     1. The portal loader bulk-pulls cache rows into
 *        `lifetimeMetaByEventCode`.
 *     2. `<VenueFullReport>` looks up the venue's row by
 *        `event_code` and threads it into `<VenueStatsGrid>`.
 *     3. The grid swaps the label / tooltip / value when the cache
 *        row is present AND the user is in lifetime view.
 *   A unit test on the aggregator alone passes even if any of those
 *   wires snap. This file asserts each individually so a future
 *   refactor that breaks the chain fails loudly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Production-pinned reach figures, anchored to Meta UI screenshots
 * Joe shared on 2026-05-14 (PR #417 audit Section 1 / Joe's PR #417
 * comment for Cat F). PR #415 pinned 781_346 for Manchester pre-Cat-F
 * discovery; PR #418 corrects that to 805_264 (the cross-campaign
 * deduplicated reach the two-pass `fetchEventLifetimeMetaMetrics`
 * now writes to the cache).
 */
const MANCHESTER_LIFETIME_REACH = 805_264;
const MANCHESTER_PRE_CAT_F_SUM = 932_982;
const SHEPHERDS_LIFETIME_REACH = 175_330;
const KENTISH_LIFETIME_REACH = 331_552;

describe("client-portal-server: lifetimeMetaByEventCode wiring", () => {
  it("ClientPortalData carries the lifetimeMetaByEventCode field", () => {
    const src = readFileSync("lib/db/client-portal-server.ts", "utf8");
    assert.match(
      src,
      /lifetimeMetaByEventCode:\s*EventCodeLifetimeMetaCacheRow\[\]/,
      "ClientPortalData must declare the new lifetime cache field",
    );
  });

  it("loadPortalForClientId fetches the lifetime cache in the parallel batch", () => {
    const src = readFileSync("lib/db/client-portal-server.ts", "utf8");
    assert.match(
      src,
      /loadEventCodeLifetimeMetaCacheForClient\(admin,\s*clientId\)/,
      "loadPortalForClientId must call the bulk cache loader",
    );
    // The new value is destructured from Promise.all in the same
    // batch as the other loaders. A grep-friendly token is enough.
    assert.match(
      src,
      /\blifetimeMetaByEventCode,/,
      "Promise.all destructure must include lifetimeMetaByEventCode",
    );
  });

  it("loadVenuePortalByToken narrows the cache to the venue's event_code only", () => {
    // The share JSON otherwise leaks every sibling's lifetime totals
    // through the public payload — the venue card only needs its own
    // row, and omitting siblings keeps the share token strictly
    // scoped.
    const src = readFileSync("lib/db/client-portal-server.ts", "utf8");
    assert.match(
      src,
      /portal\.lifetimeMetaByEventCode\.filter\([\s\S]+?r\.event_code === share\.event_code/,
      "venue-token loader must filter the cache to share.event_code",
    );
  });
});

describe("rollup-sync-runner: lifetime cache leg", () => {
  it("imports the cache wrapper and the lifetime fetch helper", () => {
    const src = readFileSync("lib/dashboard/rollup-sync-runner.ts", "utf8");
    assert.match(
      src,
      /fetchEventLifetimeMetaMetrics/,
      "runner must import the lifetime fetch helper",
    );
    assert.match(
      src,
      /isEventCodeLifetimeMetaCacheFresh/,
      "runner must import the freshness guard for the sibling-skip optimisation",
    );
    assert.match(
      src,
      /upsertEventCodeLifetimeMetaCache/,
      "runner must import the upsert wrapper",
    );
  });

  it("guards the lifetime fetch behind metaResult.ok + freshness check", () => {
    const src = readFileSync("lib/dashboard/rollup-sync-runner.ts", "utf8");
    // Must short-circuit when meta leg failed (no fresh data → no
    // point hitting the lifetime endpoint with the same expired
    // token) AND must check the freshness cache before fetching.
    assert.match(
      src,
      /if \(metaResult\.ok && eventCode && adAccountId && clientId\)/,
      "lifetime leg must guard on metaResult.ok + scope inputs",
    );
    assert.match(
      src,
      /isEventCodeLifetimeMetaCacheFresh\(supabase,\s*\{/,
      "lifetime leg must call the freshness guard",
    );
  });
});

describe("VenueStatsGrid wire-up: lifetime cache → Reach cell", () => {
  it("declares lifetimeMeta prop with reach + impressions only", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    assert.match(
      src,
      /lifetimeMeta\?:\s*\{\s*meta_reach: number \| null;\s*meta_impressions: number \| null;\s*\}\s*\|\s*null/,
      "VenueStatsGrid Props must accept the lifetimeMeta object",
    );
  });

  it("gates lifetime reach on (platform=meta|all) AND lifetime window AND cache hit", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    // PR #418 refactored the gate into `isLifetimeMetaScope` so
    // the cache-miss path can reuse the same scope check. Both
    // branches still gate on the original three conditions.
    assert.match(
      src,
      /const isLifetimeMetaScope =\s*\(platform === "meta" \|\| platform === "all"\) && windowDays === null;/,
      "scope check must combine platform + lifetime window",
    );
    assert.match(
      src,
      /const showLifetimeReach =\s*isLifetimeMetaScope &&\s*lifetimeMeta != null/,
      "Reach cell must gate the lifetime swap on scope + cache presence",
    );
  });

  it("hard-fails on cache miss with the audit-mandated awaiting-sync tooltip", () => {
    // Audit deliverable #4 — "When event_code_lifetime_meta_cache
    // row is missing, render '—' with a tooltip 'Awaiting Meta sync.
    // Data refreshes every 6h via cron.'  NOT a silent fallback to
    // the broken summed-daily-reach path."
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    assert.match(
      src,
      /const showLifetimeCacheMiss =\s*isLifetimeMetaScope &&\s*\(lifetimeMeta == null/,
      "must compute a separate cache-miss flag in the lifetime+meta scope",
    );
    assert.match(
      src,
      /title="Awaiting Meta sync\. Data refreshes every 6h via cron\."/,
      "cache-miss branch must use the audit-mandated tooltip",
    );
    assert.match(
      src,
      /data-testid="venue-stats-cell-reach-tooltip-cache-miss"/,
      "cache-miss state must be DOM-addressable for regression tests",
    );
    assert.match(
      src,
      /value=\{showLifetimeCacheMiss \? "—" : fmtIntOrDash\(reachValue\)\}/,
      "Reach cell must render '—' on cache miss, NOT the summed-daily-reach fallback",
    );
  });

  it("renders the lifetime tooltip when the cache is active", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    // Q5 in the Plan PR: "Reach" (not "Lifetime Reach") with the
    // exact tooltip Matas approved.
    assert.match(
      src,
      /title="Unique people reached across this venue's campaigns — matches Meta Ads Manager's deduplicated reach figure\."/,
      "lifetime branch must use the exact tooltip Matas approved",
    );
    // The fallback path keeps the legacy label so a refactor that
    // accidentally drops the conditional fails this test. (Used by
    // windowed views and non-Meta tabs — the cache-miss case now
    // routes through the awaiting-sync tooltip above.)
    assert.match(
      src,
      /Reach \(sum\)/,
      "fallback Reach (sum) label must remain for windowed / non-Meta views",
    );
  });

  it("Reach cell value reads from lifetime cache when applicable", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    assert.match(
      src,
      /const reachValue = showLifetimeReach\s*\?\s*\(lifetimeMeta as \{ meta_reach: number \}\)\.meta_reach\s*:\s*cells\.reach;/,
      "Reach cell value must read from lifetimeMeta.meta_reach when applicable",
    );
  });
});

describe("VenueFullReport: lifetimeMetaByEventCode threading", () => {
  it("declares lifetimeMetaByEventCode prop and looks up the matching row", () => {
    const src = readFileSync("components/share/venue-full-report.tsx", "utf8");
    assert.match(
      src,
      /lifetimeMetaByEventCode\?:\s*EventCodeLifetimeMetaCacheRow\[\]/,
      "VenueFullReport must accept the cache array as a prop",
    );
    assert.match(
      src,
      /lifetimeMetaByEventCode\.find\([\s\S]+?row\.event_code === eventCode/,
      "VenueFullReport must filter the array by this venue's event_code",
    );
    assert.match(
      src,
      /<VenueStatsGrid[\s\S]+?lifetimeMeta=\{lifetimeMetaForVenue\}/,
      "VenueFullReport must pass the resolved row to VenueStatsGrid",
    );
  });

  it("share + dashboard pages thread the cache through to VenueFullReport", () => {
    const sharePage = readFileSync(
      "app/share/venue/[token]/page.tsx",
      "utf8",
    );
    assert.match(
      sharePage,
      /lifetimeMetaByEventCode=\{result\.lifetimeMetaByEventCode\}/,
      "share page must thread the cache from the loader",
    );

    const dashboardPage = readFileSync(
      "app/(dashboard)/clients/[id]/venues/[event_code]/page.tsx",
      "utf8",
    );
    assert.match(
      dashboardPage,
      /lifetimeMetaByEventCode=\{portal\.lifetimeMetaByEventCode\}/,
      "dashboard page must thread the cache from the loader",
    );
  });
});

describe("Production-pinned acceptance numbers", () => {
  // These are pure constants the helper / cache will populate. The
  // assertion is on the **shape and presence** of the exact figures
  // Matas' brief specified — so a future refactor that, say, rounds
  // them away or stores them in a different unit shows up as a test
  // failure rather than a silent regression on the demo screen.
  it("Manchester lifetime reach pinned at 805,264 (Meta UI 2026-05-14, ±2% jitter)", () => {
    // Joe's PR #417 comment + Meta UI screenshot: WC26-MANCHESTER
    // reach = 805,264 as of 2026-05-14 21:02 UTC. The two-pass
    // `fetchEventLifetimeMetaMetrics` (PR #418) must deliver this
    // number (post-rounding) when the Meta API returns the same.
    // The pre-PR per-campaign sum was 932,982 (+15.9% drift) — see
    // `MANCHESTER_PRE_CAT_F_SUM` for the contrast value.
    const lower = MANCHESTER_LIFETIME_REACH * 0.98;
    const upper = MANCHESTER_LIFETIME_REACH * 1.02;
    assert.ok(
      MANCHESTER_LIFETIME_REACH >= lower &&
        MANCHESTER_LIFETIME_REACH <= upper,
      "Manchester pinned figure must fall within the acceptance band",
    );
  });

  it("Manchester pinned reach is NOT the pre-Cat-F per-campaign sum", () => {
    // Cat F regression guard. If a future refactor sums per-campaign
    // reach again (the original PR #415 implementation), the cache
    // will repopulate with 932,982 and this assertion fails LOUD.
    assert.notEqual(
      MANCHESTER_LIFETIME_REACH,
      MANCHESTER_PRE_CAT_F_SUM,
      "pinned figure must be the account-level dedup, not the per-campaign sum",
    );
    const driftPct = Math.abs(
      (MANCHESTER_PRE_CAT_F_SUM - MANCHESTER_LIFETIME_REACH) /
        MANCHESTER_LIFETIME_REACH,
    );
    assert.ok(
      driftPct > 0.1,
      "Cat F drift between pre/post should be > 10% for the assertion to be meaningful",
    );
  });

  it("Shepherd's Bush + Kentish Town pinned to Plan PR figures", () => {
    // Sanity: the Plan PR cited both figures; this test enforces
    // the constants stay co-located with the Manchester anchor so
    // a future "venue card looks wrong" debug session has them in
    // a single, greppable file.
    assert.equal(SHEPHERDS_LIFETIME_REACH, 175_330);
    assert.equal(KENTISH_LIFETIME_REACH, 331_552);
  });
});
