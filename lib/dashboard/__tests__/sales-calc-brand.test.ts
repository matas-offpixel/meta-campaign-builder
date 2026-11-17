/**
 * PH6 (docs/design-record/2026-11-15-dashboard-v2-presale-creatives-budget.html):
 * undated brand campaigns count in the client's spend and cost per ticket,
 * the scope line says "includes brand campaigns (£{n})" in whole pounds, and
 * show level is unchanged and silent. Tickets and signups stay counted.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSeries, buildSeriesWithBrands, periodFigures } from "../sales-calc/figures.ts";
import { loadSalesCalcInput } from "../sales-calc/load.ts";
import { ALL_SHOWS_ID, buildSalesDashboard } from "../sales-calc/model.ts";
import type { BrandCampaignInput, SalesCalcInput, ShowInput } from "../sales-calc/types.ts";
import { IRONWORKS_INPUT, IRONWORKS_INPUT_NO_BRAND } from "../sales-ironworks-input.ts";
import { LIVE_LIKE_INPUT } from "../sales-live-like-input.ts";

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
    venueKey: "v1",
    venueName: "Venue One",
    linkedCampaignIds: [],
    referenceEventIds: [],
    counts: [],
    finalCount: null,
    ...over,
  };
}

const ic = (day: string, sold: number) => ({ day, sold, comps: null, source: "internal_counts" as const });
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
const roll = (eventId: string, day: string, m: number | null, tiktok: number | null = null) => ({
  eventId,
  day,
  meta: m,
  tiktok,
  google: null,
  metaSynced: m != null,
  tiktokSynced: tiktok != null,
  googleSynced: false,
});

const BRAND: BrandCampaignInput = { eventId: "brand", code: "C-BRAND", name: "Brand Awareness (Always-On)", linkedCampaignIds: ["b1"] };

/** One venue, two counted shows, a brand campaign that spends on Meta and TikTok, with clicks, checkouts and signups of its own. */
function base(brandCampaigns: BrandCampaignInput[] = [BRAND]): SalesCalcInput {
  return {
    client: { id: "c1", name: "Client" },
    today: "2026-11-13",
    shows: [
      show({ eventId: "a", code: "A-1", name: "Show A", linkedCampaignIds: ["m1"], counts: [ic("2026-11-01", 100), ic("2026-11-10", 300)], cirqlinPageId: "p1" }),
      show({ eventId: "b", code: "B-1", name: "Show B", showDate: "2026-12-05", counts: [ic("2026-11-01", 50), ic("2026-11-10", 100)] }),
    ],
    brandCampaigns,
    metaCampaignDays: [
      meta("m1", "[A-1] on sale", "2026-11-05", 200, { linkClicks: 40, initiateCheckouts: 4 }),
      meta("t1", "[B-1] on sale", "2026-11-06", 100, { linkClicks: 10 }),
      // The brand campaign's own results: they must never reach the counts.
      meta("b1", "[C-BRAND] always on", "2026-11-05", 600.4, { linkClicks: 500, landingPageViews: 400, initiateCheckouts: 90, addsToCart: 30 }),
      meta("b1", "[C-BRAND] always on", "2026-11-12", 50, { linkClicks: 20 }),
    ],
    googleCampaignDays: [],
    rollups: [roll("brand", "2026-11-05", 600.4, 34.4), roll("brand", "2026-11-12", 50)],
    signups: [
      { eventId: "a", day: "2026-11-05", signups: 10 },
      // A brand registration: never a signup.
      { eventId: "brand", day: "2026-11-05", signups: 999 },
    ],
    library: [],
  };
}

const VENUE = "venue:v1";

describe("PH6 brand campaigns at client level", () => {
  it("counts brand spend in the client total and its channels, with the whole-pound line", () => {
    const { model } = buildSalesDashboard(base());
    for (const id of [ALL_SHOWS_ID, VENUE]) {
      const total = model.views[id].spendTotal!;
      // Shows £300 + brand £600.40 + £34.40 TikTok + £50.
      assert.equal(total.amount, 984.8);
      assert.equal(total.text, "£985");
      assert.equal(total.includes, "includes brand campaigns (£685)");
      assert.deepEqual(
        total.channels.map((c) => [c.label, c.text]),
        [["Meta", "£950"], ["TikTok", "£34"]],
      );
      // N3: the parts still sum to the total; the brand campaign is a part by its own name.
      assert.deepEqual(
        total.parts.map((p) => [p.label, p.text]),
        [["Show A", "£200"], ["Show B", "£100"], ["Brand Awareness (Always-On)", "£685"]],
      );
      assert.equal(total.parts.reduce((s, p) => s + p.amount, 0), total.amount);
      const tile = model.views[id].tiles.find((t) => t.id === "spend")!;
      assert.equal(tile.value, "£985");
      assert.match(tile.detail, /· includes brand campaigns \(£685\)$/);
      assert.match(model.views[id].header!.channelLine, /^Meta £950 · TikTok £34 · includes brand campaigns \(£685\) · to 12 Nov/);
      assert.match(model.views[id].header!.sentence, /£985 spend since launch/);
    }
  });

  it("rounds the line to whole pounds", () => {
    const input = base();
    input.rollups = [roll("brand", "2026-11-05", 22553.07)];
    input.metaCampaignDays = input.metaCampaignDays.filter((r) => r.campaignId !== "b1");
    const total = buildSalesDashboard(input).model.views[VENUE].spendTotal!;
    assert.equal(total.includes, "includes brand campaigns (£22,553)");
  });

  it("cost per ticket is client spend, brand included, over tickets sold; spend past the last count is left out and said", () => {
    const { model } = buildSalesDashboard(base());
    const cpt = model.views[VENUE].tiles.find((t) => t.id === "costPerTicket")!;
    // Tickets: 300 + 100 = 400, counted only. Spend to the 10 Nov count: shows £300 + brand £634.80. The brand's £50 on 12 Nov is after it.
    assert.equal(cpt.value, "£2.34");
    const before = buildSalesDashboard(base([])).model.views[VENUE].tiles.find((t) => t.id === "costPerTicket")!;
    assert.equal(before.value, "£0.75");
    assert.match(model.views[VENUE].header!.sentence, /400 tickets sold across 2 shows .*so £2\.34 of spend per ticket, on spend to the 10 Nov count\./);
  });

  it("brand purchases, registrations, clicks and checkouts never reach tickets, signups or the engagement figures", () => {
    const withBrand = buildSalesDashboard(base()).model.views[VENUE];
    const without = buildSalesDashboard(base([])).model.views[VENUE];
    for (const id of ["sold", "tickets", "registrations", "costPerRegistration", "checkoutActions", "costPerCheckout", "lpv", "costPerLpv", "clicks", "cpc"]) {
      assert.deepEqual(withBrand.tiles.find((t) => t.id === id), without.tiles.find((t) => t.id === id), id);
    }
    assert.equal(withBrand.tiles.find((t) => t.id === "sold")!.value, "400");
    assert.equal(withBrand.tiles.find((t) => t.id === "registrations")!.value, "10");
  });

  it("in a period, the brand's spend in it counts, and the line goes when it spent nothing there", () => {
    const { periods } = buildSalesDashboard(base());
    assert.equal(periods[VENUE]["3"].spendTotal!.text, "£50");
    assert.equal(periods[VENUE]["3"].spendTotal!.includes, "includes brand campaigns (£50)");
    const quiet = base();
    quiet.rollups = [roll("brand", "2026-11-05", 600.4)];
    quiet.metaCampaignDays = quiet.metaCampaignDays.filter((r) => r.day !== "2026-11-12");
    const p = buildSalesDashboard(quiet).periods[VENUE];
    assert.equal(p["3"].spendTotal!.includes, null);
    assert.ok(!/brand/.test(p["3"].tiles.find((t) => t.id === "spend")!.detail));
    // 7 days is 6–12 Nov: only the brand's £50 on 12 Nov.
    assert.equal(periods[VENUE]["7"].spendTotal!.includes, "includes brand campaigns (£50)");
    assert.equal(periods[VENUE]["14"].spendTotal!.includes, "includes brand campaigns (£685)");
  });

  it("period cost per ticket takes the brand's spend over the same ticket days", () => {
    const f = periodFigures(
      [...buildSeries(base()).values()],
      "7",
      "2026-11-12",
      buildSeriesWithBrands(base()).brands,
    );
    // Ticket days 4–10 Nov (sold on 3 Nov read off the line between counts): shows £300 + brand £634.80 over 194.4 tickets.
    assert.deepEqual(f.ticketDays, { from: "2026-11-04", to: "2026-11-10" });
    assert.equal(Math.round(f.tickets! * 10) / 10, 194.4);
    assert.equal(Math.round(f.costPerTicket! * 100) / 100, 4.81);
    const without = periodFigures([...buildSeries(base([])).values()], "7", "2026-11-12");
    assert.equal(Math.round(without.costPerTicket! * 100) / 100, 1.54);
    assert.equal(f.spendPastCount, true);
  });
});

describe("PH6 show level and the rest are unchanged", () => {
  it("a show's view is the same with and without the brand campaign, and says nothing", () => {
    const withBrand = buildSalesDashboard(base()).model;
    const without = buildSalesDashboard(base([])).model;
    for (const id of ["a-1", "b-1"]) {
      assert.deepEqual(withBrand.views[id], without.views[id], id);
      assert.ok(!JSON.stringify(withBrand.views[id]).includes("brand"), id);
    }
  });

  it("a show keeps a campaign it links even when the brand campaign links it too", () => {
    const input = base([{ ...BRAND, linkedCampaignIds: ["b1", "m1"] }]);
    const { shows, brands } = buildSeriesWithBrands(input);
    assert.equal(shows.get("a")!.campaigns.map((c) => c.campaignId).join(), "m1");
    assert.equal(brands[0].campaigns.map((c) => c.campaignId).join(), "b1");
  });

  it("a client with no brand campaign is unchanged (live-like fixture, every view and period)", () => {
    const before = buildSalesDashboard({ ...LIVE_LIKE_INPUT, brandCampaigns: undefined });
    const after = buildSalesDashboard({ ...LIVE_LIKE_INPUT, brandCampaigns: [] });
    assert.deepEqual(after.model, before.model);
    assert.deepEqual(after.periods, before.periods);
    assert.ok(!JSON.stringify(after.model).includes("brand campaigns"));
  });

  it("under several venues, only All venues counts the brand campaign; each venue is unchanged", () => {
    const input = base();
    input.shows = input.shows.map((s) => (s.eventId === "b" ? { ...s, venueKey: "v2", venueName: "Venue Two" } : s));
    const withBrand = buildSalesDashboard(input).model;
    const without = buildSalesDashboard({ ...input, brandCampaigns: [] }).model;
    assert.equal(withBrand.views[ALL_SHOWS_ID].spendTotal!.includes, "includes brand campaigns (£685)");
    for (const id of ["venue:v1", "venue:v2"]) assert.deepEqual(withBrand.views[id], without.views[id], id);
  });
});

describe("PH6 Ironworks (prod rows, today 25 Oct)", () => {
  it("reads includes brand campaigns (£22,553): the HE6 builder's £22,553.07", () => {
    const { model } = buildSalesDashboard(IRONWORKS_INPUT);
    const total = model.views[model.initialShowId].spendTotal!;
    assert.equal(model.initialShowId, "venue:ironworks");
    assert.equal(total.includes, "includes brand campaigns (£22,553)");
    const brand = total.parts.find((p) => p.label === "Brand Awareness (Always-On)")!;
    assert.equal(Math.round(brand.amount * 100) / 100, 22553.07);
    // Its rollup's Google leg is synced, so a real £0 shows (D12).
    assert.deepEqual(brand.channels.map((c) => [c.label, Math.round(c.amount * 100) / 100]), [["Meta", 18910.3], ["TikTok", 3642.77], ["Google", 0]]);
    assert.equal(total.text, "£38,143");
    // No ticket counts stored for Ironworks: cost per ticket is "—" before and after.
    assert.equal(model.views[model.initialShowId].tiles.find((t) => t.id === "costPerTicket")!.value, "—");
  });

  it("before PH6 the same client read £15,590, and every show view is unchanged", () => {
    const before = buildSalesDashboard(IRONWORKS_INPUT_NO_BRAND).model;
    const after = buildSalesDashboard(IRONWORKS_INPUT).model;
    assert.equal(before.views["venue:ironworks"].spendTotal!.text, "£15,590");
    assert.equal(before.views["venue:ironworks"].spendTotal!.includes, null);
    for (const id of Object.keys(after.views).filter((k) => k.startsWith("irw"))) assert.deepEqual(after.views[id], before.views[id], id);
  });
});

describe("PH6 loader", () => {
  type Row = Record<string, unknown>;
  function fakeDb(tables: Record<string, Row[]>) {
    const reads: { table: string; filters: [string, string, unknown][] }[] = [];
    const from = (table: string) => {
      const filters: [string, string, unknown][] = [];
      reads.push({ table, filters });
      const rows = () =>
        (tables[table] ?? []).filter((r) => filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : op === "in" ? (v as unknown[]).includes(r[col]) : true)));
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push(["eq", col, v]), q),
        in: (col: string, v: unknown[]) => (filters.push(["in", col, v]), q),
        gte: () => q,
        gt: () => q,
        lte: () => q,
        not: () => q,
        is: () => q,
        order: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: rows().slice(a, b + 1), error: null }),
        maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
      };
      return q;
    };
    return { db: { from } as never, reads };
  }
  const ev = (over: Row) => ({ user_id: "u", client_id: "c1", presale_at: null, general_sale_at: null, meta_campaign_id: null, meta_ad_account_id: null, status: "on_sale", venue_key: "v1", venue_name: "Venue One", kind: "event", ...over });

  it("reads an undated brand campaign's spend, never its counts or signups; an undated show is still dropped", async () => {
    const { db, reads } = fakeDb({
      clients: [{ id: "c1", name: "Client", meta_ad_account_id: "111" }],
      events: [
        ev({ id: "a", event_code: "A-1", name: "Show A", event_date: "2026-12-01" }),
        ev({ id: "brand", event_code: "C-BRAND", name: "Brand", event_date: null, kind: "brand_campaign", meta_campaign_id: "b1, b2" }),
        ev({ id: "tbc", event_code: "T-1", name: "No date yet", event_date: null }),
        ev({ id: "gone", event_code: "G-1", name: "Cancelled brand", event_date: null, kind: "brand_campaign", status: "cancelled" }),
      ],
      event_daily_rollups: [
        { id: "r1", event_id: "a", date: "2026-11-10", ad_spend: 10 },
        { id: "r2", event_id: "brand", date: "2026-11-10", ad_spend: 20 },
        { id: "r3", event_id: "tbc", date: "2026-11-10", ad_spend: 99 },
      ],
      google_ads_daily_snapshots: [{ id: "g1", event_code: "C-BRAND", date: "2026-11-10", cost_micros: 5_000_000, campaign_resource_name: "x/1" }],
    });
    const input = (await loadSalesCalcInput(db, "c1", { today: "2026-11-13" }))!;
    assert.deepEqual(input.shows.map((s) => s.code), ["A-1"]);
    assert.deepEqual(input.brandCampaigns, [{ eventId: "brand", code: "C-BRAND", name: "Brand", linkedCampaignIds: ["b1", "b2"] }]);
    assert.deepEqual(input.rollups.map((r) => r.eventId).sort(), ["a", "brand"]);
    assert.deepEqual(input.googleCampaignDays.map((g) => g.eventCode), ["C-BRAND"]);
    const ids = (table: string) => reads.filter((r) => r.table === table).flatMap((r) => r.filters.filter(([op, col]) => op === "in" && col === "event_id").flatMap(([, , v]) => v as string[]));
    for (const table of ["ticket_sales_snapshots", "signup_source_snapshots"]) assert.deepEqual(ids(table), ["a"], table);
  });
});
