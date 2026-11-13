/**
 * The "NX Newcastle sales vs spend" model's calcs (artifact
 * 1WbbWGeA1hvTfx7dkS9duj, page v13, read 13 Nov 2026), ported line for
 * line with d3 replaced by plain loops, plus its two SQL datasets
 * (meta_daily, campaigns) as functions over the same raw rows the server
 * calc reads. The parity test runs both on the 12 Nov data.
 *
 * Kept as the model wrote it, including what D13 fixes. Test-only.
 */

import type { SalesCalcInput } from "../sales-calc/types.ts";

const DAY = 864e5;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const sum = <T>(rows: readonly T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0);
const max = <T>(rows: readonly T[], f: (r: T) => string | number | null | undefined) => {
  let out: string | number | undefined;
  for (const r of rows) {
    const v = f(r);
    if (v == null) continue;
    if (out === undefined || v > out) out = v;
  }
  return out;
};
const min = <T>(rows: readonly T[], f: (r: T) => string | undefined) => {
  let out: string | undefined;
  for (const r of rows) {
    const v = f(r);
    if (v == null) continue;
    if (out === undefined || v < out) out = v;
  }
  return out;
};
function groups<T>(rows: readonly T[], key: (r: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return [...m.entries()];
}

export interface MetaDailyRow {
  event_code: string;
  show: string;
  show_date: string;
  presale_date: string | null;
  day: string;
  spend: number;
  dashboard_spend: number;
  unlinked_spend: number;
  link_clicks: number;
  landing_page_views: number;
  initiate_checkouts: number;
  adds_to_cart: number;
}

/** The meta_daily SQL, over raw rows. `today` is the model's current_date. */
export function metaDaily(input: SalesCalcInput): MetaDailyRow[] {
  const today = input.today;
  const ev = input.shows.filter((s) => /^NX2[67]-/.test(s.code) && s.showDate >= today);
  const evCodes = new Set(ev.map((s) => s.code));
  const linked = new Map<string, string>();
  for (const s of ev) for (const id of s.linkedCampaignIds) linked.set(id, s.code);
  const names = new Map<string, string>();
  for (const r of input.metaCampaignDays) {
    const n = names.get(r.campaignId);
    if (n == null || r.campaignName > n) names.set(r.campaignId, r.campaignName);
  }
  const map = new Map<string, { linked: string | null; tag: string | null }>();
  for (const [cid, nm] of names) {
    const tag = ev.find((s) => nm.includes(`[${s.code}]`))?.code ?? null;
    map.set(cid, { linked: linked.get(cid) ?? null, tag });
  }
  const ins = new Map<string, { linked: number; unlinked: number; lc: number; lpv: number; ic: number; atc: number }>();
  for (const r of input.metaCampaignDays) {
    const m = map.get(r.campaignId);
    const code = m?.linked ?? m?.tag ?? null;
    if (!code || r.day >= today) continue;
    const key = `${code}|${r.day}`;
    const a = ins.get(key) ?? { linked: 0, unlinked: 0, lc: 0, lpv: 0, ic: 0, atc: 0 };
    if (m!.linked) a.linked += r.spend;
    else a.unlinked += r.spend;
    a.lc += r.linkClicks;
    a.lpv += r.landingPageViews;
    a.ic += r.initiateCheckouts;
    a.atc += r.addsToCart;
    ins.set(key, a);
  }
  const codeOf = new Map(input.shows.map((s) => [s.eventId, s.code]));
  const roll = new Map<string, number>();
  for (const r of input.rollups) {
    const code = codeOf.get(r.eventId);
    if (!code || !evCodes.has(code) || r.day >= today) continue;
    roll.set(`${code}|${r.day}`, r.meta ?? 0);
  }
  const keys = new Set([...roll.keys(), ...ins.keys()]);
  const show = new Map(ev.map((s) => [s.code, s]));
  const out: MetaDailyRow[] = [];
  for (const key of keys) {
    const [code, day] = key.split("|");
    const s = show.get(code)!;
    const r = roll.get(key) ?? 0;
    const i = ins.get(key);
    out.push({
      event_code: code,
      show: s.name,
      show_date: s.showDate,
      presale_date: s.presaleDate,
      day,
      spend: Math.max(r, (i?.linked ?? 0) + (i?.unlinked ?? 0)),
      dashboard_spend: r,
      unlinked_spend: i?.unlinked ?? 0,
      link_clicks: i?.lc ?? 0,
      landing_page_views: i?.lpv ?? 0,
      initiate_checkouts: i?.ic ?? 0,
      adds_to_cart: i?.atc ?? 0,
    });
  }
  out.sort((a, b) => a.show_date.localeCompare(b.show_date) || a.event_code.localeCompare(b.event_code) || a.day.localeCompare(b.day));
  return out;
}

export interface CampaignRow {
  event_code: string;
  campaign_id: string;
  campaign: string;
  linked_to_event: boolean;
  last_spend_day: string | null;
  spend_all: number;
  spend_14: number;
}

/** The campaigns SQL (spend_all, spend_14 and the last spend day). */
export function campaigns(input: SalesCalcInput): CampaignRow[] {
  const today = input.today;
  const ev = input.shows.filter((s) => /^NX2[67]-/.test(s.code) && s.showDate >= today);
  const linked = new Map<string, string>();
  for (const s of ev) for (const id of s.linkedCampaignIds) linked.set(id, s.code);
  const names = new Map<string, string>();
  for (const r of input.metaCampaignDays) {
    const n = names.get(r.campaignId);
    if (n == null || r.campaignName > n) names.set(r.campaignId, r.campaignName);
  }
  const cut14 = iso(Date.parse(today) - 14 * DAY);
  const out = new Map<string, CampaignRow>();
  for (const r of input.metaCampaignDays) {
    if (r.day >= today) continue;
    const nm = names.get(r.campaignId)!;
    const l = linked.get(r.campaignId) ?? null;
    const code = l ?? ev.find((s) => nm.includes(`[${s.code}]`))?.code ?? null;
    if (!code) continue;
    const row = out.get(r.campaignId) ?? { event_code: code, campaign_id: r.campaignId, campaign: nm, linked_to_event: l != null, last_spend_day: null, spend_all: 0, spend_14: 0 };
    row.spend_all += r.spend;
    if (r.day >= cut14) row.spend_14 += r.spend;
    if (r.spend > 0 && (row.last_spend_day == null || r.day > row.last_spend_day)) row.last_spend_day = r.day;
    out.set(r.campaignId, row);
  }
  return [...out.values()].filter((r) => r.spend_all > 0);
}

export interface CountRow {
  event_code: string;
  show: string;
  count_date: string;
  tickets_sold: number;
}

export interface RegRow {
  event_code: string;
  day: string;
  registrations: number;
}

export interface Window {
  key: string;
  event_code: string;
  from: string;
  to: string;
  days: number;
  start_count?: number;
  tickets: number;
  tickets_per_day: number;
  spend: number;
  spend_complete: boolean;
  cost_per_ticket: number | null;
}

export function ticketWindows(ticket_counts: CountRow[], meta_daily: MetaDailyRow[]): Window[] {
  const spendOn = new Map(meta_daily.map((r) => [r.event_code + "|" + r.day, +r.spend]));
  const lastSpendDay = max(meta_daily, (r) => r.day) as string;
  const out: Window[] = [];
  const inScope = new Set(meta_daily.map((r) => r.event_code));
  const byShow = groups(
    ticket_counts.filter((r) => inScope.has(r.event_code)).map((r) => ({ code: r.event_code, show: r.show, date: String(r.count_date).slice(0, 10), n: Number(r.tickets_sold) })),
    (r) => r.code,
  );
  for (const [code, list] of byShow) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const days = Math.round((Date.parse(b.date) - Date.parse(a.date)) / DAY);
      let spend = 0;
      for (let k = 1; k <= days; k++) spend += spendOn.get(code + "|" + iso(Date.parse(a.date) + k * DAY)) || 0;
      const tickets = b.n - a.n;
      const partial = b.date > lastSpendDay;
      out.push({ key: code + "|" + b.date, event_code: code, from: a.date, to: b.date, days, start_count: a.n, tickets, tickets_per_day: tickets / days, spend, spend_complete: !partial, cost_per_ticket: tickets > 0 && !partial ? spend / tickets : null });
    }
  }
  for (const [to, list] of groups(out.slice(), (r) => r.to)) {
    const from = max(list, (r) => r.from) as string;
    const tickets = sum(list, (r) => r.tickets);
    const spend = sum(list, (r) => r.spend);
    const partial = list.some((r) => !r.spend_complete);
    out.push({ key: "ALL|" + to, spend_complete: !partial, event_code: "ALL", from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / DAY), tickets, tickets_per_day: sum(list, (r) => r.tickets_per_day), spend, cost_per_ticket: tickets > 0 && !partial ? spend / tickets : null });
  }
  return out;
}

export interface ChartRowRef {
  event_code: string;
  day: string;
  spend: number;
  tickets_per_day: number | null;
  cost_per_ticket: number | null;
  checkout_actions: number;
  cost_per_checkout_action: number | null;
  landing_page_views: number;
  cost_per_landing_page_view: number | null;
  link_clicks: number;
  cost_per_click: number | null;
  registrations: number;
  cost_per_registration: number | null;
  tickets_total: number | null;
}

export function chartRowsRef(meta_daily: MetaDailyRow[], ticket_windows: Window[], registrations: RegRow[]): ChartRowRef[] {
  const regOn = new Map<string, Map<string, number>>();
  for (const r of registrations) {
    const m = regOn.get(r.event_code) ?? new Map<string, number>();
    m.set(r.day, (m.get(r.day) ?? 0) + +r.registrations);
    regOn.set(r.event_code, m);
  }
  const presale = new Map(meta_daily.map((r) => [r.event_code, r.presale_date]));
  const series = new Map<string, { d: string; n: number }[]>();
  for (const [code, ws] of groups(ticket_windows.filter((w) => w.event_code !== "ALL"), (w) => w.event_code)) {
    ws.sort((a, b) => a.to.localeCompare(b.to));
    const first = ws[0];
    const pts = [{ d: first.from, n: first.start_count! }];
    for (const w of ws) pts.push({ d: w.to, n: w.start_count! + w.tickets });
    series.set(code, pts);
  }
  const soldOn = (code: string, day: string): number | null => {
    const pts = series.get(code);
    if (!pts) return null;
    if (day < pts[0].d) {
      const ps = presale.get(code);
      return (ps && day < ps) || pts[0].n === 0 ? 0 : null;
    }
    for (let k = 1; k < pts.length; k++)
      if (day <= pts[k].d) {
        const a = pts[k - 1];
        const b = pts[k];
        const t = (Date.parse(day) - Date.parse(a.d)) / (Date.parse(b.d) - Date.parse(a.d));
        return a.n + (b.n - a.n) * t;
      }
    return pts[pts.length - 1].n;
  };
  const showCodesWithCounts = [...series.keys()];
  const soldFor = (code: string, day: string) => {
    if (code !== "ALL") return soldOn(code, day);
    let s = 0;
    for (const k of showCodesWithCounts) {
      const v = soldOn(k, day);
      if (v == null) return null;
      s += v;
    }
    return s;
  };
  const regsFor = (code: string, day: string, rows: MetaDailyRow[]) =>
    code === "ALL" ? sum(rows, (r) => regOn.get(r.event_code)?.get(day) ?? 0) : regOn.get(code)?.get(day) ?? 0;
  const make = (code: string, day: string, rows: MetaDailyRow[]): ChartRowRef => {
    const regs = regsFor(code, day, rows);
    const soldTotal = soldFor(code, day);
    const spend = sum(rows, (r) => +r.spend);
    const ca = sum(rows, (r) => +r.initiate_checkouts + +r.adds_to_cart);
    const lpv = sum(rows, (r) => +r.landing_page_views);
    const clicks = sum(rows, (r) => +r.link_clicks);
    const w = ticket_windows.find((x) => x.event_code === code && day > x.from && day <= x.to);
    return {
      event_code: code,
      day,
      spend,
      tickets_per_day: w ? w.tickets_per_day : null,
      cost_per_ticket: w ? w.cost_per_ticket : null,
      checkout_actions: ca,
      cost_per_checkout_action: ca > 0 ? spend / ca : null,
      landing_page_views: lpv,
      cost_per_landing_page_view: lpv > 0 ? spend / lpv : null,
      link_clicks: clicks,
      cost_per_click: clicks > 0 ? spend / clicks : null,
      registrations: regs,
      cost_per_registration: regs > 0 ? spend / regs : null,
      tickets_total: soldTotal == null ? null : Math.round(soldTotal),
    };
  };
  const active = (r: MetaDailyRow) => +r.spend > 0 || +r.link_clicks > 0 || (regOn.get(r.event_code)?.get(r.day) ?? 0) > 0;
  const out: ChartRowRef[] = [];
  for (const [code, rows] of groups(meta_daily, (r) => r.event_code)) {
    const start = min(rows.filter(active), (r) => r.day);
    if (!start) continue;
    for (const r of rows) if (r.day >= start) out.push(make(code, r.day, [r]));
  }
  const shows = meta_daily.filter((r) => r.event_code !== "NX26-GLOBAL");
  const start = min(shows.filter(active), (r) => r.day);
  for (const [day, rows] of groups(shows, (r) => r.day)) if (start && day >= start) out.push(make("ALL", day, rows));
  return out;
}

export interface TotalsRef {
  event_code: string;
  period: string;
  spend: number;
  tickets: number | null;
  sold_to_date: number | null;
  cost_per_ticket: number | null;
  checkout_actions: number;
  cost_per_checkout_action: number | null;
  landing_page_views: number;
  cost_per_landing_page_view: number | null;
  link_clicks: number;
  cost_per_click: number | null;
  registrations: number | null;
  cost_per_registration: number | null;
}

export function totalsRef(meta_daily: MetaDailyRow[], ticket_windows: Window[], ticket_counts: CountRow[], registrations: RegRow[]): TotalsRef[] {
  const regCodes = new Set(registrations.map((r) => r.event_code));
  const lastDay = max(meta_daily, (r) => r.day) as string;
  const periods = ["all", "30", "14", "7", "3", "1"];
  const cutoff = (p: string) => (p === "all" ? "0000-00-00" : iso(Date.parse(lastDay) - (Number(p) - 1) * DAY));
  const latest = new Map<string, { date: string; n: number }>();
  for (const r of ticket_counts) {
    const d = String(r.count_date).slice(0, 10);
    const cur = latest.get(r.event_code);
    if (!cur || d > cur.date) latest.set(r.event_code, { date: d, n: Number(r.tickets_sold) });
  }
  const showMeta = new Map(meta_daily.map((r) => [r.event_code, { show: r.show, show_date: r.show_date }]));
  const make = (code: string, p: string, rows: MetaDailyRow[], codesWithCounts: string[], codesWithRegs: string[]): TotalsRef => {
    const c = cutoff(p);
    const inP = rows.filter((r) => r.day >= c);
    const spend = sum(inP, (r) => +r.spend);
    const ca = sum(inP, (r) => +r.initiate_checkouts + +r.adds_to_cart);
    const lpv = sum(inP, (r) => +r.landing_page_views);
    const clicks = sum(inP, (r) => +r.link_clicks);
    const regRows = registrations.filter((r) => codesWithRegs.includes(r.event_code) && r.day >= c);
    const regs = codesWithRegs.length ? sum(regRows, (r) => +r.registrations) : null;
    const regSpend = sum(codesWithRegs, (k) => {
      const days = registrations.filter((r) => r.event_code === k && +r.registrations > 0).map((r) => r.day);
      if (!days.length) return 0;
      const a = min(days, (d) => d)!;
      const b = max(days, (d) => d) as string;
      return sum(inP.filter((r) => r.event_code === k && r.day >= a && r.day <= b), (r) => +r.spend);
    });
    let tickets: number | null = null;
    let cpt: number | null = null;
    if (p === "all") {
      const counted = codesWithCounts.filter((k) => latest.has(k));
      if (counted.length) {
        tickets = sum(counted, (k) => latest.get(k)!.n);
        const s = sum(rows.filter((r) => counted.includes(r.event_code)), (r) => +r.spend);
        cpt = tickets > 0 ? s / tickets : null;
      }
    } else {
      const wins = ticket_windows.filter((w) => codesWithCounts.includes(w.event_code) && w.to >= c);
      if (wins.length) {
        tickets = sum(wins, (w) => w.tickets);
        const full = wins.filter((w) => w.spend_complete);
        const t2 = sum(full, (w) => w.tickets);
        const s = sum(full, (w) => w.spend);
        cpt = t2 > 0 ? s / t2 : null;
      }
    }
    return {
      event_code: code,
      period: p,
      spend,
      tickets,
      sold_to_date: codesWithCounts.some((k) => latest.has(k)) ? sum(codesWithCounts.filter((k) => latest.has(k)), (k) => latest.get(k)!.n) : null,
      cost_per_ticket: cpt,
      checkout_actions: ca,
      cost_per_checkout_action: ca > 0 ? spend / ca : null,
      landing_page_views: lpv,
      cost_per_landing_page_view: lpv > 0 ? spend / lpv : null,
      link_clicks: clicks,
      cost_per_click: clicks > 0 ? spend / clicks : null,
      registrations: regs,
      cost_per_registration: regs != null && regs > 0 ? regSpend / regs : null,
    };
  };
  const out: TotalsRef[] = [];
  const codes = [...showMeta.keys()].sort((a, b) => showMeta.get(a)!.show_date.localeCompare(showMeta.get(b)!.show_date) || a.localeCompare(b));
  const showCodes = codes.filter((k) => k !== "NX26-GLOBAL");
  const showRows = meta_daily.filter((r) => r.event_code !== "NX26-GLOBAL");
  for (const p of periods) {
    out.push(make("ALL", p, showRows, showCodes, showCodes.filter((k) => regCodes.has(k))));
    for (const k of codes) {
      out.push(make(k, p, meta_daily.filter((r) => r.event_code === k), k === "NX26-GLOBAL" ? [] : [k], regCodes.has(k) ? [k] : []));
    }
  }
  return out;
}

export interface TrajectoryRef {
  event_code: string;
  sold: number;
  as_of: string | null;
  days_left: number | null;
  pace_7: number | null;
  pace_14: number | null;
  needed_pace: number | null;
  projected: number | null;
  projected_enzo: number | null;
  projected_djez: number | null;
  projected_high: number | null;
  sellout_date: string | null;
}

/** The model's trajectory calc, with its lifts passed in (the model read them from final_week). */
export function trajectoryRef(ticket_counts: CountRow[], meta_daily: MetaDailyRow[], lifts: { enzo: number | null; djez: number | null }): TrajectoryRef[] {
  const CAP = 2000;
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
  const addDays = (a: string, n: number) => iso(Date.parse(a) + n * DAY);
  const liftEnzo = lifts.enzo == null ? null : Math.max(1, lifts.enzo);
  const liftEz = lifts.djez == null ? null : Math.max(1, lifts.djez);
  const showDate = new Map(meta_daily.map((r) => [r.event_code, { show: r.show, date: r.show_date }]));
  const out: TrajectoryRef[] = [];
  for (const [code, list] of groups(ticket_counts.filter((r) => showDate.has(r.event_code)), (r) => r.event_code)) {
    const pts = list.map((r) => ({ d: String(r.count_date).slice(0, 10), n: Number(r.tickets_sold) })).sort((a, b) => a.d.localeCompare(b.d));
    const last = pts[pts.length - 1];
    const paceOver = (span: number) => {
      const base = pts.filter((p) => p.d <= addDays(last.d, -span)).pop() || pts[0];
      const days = dayDiff(base.d, last.d);
      return days > 0 ? (last.n - base.n) / days : null;
    };
    const pace7 = paceOver(7);
    const pace14 = paceOver(14);
    const sd = showDate.get(code)!.date;
    const daysLeft = Math.max(0, dayDiff(last.d, sd));
    const proj = (f: number | null) => (pace7 == null || f == null ? null : last.n + pace7 * Math.max(0, daysLeft - 7) + pace7 * f * Math.min(7, daysLeft));
    const needed = daysLeft > 0 ? Math.max(0, CAP - last.n) / daysLeft : null;
    const selloutIn = pace7 != null && pace7 > 0 ? Math.ceil(Math.max(0, CAP - last.n) / pace7) : null;
    const p0 = proj(1);
    const pE = proj(liftEnzo);
    const pZ = proj(liftEz);
    const all = [p0, pE, pZ].filter((v): v is number => v != null);
    out.push({
      event_code: code,
      sold: last.n,
      as_of: last.d,
      days_left: daysLeft,
      pace_7: pace7,
      pace_14: pace14,
      needed_pace: needed,
      projected: p0,
      projected_enzo: pE,
      projected_djez: pZ,
      projected_high: all.length ? Math.max(...all) : null,
      sellout_date: selloutIn != null && selloutIn <= daysLeft ? addDays(last.d, selloutIn) : null,
    });
  }
  return out;
}

/** The model's final_week calc over its reference_counts CSV. */
export function finalWeekRef(rows: { event_code: string; show_date: string; count_date: string; tickets_sold: number; excluded_at_final: number }[]) {
  const addDays = (a: string, n: number) => iso(Date.parse(a) + n * DAY);
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
  const out: { event_code: string; per_day_before: number | null; per_day_final_week: number | null; lift: number | null }[] = [];
  for (const [code, list] of groups(rows, (r) => r.event_code)) {
    const pts = list.map((r) => ({ d: r.count_date, n: r.tickets_sold, x: r.excluded_at_final })).sort((a, b) => a.d.localeCompare(b.d));
    const sd = list[0].show_date;
    const at = (d: string) => {
      if (d <= pts[0].d) return pts[0].n;
      for (let k = 1; k < pts.length; k++)
        if (d <= pts[k].d) {
          const a = pts[k - 1];
          const b = pts[k];
          return a.n + ((b.n - a.n) * dayDiff(a.d, d)) / dayDiff(a.d, b.d);
        }
      return null;
    };
    const d7 = addDays(sd, -7);
    const d21 = addDays(sd, -21);
    const last = pts[pts.length - 1];
    const endD = last.d < sd ? last.d : sd;
    const endN = last.d < sd ? last.n : last.n - last.x;
    const fwDays = dayDiff(d7, endD);
    const n7 = at(d7);
    const n21 = at(d21);
    const before = n7 != null && n21 != null ? (n7 - n21) / 14 : null;
    const during = fwDays >= 2 && n7 != null ? (endN - n7) / fwDays : null;
    out.push({ event_code: code, per_day_before: before, per_day_final_week: during, lift: before != null && before > 0 && during != null ? during / before : null });
  }
  return out;
}
