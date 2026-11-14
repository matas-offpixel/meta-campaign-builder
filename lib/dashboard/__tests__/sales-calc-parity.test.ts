/**
 * HD3 parity: the server calc against the "NX Newcastle sales vs spend"
 * model on the 12 Nov data (fixtures/sales-12-nov.json).
 *
 * Every figure the model shows must match, except where the record
 * deliberately changes it. Each such difference is named by its rule:
 *   D12  spend across channels (TikTok and Google added to Meta)
 *   D13a since-launch cost per ticket: spend capped at the latest count
 *   D13b a window straddling the period start is pro-rated
 *   D13c daily £ per registration only inside the signup window, else
 *        empty, never £0.00 (design, 14 Nov). All shows has no one signup
 *        window, so its daily figure is empty
 *   D6   the projection is capped at the sellable allocation
 *   D10  the cases come from the library, not Enzo and DJ EZ
 *   ALL  "The model drops windows by end day; corrected" (design, 14 Nov):
 *        All shows takes each show's value for the day from that show's own
 *        window. The model grouped windows by end day and dropped
 *        Rudimental's 1→8 Oct window from its 2–5 Oct step.
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
  /** The live Internal Counts per show: [day, paid, comps] and the is_final final [day, paid, comps]. */
  prodCounts: Record<string, { counts: [string, number, number | null][]; final: [string, number, number] | null }>;
};

function readFixture(): Fixture {
  return JSON.parse(readFileSync(new URL("./fixtures/sales-12-nov.json", import.meta.url), "utf8")) as Fixture;
}

/** The same rows with the counts the ingest wrote to prod (HD1) in place of the model's hand-parsed CSV. */
export function loadProdFixture(): SalesCalcInput {
  const f = readFixture();
  const input = loadFixture();
  return {
    ...input,
    shows: input.shows.map((s) => {
      const prod = f.prodCounts[s.code];
      if (!prod) return s;
      return {
        ...s,
        counts: prod.counts.map(([day, sold, comps]) => ({ day, sold, comps, source: "internal_counts" as const })),
        finalCount: prod.final ? { day: prod.final[0], paid: prod.final[1], comps: prod.final[2], source: "internal_counts" as const, blockId: null } : null,
      };
    }),
  };
}

export function loadFixture(): SalesCalcInput {
  const f = readFixture();
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

/** PRE: Total sold isn't drawn before the first count in scope (design's note on #1233); the model draws a flat 0. */
type Rule = "D12" | "D13a" | "D13b" | "D13c" | "D6" | "D10" | "ALL" | "COUNT" | "D8" | "FINAL" | "PRE";
interface Row {
  show: string;
  figure: string;
  model: number | string | null;
  server: number | string | null;
  rule: Rule | null;
}

const close = (a: number | string | null, b: number | string | null) =>
  typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a)) : a === b;

function compare(): { rows: Row[]; unexplained: Row[]; compared: number } {
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
  let compared = 0;
  const add = (show: string, figure: string, model: number | string | null, server: number | string | null, rule: Rule | null) => {
    compared += 1;
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
    const firstCount = list.flatMap((s) => (s.counts.length ? [s.counts[0].day] : [])).sort()[0] ?? null;
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
      add(name, `daily total sold ${at}`, ref.tickets_total, r?.sold ?? null, firstCount != null && ref.day < firstCount && ref.tickets_total === 0 && r?.sold == null ? "PRE" : null);
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
  return { rows, unexplained, compared };
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


/**
 * Part B: the server on the live Internal Counts (prod, HD1) against the
 * model on its hand-parsed CSV. First the counts themselves, show-day by
 * show-day; then the tile and trajectory figures. A figure may differ only
 * when the two count series differ on a day it depends on (COUNT), or by
 * D8 (paid only) or the final-count rule (FINAL).
 */
function compareProd(): { rows: Row[]; unexplained: Row[]; compared: number } {
  const csvInput = metaOnly(loadFixture());
  const prodInput = metaOnly(loadProdFixture());
  const endDay = endDayOf(csvInput);
  const csv = buildSeries(csvInput);
  const prod = buildSeries(prodInput);
  const csvBy = new Map([...csv.values()].map((s) => [s.show.code, s]));
  const prodBy = new Map([...prod.values()].map((s) => [s.show.code, s]));
  const rows: Row[] = [];
  const unexplained: Row[] = [];
  let compared = 0;
  const add = (show: string, figure: string, model: number | string | null, server: number | string | null, rule: Rule | null) => {
    compared += 1;
    if (close(model, server)) return;
    const row = { show, figure, model, server, rule };
    rows.push(row);
    if (!rule) unexplained.push(row);
  };

  // The counts, every show-day either source has.
  const differFrom = new Map<string, string | null>();
  for (const s of csvInput.shows) {
    const a = new Map(s.counts.map((c) => [c.day, c.sold]));
    const p = prodInput.shows.find((x) => x.eventId === s.eventId)!;
    const b = new Map(p.counts.map((c) => [c.day, c]));
    let first: string | null = null;
    for (const day of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const m = a.get(day) ?? null;
      const c = b.get(day);
      if (m === (c?.sold ?? null)) continue;
      first ??= day;
      const comps = c?.comps ?? 0;
      const rule: Rule = c && m != null && comps > 0 && m - c.sold === comps ? "D8" : "COUNT";
      const prior = p.counts.filter((x) => x.day < day).at(-1);
      const repeat = !c && prior != null && prior.sold === m;
      const why = repeat ? " (a repeat of the last count: the ingest writes none)" : !c ? " (not in prod)" : m == null ? " (not in the CSV)" : "";
      rows.push({ show: s.code, figure: `count ${day}${c && comps > 0 ? ` (paid; ${comps} comps)` : ""}${why}`, model: m, server: c?.sold ?? null, rule });
      compared += 1;
    }
    differFrom.set(s.code, first);
  }
  const fol = prodInput.shows.find((s) => s.code === "NX26-FOLAMOUR");
  const folCsv = csvInput.shows.find((s) => s.code === "NX26-FOLAMOUR");
  if (fol?.finalCount && folCsv) {
    add("NX26-FOLAMOUR", "final count (model: show-day count; server: latest on or after show day)", folCsv.counts.find((c) => c.day === fol.showDate)?.sold ?? null, fol.finalCount.paid, "FINAL");
  }

  const differsOnOrAfter = (codes: string[], day: string | null) =>
    codes.some((code) => {
      const first = differFrom.get(code);
      return first != null && (day == null || first >= day || lastDiff(code) >= day);
    });
  const lastDiff = (code: string) => {
    const a = csvBy.get(code)!.counts;
    const b = prodBy.get(code)!.counts;
    const days = [...new Set([...a.map((c) => c.day), ...b.map((c) => c.day)])].sort().reverse();
    return days.find((d) => a.find((c) => c.day === d)?.sold !== b.find((c) => c.day === d)?.sold) ?? "";
  };

  const scope = csvInput.shows.filter((s) => !s.isUmbrella && s.showDate >= csvInput.today && /^NX2[67]-/.test(s.code)).map((s) => s.code);
  for (const period of PERIOD_IDS) {
    for (const code of [...scope, "ALL"]) {
      const codes = code === "ALL" ? scope : [code];
      const a = periodFigures(codes.map((c) => csvBy.get(c)!), period, endDay);
      const b = periodFigures(codes.map((c) => prodBy.get(c)!), period, endDay);
      const cutoff = period === "launch" ? null : periodCutoffOf(period, endDay);
      const dependsFrom = cutoff == null ? null : earliestFrom(codes, cutoff);
      const label = period === "launch" ? "since launch" : period === "yesterday" ? "yesterday" : `${period} days`;
      const name = code === "ALL" ? "All shows" : code;
      const rule: Rule | null = differsOnOrAfter(codes, dependsFrom) ? "COUNT" : null;
      add(name, "sold to date (prod counts)", a.sold, b.sold, null);
      add(name, `tickets · ${label} (prod counts)`, a.tickets, b.tickets, period === "launch" ? null : rule);
      add(name, `cost per ticket · ${label} (prod counts)`, a.costPerTicket, b.costPerTicket, period === "launch" ? null : rule);
    }
  }
  function earliestFrom(codes: string[], cutoff: string): string {
    let day = cutoff;
    for (const code of codes) for (const s of [csvBy.get(code)!, prodBy.get(code)!]) for (const w of s.windows) if (w.to >= cutoff && w.from < day) day = w.from;
    return day;
  }
  for (const code of scope) {
    const a = csvBy.get(code)!;
    const b = prodBy.get(code)!;
    if (!a.counts.length && !b.counts.length) continue;
    const pa = project(a, { average: null, best: null });
    const pb = project(b, { average: null, best: null });
    const from = [pa?.base7.day, pb?.base7.day].filter((d): d is string => !!d).sort()[0] ?? null;
    const base14 = (s: typeof a) => {
      const last = s.counts.at(-1)!.day;
      return s.counts.filter((c) => c.day <= addDaysIso(last, -14)).pop()?.day ?? s.counts[0].day;
    };
    const from14 = [base14(a), base14(b)].sort()[0];
    add(code, "7-day pace (prod counts)", pa?.pace7 ?? null, pb?.pace7 ?? null, differsOnOrAfter([code], from) ? "COUNT" : null);
    add(code, "14-day pace (prod counts)", pa?.pace14 ?? null, pb?.pace14 ?? null, differsOnOrAfter([code], from14) ? "COUNT" : null);
    add(code, "holds (prod counts)", pa?.holds ?? null, pb?.holds ?? null, differsOnOrAfter([code], from) ? "COUNT" : null);
    add(code, "needed a day (prod counts)", pa?.neededPerDay ?? null, pb?.neededPerDay ?? null, null);
  }
  return { rows, unexplained, compared };
}

function periodCutoffOf(period: PeriodId, endDay: string): string {
  const n = { "30": 30, "14": 14, "7": 7, "3": 3, yesterday: 1 }[period as Exclude<PeriodId, "launch">];
  return addDaysIso(endDay, -(n - 1));
}

function addDaysIso(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const fmt = (v: number | string | null) => (v == null ? "—" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v);

describe("HD3 parity with the sales-vs-spend model on 12 Nov", () => {
  const { rows, unexplained, compared } = compare();
  const prodPart = compareProd();

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

  it("on the live Internal Counts, every difference from the CSV model comes from the counts themselves", () => {
    assert.deepEqual(prodPart.unexplained.map((r) => `${r.show} · ${r.figure}: model ${fmt(r.model)}, server ${fmt(r.server)}`), []);
    const input = loadProdFixture();
    const { entries } = buildLibrary(buildSeries(input), [], input.today);
    assert.deepEqual(
      entries.map((e) => [e.code, e.finalPaid, e.compsExcluded, Number(e.lift.toFixed(2))]),
      [
        ["NX26-DJEZ", 305, 218, 3.32],
        ["NX26-MF", 996, 0, 4.52],
        ["NX26-FOLAMOUR", 1292, 0, 2.23],
        ["ES26-GDS", 922, 0, 1.81],
        ["ES26-FEVER105", 242, 0, 3.25],
        ["NX26-AZYR", 1309, 0, 2.95],
      ],
    );
  });

  it("D10 on the live counts: Folamour's lift worked to the number, from its 26 Oct final", () => {
    const input = loadProdFixture();
    const { entries } = buildLibrary(buildSeries(input), [], input.today);
    const fol = entries.find((e) => e.code === "NX26-FOLAMOUR")!;
    // Show 23 Oct. D−21 = 2 Oct, between 1 Oct (1,116) and 5 Oct (1,137): 1,116 + 21 × 1/4 = 1,121.25.
    // D−7 = 16 Oct, a count: 1,202. Final 1,292 (26 Oct, the latest on or after show day), drawn on show day.
    assert.equal(fol.d21Day, "2026-10-02");
    assert.equal(fol.d21Sold, 1121.25);
    assert.equal(fol.d7Day, "2026-10-16");
    assert.equal(fol.d7Sold, 1202);
    assert.equal(fol.finalDay, "2026-10-26");
    assert.equal(fol.finalPaid, 1292);
    assert.equal(fol.perDayBefore, (1202 - 1121.25) / 14);
    assert.equal(fol.perDayFinalWeek, (1292 - 1202) / 7);
    assert.equal(fol.lift, (90 / 7) / (80.75 / 14));
    assert.equal(Number(fol.lift.toFixed(3)), 2.229);
  });

  it("the cases read from the data: the client-wide library, Sheffield included (Matas, 14 Nov)", () => {
    const input = loadProdFixture();
    const build = buildSalesDashboard(input);
    const lifts = build.library.map((e) => e.lift);
    assert.equal(lifts.length, 6);
    const average = lifts.reduce((a, b) => a + b, 0) / lifts.length;
    const best = build.library.reduce((a, b) => (b.lift > a.lift ? b : a));
    const t = build.model.views["nx26-ipc"].trajectory;
    assert.ok(t.kind === "single");
    if (t.kind !== "single") return;
    assert.deepEqual(t.cases.map((c) => c.label), [
      "Holds",
      `Like your average finish (×${Number(average.toFixed(2))}, 6 shows)`,
      `Like your best finish (×${Number(best.lift.toFixed(2))}, ${best.name})`,
    ]);
    assert.equal(best.name, "Modern Funktion");
    assert.equal(
      t.libraryNote,
      "Average and best from 6 finished shows: DJ EZ (2 Oct), Modern Funktion (16 Oct), Folamour (23 Oct), Girls Don't Sync (31 Oct), Sheffield Fever 105 (6 Nov), AZYR b2b Partiboi69 (7 Nov).",
    );
  });

  it("an event's own reference shows override the library for that event only", () => {
    const input = loadProdFixture();
    const djez = input.shows.find((s) => s.code === "NX26-DJEZ")!.eventId;
    const fol = input.shows.find((s) => s.code === "NX26-FOLAMOUR")!.eventId;
    const shows = input.shows.map((s) => (s.code === "NX26-IPC" ? { ...s, referenceEventIds: [djez, fol] } : s));
    const build = buildSalesDashboard({ ...input, shows });
    const ipc = build.model.views["nx26-ipc"].trajectory;
    const dod = build.model.views["nx26-dod"].trajectory;
    assert.ok(ipc.kind === "single" && dod.kind === "single");
    if (ipc.kind !== "single" || dod.kind !== "single") return;
    const own = build.library.filter((e) => e.eventId === djez || e.eventId === fol);
    const avg = (own[0].lift + own[1].lift) / 2;
    assert.equal(ipc.cases[1].label, `Like your average finish (×${Number(avg.toFixed(2))}, 2 shows)`);
    assert.equal(ipc.cases[2].label, `Like your best finish (×${Number(own[0].lift.toFixed(2))}, DJ EZ)`);
    assert.match(dod.cases[1].label, /, 6 shows\)$/);
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
    const lines = [`${compared} figures compared; ${compared - rows.length} match; ${rows.length} differ, each by a rule.`, "", "| Show | Figure | Model | Server | Rule |", "|---|---|---|---|---|"];
    for (const r of rows) lines.push(`| ${r.show} | ${r.figure} | ${fmt(r.model)} | ${fmt(r.server)} | ${r.rule ?? "**none**"} |`);
    lines.push("", `Part B, the server on the live Internal Counts against the model on its CSV: ${prodPart.compared} figures compared; ${prodPart.compared - prodPart.rows.length} match; ${prodPart.rows.length} differ, each by a rule.`, "", "| Show | Figure | Model (CSV) | Server (prod) | Rule |", "|---|---|---|---|---|");
    for (const r of prodPart.rows) lines.push(`| ${r.show} | ${r.figure} | ${fmt(r.model)} | ${fmt(r.server)} | ${r.rule ?? "**none**"} |`);
    writeFileSync(out, `${lines.join("\n")}\n`);
  });
});
