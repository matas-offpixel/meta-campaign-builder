/**
 * HD3 parity: the server calc against the "NX Newcastle sales vs spend"
 * model on the 12 Nov data (fixtures/sales-12-nov.json).
 *
 * Every figure the model shows must match, except where the record
 * deliberately changes it. Each such difference is named by its rule:
 *   D12  spend across channels (TikTok and Google added to Meta)
 *   D13a since-launch cost per ticket: spend capped at the latest count
 *   D13b a window straddling the period start is pro-rated
 *   D13c daily £ per registration only inside the signup window
 *   D6   the projection is capped at the sellable allocation
 *   D10  the cases come from the library, not Enzo and DJ EZ
 *   ALL  All shows' daily tickets a day and cost per ticket sum every
 *        show's own window. The model grouped windows by their end day,
 *        which dropped a show counted on another day (Rudimental, 1→8 Oct,
 *        is missing from its 2–5 Oct step). Not in D13: flagged for a ruling.
 * A difference with no rule fails the test.
 *
 * PARITY_OUT=path writes the table (both values) as Markdown.
 *
 * Fixture rows are tuples:
 *   campaigns [id, name] · meta [campaign, day, spend, clicks, lpv, ic, atc]
 *   google [code, day, spend] · rollups [show, day, meta, tiktok, google, synced bits 1/2/4]
 *   signups [show, day, n]
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildSalesDashboard } from "../sales-calc/model.ts";
import { buildSeries, chartRows, endDayOf, periodFigures, project, buildLibrary, liftsFor, PERIOD_IDS, type PeriodId } from "../sales-calc/figures.ts";
import type { SalesCalcInput, ShowInput } from "../sales-calc/types.ts";
import {
  campaigns as campaignsRef,
  chartRowsRef,
  finalWeekRef,
  metaDaily,
  ticketWindows,
  totalsRef,
  trajectoryRef,
  type CountRow,
  type RegRow,
} from "./sales-calc-model-reference.ts";

type Fixture = {
  client: { id: string; name: string };
  today: string;
  shows: ShowInput[];
  campaigns: [string, string][];
  meta: [number, string, number, number, number, number, number][];
  google: [string, string, number][];
  rollups: [number, string, number | null, number | null, number | null, number][];
  signups: [number, string, number][];
};

export function loadFixture(): SalesCalcInput {
  const f = JSON.parse(readFileSync(new URL("./fixtures/sales-12-nov.json", import.meta.url), "utf8")) as Fixture;
  return {
    client: f.client,
    today: f.today,
    shows: f.shows,
    metaCampaignDays: f.meta.map(([c, day, spend, linkClicks, landingPageViews, initiateCheckouts, addsToCart]) => ({
      campaignId: f.campaigns[c][0],
      campaignName: f.campaigns[c][1],
      day,
      spend,
      linkClicks,
      landingPageViews,
      initiateCheckouts,
      addsToCart,
    })),
    googleCampaignDays: f.google.map(([eventCode, day, spend]) => ({ eventCode, day, spend })),
    rollups: f.rollups.map(([s, day, meta, tiktok, google, bits]) => ({
      eventId: f.shows[s].eventId,
      day,
      meta,
      tiktok,
      google,
      metaSynced: (bits & 1) !== 0,
      tiktokSynced: (bits & 2) !== 0,
      googleSynced: (bits & 4) !== 0,
    })),
    signups: f.signups.map(([s, day, signups]) => ({ eventId: f.shows[s].eventId, day, signups })),
    library: [],
  };
}

/** The model read Meta only. Strip the other channels to compare like with like; D12 is measured separately. */
function metaOnly(input: SalesCalcInput): SalesCalcInput {
  return { ...input, googleCampaignDays: [], rollups: input.rollups.map((r) => ({ ...r, tiktok: null, google: null, tiktokSynced: false, googleSynced: false })) };
}

const MODEL_PERIOD: Record<PeriodId, string> = { launch: "all", "30": "30", "14": "14", "7": "7", "3": "3", yesterday: "1" };

type Rule = "D12" | "D13a" | "D13b" | "D13c" | "D6" | "D10" | "ALL";
interface Row {
  show: string;
  figure: string;
  model: number | string | null;
  server: number | string | null;
  rule: Rule | null;
}

const close = (a: number | string | null, b: number | string | null) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a)) : a === b;

function compare(): { rows: Row[]; unexplained: Row[] } {
  const input = loadFixture();
  const meta = metaOnly(input);
  const md = metaDaily(input);
  const ticket_counts: CountRow[] = input.shows.flatMap((s) => s.counts.map((c) => ({ event_code: s.code, show: s.name, count_date: c.day, tickets_sold: c.sold })));
  const regs: RegRow[] = input.signups.map((s) => ({ event_code: input.shows.find((x) => x.eventId === s.eventId)!.code, day: s.day, registrations: s.signups }));
  const windows = ticketWindows(ticket_counts, md);
  const totals = totalsRef(md, windows, ticket_counts, regs);
  const chart = chartRowsRef(md, windows, regs);

  const endDay = endDayOf(input);
  const series = buildSeries(meta);
  const seriesAll = buildSeries(input);
  const byCode = new Map([...series.values()].map((s) => [s.show.code, s]));
  const byCodeAll = new Map([...seriesAll.values()].map((s) => [s.show.code, s]));
  const scope = [...new Set(md.map((r) => r.event_code))];
  const upcoming = scope.filter((c) => c !== "NX26-GLOBAL");

  const rows: Row[] = [];
  const unexplained: Row[] = [];
  const add = (show: string, figure: string, model: number | string | null, server: number | string | null, rule: Rule | null) => {
    if (close(model, server)) return;
    const row = { show, figure, model, server, rule };
    rows.push(row);
    if (!rule) unexplained.push(row);
  };

  // Period totals (D4): every show, All shows and the umbrella, every period.
  for (const period of PERIOD_IDS) {
    for (const code of [...scope, "ALL"]) {
      const ref = totals.find((t) => t.event_code === code && t.period === MODEL_PERIOD[period])!;
      const list = code === "ALL" ? upcoming.map((c) => byCode.get(c)!) : [byCode.get(code)!];
      const listAll = code === "ALL" ? upcoming.map((c) => byCodeAll.get(c)!) : [byCodeAll.get(code)!];
      const f = periodFigures(list, period, endDay);
      const fAll = periodFigures(listAll, period, endDay);
      const label = `${period === "launch" ? "since launch" : period === "yesterday" ? "yesterday" : `${period} days`}`;
      const name = code === "ALL" ? "All shows" : code;
      const umbrella = code === "NX26-GLOBAL";
      add(name, `spend · ${label}`, ref.spend, f.spend, null);
      add(name, `spend, all channels · ${label}`, ref.spend, fAll.spend, "D12");
      add(name, `checkout actions · ${label}`, ref.checkout_actions, f.checkoutActions, null);
      add(name, `£ per checkout action · ${label}`, ref.cost_per_checkout_action, f.costPerCheckout, null);
      add(name, `LPVs · ${label}`, ref.landing_page_views, f.landingPageViews, null);
      add(name, `£ per LPV · ${label}`, ref.cost_per_landing_page_view, f.costPerLpv, null);
      add(name, `clicks · ${label}`, ref.link_clicks, f.linkClicks, null);
      add(name, `CPC · ${label}`, ref.cost_per_click, f.cpc, null);
      add(name, `registrations · ${label}`, ref.registrations, f.registrations, null);
      add(name, `£ per registration · ${label}`, ref.cost_per_registration, f.costPerRegistration, null);
      if (umbrella) continue;
      add(name, `sold to date`, ref.sold_to_date, f.sold, null);
      add(name, `tickets · ${label}`, ref.tickets, f.tickets, period === "launch" ? null : "D13b");
      add(name, `cost per ticket · ${label}`, ref.cost_per_ticket, f.costPerTicket, period === "launch" ? "D13a" : "D13b");
      add(name, `cost per ticket, all channels · ${label}`, ref.cost_per_ticket, fAll.costPerTicket, "D12");
    }
  }

  // Daily chart rows (D5), on the model's days.
  for (const code of [...scope, "ALL"]) {
    const list = code === "ALL" ? upcoming.map((c) => byCode.get(c)!) : [byCode.get(code)!];
    const mine = new Map(chartRows(list, endDay).map((r) => [r.day, r]));
    for (const ref of chart.filter((r) => r.event_code === code)) {
      const r = mine.get(ref.day);
      const name = code === "ALL" ? "All shows" : code;
      const at = `${ref.day}`;
      add(name, `daily spend ${at}`, ref.spend, r?.spend ?? 0, null);
      add(name, `daily clicks ${at}`, ref.link_clicks, r?.linkClicks ?? 0, null);
      add(name, `daily LPVs ${at}`, ref.landing_page_views, r?.landingPageViews ?? 0, null);
      add(name, `daily checkout actions ${at}`, ref.checkout_actions, r?.checkoutActions ?? 0, null);
      add(name, `daily CPC ${at}`, ref.cost_per_click, r?.cpc ?? null, null);
      if (code === "NX26-GLOBAL") continue;
      add(name, `daily total sold ${at}`, ref.tickets_total, r?.sold ?? null, null);
      const all = code === "ALL" ? "ALL" : null;
      add(name, `daily tickets a day ${at}`, ref.tickets_per_day, r?.ticketsPerDay ?? null, all);
      add(name, `daily cost per ticket ${at}`, ref.cost_per_ticket, r?.costPerTicket ?? null, all);
      add(name, `daily registrations ${at}`, ref.registrations, r?.registrations ?? 0, null);
      add(name, `daily £ per registration ${at}`, ref.cost_per_registration, r?.costPerRegistration ?? null, "D13c");
    }
  }

  // Campaigns table: since launch and 14 days, per campaign.
  for (const ref of campaignsRef(input)) {
    const s = byCode.get(ref.event_code)!;
    const c = s.campaigns.find((x) => x.campaignId === ref.campaign_id);
    add(ref.event_code, `campaign ${ref.campaign_id} since launch`, ref.spend_all, c?.sinceLaunch ?? null, null);
    add(ref.event_code, `campaign ${ref.campaign_id} last spend day`, ref.last_spend_day, c?.lastSpendDay ?? null, null);
    add(ref.event_code, `campaign ${ref.campaign_id} not linked`, String(!ref.linked_to_event), String(c?.unlinked ?? null), null);
  }

  // Trajectory (D6, D10): the model's Enzo (×1.20) and DJ EZ lifts, from its reference CSV.
  const ref = finalWeekRef(REFERENCE_CSV);
  const djez = ref.find((r) => r.event_code === "NX26-DJEZ")!;
  const enzo = ref.find((r) => r.event_code === "NX26-ENZO")!;
  const traj = trajectoryRef(ticket_counts, md, { enzo: enzo.lift, djez: djez.lift });
  const { entries: library } = buildLibrary(series, [], input.today);
  for (const t of traj) {
    if (t.event_code === "NX26-GLOBAL") continue;
    const s = byCode.get(t.event_code)!;
    const lifts = liftsFor(s.show, library);
    const p = project(s, { average: lifts.average, best: lifts.best?.lift ?? null })!;
    add(t.event_code, "sold at latest count", t.sold, p.sold, null);
    add(t.event_code, "7-day pace", t.pace_7, p.pace7, null);
    add(t.event_code, "14-day pace", t.pace_14, p.pace14, null);
    add(t.event_code, "needed a day", t.needed_pace, p.neededPerDay, null);
    add(t.event_code, "sells out", t.sellout_date, p.sellsOutOn, null);
    const holdsModel = t.projected == null ? null : Math.round(t.projected);
    add(t.event_code, "holds", holdsModel, p.holds, holdsModel != null && holdsModel > (s.show.allocation ?? Infinity) ? "D6" : null);
    add(t.event_code, "case 2 (model: like Enzo; server: average finish)", t.projected_enzo == null ? null : Math.round(t.projected_enzo), p.average, "D10");
    add(t.event_code, "case 3 (model: like DJ EZ; server: best finish)", t.projected_djez == null ? null : Math.round(t.projected_djez), p.best, "D10");
  }
  add("Library", "DJ EZ lift", djez.lift, library.find((e) => e.code === "NX26-DJEZ")?.lift ?? null, null);
  add("Library", "Enzo lift (the model's case 2)", enzo.lift, null, "D10");
  return { rows, unexplained };
}

/** The model's reference_counts_v2.csv (DJ EZ, Enzo), as it read them on 13 Nov. */
const REFERENCE_CSV = [
  ["NX26-DJEZ", "2026-10-02", "2026-09-11", 132, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-09-14", 140, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-09-17", 149, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-09-18", 152, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-09-22", 163, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-09-24", 178, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-09-30", 292, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-10-01", 365, 0],
  ["NX26-DJEZ", "2026-10-02", "2026-10-02", 523, 218],
  ["NX26-ENZO", "2026-10-17", "2026-09-11", 561, 0],
  ["NX26-ENZO", "2026-10-17", "2026-09-14", 605, 0],
  ["NX26-ENZO", "2026-10-17", "2026-09-17", 626, 0],
  ["NX26-ENZO", "2026-10-17", "2026-09-18", 660, 0],
  ["NX26-ENZO", "2026-10-17", "2026-09-22", 704, 0],
  ["NX26-ENZO", "2026-10-17", "2026-09-24", 752, 0],
  ["NX26-ENZO", "2026-10-17", "2026-09-30", 944, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-01", 1001, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-05", 1142, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-08", 1345, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-09", 1373, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-12", 1510, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-13", 1553, 0],
  ["NX26-ENZO", "2026-10-17", "2026-10-14", 1626, 0],
].map(([event_code, show_date, count_date, tickets_sold, excluded_at_final]) => ({
  event_code: event_code as string,
  show_date: show_date as string,
  count_date: count_date as string,
  tickets_sold: tickets_sold as number,
  excluded_at_final: excluded_at_final as number,
}));

const fmt = (v: number | string | null) => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v);

describe("HD3 parity with the sales-vs-spend model on 12 Nov", () => {
  const { rows, unexplained } = compare();

  it("the fixture is the model's own data: Meta spend per show matches its meta_daily SQL run on 13 Nov", () => {
    const md = metaDaily(loadFixture());
    const total = (code: string) => md.filter((r) => r.event_code === code).reduce((a, r) => a + r.spend, 0);
    const SQL: Record<string, number> = {
      "NX26-DOD": 2019.85,
      "NX26-EED": 2753.69,
      "NX26-GLOBAL": 3854.28,
      "NX26-IPC": 2613.68,
      "NX26-LOCKLEAD": 1506.8,
      "NX26-ROBBIEDOHERTY": 2220.57,
      "NX26-RUDIMENTAL": 2206.37,
      "NX26-SCHAK": 2147.3,
      "NX27-EWANMCVICAR": 0,
      "NX27-JULIANFIJMA": 1267.93,
    };
    for (const [code, spend] of Object.entries(SQL)) assert.ok(Math.abs(total(code) - spend) < 0.02, `${code}: ${total(code)} vs SQL ${spend}`);
  });

  it("every difference from the model is one the record makes on purpose", () => {
    assert.deepEqual(unexplained.map((r) => `${r.show} · ${r.figure}: model ${fmt(r.model)}, server ${fmt(r.server)}`), []);
  });

  it("DJ EZ's lift is the model's ×3.32 (305 paid, 218 comps out)", () => {
    const input = loadFixture();
    const { entries } = buildLibrary(buildSeries(input), [], input.today);
    const djez = entries.find((e) => e.code === "NX26-DJEZ");
    assert.ok(djez);
    assert.equal(djez.finalPaid, 305);
    assert.equal(djez.compsExcluded, 218);
    assert.equal(Number(djez.lift.toFixed(2)), 3.32);
  });

  it("the model builds for the 12 Nov data without throwing, and All shows leaves the umbrella out", () => {
    const build = buildSalesDashboard(loadFixture());
    assert.ok(build.model.views.all);
    assert.ok(!build.model.shows.some((c) => c.kind === "show" && c.id === "nx26-global"));
    assert.equal(build.model.shows.at(-1)?.kind, "umbrella");
  });

  it("writes the parity table when PARITY_OUT is set", () => {
    const out = process.env.PARITY_OUT;
    if (!out) return;
    const lines = ["| Show | Figure | Model | Server | Rule |", "|---|---|---|---|---|"];
    for (const r of rows) lines.push(`| ${r.show} | ${r.figure} | ${fmt(r.model)} | ${fmt(r.server)} | ${r.rule ?? "**none**"} |`);
    writeFileSync(out, `${lines.join("\n")}\n`);
  });
});
