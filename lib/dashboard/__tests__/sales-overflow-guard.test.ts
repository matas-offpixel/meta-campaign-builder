/**
 * MB1 (docs/design-record/2026-11-14-dashboard-v2-phone.html): nothing wider
 * than the phone. The layout check itself runs in a browser in CI
 * (scripts/plan-frames/overflow-guard.mjs); these keep its inputs honest.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DASHBOARD_V2_FRAMES } from "../../../scripts/plan-frames/dashboard-v2-ids.ts";
import { NX_SALES_LIVE_LIKE, NX_SALES_LIVE_LIKE_MIXED } from "../sales-vs-spend-fixture.ts";

describe("MB1 overflow guard", () => {
  it("checks the internal page and the share link at 320, 375, 390 and 430, in CI", () => {
    const guard = readFileSync("scripts/plan-frames/overflow-guard.mjs", "utf8");
    assert.match(guard, /OVERFLOW_WIDTHS = \[320, 375, 390, 430\]/);
    assert.match(guard, /OVERFLOW_FRAMES = \["sales\/MBO", "sales\/MBS"/);
    // MB2: the first-screen budgets, 375 × 548, 390 × 664 and 430 × 739.
    assert.match(guard, /width: 375, height: 548/);
    assert.match(guard, /width: 390, height: 664/);
    assert.match(guard, /width: 430, height: 739/);
    assert.equal(DASHBOARD_V2_FRAMES.MBO.surface, "internal");
    assert.equal(DASHBOARD_V2_FRAMES.MBS.surface, "share");
    assert.equal(DASHBOARD_V2_FRAMES.MBO.fixture, "live-mixed");
    assert.equal(DASHBOARD_V2_FRAMES.MBS.fixture, "live-mixed");
    // Design's note on #1232: All venues (three grouped chip rows) is in the guard too.
    assert.match(guard, /"sales\/MBA"/);
    assert.equal(DASHBOARD_V2_FRAMES.MBA.venueKey, "all");
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    assert.match(ci, /node scripts\/plan-frames\/overflow-guard\.mjs/);
  });

  it("the live-like fixture has the live page's widest rows", () => {
    const venues = NX_SALES_LIVE_LIKE.venues!.filter((v) => v.liveShows > 0);
    assert.equal(venues.length + 1, 4, "three venues plus All venues");
    const nx = venues.find((v) => v.key === "nx newcastle")!;
    const shows = nx.shows.filter((c) => c.kind === "show");
    // MBV1's row: eight NX shows and the umbrella.
    assert.equal(shows.length, 8);
    assert.equal(nx.shows.filter((c) => c.kind === "umbrella").length, 1);
    assert.ok(shows.some((c) => c.narrow === "Interplanetary Criminal" && c.wide === "Interplanetary Criminal · 21 Nov"));
    const view = NX_SALES_LIVE_LIKE.views["venue:nx newcastle"];
    assert.ok(view.spendTotal!.amount >= 10_000, "a five-figure spend");
    // The guard's frames use the mixed-count rows: the longest header sentence.
    assert.match(NX_SALES_LIVE_LIKE_MIXED.views["venue:nx newcastle"].header!.sentence, /on spend to each show's last count \(latest 12 Nov\)/);
  });

  it("the frames put the section in a flex column, as the pages do, so the bug can show", () => {
    assert.match(readFileSync("components/dashboard/sales/frame-mount.tsx", "utf8"), /className="relative flex flex-col bg-background"/);
  });

  it("the section fills its column and every scrolling row has min-w-0", () => {
    const src = readFileSync("components/dashboard/sales/sales-dashboard.tsx", "utf8");
    assert.match(src, /<section className="mx-auto w-full min-w-0 max-w-6xl/);
    const chart = readFileSync("components/dashboard/sales/phone-chart.tsx", "utf8");
    // Plain and template-literal classes alike.
    const rows = [...src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g), ...chart.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)]
      .map((m) => m[1] ?? m[2])
      .filter((cls) => /(^|\s)overflow-x-auto(\s|$)/.test(cls));
    assert.ok(rows.length >= 5, String(rows.length));
    for (const row of rows) assert.match(row, /min-w-0/, row);
  });
});
