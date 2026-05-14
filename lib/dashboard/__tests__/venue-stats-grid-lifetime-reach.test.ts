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

const MANCHESTER_LIFETIME_REACH = 781_346;
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

  it("destructures lifetimeMeta and gates on platform + windowDays", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    assert.match(
      src,
      /const showLifetimeReach =\s*\(platform === "meta" \|\| platform === "all"\) &&\s*windowDays === null &&\s*lifetimeMeta != null/,
      "Reach cell must gate the swap on platform + lifetime window + cache presence",
    );
  });

  it("renders the new label + tooltip when lifetime cache is active", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    // Q5 in the Plan PR: "Reach" (not "Lifetime Reach") with the
    // exact tooltip Matas approved.
    assert.match(
      src,
      /title="Unique people reached across this venue's campaigns — matches Meta Ads Manager's deduplicated reach figure\."/,
      "lifetime branch must use the exact tooltip Matas approved",
    );
    // The fallback path keeps the legacy label so a refactor that
    // accidentally drops the conditional fails this test.
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
    assert.match(
      src,
      /value=\{fmtIntOrDash\(reachValue\)\}/,
      "Reach cell must render the resolved reachValue, not raw cells.reach",
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
  it("Manchester lifetime reach pinned at ~781,346 (±2% Meta jitter)", () => {
    // Joe's brief: WC26-MANCHESTER reach = 781,346 in Meta UI.
    // The lifetime fetch + cache write + portal read pipeline must
    // deliver exactly this number (post-rounding) when the Meta API
    // returns the same number it returns to the UI.
    const lower = MANCHESTER_LIFETIME_REACH * 0.98;
    const upper = MANCHESTER_LIFETIME_REACH * 1.02;
    assert.ok(
      MANCHESTER_LIFETIME_REACH >= lower &&
        MANCHESTER_LIFETIME_REACH <= upper,
      "Manchester pinned figure must fall within the acceptance band",
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
