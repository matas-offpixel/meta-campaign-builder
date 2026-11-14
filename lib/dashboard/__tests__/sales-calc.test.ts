import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collapseCounts } from "../sales-calc/counts.ts";
import {
  buildLibrary,
  buildSeries,
  chartRows,
  liftFor,
  liftsFor,
  periodFigures,
  project,
} from "../sales-calc/figures.ts";
import { buildSalesDashboard } from "../sales-calc/model.ts";
import type { LiftEntry, SalesCalcInput, ShowInput } from "../sales-calc/types.ts";
import { MISSING_CAPACITY, LIBRARY_OPENS, NO_CIRQLIN_PAGE, NO_TICKET_COUNTS, salesForSurface } from "../sales-vs-spend.ts";

function show(over: Partial<ShowInput> & { eventId: string; code: string }): ShowInput {
  return {
    name: over.code,
    showDate: "2026-12-01",
    presaleDate: "2026-10-01",
    capacity: 1000,
    allocation: 1000,
    allocationFromTiers: false,
    isUmbrella: false,
    cirqlinPageId: null,
    linkedCampaignIds: [],
    referenceEventIds: [],
    counts: [],
    finalCount: null,
    ...over,
  };
}

function input(over: Partial<SalesCalcInput>): SalesCalcInput {
  return {
    client: { id: "c1", name: "Client" },
    today: "2026-11-13",
    shows: [],
    metaCampaignDays: [],
    googleCampaignDays: [],
    rollups: [],
    signups: [],
    library: [],
    ...over,
  };
}

const ic = (day: string, sold: number, comps: number | null = null) => ({ day, sold, comps, source: "internal_counts" as const });
const meta = (campaignId: string, campaignName: string, day: string, spend: number, extra: Partial<{ linkClicks: number; landingPageViews: number; initiateCheckouts: number; addsToCart: number }> = {}) => ({
  campaignId,
  campaignName,
  day,
  spend,
  linkClicks: 0,
  landingPageViews: 0,
  initiateCheckouts: 0,
  addsToCart: 0,
  ...extra,
});
const roll = (eventId: string, day: string, m: number | null, tiktok: number | null = null, google: number | null = null) => ({
  eventId,
  day,
  meta: m,
  tiktok,
  google,
  metaSynced: m != null,
  tiktokSynced: tiktok != null,
  googleSynced: google != null,
});

describe("D2 / D12 spend", () => {
  it("takes the larger of the rollup and the platform's own campaigns, per platform per day, then sums", () => {
    const a = show({ eventId: "a", code: "A-1", linkedCampaignIds: ["m1"] });
    const s = buildSeries(
      input({
        shows: [a],
        metaCampaignDays: [meta("m1", "x", "2026-11-10", 80), meta("m1", "x", "2026-11-11", 20)],
        googleCampaignDays: [{ eventCode: "A-1", day: "2026-11-10", spend: 15 }],
        rollups: [roll("a", "2026-11-10", 50, 5, 10), roll("a", "2026-11-11", 30, 0, null)],
      }),
    ).get("a")!;
    assert.deepEqual(s.days.get("2026-11-10")!.byPlatform, { meta: 80, tiktok: 5, google: 15 });
    assert.equal(s.days.get("2026-11-10")!.spend, 100);
    assert.deepEqual(s.days.get("2026-11-11")!.byPlatform, { meta: 30, tiktok: 0, google: 0 });
    assert.deepEqual([...s.platformsWithData].sort(), ["google", "meta", "tiktok"]);
  });

  it("never reads today", () => {
    const a = show({ eventId: "a", code: "A-1", linkedCampaignIds: ["m1"] });
    const s = buildSeries(input({ shows: [a], metaCampaignDays: [meta("m1", "x", "2026-11-13", 999)], rollups: [roll("a", "2026-11-13", 999)] })).get("a")!;
    assert.equal(s.days.size, 0);
  });

  it("a platform with no data isn't listed; a real £0 is", () => {
    const a = show({ eventId: "a", code: "A-1" });
    const s = buildSeries(input({ shows: [a], rollups: [roll("a", "2026-11-10", 10, 0, null)] })).get("a")!;
    assert.deepEqual([...s.platformsWithData].sort(), ["meta", "tiktok"]);
  });
});

describe("D1 campaign mapping", () => {
  it("linked beats tagged, and a tagged-only campaign is flagged not linked", () => {
    const a = show({ eventId: "a", code: "A-1", linkedCampaignIds: ["m1"] });
    const b = show({ eventId: "b", code: "B-2", showDate: "2026-12-05" });
    const series = buildSeries(
      input({ shows: [a, b], metaCampaignDays: [meta("m1", "[B-2] Linked to A", "2026-11-10", 10), meta("m2", "[B-2] On sale", "2026-11-10", 5)] }),
    );
    assert.deepEqual(series.get("a")!.campaigns.map((c) => [c.campaignId, c.unlinked]), [["m1", false]]);
    assert.deepEqual(series.get("b")!.campaigns.map((c) => [c.campaignId, c.unlinked]), [["m2", true]]);
  });
});

describe("D8 counts: one source per show-day", () => {
  it("follows the show's highest automatic source; a manual entry replaces its day", () => {
    const rows = [
      { snapshot_at: "2026-11-01T12:00:00Z", tickets_sold: 400, source: "eventbrite" },
      { snapshot_at: "2026-11-01T12:00:00Z", tickets_sold: 500, source: "internal_counts", comps: 20 },
      { snapshot_at: "2026-11-03T12:00:00Z", tickets_sold: 450, source: "eventbrite" },
      { snapshot_at: "2026-11-05T12:00:00Z", tickets_sold: 600, source: "internal_counts", comps: 22 },
      { snapshot_at: "2026-11-05T09:00:00Z", tickets_sold: 610, source: "manual" },
    ];
    assert.deepEqual(collapseCounts(rows), [
      { day: "2026-11-01", sold: 500, comps: 20, source: "internal_counts" },
      { day: "2026-11-05", sold: 610, comps: null, source: "manual" },
    ]);
  });
});

describe("D4 / D13 period figures", () => {
  const counts = [ic("2026-11-01", 100), ic("2026-11-06", 150), ic("2026-11-11", 200)];
  const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"];
  const a = show({ eventId: "a", code: "A-1", counts });
  const base = input({ shows: [a], rollups: days.map((d) => roll("a", d, 10)) });

  it("a period's sales and cost per ticket cover the same days, ending on the last count (period-calc ticket)", () => {
    const s = buildSeries(base).get("a")!;
    // 3 days to the 11 Nov count: 9–11 Nov. Sold 200 on 11 Nov less 170 on 8 Nov (6→11 Nov's line, 3 of 5 days in).
    const f = periodFigures([s], "3", "2026-11-12");
    assert.deepEqual(f.ticketDays, { from: "2026-11-09", to: "2026-11-11" });
    assert.equal(f.tickets, 30);
    // Spend over the same three days (£10 a day), over those tickets. The 12 Nov spend, after the count, is not in it.
    assert.equal(f.costPerTicket, 30 / 30);
  });

  it("D13a: since launch, spend stops at the latest count", () => {
    const s = buildSeries(base).get("a")!;
    const f = periodFigures([s], "launch", "2026-11-12");
    assert.equal(f.tickets, 200);
    assert.equal(f.costPerTicket, (10 * 10) / 200); // 2–11 Nov, not 12 Nov
    assert.equal(f.spend, 110);
  });

  it("a count dated after the spend date: the period ends on the spend date, its sold read off the line", () => {
    const b = show({ eventId: "b", code: "B-1", counts: [ic("2026-11-10", 0), ic("2026-11-13", 30)] });
    const s = buildSeries(input({ shows: [b], rollups: [roll("b", "2026-11-11", 20), roll("b", "2026-11-12", 20)] })).get("b")!;
    const f = periodFigures([s], "7", "2026-11-12");
    assert.deepEqual(f.ticketDays, { from: "2026-11-06", to: "2026-11-12" });
    assert.equal(f.tickets, 20);
    assert.equal(f.costPerTicket, 40 / 20);
  });

  it("a show that went on sale inside the period counts its first count's tickets (Locklead)", () => {
    const c = show({ eventId: "c", code: "C-1", presaleDate: "2026-11-06", counts: [ic("2026-11-06", 226), ic("2026-11-12", 372)] });
    const s = buildSeries(input({ shows: [c], rollups: days.map((d) => roll("c", d, 10)) })).get("c")!;
    const f = periodFigures([s], "14", "2026-11-12");
    assert.equal(f.tickets, 372);
    // Spend 30 Oct–12 Nov on the show (£10 a day from 2 Nov: 11 days), presale spend before its first count included.
    assert.equal(f.costPerTicket, 110 / 372);
  });

  it("Keep D13: counts on different days, each show's days end on its own last count", () => {
    const a = show({ eventId: "a", code: "A-1", counts: [ic("2026-10-01", 100), ic("2026-11-12", 200)] });
    const b = show({ eventId: "b", code: "B-1", counts: [ic("2026-10-01", 50), ic("2026-11-09", 120)] });
    const both = buildSeries(input({ shows: [a, b], rollups: days.flatMap((d) => [roll("a", d, 10), roll("b", d, 10)]) }));
    const f = periodFigures([both.get("a")!, both.get("b")!], "3", "2026-11-12");
    assert.equal(f.ticketDaysDiffer, true);
    assert.deepEqual(f.ticketDays, { from: "2026-11-10", to: "2026-11-12" });
    // A: 10–12 Nov, £30. B: 7–9 Nov (its own last count), £30; its 10–12 Nov spend is past its count, left out.
    assert.equal(f.spendPastCount, true);
    const aSold = 200 - (100 + (100 * 39) / 42);
    const bSold = 120 - (50 + (70 * 36) / 39);
    assert.ok(Math.abs(f.tickets! - (aSold + bSold)) < 1e-9);
    assert.ok(Math.abs(f.costPerTicket! - 60 / (aSold + bSold)) < 1e-9);
  });

  it("yesterday's sales need a count yesterday", () => {
    const s = buildSeries(base).get("a")!;
    assert.equal(periodFigures([s], "yesterday", "2026-11-12").tickets, null);
    assert.equal(periodFigures([s], "yesterday", "2026-11-11").tickets, 10);
  });

  it("registrations: null without a page; £ per registration only counts spend inside the signup window", () => {
    const noPage = buildSeries(base).get("a")!;
    assert.equal(periodFigures([noPage], "14", "2026-11-12").registrations, null);
    const paged = show({ eventId: "a", code: "A-1", counts, cirqlinPageId: "00000000-0000-4000-8000-000000000001" });
    const s = buildSeries({ ...base, shows: [paged], signups: [{ eventId: "a", day: "2026-11-03", signups: 5 }, { eventId: "a", day: "2026-11-04", signups: 5 }] }).get("a")!;
    const f = periodFigures([s], "launch", "2026-11-12");
    assert.equal(f.registrations, 10);
    assert.equal(f.costPerRegistration, 20 / 10);
    const rows = chartRows([s], "2026-11-12");
    assert.equal(rows.find((r) => r.day === "2026-11-03")!.costPerRegistration, 2);
    assert.equal(rows.find((r) => r.day === "2026-11-08")!.costPerRegistration, null);
  });
});

describe("D13 daily £ per registration (design's fix)", () => {
  const paged = show({ eventId: "a", code: "A-1", cirqlinPageId: "00000000-0000-4000-8000-000000000001" });
  const data = input({
    shows: [paged, show({ eventId: "b", code: "B-1", showDate: "2026-12-05", cirqlinPageId: "00000000-0000-4000-8000-000000000002" })],
    rollups: [roll("a", "2026-11-02", 30), roll("a", "2026-11-03", 0), roll("a", "2026-11-06", 40), roll("b", "2026-11-02", 10)],
    signups: [
      { eventId: "a", day: "2026-11-02", signups: 10 },
      { eventId: "a", day: "2026-11-03", signups: 5 },
      { eventId: "a", day: "2026-11-04", signups: 5 },
      { eventId: "b", day: "2026-11-02", signups: 2 },
    ],
  });

  it("is empty outside the window and on a day with no spend, never £0.00", () => {
    const s = buildSeries(data).get("a")!;
    const rows = new Map(chartRows([s], "2026-11-12").map((r) => [r.day, r]));
    assert.equal(rows.get("2026-11-02")!.costPerRegistration, 3);
    assert.equal(rows.get("2026-11-03")!.costPerRegistration, null);
    assert.equal(rows.get("2026-11-06")!.costPerRegistration, null);
    const build = buildSalesDashboard(data);
    const points = build.model.views["a-1"].points;
    assert.ok(points.every((p) => p.values.costPerRegistration !== 0));
    assert.equal(points.find((p) => p.day === "2026-11-06")!.values.costPerRegistration, null);
  });

  it("All shows has no one signup window, so its daily figure is empty; its period figure stays windowed", () => {
    const build = buildSalesDashboard(data);
    assert.ok(build.model.views.all.points.every((p) => p.values.costPerRegistration == null));
    const tile = build.periods.all.launch.tiles.find((t) => t.id === "costPerRegistration")!;
    assert.equal(tile.value, "£1.82");
    const yesterday = build.periods["a-1"].yesterday.tiles.find((t) => t.id === "costPerRegistration")!;
    assert.equal(yesterday.value, "—");
  });
});

describe("D5 chart", () => {
  it("total sold is a straight line between counts, not drawn before the first count, and the hover names the counts", () => {
    const a = show({ eventId: "a", code: "A-1", presaleDate: "2026-10-30", counts: [ic("2026-11-01", 100), ic("2026-11-05", 140)] });
    const s = buildSeries(input({ shows: [a], rollups: [roll("a", "2026-10-29", 5), roll("a", "2026-11-03", 5)] })).get("a")!;
    const rows = chartRows([s], "2026-11-12");
    // Design's note on #1233: before the first count, Total sold isn't drawn (it was 0 before presale under D5).
    assert.equal(rows.find((r) => r.day === "2026-10-29")!.sold, null);
    assert.equal(rows.find((r) => r.day === "2026-10-31")!.sold, null);
    assert.equal(rows.find((r) => r.day === "2026-11-03")!.sold, 120);
    assert.deepEqual(rows.find((r) => r.day === "2026-11-03")!.estimatedBetween, { from: "2026-11-01", to: "2026-11-05" });
    assert.equal(rows.find((r) => r.day === "2026-11-05")!.count, true);
    assert.equal(rows.find((r) => r.day === "2026-11-03")!.ticketsPerDay, 10);
  });

  it("a finished show ends at show day with its final count", () => {
    const a = show({
      eventId: "a",
      code: "A-1",
      showDate: "2026-11-07",
      counts: [ic("2026-11-01", 100), ic("2026-11-08", 180), ic("2026-11-09", 190)],
      finalCount: { day: "2026-11-09", paid: 190, comps: 40, source: "internal_counts", blockId: "b1" },
    });
    const s = buildSeries(input({ shows: [a], rollups: [roll("a", "2026-11-02", 5), roll("a", "2026-11-10", 5)] })).get("a")!;
    assert.deepEqual(s.counts.map((c) => [c.day, c.sold]), [["2026-11-01", 100], ["2026-11-07", 190]]);
    assert.equal(s.finalDay, "2026-11-09");
    assert.equal(chartRows([s], "2026-11-12").at(-1)!.day, "2026-11-07");
    const build = buildSalesDashboard(input({ shows: [a], rollups: [roll("a", "2026-11-02", 5)] }));
    const sold = build.model.views["a-1"].tiles.find((t) => t.id === "sold")!;
    assert.equal(sold.detail, "to date · Final count · Internal Counts, 9 Nov · plus 40 comps");
  });
});

describe("D6 trajectory", () => {
  it("is capped at the sellable allocation, and needed / short use it", () => {
    const a = show({ eventId: "a", code: "A-1", showDate: "2026-11-22", allocation: 500, counts: [ic("2026-11-02", 100), ic("2026-11-12", 400)] });
    const s = buildSeries(input({ shows: [a] })).get("a")!;
    const p = project(s, { average: 2, best: 3 })!;
    assert.equal(p.pace7, 30);
    assert.equal(p.holds, 500);
    assert.equal(p.best, 500);
    assert.equal(p.neededPerDay, 10);
    assert.equal(p.sellsOutOn, "2026-11-16");
  });

  it("with no capacity says so and draws no line; no default capacity anywhere", () => {
    const a = show({ eventId: "a", code: "A-1", capacity: null, allocation: null, counts: [ic("2026-11-02", 100), ic("2026-11-12", 200)] });
    const build = buildSalesDashboard(input({ shows: [a] }));
    const t = build.model.views["a-1"].trajectory;
    assert.equal(t.kind, "single");
    if (t.kind !== "single") return;
    assert.equal(t.missingCapacity, MISSING_CAPACITY);
    assert.equal(t.allocation, null);
    const all = build.model.views.all.trajectory;
    assert.equal(all.kind === "all" && all.bars[0].allocation, null);
  });

  it("an umbrella has no trajectory, tickets or cost per ticket, and stays out of All shows", () => {
    const a = show({ eventId: "a", code: "A-1", linkedCampaignIds: ["m1"], counts: [ic("2026-11-02", 100), ic("2026-11-12", 200)] });
    const u = show({ eventId: "u", code: "U-1", isUmbrella: true, capacity: null, allocation: null, linkedCampaignIds: ["m2"] });
    const build = buildSalesDashboard(
      input({ shows: [a, u], metaCampaignDays: [meta("m1", "a", "2026-11-10", 100), meta("m2", "u", "2026-11-10", 40)], client: { id: "c1", name: "NX" } }),
    );
    const all = build.model.views.all;
    assert.equal(all.tiles.find((t) => t.id === "spend")!.value, "£100");
    assert.equal(all.umbrellaLine, "Separate NX umbrella spend £40");
    const um = build.model.views["u-1"];
    assert.equal(um.tiles.find((t) => t.id === "spend")!.value, "£40");
    assert.equal(um.tiles.find((t) => t.id === "tickets")!.value, "—");
    assert.equal(um.trajectory.kind === "single" && um.trajectory.cases.length, 0);
  });
});

describe("D10 library", () => {
  const finished = (code: string, counts: ReturnType<typeof ic>[], final: number, comps = 0, allocation: number | null = 2000) =>
    show({
      eventId: code.toLowerCase(),
      code,
      showDate: "2026-10-22",
      allocation,
      capacity: allocation,
      counts,
      finalCount: { day: "2026-10-24", paid: final, comps, source: "internal_counts", blockId: `blk-${code}` },
    });
  const steady = [ic("2026-09-30", 100), ic("2026-10-15", 240)];

  it("lift = final-week rate over the 14 days before, floored at 1, stored with its evidence", () => {
    const s = buildSeries(input({ shows: [finished("F-1", steady, 380, 30)] })).get("f-1")!;
    const out = liftFor(s, "2026-11-13");
    assert.ok(out.ok);
    if (!out.ok) return;
    // D−21 = 1 Oct (≈109.3), D−7 = 15 Oct (240): 9.33 a day before, 20 a day after.
    assert.equal(out.entry.d21Day, "2026-10-01");
    assert.equal(out.entry.d7Sold, 240);
    assert.equal(out.entry.finalPaid, 380);
    assert.equal(out.entry.compsExcluded, 30);
    assert.equal(Number(out.entry.lift.toFixed(4)), Number(((140 / 7) / ((240 - (100 + 140 / 15)) / 14)).toFixed(4)));
    const flat = buildSeries(input({ shows: [finished("F-2", steady, 250)] })).get("f-2")!;
    const f2 = liftFor(flat, "2026-11-13");
    assert.ok(f2.ok && f2.entry.lift === 1);
  });

  it("leaves out a show that sold out before its final week, one with no final count, and one with no count by D−21", () => {
    const soldOut = buildSeries(input({ shows: [finished("S-1", [ic("2026-09-30", 100), ic("2026-10-10", 500)], 500, 0, 500)] })).get("s-1")!;
    assert.deepEqual(liftFor(soldOut, "2026-11-13"), { ok: false, reason: "sold_out_early" });
    const noFinal = buildSeries(input({ shows: [show({ eventId: "n", code: "N-1", showDate: "2026-10-22", counts: steady })] })).get("n")!;
    assert.deepEqual(liftFor(noFinal, "2026-11-13"), { ok: false, reason: "no_final_count" });
    const late = buildSeries(input({ shows: [finished("L-1", [ic("2026-10-05", 100), ic("2026-10-15", 200)], 300)] })).get("l-1")!;
    assert.deepEqual(liftFor(late, "2026-11-13"), { ok: false, reason: "no_counts_by_d21" });
  });

  it("D10: a show is out until it has a count before each interpolation point", () => {
    // D−21 = 1 Oct, D−7 = 15 Oct. First count 2 Oct: nothing before D−21 to interpolate from.
    const noneBefore21 = buildSeries(input({ shows: [finished("A-1", [ic("2026-10-02", 100), ic("2026-10-14", 200)], 300)] })).get("a-1")!;
    assert.deepEqual(liftFor(noneBefore21, "2026-11-13"), { ok: false, reason: "no_counts_by_d21" });
    // A count exactly on D−21 is enough on that side.
    const onD21 = buildSeries(input({ shows: [finished("B-1", [ic("2026-10-01", 100), ic("2026-10-14", 200)], 300)] })).get("b-1")!;
    assert.ok(liftFor(onD21, "2026-11-13").ok);
    // Then a second count lands before D−21: the show comes in.
    const later = buildSeries(input({ shows: [finished("C-1", [ic("2026-09-28", 90), ic("2026-10-02", 100), ic("2026-10-14", 200)], 300)] })).get("c-1")!;
    assert.ok(liftFor(later, "2026-11-13").ok);
  });

  it("D10: a show that reached its allocation before D−7 is out, even when its final is higher", () => {
    const early = buildSeries(input({ shows: [finished("E-1", [ic("2026-09-30", 100), ic("2026-10-12", 1000)], 1000, 0, 1000)] })).get("e-1")!;
    assert.deepEqual(liftFor(early, "2026-11-13"), { ok: false, reason: "sold_out_early" });
    const atTheEnd = buildSeries(input({ shows: [finished("F-9", [ic("2026-09-30", 100), ic("2026-10-15", 600)], 1000, 0, 1000)] })).get("f-9")!;
    assert.ok(liftFor(atTheEnd, "2026-11-13").ok);
  });

  it("a stored entry is used as stored; a new final count is a fresh entry", () => {
    const f = finished("F-1", steady, 380);
    const series = buildSeries(input({ shows: [f] }));
    const stored: LiftEntry = { ...(liftFor(series.get("f-1")!, "2026-11-13") as { ok: true; entry: Omit<LiftEntry, "computedAt"> }).entry, lift: 2.5, computedAt: "2026-11-01T00:00:00Z" };
    const kept = buildLibrary(series, [stored], "2026-11-13");
    assert.equal(kept.entries[0].lift, 2.5);
    assert.equal(kept.fresh.length, 0);
    const changed = buildLibrary(series, [{ ...stored, finalBlockId: "older", finalDay: "2026-10-23" }], "2026-11-13");
    assert.equal(changed.fresh.length, 1);
    assert.notEqual(changed.entries[0].lift, 2.5);
  });

  it("fewer than 2 shows: only Holds, with the opening sentence; an event's own reference set wins", () => {
    const up = show({ eventId: "u", code: "U-1", showDate: "2026-11-30", counts: [ic("2026-11-02", 100), ic("2026-11-12", 200)] });
    const one = buildSalesDashboard(input({ shows: [finished("F-1", steady, 380), up] }));
    const t = one.model.views["u-1"].trajectory;
    assert.ok(t.kind === "single");
    if (t.kind !== "single") return;
    assert.equal(t.opensAfter, LIBRARY_OPENS);
    assert.deepEqual(t.cases.map((c) => c.id), ["holds"]);
    const lib = [
      { eventId: "x", lift: 2 },
      { eventId: "y", lift: 3 },
      { eventId: "z", lift: 5 },
    ] as Omit<LiftEntry, "computedAt">[];
    assert.equal(liftsFor({ ...up, referenceEventIds: [] }, lib).average, 10 / 3);
    assert.equal(liftsFor({ ...up, referenceEventIds: ["x", "y"] }, lib).best?.eventId, "y");
  });
});

describe("words and surfaces", () => {
  const a = show({
    eventId: "a",
    code: "A-1",
    name: "Show A",
    showDate: "2026-11-21",
    allocation: 1500,
    capacity: 1500,
    linkedCampaignIds: ["m1"],
    counts: [ic("2026-11-05", 719, 60), ic("2026-11-12", 812, 64)],
  });
  const data = input({
    client: { id: "c1", name: "NX Newcastle" },
    shows: [a],
    metaCampaignDays: [meta("m1", "[A-1] On Sale", "2026-11-12", 100), meta("m2", "[A-1] Stories", "2026-11-01", 20)],
    rollups: [roll("a", "2026-11-12", 100, 10)],
  });

  it("names the one source on the Sold tile, comps as context; sublines start with their span (N7)", () => {
    const build = buildSalesDashboard(data);
    const view = build.model.views["a-1"];
    assert.equal(view.title, "Show A · NX Newcastle");
    assert.equal(view.subtitle, "Sat 21 Nov · allocation 1,500");
    const sold = view.tiles.find((t) => t.id === "sold")!;
    assert.equal(sold.value, "812");
    assert.equal(sold.detail, "to date · Internal Counts, 12 Nov · plus 64 comps");
    // N5: the view's own tiles are since launch.
    assert.equal(view.tiles.find((t) => t.id === "spend")!.detail, "Show A · Meta £120 · TikTok £10");
    const fourteen = build.periods["a-1"]["14"].tiles;
    assert.equal(fourteen.find((t) => t.id === "spend")!.detail, "Show A · Meta £120 · TikTok £10 · of £130 since launch");
    assert.equal(fourteen.find((t) => t.id === "sold")!.detail, "to date · Internal Counts, 12 Nov · plus 64 comps");
    assert.equal(fourteen.find((t) => t.id === "tickets")!.detail, "in 14 days · 6.6 a day");
    assert.equal(fourteen.find((t) => t.id === "checkoutActions")!.detail, "in 14 days · actions, one person can do both");
    assert.equal(view.tiles.find((t) => t.id === "tickets")!.detail, "since launch, to 12 Nov");
    assert.equal(view.tiles.find((t) => t.id === "registrations")!.detail, NO_CIRQLIN_PAGE);
  });

  it("the share drops the Not linked pill and every cross-client line; the campaigns keep their names", () => {
    const build = buildSalesDashboard(data);
    const rows = build.model.views["a-1"].campaigns;
    assert.deepEqual(rows.map((r) => [r.name, r.unlinked, r.delivery]), [["[A-1] On Sale", false, "Spending"], ["[A-1] Stories", true, "Stopped 1 Nov"]]);
    const share = salesForSurface(build.model, "share");
    assert.equal(share.crossClientNote, null);
    assert.equal(share.reviewLine, null);
    assert.ok(share.views["a-1"].campaigns.every((r) => !r.unlinked));
    for (const slice of Object.values(share.views["a-1"].periods ?? {})) assert.ok(slice!.campaigns.every((r) => !r.unlinked));
    assert.ok(build.model.views["a-1"].periods?.["7"]?.campaigns.some((r) => r.unlinked));
    assert.equal(build.model.crossClientNote, null);
  });

  it("every period has its own tiles and campaigns; the view carries since launch (N5)", async () => {
    const build = buildSalesDashboard(data);
    assert.deepEqual(Object.keys(build.periods["a-1"]).sort(), ["14", "3", "30", "7", "launch", "yesterday"]);
    assert.equal(build.model.views["a-1"].tiles, build.periods["a-1"].launch.tiles);
    assert.equal(build.model.initialPeriod, "launch");
    assert.equal(build.periods["a-1"].yesterday.campaigns[0].periodSpend, "£100");
    const { campaignsForPeriod, tilesForPeriod } = await import("../sales-vs-spend.ts");
    const view = build.model.views["a-1"];
    // Present: the server's period, as sent.
    assert.equal(tilesForPeriod(view.tiles, view.points, "launch", view.endDay, view.periods), build.periods["a-1"].launch.tiles);
    assert.equal(campaignsForPeriod(view, "yesterday"), build.periods["a-1"].yesterday.campaigns);
    // Absent: today's behaviour, unchanged.
    const bare = { ...view, periods: undefined };
    assert.deepEqual(tilesForPeriod(bare.tiles, bare.points, "7", bare.endDay, bare.periods), tilesForPeriod(bare.tiles, bare.points, "7", bare.endDay));
    assert.equal(tilesForPeriod(bare.tiles, bare.points, "14", bare.endDay, undefined), bare.tiles);
    assert.equal(campaignsForPeriod(bare, "7"), bare.campaigns);
  });

  it("freshness stamps turn amber more than 2 days behind yesterday", () => {
    const stale = buildSalesDashboard({ ...data, shows: [{ ...a, counts: [ic("2026-11-05", 719)] }] }).model.freshness;
    assert.deepEqual(stale.map((s) => [s.wide, s.stale]), [["Counts to 5 Nov", true], ["Spend to 12 Nov", false]]);
  });

  it("a show with no counts says so", () => {
    const view = buildSalesDashboard({ ...data, shows: [{ ...a, counts: [] }] }).model.views["a-1"];
    assert.equal(view.tiles.find((t) => t.id === "sold")!.detail, NO_TICKET_COUNTS);
  });
});

describe("query params", () => {
  it("keeps a known show and period, else falls back", async () => {
    const { pickPeriod, pickShow } = await import("../sales-calc/query.ts");
    const model = { views: { all: {}, "nx26-ipc": {} }, initialShowId: "all" } as never;
    assert.equal(pickShow(model, "NX26-IPC"), "nx26-ipc");
    assert.equal(pickShow(model, "nope"), "all");
    assert.equal(pickPeriod("7"), "7");
    assert.equal(pickPeriod("90"), undefined);
  });
});

describe("chart runs", () => {
  it("an empty day ends a run; nulls at the start, middle and end", async () => {
    const { metricRuns } = await import("../sales-vs-spend.ts");
    const pts = [null, 1, 2, null, null, 3, null].map((v, i) => ({ day: `2026-11-0${i + 1}`, estimated: false, count: false, estimateNote: null, values: { cpc: v } }));
    assert.deepEqual(metricRuns(pts, "cpc"), [[1, 2], [5]]);
    assert.deepEqual(metricRuns(pts, "clicks"), []);
  });
});

describe("Meta attribution in the calc (HN2)", () => {
  it("an override beats the name and the linked list; with no override only the exact [CODE] matches", () => {
    const a = show({ eventId: "a", code: "NX26-AZYR" });
    const b = show({ eventId: "b", code: "NX26-LOCKLEAD", showDate: "2026-12-11" });
    const series = buildSeries(
      input({
        shows: [a, b],
        metaCampaignDays: [
          meta("m1", "[NX26-AZYR] Locklead signup", "2026-11-10", 10),
          meta("m2", "[nx26-locklead] On sale", "2026-11-10", 5),
          meta("m3", "[NX26-AZYR[ Presale", "2026-11-10", 2),
        ],
        overrides: { meta: { m1: "b" } },
      }),
    );
    // m2 "[nx26-locklead]" and m3 "[NX26-AZYR[" carry no exact code: unattributed until an override says.
    assert.deepEqual(series.get("b")!.campaigns.map((c) => [c.campaignId, c.unlinked]), [["m1", false]]);
    assert.deepEqual(series.get("a")!.campaigns.map((c) => c.campaignId), []);
  });

  it("an override to an event outside the client is ignored, never re-matched by name", () => {
    const a = show({ eventId: "a", code: "NX26-AZYR" });
    const series = buildSeries(input({ shows: [a], metaCampaignDays: [meta("m1", "[NX26-AZYR] x", "2026-11-10", 10)], overrides: { meta: { m1: "elsewhere" } } }));
    assert.equal(series.get("a")!.campaigns.length, 0);
  });
});

describe("venues on the share (N2, design Q6)", () => {
  const data = input({
    client: { id: "c1", name: "Electric" },
    shows: [
      show({ eventId: "n1", code: "NX-1", venueKey: "nx newcastle", venueName: "NX Newcastle", showDate: "2026-12-01" }),
      show({ eventId: "n2", code: "NX-2", venueKey: "nx newcastle", venueName: "NX Newcastle", showDate: "2026-12-02" }),
      show({ eventId: "b1", code: "EB-1", venueKey: "electric bristol", venueName: "Electric Bristol", showDate: "2026-12-03" }),
      show({ eventId: "u1", code: "EB-2", name: "Glitterbox", venueKey: null, venueName: "Electric Bristol", showDate: "2027-02-27" }),
      show({ eventId: "g", code: "NX-G", name: "Global Marketing", isUmbrella: true, venueKey: "nx newcastle", capacity: null, allocation: null }),
    ],
    rollups: [roll("n1", "2026-11-10", 10), roll("b1", "2026-11-10", 5), roll("u1", "2026-11-10", 3), roll("g", "2026-11-10", 7)],
  });

  it("internal keeps \"Venue not set\"; the share never says it and names the show instead", async () => {
    const { salesForSurface: present } = await import("../sales-vs-spend.ts");
    const build = buildSalesDashboard(data);
    const internalParts = build.model.views.all.spendTotal!.parts.map((p) => p.label);
    assert.deepEqual(internalParts, ["NX Newcastle", "Electric Bristol", "Venue not set"]);
    const share = present(build.model, "share");
    assert.doesNotMatch(JSON.stringify(share), /Venue not set/);
    assert.deepEqual(share.views.all.spendTotal!.parts.map((p) => [p.label, p.text]), [["NX Newcastle", "£10"], ["Electric Bristol", "£5"], ["Glitterbox", "£3"]]);
    assert.equal(share.views["venue:unset"], undefined);
    assert.ok(share.venues!.every((v) => v.key != null));
    // The internal model is untouched by the share copy.
    assert.equal(build.model.views.all.spendTotal!.parts.at(-1)!.label, "Venue not set");
  });

  it("the umbrella chip reads \"Umbrella\" in every chip row; \"{Venue} umbrella\" stays in titles and sentences", () => {
    const build = buildSalesDashboard(data);
    assert.equal(build.model.shows.find((c) => c.kind === "umbrella")!.wide, "Umbrella");
    assert.equal(build.model.venues!.find((v) => v.key === "nx newcastle")!.shows.at(-1)!.wide, "Umbrella");
    assert.equal(build.model.views["nx-g"].title, "NX Newcastle umbrella");
    assert.match(build.model.views["venue:nx newcastle"].header!.sentence, /Separate NX Newcastle umbrella spend: £7\./);
  });
});
