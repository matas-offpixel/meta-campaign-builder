/**
 * lib/dashboard/sales-live-like-input.ts
 *
 * The live-like input for dashboard v2's phone frames and overflow guard
 * (docs/design-record/2026-11-14-dashboard-v2-phone.html). Invented rows,
 * shaped like the live NX Newcastle data on 14 Nov, that the real calc
 * (buildSalesDashboard) turns into the page. So the header sentence, the
 * tiles, the chart, the stamps and the campaigns all come from the same
 * rows and can't disagree (design's note on #1232).
 *
 * Aimed at the record's live set: £14,216 spend since launch (Meta £14,078,
 * TikTok £119, Google £19), 6,795 sold across 7 shows, counts 12 Nov, spend
 * 13 Nov, £2.08 of spend per ticket on spend to the 12 Nov count, umbrella
 * £4,309, 4,276 registrations. Everything else (pace, projections, cost per
 * registration) is whatever the calc makes of these rows.
 *
 * Real show names, invented ids and figures. Relative imports only.
 */

import type { MetaCampaignDay, RollupDay, SalesCalcInput, ShowCount, ShowInput, SignupDay } from "./sales-calc/types.ts";

const TODAY = "2026-11-14";
const FIRST_DAY = "2026-08-14";
const END_DAY = "2026-11-13";
const COUNT_END = "2026-11-12";

/** The real NX count days. */
const COUNT_DAYS = [
  "2026-09-11", "2026-09-14", "2026-09-17", "2026-09-18", "2026-09-22", "2026-09-24", "2026-09-30",
  "2026-10-01", "2026-10-05", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14",
  "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-23", "2026-10-26", "2026-10-27", "2026-10-28",
  "2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06",
  "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12",
];

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

type ShowPlan = {
  id: string;
  code: string;
  name: string;
  showDate: string;
  presale: string | null;
  venue: string;
  venueName: string;
  /** First count day and its figure, then the final figure on the last count day. */
  firstCount?: [string, number];
  lastCount?: [string, number];
  /** Meta spend to 13 Nov, and the share of it that lands on 13 Nov. */
  meta: number;
  tiktok?: number;
  google?: number;
  campaigns: number;
  spending: number;
  signups?: number;
  page?: string;
  umbrella?: boolean;
  finished?: boolean;
};

/**
 * NX's seven counted shows sum to 6,795 on 12 Nov; their Meta + TikTok +
 * Google is £14,216 with £82 of it on 13 Nov (after every count), so cost per
 * ticket is £14,134 / 6,795 = £2.08.
 */
const PLANS: ShowPlan[] = [
  { id: "ipc", code: "NX26-IPC", name: "Interplanetary Criminal", showDate: "2026-11-21", presale: "2026-08-13", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-11", 1010], lastCount: [COUNT_END, 1828], meta: 3412, tiktok: 119, campaigns: 6, spending: 2 },
  { id: "robbie", code: "NX26-ROBBIEDOHERTY", name: "Robbie Doherty", showDate: "2026-11-27", presale: "2026-10-08", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-10-08", 200], lastCount: [COUNT_END, 497], meta: 1630, campaigns: 4, spending: 1, signups: 812, page: "nx-robbie-doherty" },
  { id: "dod", code: "NX26-DOD", name: "D.O.D", showDate: "2026-12-04", presale: "2026-09-09", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-11", 519], lastCount: [COUNT_END, 932], meta: 2196, google: 19, campaigns: 5, spending: 1, signups: 905, page: "nx-dod" },
  { id: "locklead", code: "NX26-LOCKLEAD", name: "Locklead", showDate: "2026-12-11", presale: "2026-11-06", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-11-06", 226], lastCount: [COUNT_END, 372], meta: 1104, campaigns: 3, spending: 1, signups: 688, page: "nx-locklead" },
  { id: "rudimental", code: "NX26-RUDIMENTAL", name: "Rudimental", showDate: "2026-12-12", presale: "2026-10-01", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-24", 0], lastCount: [COUNT_END, 717], meta: 1890, campaigns: 5, spending: 1, signups: 764, page: "nx-rudimental" },
  { id: "schak", code: "NX26-SCHAK", name: "Schak", showDate: "2026-12-18", presale: null, venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-24", 0], lastCount: [COUNT_END, 1870], meta: 2486, campaigns: 3, spending: 1, signups: 531, page: "nx-schak" },
  { id: "ewan", code: "NX27-EWANMCVICAR", name: "Ewan McVicar", showDate: "2027-02-26", presale: "2026-11-20", venue: "nx newcastle", venueName: "NX Newcastle", meta: 0, campaigns: 0, spending: 0, signups: 214, page: "nx-ewan-mcvicar" },
  { id: "julian", code: "NX27-JULIANFIJMA", name: "Julian Fijma", showDate: "2027-03-19", presale: "2026-11-03", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-11-03", 0], lastCount: [COUNT_END, 579], meta: 1360, campaigns: 3, spending: 0, signups: 362, page: "nx-julian-fijma" },
  { id: "global", code: "NX26-GLOBAL", name: "Global Marketing", showDate: "2026-11-27", presale: null, venue: "nx newcastle", venueName: "NX Newcastle", meta: 4309, campaigns: 2, spending: 1, umbrella: true },
  // Finished NX shows: the client's own library (D10).
  { id: "djez", code: "NX26-DJEZ", name: "DJ EZ", showDate: "2026-10-02", presale: "2026-08-21", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-11", 132], lastCount: ["2026-10-02", 305], meta: 820, campaigns: 1, spending: 0, finished: true },
  { id: "mf", code: "NX26-MF", name: "Modern Funktion", showDate: "2026-10-16", presale: "2026-08-05", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-11", 498], lastCount: ["2026-10-16", 940], meta: 960, campaigns: 1, spending: 0, finished: true },
  { id: "folamour", code: "NX26-FOLAMOUR", name: "Folamour", showDate: "2026-10-23", presale: "2026-09-03", venue: "nx newcastle", venueName: "NX Newcastle", firstCount: ["2026-09-11", 831], lastCount: ["2026-10-23", 1495], meta: 1010, campaigns: 0, spending: 0, finished: true },
  // Two more venues: four options in the venue row.
  { id: "kream", code: "EB26-KREAM", name: "Kream", showDate: "2026-12-05", presale: "2026-10-24", venue: "electric bristol", venueName: "Electric Bristol", firstCount: ["2026-10-26", 120], lastCount: [COUNT_END, 336], meta: 640, campaigns: 0, spending: 0 },
  { id: "fever", code: "ES26-FEVER105", name: "Fever 105", showDate: "2026-12-12", presale: "2026-10-09", venue: "electric studios", venueName: "Electric Studios", firstCount: ["2026-10-08", 0], lastCount: [COUNT_END, 404], meta: 720, campaigns: 0, spending: 0 },
];

/** Each show's last-day share of Meta spend; NX's counted shows land £82 in all on 13 Nov. */
const LAST_DAY: Record<string, number> = { ipc: 24, robbie: 10, dod: 14, locklead: 9, rudimental: 13, schak: 12, global: 30, kream: 12, fever: 10 };

function counts(plan: ShowPlan, lastDay: string): ShowCount[] {
  if (!plan.firstCount || !plan.lastCount) return [];
  const [d0, v0] = plan.firstCount;
  const [, v1] = plan.lastCount;
  const end = lastDay;
  const list = [...new Set([d0, ...COUNT_DAYS.filter((d) => d > d0 && d <= end)])].filter((d) => d <= end).sort();
  const span = Date.parse(end) - Date.parse(d0) || 1;
  return list.map((day) => {
    // Sales slow towards the last count, so the 7-day pace sits under the 14-day one (as live).
    const t = (Date.parse(day) - Date.parse(d0)) / span;
    // The finished shows (the library) sped up into show day, so their final-week lift is above 1.
    const eased = plan.finished ? t ** 2.2 : 1 - (1 - t) ** 1.8;
    return { day, sold: Math.round(v0 + (v1 - v0) * Math.min(1, eased)), comps: 0, source: "internal_counts" as const };
  });
}

function showInput(plan: ShowPlan, index: number, lastCountDay: string): ShowInput {
  const end = plan.finished ? plan.showDate : lastCountDay;
  const list = counts(plan, plan.finished ? plan.showDate : end);
  return {
    eventId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    code: plan.code,
    name: plan.name,
    showDate: plan.showDate,
    presaleDate: plan.presale,
    capacity: plan.umbrella ? null : 2000,
    allocation: plan.umbrella ? null : 2000,
    allocationFromTiers: false,
    isUmbrella: plan.umbrella ?? false,
    cirqlinPageId: plan.page ? `page-${plan.id}` : null,
    cirqlinPageSlug: plan.page ?? null,
    venueKey: plan.venue,
    venueName: plan.venueName,
    linkedCampaignIds: [],
    referenceEventIds: [],
    counts: list,
    finalCount: plan.finished && list.length ? { day: addDays(plan.showDate, 2), paid: list[list.length - 1].sold, comps: 0, source: "internal_counts", blockId: null } : null,
  };
}

/** Spread `total` over `ds`, rising over time, landing `last` on the final day, to the penny. */
function spread(total: number, ds: string[], last: number): Map<string, number> {
  const out = new Map<string, number>();
  if (total <= 0 || ds.length === 0) return out;
  const head = ds.slice(0, -1);
  const weights = head.map((_, i) => 1 + i / Math.max(1, head.length));
  const sum = weights.reduce((a, w) => a + w, 0);
  let given = 0;
  head.forEach((d, i) => {
    const v = Math.round(((total - last) * weights[i] * 100) / sum) / 100;
    out.set(d, v);
    given += v;
  });
  out.set(ds[ds.length - 1], Math.round((total - given) * 100) / 100);
  return out;
}

/** A show whose campaigns all stopped on 6 Nov spends nothing after it. */
const STOPPED = "2026-11-06";

function spendingCampaigns(plan: ShowPlan): number {
  return plan.campaigns === 0 ? 1 : plan.spending;
}

function spendDays(plan: ShowPlan): string[] {
  const start = plan.presale && plan.presale > FIRST_DAY ? addDays(plan.presale, -14) : FIRST_DAY;
  const end = plan.finished ? plan.showDate : spendingCampaigns(plan) === 0 ? STOPPED : END_DAY;
  return days(start < FIRST_DAY ? FIRST_DAY : start, end);
}

function build(lastCountDayFor: (plan: ShowPlan) => string): SalesCalcInput {
  const shows = PLANS.map((p, i) => showInput(p, i, lastCountDayFor(p)));
  const meta: MetaCampaignDay[] = [];
  const rollups: RollupDay[] = [];
  const signups: SignupDay[] = [];
  let campaignNo = 0;
  for (const plan of PLANS) {
    const show = shows.find((s) => s.code === plan.code)!;
    const ds = spendDays(plan);
    // Meta: each day's spend is split exactly among the campaigns running that day. The spending ones run to
    // 13 Nov; the rest stopped on 6 Nov.
    const lastShare = plan.finished || spendingCampaigns(plan) === 0 ? 0 : (LAST_DAY[plan.id] ?? 0);
    const metaByDay = spread(plan.meta, ds, lastShare);
    const n = Math.max(1, plan.campaigns);
    const ids = Array.from({ length: n }, () => `c${String((campaignNo += 1)).padStart(4, "0")}`);
    const kinds = ["On Sale — Adv+", "Presale", "Stories", "Retargeting", "Announce", "Lookalike"];
    for (const [day, value] of metaByDay) {
      const running = day <= STOPPED ? n : spendingCampaigns(plan);
      let left = Math.round(value * 100);
      for (let c = 0; c < running; c++) {
        const pennies = c === running - 1 ? left : Math.round((value * 100) / running);
        left -= pennies;
        const v = pennies / 100;
        if (v <= 0) continue;
        meta.push({
          campaignId: ids[c],
          campaignName: `[${plan.code}] ${kinds[c % kinds.length]}`,
          day,
          spend: v,
          linkClicks: Math.round(v * 4.06),
          landingPageViews: Math.round(v * 3.27),
          initiateCheckouts: Math.round(v * 0.12),
          addsToCart: Math.round(v * 0.07),
        });
      }
    }
    // TikTok and Google come through the rollups.
    const tt = spread(plan.tiktok ?? 0, ds.filter((d) => d >= "2026-10-20"), 0);
    const gg = spread(plan.google ?? 0, ds.filter((d) => d >= "2026-10-01"), 0);
    for (const day of new Set([...tt.keys(), ...gg.keys()])) {
      rollups.push({ eventId: show.eventId, day, meta: null, tiktok: tt.get(day) ?? null, google: gg.get(day) ?? null, metaSynced: false, tiktokSynced: tt.has(day), googleSynced: gg.has(day) });
    }
    // Signups on the show's page, before it went on sale (Ewan's page is still open on 13 Nov).
    if (plan.signups && plan.page) {
      const close = plan.presale && plan.presale <= END_DAY ? addDays(plan.presale, -1) : END_DAY;
      const open = addDays(close, -13) < ds[0] ? ds[0] : addDays(close, -13);
      const sd = days(open, close).filter((d) => ds.includes(d));
      let left = plan.signups;
      sd.forEach((day, i) => {
        const v = i === sd.length - 1 ? left : Math.round(plan.signups! / sd.length);
        left -= v;
        signups.push({ eventId: show.eventId, day, signups: v });
      });
    }
  }
  return {
    client: { id: "live-like", name: "NX Newcastle" },
    today: TODAY,
    shows,
    metaCampaignDays: meta,
    googleCampaignDays: [],
    rollups,
    signups,
    library: [],
  };
}

/** Every show in scope last counted on 12 Nov: "(Internal Counts, 12 Nov) … on spend to the 12 Nov count" (MBV1–MBV4). */
export const LIVE_LIKE_INPUT: SalesCalcInput = build(() => COUNT_END);

/**
 * The longest header sentence (MB1's guard): Julian Fijma last counted on
 * 11 Nov, so the shows' count days differ: "(Internal Counts, to 12 Nov) …
 * on spend to each show's last count (latest 12 Nov)".
 */
export const LIVE_LIKE_MIXED_INPUT: SalesCalcInput = build((p) => (p.id === "julian" ? "2026-11-11" : COUNT_END));
