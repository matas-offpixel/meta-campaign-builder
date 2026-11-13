import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { NX_SALES_FIXTURE } from "../sales-vs-spend-fixture.ts";
import {
  LIBRARY_OPENS,
  MISSING_CAPACITY,
  MISSING_CAPACITY_SHORT,
  NO_TICKET_COUNTS,
  SALES_METRICS,
  SALES_PERIODS,
  keepDate,
  planAxes,
  salesForSurface,
  slicePoints,
  visibleShows,
  type SalesCampaignRow,
  type SalesDashboardModel,
} from "../sales-vs-spend.ts";

describe("sales vs spend layout contract", () => {
  it("names twelve metrics and keeps Spend and Total sold as the default pair", () => {
    assert.equal(SALES_METRICS.length, 12);
    assert.equal(NX_SALES_FIXTURE.views.ipc.tiles.length, 12);
    assert.deepEqual(
      NX_SALES_FIXTURE.views.ipc.tiles.map((tile) => tile.id),
      SALES_METRICS.map((metric) => metric.id),
    );
  });

  it("uses the record's 12 Nov NX words and never a default capacity", () => {
    const ipc = NX_SALES_FIXTURE.views.ipc;
    assert.equal(ipc.title, "Interplanetary Criminal · NX Newcastle");
    assert.equal(ipc.subtitle, "Sat 21 Nov · allocation 1,500");
    assert.equal(ipc.umbrellaLine, "Separate NX umbrella spend £640");
    assert.equal(ipc.tiles.find((tile) => tile.id === "spend")?.value, "£2,060");
    assert.equal(ipc.tiles.find((tile) => tile.id === "sold")?.detail, "Internal Counts, 12 Nov · plus 64 comps");
    assert.equal(ipc.tiles.find((tile) => tile.id === "registrations")?.detail, "signups closed at on-sale");
    assert.equal(NX_SALES_FIXTURE.freshness.find((stamp) => stamp.id === "signups")?.stale, true);
    const locklead = NX_SALES_FIXTURE.views.locklead;
    assert.equal(locklead.trajectory.kind === "single" && locklead.trajectory.missingCapacity, MISSING_CAPACITY);
    assert.equal(locklead.trajectory.kind === "single" && locklead.trajectory.allocation, null);
    assert.equal(locklead.tiles.find((tile) => tile.id === "sold")?.detail, NO_TICKET_COUNTS);
    const all = NX_SALES_FIXTURE.views.all.trajectory;
    assert.equal(all.kind, "all");
    if (all.kind === "all") {
      assert.equal(all.bars.find((bar) => bar.id === "locklead")?.caption, MISSING_CAPACITY_SHORT);
      assert.equal(all.bars.some((bar) => bar.allocation === 2000), false);
    }
    assert.equal(NX_SALES_FIXTURE.views.quiet.trajectory.kind === "single" && NX_SALES_FIXTURE.views.quiet.trajectory.opensAfter, LIBRARY_OPENS);
  });

  it("hides finished shows until Include finished is on", () => {
    assert.equal(visibleShows(NX_SALES_FIXTURE, false).some((chip) => chip.id === "djez"), false);
    const shown = visibleShows(NX_SALES_FIXTURE, true);
    assert.equal(shown.find((chip) => chip.id === "djez")?.finished, true);
  });

  it("indexes when three unit types are picked and uses two axes for two types", () => {
    assert.equal(planAxes(["money", "count"], false).mode, "dual");
    assert.equal(planAxes(["money", "count", "rate"], false).mode, "index");
    assert.equal(planAxes(["money"], true).mode, "index");
    assert.equal(planAxes(["count"], false).mode, "single");
  });

  it("slices the chart back from the last data day and leaves today out", () => {
    const points = NX_SALES_FIXTURE.views.ipc.points;
    assert.equal(points.at(-1)?.day, "2026-11-12");
    assert.equal(slicePoints(points, "14", "2026-11-12").length, 14);
    assert.equal(slicePoints(points, "yesterday", "2026-11-12").length, 1);
    assert.equal(points.some((point) => point.day > "2026-11-12"), false);
    assert.match(points.find((point) => point.estimated)?.estimateNote ?? "", /Estimated between counts on 5 Nov and 12 Nov/);
  });

  it("drops cross-client learnings and the Not linked pill on the share", () => {
    const withLearning: SalesDashboardModel = {
      ...NX_SALES_FIXTURE,
      crossClientNote: "Across other clients, this finish runs cheaper than the pool.",
      reviewLine: "2 campaigns to review",
    };
    const share = salesForSurface(withLearning, "share");
    assert.equal(share.crossClientNote, null);
    assert.equal(share.reviewLine, null);
    const tagged = share.views.ipc.campaigns.find((row) => row.id === "tagged") as SalesCampaignRow;
    assert.equal(tagged.name, "[NX26-IPC] Stories — tagged only");
    assert.equal(tagged.unlinked, false);
    assert.equal(tagged.delivery, "Spending");
    assert.equal(tagged.title.includes("Not linked"), false);
    assert.equal(JSON.stringify(share).includes("Not linked"), false);
    const internal = salesForSurface(withLearning, "internal");
    assert.equal(internal.crossClientNote, withLearning.crossClientNote);
    assert.equal(internal.views.ipc.campaigns.find((row) => row.id === "tagged")?.unlinked, true);
    assert.equal(internal.views.ipc.campaigns.find((row) => row.id === "tagged")?.delivery, "Spending");
  });

  it("sums All shows and names the trajectory fields HD3 fills", () => {
    assert.equal(SALES_PERIODS.find((period) => period.id === "7")?.label, "7 days");
    assert.equal(SALES_PERIODS.find((period) => period.id === "3")?.label, "3 days");
    const all = NX_SALES_FIXTURE.views.all;
    assert.equal(all.tiles.find((tile) => tile.id === "sold")?.value, "2,327");
    assert.notEqual(all.tiles.find((tile) => tile.id === "spend")?.value, "£2,060");
    assert.equal(all.trajectory.kind === "all" && all.trajectory.bars[0]?.label, "IPC · 21 Nov");
    const ipc = NX_SALES_FIXTURE.views.ipc;
    assert.equal(ipc.campaigns.find((row) => row.id === "onsale")?.sinceLaunch, "£3,350");
    assert.equal(ipc.campaigns.find((row) => row.id === "presale")?.sinceLaunch, "£1,980");
    assert.equal(ipc.trajectory.kind === "single" && ipc.trajectory.pace?.fanDay, "2026-11-14");
    assert.equal(ipc.trajectory.kind === "single" && ipc.trajectory.needed?.showDaySold, 1500);
    assert.equal(keepDate("Stopped 6 Nov"), "Stopped 6\u00a0Nov");
  });

  it("404s the live sales routes unless the flag is exactly 1, and keeps the fixture on the frames route", async () => {
    const internalSource = readFileSync("app/(dashboard)/clients/[id]/sales/page.ts", "utf8");
    const shareSource = readFileSync("app/share/client/[token]/sales/page.ts", "utf8");
    const framesSource = readFileSync("components/dashboard/sales/frame-mount.tsx", "utf8");
    assert.equal(internalSource.includes("sales-vs-spend-fixture"), false);
    assert.equal(shareSource.includes("sales-vs-spend-fixture"), false);
    assert.equal(framesSource.includes("sales-vs-spend-fixture"), true);

    const previous = process.env.DASHBOARD_V2_ENABLED;
    function is404(error: unknown) {
      assert.equal(error instanceof Error && "digest" in error ? String(error.digest) : "", "NEXT_HTTP_ERROR_FALLBACK;404");
      return true;
    }
    const load = (source: string, name: string) => {
      const body = source
        .replace(/import\s+\{\s*notFound\s*\}\s+from\s+"next\/navigation";/, "")
        .replace("export default ", "");
      const notFound = () => {
        const error = new Error("NEXT_HTTP_ERROR_FALLBACK;404") as Error & { digest: string };
        error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
        throw error;
      };
      return new Function("notFound", `${body}\nreturn ${name};`)(notFound) as () => null;
    };
    const internal = load(internalSource, "ClientSalesPage");
    const share = load(shareSource, "ShareSalesPage");
    try {
      delete process.env.DASHBOARD_V2_ENABLED;
      await assert.rejects(async () => internal(), is404);
      await assert.rejects(async () => share(), is404);
      process.env.DASHBOARD_V2_ENABLED = "true";
      await assert.rejects(async () => internal(), is404);
      await assert.rejects(async () => share(), is404);
      process.env.DASHBOARD_V2_ENABLED = "1";
      assert.equal(internal(), null);
      assert.equal(share(), null);
    } finally {
      if (previous === undefined) delete process.env.DASHBOARD_V2_ENABLED;
      else process.env.DASHBOARD_V2_ENABLED = previous;
    }
  });

  it("appends the DV shots on their own route, off the shared frames page", () => {
    const shots = readFileSync("scripts/plan-frames/dashboard-v2-shots.mjs", "utf8");
    assert.match(shots, /frame: `sales\/\$\{frame\}`/);
    const runner = readFileSync("scripts/plan-frames/run.mjs", "utf8");
    const line = runner.split("\n").find((row) => row.startsWith("const FRAME_SHOTS"));
    assert.ok(line?.includes("...DRIVE_PICKER_SHOTS, ...DASHBOARD_V2_SHOTS]"));
    const page = readFileSync("app/(dev)/frames/sales/[id]/page.tsx", "utf8");
    const imports = page.split("\n").filter((row) => row.startsWith("import "));
    assert.ok(imports.some((row) => row.includes("SalesFrameMount")));
    assert.equal(imports.some((row) => /footage-frame-mount|caption-facts|node:crypto/.test(row)), false);
    const shared = readFileSync("app/(dev)/frames/[id]/page.tsx", "utf8");
    assert.doesNotMatch(shared, /SalesFrameMount|DASHBOARD_V2/);
  });
});
