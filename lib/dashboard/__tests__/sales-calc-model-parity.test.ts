/**
 * Dashboard v2 against the model (docs/design-record/2026-11-13-dashboard-v2-
 * against-the-model.html, HN2) and #1225's reconciliation, on the 12 Nov
 * fixture. HN1's data changes (venue_key on NX26-GLOBAL and
 * NX27-EWANMCVICAR, the umbrella's page) are applied in memory here; the
 * SQL for ops is in the PR body.
 *
 * Expected figures are the record's table (database to 12 Nov). Spend to
 * the pound, tickets exact, registrations within 2.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { tiktokCampaignCountsForEvent } from "../../tiktok/rollup-insights.ts";
import { shortDay } from "../sales-calc/days.ts";
import { buildSeries, periodFigures, type PeriodFigures } from "../sales-calc/figures.ts";
import { SOURCE_LABEL, buildSalesDashboard } from "../sales-calc/model.ts";
import { headerSentence } from "../sales-calc/scope.ts";
import type { SalesCalcInput } from "../sales-calc/types.ts";
import { loadProdFixture } from "./sales-calc-parity.test.ts";

function withHn1(input: SalesCalcInput): SalesCalcInput {
  return {
    ...input,
    shows: input.shows.map((s) =>
      s.code === "NX26-GLOBAL" || s.code === "NX27-EWANMCVICAR" ? { ...s, venueKey: "nx newcastle", ...(s.code === "NX26-GLOBAL" ? { cirqlinPageSlug: "nx-loves-aw26" } : {}) } : s,
    ),
  };
}

const build = buildSalesDashboard(withHn1(loadProdFixture()));
const nx = build.model.views["venue:nx newcastle"];
const tile = (view: typeof nx, id: string, period?: "14") => (period ? view.periods![period]!.tiles : view.tiles).find((t) => t.id === id)!;
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;

describe("HN2 against the record's expected figures (NX Newcastle, to 12 Nov)", () => {
  it("N2: venues come from venue_key; the default is the venue with the most live shows", () => {
    assert.equal(build.model.initialShowId, "venue:nx newcastle");
    assert.equal(build.model.initialVenueViewId, "venue:nx newcastle");
    const venue = build.model.venues![0];
    assert.equal(venue.name, "NX Newcastle");
    assert.equal(venue.liveShows, 9);
    assert.equal(venue.shows.at(-1)!.wide, "Umbrella");
    assert.equal(venue.shows[0].id, "venue:nx newcastle");
  });

  it("N3: spend ties out, and NX + Meta is still the model's £16,736.19", () => {
    const total = nx.spendTotal!;
    assert.ok(near(total.amount, 16780.14), String(total.amount));
    assert.deepEqual(total.channels.map((c) => [c.label, Number(c.amount.toFixed(2))]), [["Meta", 16736.19], ["TikTok", 12], ["Google", 31.95]]);
    assert.ok(near(total.parts.reduce((a, p) => a + p.amount, 0), total.amount, 1e-6));
    assert.equal(total.text, "£16,780");
    assert.equal(total.notIncluded, "Not in this total: NX Newcastle umbrella £4,220. Finished shows (Include finished adds them).");
    assert.equal(nx.periods!["14"]!.spendTotal!.text, "£3,377");
    assert.equal(tile(nx, "spend").detail, "NX Newcastle · Meta £16,736 · TikTok £12 · Google £32");
    // In a period: the same scope, its channel split, then "of £{since launch} since launch" in that scope (N3).
    assert.match(tile(nx, "spend", "14").detail, /^NX Newcastle · Meta £[\d,]+ · TikTok £\d+ · Google £\d+ · of £16,780 since launch$/);
    assert.equal(tile(nx, "spend", "14").value, "£3,377");
  });

  it("N4: the header sentence and its channel line", () => {
    assert.equal(
      nx.header!.sentence,
      "NX Newcastle to date: £16,780 spend since launch, 8,526 tickets sold across 8 shows (Internal Counts, 12 Nov), so £1.97 of spend per ticket. Separate NX Newcastle umbrella spend: £4,220.",
    );
    assert.equal(nx.header!.channelLine, "Meta £16,736 · TikTok £12 · Google £32 · to 12 Nov · finished shows not included");
    assert.equal(build.model.views["nx26-eed"].header!.sentence, "East End Dubs to date: £2,767 spend since launch, 1,731 tickets sold (Internal Counts, 12 Nov), so £1.60 per ticket.");
  });

  it("N5 and N7: since launch by default, every subline starts with its span", () => {
    assert.equal(build.model.initialPeriod, "launch");
    assert.equal(tile(nx, "sold").value, "8,526");
    assert.match(tile(nx, "sold").detail, /^to date · Internal Counts, 12 Nov/);
    assert.equal(tile(nx, "tickets").detail, "since launch, to 12 Nov");
    assert.equal(tile(nx, "costPerTicket").value, "£1.97");
    assert.deepEqual(
      ["checkoutActions", "costPerCheckout", "lpv", "costPerLpv", "clicks", "cpc"].map((id) => tile(nx, id).value),
      ["2,672", "£6.26", "53,881", "£0.31", "65,821", "£0.25"],
    );
    assert.equal(tile(nx, "checkoutActions").detail, "since launch · actions, one person can do both");
    assert.equal(tile(nx, "costPerRegistration").value, "£1.15");
    assert.equal(tile(nx, "costPerRegistration").detail, "show pages, inside their signup windows");
  });

  it("registrations by page: 6,068 within 2, the umbrella's 808 apart and never added", () => {
    const regs = Number(tile(nx, "registrations").value.replace(/,/g, ""));
    assert.ok(Math.abs(regs - 6068) <= 2, String(regs));
    assert.match(tile(nx, "registrations").detail, /^to date · signup pages close at on-sale · plus 808 on the umbrella page$/);
    assert.equal(tile(nx, "registrations", "14").value, "392");
    assert.match(tile(nx, "registrations", "14").detail, /^in 14 days · [\d,]+ to date · plus 57 on the umbrella page$/);
  });

  it("N6: the trajectory's three tiles, capped bars and the sells-out flags", () => {
    const t = nx.trajectory;
    assert.ok(t.kind === "all" && t.summary);
    if (t.kind !== "all" || !t.summary) return;
    assert.deepEqual(t.summary.sold, { label: "Sold · count of 12 Nov", value: "8,526", detail: "53% of 16,000 across 8 shows" });
    assert.equal(t.summary.pace.value, "113.3 a day");
    assert.equal(t.summary.pace.detail, "14-day 155.3 a day");
    assert.match(t.summary.projected.value, /^11,315–/);
    const bar = (name: string) => t.bars.find((b) => b.label.startsWith(name))!;
    assert.equal(bar("Schak").caption, "1,870 → sells out at this pace");
    assert.equal(bar("Schak").sellsOut, "holds");
    assert.equal(bar("Julian Fijma").caption, "579 → sells out at this pace");
    assert.equal(bar("Ewan McVicar").caption, "No ticket counts yet");
    assert.match(bar("East End Dubs").caption, /^1,731 → 1,775–/);
    assert.ok(t.bars.every((b) => b.high == null || b.allocation == null || b.high <= b.allocation));
  });

  it("N8: the umbrella, named by its venue, with its page's signups", () => {
    const u = build.model.views["nx26-global"];
    assert.equal(u.title, "NX Newcastle umbrella");
    assert.equal(u.subtitle, "Global Marketing · not a show: no tickets and no trajectory");
    assert.equal(u.header!.sentence, "NX Newcastle umbrella to date: £4,220 spend since launch, kept out of every show total. 808 signups on its page.");
    assert.equal(u.header!.channelLine, "Meta £3,854 · TikTok £328 · Google £38 · to 12 Nov");
    assert.equal(tile(u, "registrations").value, "808");
    assert.equal(tile(u, "registrations").detail, "to date · nx-loves-aw26");
    assert.equal(tile(u, "costPerRegistration").value, "£5.22");
    assert.equal(tile(u, "costPerRegistration").detail, "all umbrella spend, 18 Sep–12 Nov");
    assert.equal(tile(u, "sold").value, "—");
  });
});

describe("TikTok after the overrides (#1225)", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/sales-12-nov.json", import.meta.url), "utf8")) as { tiktokCampaigns: [string, string, number][] };
  const input = loadProdFixture();
  const id = (code: string) => input.shows.find((s) => s.code === code)!.eventId;
  const seed = new Map([
    ["1880462786907170", id("NX26-LOCKLEAD")],
    ["1880403187534530", id("NX26-LOCKLEAD")],
    ["1879669080323249", id("NX26-AZYR")],
    ["1875856480493234", id("NX26-AZYR")],
  ]);
  const byEvent = (overrides?: Map<string, string>) => {
    const out: Record<string, number> = {};
    for (const s of input.shows) {
      let sum = 0;
      for (const [campaignId, name, spend] of fixture.tiktokCampaigns) {
        if (tiktokCampaignCountsForEvent({ campaignId, name, eventCode: s.code, eventId: s.eventId, overrides })) sum += spend;
      }
      if (sum) out[s.code] = Number(sum.toFixed(2));
    }
    return out;
  };
  const total = (m: Record<string, number>) => Number(Object.values(m).reduce((a, b) => a + b, 0).toFixed(2));

  it("today, stored: £455.37 (the £8.01 double count is a stale 29 Oct row the leg now clears)", () => {
    const stored = input.rollups.reduce((a, r) => a + (r.tiktok ?? 0), 0);
    assert.equal(Number(stored.toFixed(2)), 455.37);
  });

  it("the leg without the seed, exact [CODE]: £435.36; AZYR holds Locklead's £106.98 and \"[NX26-Locklead]\" matches nothing", () => {
    const m = byEvent();
    assert.deepEqual(m, { "NX26-GLOBAL": 328.38, "NX26-AZYR": 106.98 });
    assert.equal(total(m), 435.36);
  });

  it("with the seed applied in memory: £540.65, the advertiser's own total", () => {
    const m = byEvent(seed);
    assert.deepEqual(m, { "NX26-LOCKLEAD": 118.98, "NX26-GLOBAL": 328.38, "NX26-AZYR": 93.29 });
    assert.equal(total(m), 540.65);
    assert.equal(total(m), Number(fixture.tiktokCampaigns.reduce((a, [, , s]) => a + s, 0).toFixed(2)));
  });
});

// ─── Live-check fixes (14 Nov, design-ruled) ─────────────────────────────
// Prod on 14 Nov: spend to 13 Nov, the last Internal Counts on 12 Nov. The
// fixture's data ends on 12 Nov, so "today 14 Nov" puts the spend date a day
// past the count date, as it was live.

describe("live-check fixes: one count date, the spend-to-count clause, the umbrella clause", () => {
  const live = buildSalesDashboard({ ...withHn1(loadProdFixture()), today: "2026-11-14" });
  const v = live.model.views["venue:nx newcastle"];

  it("1. one count date: the view's countDay is the latest count, not the spend date", () => {
    assert.equal(v.endDay, "2026-11-13"); // the spend date, as live
    assert.equal(v.countDay, "2026-11-12");
    assert.match(v.header!.channelLine, / · to 13 Nov · /);
    // The default scope's live shows were all last counted on 12 Nov, so no "to 12 Nov" here.
    assert.match(v.header!.sentence, /\(Internal Counts, 12 Nov\)/);
    assert.doesNotMatch(v.header!.sentence, /Internal Counts, to /);
    assert.match(tile(v, "sold").detail, /^to date · Internal Counts, 12 Nov/);
    const t = v.trajectory;
    assert.ok(t.kind === "all" && t.summary);
    if (t.kind === "all" && t.summary) assert.equal(t.summary.sold.label, `Sold · count of 12 Nov`);
    // Every view: the trajectory tile's date is the view's countDay.
    for (const view of Object.values(live.model.views)) {
      if (view.trajectory.kind === "all" && view.trajectory.summary) {
        assert.equal(view.trajectory.summary.sold.label, `Sold · count of ${shortDay(view.countDay!)}`);
      }
    }
  });

  it("3. spend past the count: the header and the Cost per ticket hover name it; the subline doesn't change", () => {
    assert.match(v.header!.sentence, /, so £[\d.]+ of spend per ticket, on spend to the 12 Nov count\./);
    assert.equal(tile(v, "costPerTicket").title, "All channels' spend to each show's latest count, over tickets sold, on spend to the 12 Nov count.");
    assert.match(tile(v, "costPerTicket").detail, /^since launch · /);
    assert.doesNotMatch(tile(v, "costPerTicket").detail, /on spend to/);
    // Dates match (the 12 Nov build): no clause, the sentence as before.
    assert.doesNotMatch(nx.header!.sentence, /on spend to the/);
    assert.equal(tile(nx, "costPerTicket").title, "All channels' spend to each show's latest count, over tickets sold.");
  });

  it("3. D13 in the live calc: spend after the count is in the total, never in cost per ticket", () => {
    // £500 more Meta spend on Schak's 13 Nov rollup, after every show's 12 Nov count.
    const input = { ...withHn1(loadProdFixture()), today: "2026-11-14" };
    const schak = input.shows.find((s) => s.code === "NX26-SCHAK")!;
    const row = input.rollups.find((r) => r.eventId === schak.eventId && r.day === "2026-11-13")!;
    assert.ok(row, "the fixture has Schak's 13 Nov rollup");
    const after = buildSalesDashboard({
      ...input,
      rollups: input.rollups.map((r) => (r === row ? { ...r, meta: (r.meta ?? 0) + 500 } : r)),
    });
    const w = after.model.views["venue:nx newcastle"];
    assert.ok(near(w.spendTotal!.amount, v.spendTotal!.amount + 500, 1e-6));
    const cpt = tile(v, "costPerTicket").value;
    assert.equal(tile(w, "costPerTicket").value, cpt);
    assert.ok(w.header!.sentence.includes(`so ${cpt} of spend per ticket, on spend to the 12 Nov count.`), w.header!.sentence);
  });

  it("4. the umbrella clause shows only when its page has signups", () => {
    assert.match(tile(nx, "registrations").detail, /plus 808 on the umbrella page$/);
    const input = withHn1(loadProdFixture());
    const umbrella = input.shows.find((s) => s.code === "NX26-GLOBAL")!;
    const zero = buildSalesDashboard({ ...input, signups: input.signups.filter((d) => d.eventId !== umbrella.eventId) });
    const z = zero.model.views["venue:nx newcastle"];
    assert.equal(tile(z, "registrations").detail, "to date · signup pages close at on-sale");
    assert.doesNotMatch(tile(z, "registrations", "14").detail, /umbrella page/);
  });
});

describe("headerSentence: the count date and the spend-to-count clause (D13)", () => {
  // D13: £14,216 is spend to 13 Nov (the header's total); cost per ticket is
  // spend to the 12 Nov count, £14,134, over the 6,795 tickets at that count: £2.08.
  const figures = (over: Partial<PeriodFigures> = {}): PeriodFigures => ({
    spend: 14216,
    byPlatform: { meta: 14216, tiktok: 0, google: 0 },
    platformsWithData: ["meta"],
    sold: 6795,
    soldComps: null,
    soldDay: "2026-11-12",
    soldDaysDiffer: false,
    spendPastCount: false,
    soldSources: ["internal_counts"],
    soldIsFinal: false,
    tickets: 6795,
    costPerTicket: 14134 / 6795,
    checkoutActions: 0,
    costPerCheckout: null,
    landingPageViews: 0,
    costPerLpv: null,
    linkClicks: 0,
    cpc: null,
    registrations: null,
    costPerRegistration: null,
    signupsClosed: false,
    ...over,
  });
  const sentence = (over: Partial<PeriodFigures> = {}, kind: "venue" | "all" | "show" = "venue") =>
    headerSentence({ kind, name: "Fixture Hall", launch: figures(over), endDay: "2026-11-13", sourceLabels: SOURCE_LABEL, countedShows: 3, venues: 2 }).sentence;

  it("every show last counted the same day: £2.08, on spend to the 12 Nov count", () => {
    assert.equal(
      sentence({ spendPastCount: true }),
      "Fixture Hall to date: £14,216 spend since launch, 6,795 tickets sold across 3 shows (Internal Counts, 12 Nov), so £2.08 of spend per ticket, on spend to the 12 Nov count.",
    );
    assert.match(sentence({ spendPastCount: true }, "show"), /, so £2\.08 per ticket, on spend to the 12 Nov count\.$/);
    assert.match(sentence({ spendPastCount: true }, "all"), /, so £2\.08 of spend per ticket on those shows, on spend to the 12 Nov count\.$/);
  });

  it("mixed count days: £2.08, on spend to each show's last count (latest 12 Nov)", () => {
    assert.equal(
      sentence({ spendPastCount: true, soldDaysDiffer: true }),
      "Fixture Hall to date: £14,216 spend since launch, 6,795 tickets sold across 3 shows (Internal Counts, to 12 Nov), so £2.08 of spend per ticket, on spend to each show's last count (latest 12 Nov).",
    );
  });

  it("no show's spend runs past its own last count: no clause", () => {
    assert.equal(
      sentence({ spendPastCount: false, costPerTicket: 14216 / 6795 }),
      "Fixture Hall to date: £14,216 spend since launch, 6,795 tickets sold across 3 shows (Internal Counts, 12 Nov), so £2.09 of spend per ticket.",
    );
    assert.equal(sentence({ spendPastCount: false, soldDaysDiffer: true, costPerTicket: 14216 / 6795 }).includes("on spend to"), false);
  });
});

describe("D13 on the prod fixture: AZYR (9 Nov) with the shows counted 12 Nov", () => {
  // The model has no scope that sums a finished show with live ones (Include
  // finished adds chips only), so this is the calc over that list directly.
  const input = { ...withHn1(loadProdFixture()), today: "2026-11-14" };
  const series = [...buildSeries(input).values()];
  const endDay = "2026-11-13";
  const azyr = series.find((s) => s.show.code === "NX26-AZYR")!;
  const counted12 = series.filter((s) => !s.show.isUmbrella && s.counts.at(-1)?.day === "2026-11-12");

  it("each show's spend stops at its own last count, and the mixed form names it", () => {
    // AZYR (7 Nov) is finished; its final Internal Count is 9 Nov.
    assert.equal(azyr.finalDay, "2026-11-09");
    assert.ok(counted12.length >= 2);
    const list = [azyr, ...counted12];
    const f = periodFigures(list, "launch", endDay);
    assert.equal(f.soldDay, "2026-11-12");
    assert.equal(f.soldDaysDiffer, true);
    let capped = 0;
    for (const s of list) {
      const last = s.finalDay ?? s.counts.at(-1)!.day;
      for (const d of s.days.values()) if (d.day <= last && d.day <= endDay) capped += d.spend;
    }
    assert.ok(near(f.costPerTicket!, capped / f.sold!, 1e-9));
    assert.ok(f.spend > capped, "spend after each show's own count is in the total, not in cost per ticket");
    assert.equal(f.spendPastCount, true);
    const h = headerSentence({ kind: "venue", name: "NX Newcastle", launch: f, endDay, sourceLabels: SOURCE_LABEL, countedShows: list.length });
    assert.match(h.sentence, /\(Internal Counts, to 12 Nov\), so £[\d.]+ of spend per ticket, on spend to each show's last count \(latest 12 Nov\)\.$/);
  });

  it("the shows counted 12 Nov alone: the single-date form", () => {
    const f = periodFigures(counted12, "launch", endDay);
    assert.equal(f.soldDaysDiffer, false);
    const h = headerSentence({ kind: "venue", name: "NX Newcastle", launch: f, endDay, sourceLabels: SOURCE_LABEL, countedShows: counted12.length });
    assert.match(h.sentence, /\(Internal Counts, 12 Nov\), so £[\d.]+ of spend per ticket, on spend to the 12 Nov count\.$/);
  });

  it("to the count date only (end 12 Nov): no spend past any count, no clause", () => {
    const f = periodFigures(counted12, "launch", "2026-11-12");
    assert.equal(f.spendPastCount, false);
    const h = headerSentence({ kind: "venue", name: "NX Newcastle", launch: f, endDay: "2026-11-12", sourceLabels: SOURCE_LABEL, countedShows: counted12.length });
    assert.doesNotMatch(h.sentence, /on spend to/);
  });
});

describe("the one date formatter", () => {
  it("writes Sep, never en-GB's Sept", () => {
    assert.equal(shortDay("2026-09-04"), "4 Sep");
    assert.equal(shortDay("2026-11-12"), "12 Nov");
  });

  it("no dashboard component formats a date itself", () => {
    for (const file of ["sales-chart.tsx", "sales-dashboard.tsx", "tile-copy.ts", "chart-axes.ts", "trajectory-bars.ts"]) {
      const src = readFileSync(`components/dashboard/sales/${file}`, "utf8");
      assert.doesNotMatch(src, /toLocaleDateString|DateTimeFormat|month:\s*"short"/, file);
    }
  });
});

describe("one show count per view (design FAIL 1 on 160e017)", () => {
  it("the header, the Cost per ticket tile and showCounts name the same number of counted shows, in every view", () => {
    const live = buildSalesDashboard({ ...withHn1(loadProdFixture()), today: "2026-11-14" });
    let checked = 0;
    for (const [id, view] of Object.entries(live.model.views)) {
      if (!view.showCounts || !view.header) continue;
      const said = view.header.sentence.match(/(?:across|on the) (\d+) shows/);
      if (said) {
        assert.equal(Number(said[1]), view.showCounts.counted, `${id}: ${view.header.sentence}`);
        checked += 1;
      }
      const cpt = tile(view, "costPerTicket").detail.match(/the (\d+) shows with counts/);
      if (cpt) assert.equal(Number(cpt[1]), view.showCounts.counted, `${id}: ${tile(view, "costPerTicket").detail}`);
    }
    assert.ok(checked > 0);
  });

  it("a show with counts but no capacity still counts (its trajectory bar has no sold figure)", () => {
    const live = buildSalesDashboard({ ...withHn1(loadProdFixture()), today: "2026-11-14" });
    for (const view of Object.values(live.model.views)) {
      if (view.trajectory.kind !== "all" || !view.showCounts) continue;
      const bars = view.trajectory.bars.filter((b) => b.sold != null).length;
      assert.ok(view.showCounts.counted >= bars);
    }
  });
});
