/**
 * lib/dashboard/sales-calc/figures.ts
 *
 * The numbers behind dashboard v2 (design record 2026-11-13-dashboard-v2,
 * D2, D4, D5, D6, D10, D12, D13), as plain figures. `model.ts` turns them
 * into words for `SalesDashboardModel`; the parity test reads them
 * directly. Pure: no database, no clock (the input carries `today`).
 *
 * D2 / D12 spend: per show, per day, per platform, the larger of the
 * rollup's column and the sum of that platform's own campaigns mapped to
 * the show (Meta: linked beats tagged; Google: the [CODE] in the name;
 * TikTok: the rollup, the only per-day TikTok figure stored). Summed over
 * days and platforms. Today is never read.
 *
 * D3 engagement is Meta's only, so its costs divide Meta spend.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { NO_OVERRIDES, campaignOwner } from "../../attribution/campaign-owner.ts";
import { addDays, dayDiff, daysBetween } from "./days.ts";
import type { CountSource, LiftEntry, Platform, SalesCalcInput, ShowCount, ShowInput } from "./types.ts";

export const PLATFORMS: readonly Platform[] = ["meta", "tiktok", "google"];

export type PeriodId = "launch" | "30" | "14" | "7" | "3" | "yesterday";
export const PERIOD_DAYS: Record<PeriodId, number | null> = { launch: null, "30": 30, "14": 14, "7": 7, "3": 3, yesterday: 1 };
export const PERIOD_IDS: readonly PeriodId[] = ["launch", "30", "14", "7", "3", "yesterday"];

export interface DayFigures {
  day: string;
  /** All channels. */
  spend: number;
  byPlatform: Record<Platform, number>;
  linkClicks: number;
  landingPageViews: number;
  /** Initiate checkouts plus adds to cart: an action count (D13). */
  checkoutActions: number;
  signups: number;
}

export interface CampaignFigures {
  campaignId: string;
  name: string;
  /** Tagged only: the "Not linked to event" pill (internal). */
  unlinked: boolean;
  firstSpendDay: string | null;
  lastSpendDay: string | null;
  sinceLaunch: number;
  byDay: Map<string, number>;
}

export interface TicketWindow {
  from: string;
  to: string;
  days: number;
  startSold: number;
  tickets: number;
  perDay: number;
  /** All channels, the day after `from` through `to`. */
  spend: number;
  /** False when `to` is later than the last spend day. */
  complete: boolean;
}

export interface ShowSeries {
  show: ShowInput;
  finished: boolean;
  /** The count series the calc uses: for a finished show, counts before show day, then the final count placed on show day. */
  counts: ShowCount[];
  /** The final count's own day (it is drawn on show day). */
  finalDay: string | null;
  windows: TicketWindow[];
  days: Map<string, DayFigures>;
  platformsWithData: Set<Platform>;
  campaigns: CampaignFigures[];
  /** First and last day with signups > 0, whole run. */
  signupWindow: { first: string; last: string } | null;
  /** First day with spend, clicks or signups. The chart starts here. */
  startDay: string | null;
  /** The chart's last day: yesterday, or show day once the show has played. */
  lastDay: string;
  /** Kept for audit, never shown (D2). */
  audit: { rollupMeta: number; unlinkedMeta: number };
}

export function endDayOf(input: Pick<SalesCalcInput, "today">): string {
  return addDays(input.today, -1);
}

export function periodCutoff(period: PeriodId, endDay: string): string | null {
  const n = PERIOD_DAYS[period];
  return n == null ? null : addDays(endDay, -(n - 1));
}

const zeroPlatforms = (): Record<Platform, number> => ({ meta: 0, tiktok: 0, google: 0 });

/** Shows in the order the chips use: show day, then code. */
export function orderShows<T extends { showDate: string; code: string }>(shows: readonly T[]): T[] {
  return [...shows].sort((a, b) => a.showDate.localeCompare(b.showDate) || a.code.localeCompare(b.code));
}

/**
 * D1: campaign → show. Linked (the id is in events.meta_campaign_id) beats
 * tagged (the name holds "[CODE]", first show in show order). The name is
 * the campaign's largest stored name, as the model reads it.
 */
export function mapCampaigns(input: SalesCalcInput): Map<string, { eventId: string; linked: boolean; name: string }> {
  const names = new Map<string, string>();
  for (const r of input.metaCampaignDays) {
    const current = names.get(r.campaignId);
    if (current == null || r.campaignName > current) names.set(r.campaignId, r.campaignName);
  }
  const ordered = orderShows(input.shows);
  const linkedTo = new Map<string, string>();
  for (const show of ordered) {
    for (const id of show.linkedCampaignIds) if (!linkedTo.has(id)) linkedTo.set(id, show.eventId);
  }
  const overrides = input.overrides?.meta ?? {};
  const known = new Set(input.shows.map((s) => s.eventId));
  const out = new Map<string, { eventId: string; linked: boolean; name: string }>();
  for (const [campaignId, name] of names) {
    // An override (migration 240) is read first; it's an explicit link, so no "Not linked" pill.
    const override = overrides[campaignId];
    if (override != null) {
      if (known.has(override)) out.set(campaignId, { eventId: override, linked: true, name });
      continue;
    }
    const linked = linkedTo.get(campaignId);
    if (linked) {
      out.set(campaignId, { eventId: linked, linked: true, name });
      continue;
    }
    // The [CODE] exactly as written (Matas, 14 Nov); anything else needs an override row.
    const tagged = campaignOwner(ordered, { id: campaignId, name }, NO_OVERRIDES);
    if (tagged) out.set(campaignId, { eventId: tagged.eventId, linked: false, name });
  }
  return out;
}

/** Google: the override, else the stored first [CODE] exactly as written. */
export function googleOwner(input: SalesCalcInput, row: { eventCode: string; campaignId?: string | null }): ShowInput | null {
  const override = row.campaignId ? input.overrides?.google?.[row.campaignId] : undefined;
  if (override != null) return input.shows.find((s) => s.eventId === override) ?? null;
  return input.shows.find((s) => s.code === row.eventCode) ?? null;
}

/**
 * The counts the calc uses. A finished show's chart ends at show day with
 * its final count: earlier counts stay, later ones (the final included)
 * are replaced by the final placed on show day.
 */
export function effectiveCounts(show: ShowInput, today: string): { counts: ShowCount[]; finalDay: string | null } {
  const counts = [...show.counts].sort((a, b) => a.day.localeCompare(b.day));
  if (show.showDate >= today) return { counts, finalDay: null };
  const after = counts.filter((c) => c.day >= show.showDate);
  const final = show.finalCount
    ? { day: show.finalCount.day, sold: show.finalCount.paid, comps: show.finalCount.comps, source: show.finalCount.source }
    : after[after.length - 1] ?? null;
  const before = counts.filter((c) => c.day < show.showDate);
  if (!final) return { counts: before, finalDay: null };
  return { counts: [...before, { ...final, day: show.showDate }], finalDay: final.day };
}

export function buildWindows(counts: readonly ShowCount[], spendOn: (day: string) => number, endDay: string): TicketWindow[] {
  const out: TicketWindow[] = [];
  for (let i = 1; i < counts.length; i++) {
    const a = counts[i - 1];
    const b = counts[i];
    const days = dayDiff(a.day, b.day);
    if (days <= 0) continue;
    let spend = 0;
    for (let k = 1; k <= days; k++) spend += spendOn(addDays(a.day, k));
    const tickets = b.sold - a.sold;
    out.push({ from: a.day, to: b.day, days, startSold: a.sold, tickets, perDay: tickets / days, spend, complete: b.day <= endDay });
  }
  return out;
}

export function buildSeries(input: SalesCalcInput): Map<string, ShowSeries> {
  const endDay = endDayOf(input);
  const mapping = mapCampaigns(input);
  const out = new Map<string, ShowSeries>();
  const byShowDay = new Map<string, Map<string, DayFigures>>();
  const platforms = new Map<string, Set<Platform>>();
  const campaigns = new Map<string, Map<string, CampaignFigures>>();
  const audit = new Map<string, { rollupMeta: number; unlinkedMeta: number }>();
  const insightsMeta = new Map<string, number>();
  const googleOwn = new Map<string, number>();
  const rollupByKey = new Map<string, SalesCalcInput["rollups"][number]>();

  const dayOf = (eventId: string, day: string): DayFigures => {
    let days = byShowDay.get(eventId);
    if (!days) byShowDay.set(eventId, (days = new Map()));
    let f = days.get(day);
    if (!f) days.set(day, (f = { day, spend: 0, byPlatform: zeroPlatforms(), linkClicks: 0, landingPageViews: 0, checkoutActions: 0, signups: 0 }));
    return f;
  };
  const platformSet = (eventId: string) => {
    let set = platforms.get(eventId);
    if (!set) platforms.set(eventId, (set = new Set()));
    return set;
  };
  const auditOf = (eventId: string) => {
    let a = audit.get(eventId);
    if (!a) audit.set(eventId, (a = { rollupMeta: 0, unlinkedMeta: 0 }));
    return a;
  };

  for (const r of input.metaCampaignDays) {
    if (r.day >= input.today) continue;
    const owner = mapping.get(r.campaignId);
    if (!owner) continue;
    const key = `${owner.eventId}|${r.day}`;
    insightsMeta.set(key, (insightsMeta.get(key) ?? 0) + r.spend);
    const f = dayOf(owner.eventId, r.day);
    f.linkClicks += r.linkClicks;
    f.landingPageViews += r.landingPageViews;
    f.checkoutActions += r.initiateCheckouts + r.addsToCart;
    platformSet(owner.eventId).add("meta");
    if (!owner.linked) auditOf(owner.eventId).unlinkedMeta += r.spend;
    let list = campaigns.get(owner.eventId);
    if (!list) campaigns.set(owner.eventId, (list = new Map()));
    let c = list.get(r.campaignId);
    if (!c) list.set(r.campaignId, (c = { campaignId: r.campaignId, name: owner.name, unlinked: !owner.linked, firstSpendDay: null, lastSpendDay: null, sinceLaunch: 0, byDay: new Map() }));
    c.sinceLaunch += r.spend;
    c.byDay.set(r.day, (c.byDay.get(r.day) ?? 0) + r.spend);
    if (r.spend > 0) {
      if (c.firstSpendDay == null || r.day < c.firstSpendDay) c.firstSpendDay = r.day;
      if (c.lastSpendDay == null || r.day > c.lastSpendDay) c.lastSpendDay = r.day;
    }
  }

  for (const g of input.googleCampaignDays) {
    if (g.day >= input.today) continue;
    const show = googleOwner(input, g);
    if (!show) continue;
    const key = `${show.eventId}|${g.day}`;
    googleOwn.set(key, (googleOwn.get(key) ?? 0) + g.spend);
    dayOf(show.eventId, g.day);
    platformSet(show.eventId).add("google");
  }

  for (const r of input.rollups) {
    if (r.day >= input.today) continue;
    rollupByKey.set(`${r.eventId}|${r.day}`, r);
    dayOf(r.eventId, r.day);
    const set = platformSet(r.eventId);
    if (r.metaSynced || (r.meta ?? 0) > 0) set.add("meta");
    if (r.tiktokSynced || (r.tiktok ?? 0) > 0) set.add("tiktok");
    if (r.googleSynced || (r.google ?? 0) > 0) set.add("google");
    auditOf(r.eventId).rollupMeta += r.meta ?? 0;
  }

  for (const s of input.signups) {
    if (s.day >= input.today) continue;
    dayOf(s.eventId, s.day).signups += s.signups;
  }

  for (const [eventId, days] of byShowDay) {
    for (const f of days.values()) {
      const key = `${eventId}|${f.day}`;
      const roll = rollupByKey.get(key);
      f.byPlatform.meta = Math.max(roll?.meta ?? 0, insightsMeta.get(key) ?? 0);
      f.byPlatform.tiktok = roll?.tiktok ?? 0;
      f.byPlatform.google = Math.max(roll?.google ?? 0, googleOwn.get(key) ?? 0);
      f.spend = f.byPlatform.meta + f.byPlatform.tiktok + f.byPlatform.google;
    }
  }

  for (const show of input.shows) {
    const days = byShowDay.get(show.eventId) ?? new Map<string, DayFigures>();
    const finished = show.showDate < input.today;
    const { counts, finalDay } = effectiveCounts(show, input.today);
    const spendOn = (day: string) => days.get(day)?.spend ?? 0;
    const windows = buildWindows(counts, spendOn, endDay);
    const signupDays = [...days.values()].filter((f) => f.signups > 0).map((f) => f.day).sort();
    const active = [...days.values()].filter((f) => f.spend > 0 || f.linkClicks > 0 || f.signups > 0).map((f) => f.day).sort();
    out.set(show.eventId, {
      show,
      finished,
      counts,
      finalDay,
      windows,
      days,
      platformsWithData: platforms.get(show.eventId) ?? new Set(),
      campaigns: [...(campaigns.get(show.eventId)?.values() ?? [])].filter((c) => c.sinceLaunch > 0),
      signupWindow: signupDays.length ? { first: signupDays[0], last: signupDays[signupDays.length - 1] } : null,
      startDay: active[0] ?? null,
      lastDay: finished && show.showDate < endDay ? show.showDate : endDay,
      audit: audit.get(show.eventId) ?? { rollupMeta: 0, unlinkedMeta: 0 },
    });
  }
  return out;
}

/** D5: total sold on a day. Straight line between counts; 0 before presale or before a first count of 0; null before a non-zero first count. */
export function soldOn(series: Pick<ShowSeries, "counts" | "show">, day: string): number | null {
  const pts = series.counts;
  if (pts.length === 0) return null;
  if (day < pts[0].day) {
    const presale = series.show.presaleDate;
    return (presale && day < presale) || pts[0].sold === 0 ? 0 : null;
  }
  for (let k = 1; k < pts.length; k++) {
    if (day <= pts[k].day) {
      const a = pts[k - 1];
      const b = pts[k];
      return a.sold + ((b.sold - a.sold) * dayDiff(a.day, day)) / dayDiff(a.day, b.day);
    }
  }
  return pts[pts.length - 1].sold;
}

/** The window covering a day: day after `from` through `to`. */
export function windowOn(windows: readonly TicketWindow[], day: string): TicketWindow | null {
  return windows.find((w) => day > w.from && day <= w.to) ?? null;
}

export interface PeriodFigures {
  spend: number;
  byPlatform: Record<Platform, number>;
  platformsWithData: Platform[];
  /** Latest count (paid). Null when no show has counts. */
  sold: number | null;
  soldComps: number | null;
  soldDay: string | null;
  /** The counted shows' latest counts fall on more than one day (the header then reads "to {soldDay}"). */
  soldDaysDiffer: boolean;
  soldSources: CountSource[];
  soldIsFinal: boolean;
  tickets: number | null;
  costPerTicket: number | null;
  checkoutActions: number;
  costPerCheckout: number | null;
  landingPageViews: number;
  costPerLpv: number | null;
  linkClicks: number;
  cpc: number | null;
  /** Null when no show here has a CIRQLIN page. */
  registrations: number | null;
  costPerRegistration: number | null;
  /** Signups had ended before this period started. */
  signupsClosed: boolean;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/** The scope's one count date: the latest count (a finished show's final count) across the shows with counts. */
export function latestCountDay(list: readonly ShowSeries[]): string | null {
  let out: string | null = null;
  for (const s of list) {
    if (!s.counts.length) continue;
    const day = s.finalDay ?? s.counts[s.counts.length - 1].day;
    if (out == null || day > out) out = day;
  }
  return out;
}

/**
 * D4 period figures over one or several shows (All shows sums the shows,
 * never the umbrella; the caller passes the list). D13: a window that
 * straddles the period start counts by its share of days inside, for its
 * tickets and its spend; since launch, cost per ticket stops each show's
 * spend at its latest count.
 */
export function periodFigures(list: readonly ShowSeries[], period: PeriodId, endDay: string): PeriodFigures {
  const cutoff = periodCutoff(period, endDay);
  const inPeriod = (day: string) => day <= endDay && (cutoff == null || day >= cutoff);
  const byPlatform = zeroPlatforms();
  let spend = 0;
  let metaSpend = 0;
  let checkoutActions = 0;
  let lpv = 0;
  let clicks = 0;
  const platformsWithData = new Set<Platform>();
  for (const s of list) {
    for (const p of s.platformsWithData) platformsWithData.add(p);
    for (const f of s.days.values()) {
      if (!inPeriod(f.day)) continue;
      spend += f.spend;
      for (const p of PLATFORMS) byPlatform[p] += f.byPlatform[p];
      metaSpend += f.byPlatform.meta;
      checkoutActions += f.checkoutActions;
      lpv += f.landingPageViews;
      clicks += f.linkClicks;
    }
  }

  const counted = list.filter((s) => s.counts.length > 0);
  let sold: number | null = null;
  let soldComps: number | null = null;
  let soldDay: string | null = null;
  const soldDays = new Set<string>();
  const sources = new Set<CountSource>();
  if (counted.length) {
    sold = 0;
    for (const s of counted) {
      const last = s.counts[s.counts.length - 1];
      sold += last.sold;
      if (last.comps != null) soldComps = (soldComps ?? 0) + last.comps;
      const day = s.finalDay ?? last.day;
      if (soldDay == null || day > soldDay) soldDay = day;
      soldDays.add(day);
      sources.add(last.source);
    }
  }

  let tickets: number | null = null;
  let costPerTicket: number | null = null;
  if (period === "launch") {
    if (counted.length && sold != null) {
      tickets = sold;
      let capped = 0;
      for (const s of counted) {
        const last = s.counts[s.counts.length - 1].day;
        for (const f of s.days.values()) if (f.day <= last && f.day <= endDay) capped += f.spend;
      }
      costPerTicket = ratio(capped, sold);
    }
  } else if (cutoff != null) {
    let t = 0;
    let completeTickets = 0;
    let completeSpend = 0;
    let any = false;
    for (const s of counted) {
      for (const w of s.windows) {
        if (w.to < cutoff) continue;
        any = true;
        const inside = Math.min(w.days, dayDiff(cutoff, w.to) + 1);
        const share = inside / w.days;
        t += w.tickets * share;
        if (w.complete) {
          completeTickets += w.tickets * share;
          completeSpend += w.spend * share;
        }
      }
    }
    if (any) {
      tickets = t;
      costPerTicket = ratio(completeSpend, completeTickets);
    }
  }

  const paged = list.filter((s) => s.show.cirqlinPageId != null);
  let registrations: number | null = null;
  let costPerRegistration: number | null = null;
  let signupsClosed = false;
  if (paged.length) {
    let regs = 0;
    let regSpend = 0;
    let lastSignup: string | null = null;
    for (const s of paged) {
      for (const f of s.days.values()) {
        if (!inPeriod(f.day)) continue;
        regs += f.signups;
        const w = s.signupWindow;
        if (w && f.day >= w.first && f.day <= w.last) regSpend += f.spend;
      }
      if (s.signupWindow && (lastSignup == null || s.signupWindow.last > lastSignup)) lastSignup = s.signupWindow.last;
    }
    registrations = regs;
    costPerRegistration = ratio(regSpend, regs);
    signupsClosed = regs === 0 && lastSignup != null && cutoff != null && lastSignup < cutoff;
  }

  return {
    spend,
    byPlatform,
    platformsWithData: PLATFORMS.filter((p) => platformsWithData.has(p)),
    sold,
    soldComps: soldComps && soldComps > 0 ? soldComps : null,
    soldDay,
    soldDaysDiffer: soldDays.size > 1,
    soldSources: [...sources],
    soldIsFinal: counted.length > 0 && counted.every((s) => s.finalDay != null),
    tickets,
    costPerTicket,
    checkoutActions,
    costPerCheckout: ratio(metaSpend, checkoutActions),
    landingPageViews: lpv,
    costPerLpv: ratio(metaSpend, lpv),
    linkClicks: clicks,
    cpc: ratio(metaSpend, clicks),
    registrations,
    costPerRegistration,
    signupsClosed,
  };
}

export interface ChartRow {
  day: string;
  spend: number;
  sold: number | null;
  /** A real count on this day. */
  count: boolean;
  /** Between two counts: the line is a straight-line estimate. */
  estimatedBetween: { from: string; to: string } | null;
  ticketsPerDay: number | null;
  costPerTicket: number | null;
  checkoutActions: number;
  costPerCheckout: number | null;
  landingPageViews: number;
  costPerLpv: number | null;
  linkClicks: number;
  cpc: number | null;
  registrations: number | null;
  /**
   * D13 (design's fix, 14 Nov): only inside the show's signup window, else
   * empty (null), never £0.00. A day with no spend is empty too. All shows
   * has no one signup window (each show's closes at its own on-sale), so
   * its daily figure is always empty; its period figure stays windowed
   * per show.
   */
  costPerRegistration: number | null;
}

/** D5 daily rows over one or several shows, from the first active day to the last day. */
export function chartRows(list: readonly ShowSeries[], endDay: string): ChartRow[] {
  const starts = list.map((s) => s.startDay).filter((d): d is string => d != null).sort();
  if (!starts.length) return [];
  const last = list.map((s) => s.lastDay).sort().pop() ?? endDay;
  const counted = list.filter((s) => s.counts.length > 0);
  const paged = list.filter((s) => s.show.cirqlinPageId != null);
  const out: ChartRow[] = [];
  for (const day of daysBetween(starts[0], last)) {
    let spend = 0;
    let metaSpend = 0;
    let ca = 0;
    let lpv = 0;
    let clicks = 0;
    let regs = 0;
    let regSpend = 0;
    let inSignupWindow = false;
    for (const s of list) {
      if (day > s.lastDay) continue;
      const f = s.days.get(day);
      if (!f) continue;
      spend += f.spend;
      metaSpend += f.byPlatform.meta;
      ca += f.checkoutActions;
      lpv += f.landingPageViews;
      clicks += f.linkClicks;
      if (s.show.cirqlinPageId != null) {
        regs += f.signups;
        if (s.signupWindow && day >= s.signupWindow.first && day <= s.signupWindow.last) {
          inSignupWindow = true;
          regSpend += f.spend;
        }
      }
    }
    let sold: number | null = counted.length ? 0 : null;
    let count = false;
    let between: { from: string; to: string } | null = null;
    let perDay: number | null = null;
    let windowTickets = 0;
    let windowSpend = 0;
    let windowComplete = true;
    let anyWindow = false;
    for (const s of counted) {
      if (sold != null) {
        const v = day > s.lastDay ? s.counts[s.counts.length - 1].sold : soldOn(s, day);
        sold = v == null ? null : sold + v;
      }
      if (s.counts.some((c) => c.day === day)) count = true;
      const w = day <= s.lastDay ? windowOn(s.windows, day) : null;
      if (w) {
        anyWindow = true;
        perDay = (perDay ?? 0) + w.perDay;
        windowTickets += w.tickets;
        windowSpend += w.spend;
        if (!w.complete) windowComplete = false;
        if (day < w.to && list.length === 1) between = { from: w.from, to: w.to };
      }
    }
    out.push({
      day,
      spend,
      sold: sold == null ? null : Math.round(sold),
      count: list.length === 1 ? count : false,
      estimatedBetween: between,
      ticketsPerDay: anyWindow ? perDay : null,
      costPerTicket: anyWindow && windowComplete && windowTickets > 0 ? windowSpend / windowTickets : null,
      checkoutActions: ca,
      costPerCheckout: ratio(metaSpend, ca),
      landingPageViews: lpv,
      costPerLpv: ratio(metaSpend, lpv),
      linkClicks: clicks,
      cpc: ratio(metaSpend, clicks),
      registrations: paged.length ? regs : null,
      costPerRegistration: list.length === 1 && paged.length && inSignupWindow && regs > 0 && regSpend > 0 ? regSpend / regs : null,
    });
  }
  return out;
}

// ─── D6 trajectory ─────────────────────────────────────────────────────

export interface Projection {
  sold: number;
  asOf: string;
  base7: ShowCount;
  pace7: number | null;
  pace14: number | null;
  daysLeft: number;
  /** Null when there is no sellable allocation. */
  allocation: number | null;
  holds: number | null;
  average: number | null;
  best: number | null;
  /** The sold figure at D−7 (or the latest count, if later) along the 7-day pace. */
  fanDay: string;
  fanSold: number;
  neededPerDay: number | null;
  /** Day the 7-day pace reaches the allocation, if before show day. */
  sellsOutOn: string | null;
}

/** Count-to-count pace: latest count back to the latest count at least `span` days earlier (else the first). */
export function paceOver(counts: readonly ShowCount[], span: number): { pace: number | null; base: ShowCount } {
  const last = counts[counts.length - 1];
  const base = counts.filter((c) => c.day <= addDays(last.day, -span)).pop() ?? counts[0];
  const days = dayDiff(base.day, last.day);
  return { pace: days > 0 ? (last.sold - base.sold) / days : null, base };
}

/**
 * D6: the latest count, plus 7-day pace for the days before the final
 * week, plus 7-day pace × f for the final week's days. Always capped at
 * the sellable allocation (D9), one show or all.
 */
export function project(series: ShowSeries, lifts: { average: number | null; best: number | null }): Projection | null {
  const counts = series.counts;
  if (!counts.length) return null;
  const last = counts[counts.length - 1];
  const { pace: pace7, base: base7 } = paceOver(counts, 7);
  const { pace: pace14 } = paceOver(counts, 14);
  const daysLeft = Math.max(0, dayDiff(last.day, series.show.showDate));
  const cap = series.show.allocation;
  const raw = (f: number | null) =>
    pace7 == null || f == null ? null : last.sold + pace7 * Math.max(0, daysLeft - 7) + pace7 * f * Math.min(7, daysLeft);
  const capped = (v: number | null) => (v == null ? null : Math.round(cap == null ? v : Math.min(cap, v)));
  const fanDay = addDays(series.show.showDate, -7) > last.day ? addDays(series.show.showDate, -7) : last.day;
  const fanRaw = pace7 == null ? last.sold : last.sold + pace7 * Math.max(0, daysLeft - 7);
  const neededPerDay = cap != null && daysLeft > 0 ? Math.max(0, cap - last.sold) / daysLeft : null;
  const selloutIn = cap != null && pace7 != null && pace7 > 0 ? Math.ceil(Math.max(0, cap - last.sold) / pace7) : null;
  return {
    sold: last.sold,
    asOf: last.day,
    base7,
    pace7,
    pace14,
    daysLeft,
    allocation: cap,
    holds: capped(raw(1)),
    average: capped(raw(lifts.average)),
    best: capped(raw(lifts.best)),
    fanDay,
    fanSold: Math.round(cap == null ? fanRaw : Math.min(cap, fanRaw)),
    neededPerDay,
    sellsOutOn: selloutIn != null && selloutIn <= daysLeft ? addDays(last.day, selloutIn) : null,
  };
}

// ─── D10 library ───────────────────────────────────────────────────────

export type LiftOutcome =
  | { ok: true; entry: Omit<LiftEntry, "computedAt"> }
  | { ok: false; reason: "umbrella" | "not_finished" | "no_final_count" | "no_counts_by_d21" | "sold_out_early" | "flat_before" };

/** Interpolated count on a day; null after the last count or before the first. */
function countAt(counts: readonly ShowCount[], day: string): number | null {
  if (!counts.length || day < counts[0].day) return null;
  for (let k = 0; k < counts.length; k++) {
    if (counts[k].day === day) return counts[k].sold;
    if (k > 0 && day < counts[k].day) {
      const a = counts[k - 1];
      const b = counts[k];
      return a.sold + ((b.sold - a.sold) * dayDiff(a.day, day)) / dayDiff(a.day, b.day);
    }
  }
  return null;
}

/**
 * D10: tickets a day over the final 7 days ÷ tickets a day over the 14
 * days before that, counts interpolated to D−21 and D−7, paid only,
 * floored at 1. Out: a show that reached its allocation before D−7, and a
 * show with no final count, or no count by D−21.
 */
export function liftFor(series: ShowSeries, today: string): LiftOutcome {
  const show = series.show;
  if (show.isUmbrella) return { ok: false, reason: "umbrella" };
  if (show.showDate >= today) return { ok: false, reason: "not_finished" };
  if (series.finalDay == null) return { ok: false, reason: "no_final_count" };
  const counts = series.counts;
  const d21 = addDays(show.showDate, -21);
  const d7 = addDays(show.showDate, -7);
  const n21 = countAt(counts, d21);
  const n7 = countAt(counts, d7);
  if (n21 == null || n7 == null) return { ok: false, reason: "no_counts_by_d21" };
  const cap = show.allocation;
  if (cap != null && (n7 >= cap || counts.some((c) => c.day < d7 && c.sold >= cap))) return { ok: false, reason: "sold_out_early" };
  const final = counts[counts.length - 1];
  const before = (n7 - n21) / 14;
  if (!(before > 0)) return { ok: false, reason: "flat_before" };
  const during = (final.sold - n7) / 7;
  return {
    ok: true,
    entry: {
      eventId: show.eventId,
      code: show.code,
      name: show.name,
      showDate: show.showDate,
      d21Day: d21,
      d21Sold: n21,
      d7Day: d7,
      d7Sold: n7,
      finalDay: series.finalDay,
      finalPaid: final.sold,
      compsExcluded: show.finalCount?.comps ?? final.comps ?? 0,
      perDayBefore: before,
      perDayFinalWeek: during,
      lift: Math.max(1, during / before),
      finalBlockId: show.finalCount?.blockId ?? null,
    },
  };
}

/**
 * The client's library: a stored entry wins (never recomputed silently);
 * a finished show with a final count and no stored entry is computed.
 * Returns the entries plus the shows left out and why.
 */
export function buildLibrary(
  series: Map<string, ShowSeries>,
  stored: readonly LiftEntry[],
  today: string,
): { entries: Omit<LiftEntry, "computedAt">[]; fresh: Omit<LiftEntry, "computedAt">[]; excluded: { eventId: string; name: string; reason: string }[] } {
  const storedByEvent = new Map<string, LiftEntry>();
  for (const e of stored) {
    const current = storedByEvent.get(e.eventId);
    if (!current || e.computedAt > current.computedAt) storedByEvent.set(e.eventId, e);
  }
  const entries: Omit<LiftEntry, "computedAt">[] = [];
  const fresh: Omit<LiftEntry, "computedAt">[] = [];
  const excluded: { eventId: string; name: string; reason: string }[] = [];
  for (const s of orderShows([...series.values()].map((x) => ({ ...x, showDate: x.show.showDate, code: x.show.code })))) {
    if (s.show.isUmbrella || s.show.showDate >= today) continue;
    const outcome = liftFor(s, today);
    const kept = storedByEvent.get(s.show.eventId);
    const sameFinal = kept && outcome.ok && (kept.finalBlockId ?? null) === (outcome.entry.finalBlockId ?? null) && kept.finalDay === outcome.entry.finalDay;
    if (kept && (sameFinal || !outcome.ok)) {
      entries.push({ ...kept, code: s.show.code, name: s.show.name, showDate: s.show.showDate });
      continue;
    }
    if (outcome.ok) {
      entries.push(outcome.entry);
      fresh.push(outcome.entry);
    } else if (outcome.reason !== "not_finished") {
      excluded.push({ eventId: s.show.eventId, name: s.show.name, reason: outcome.reason });
    }
  }
  return { entries, fresh, excluded };
}

/** Average and best lift for a show: its own reference set, else the client's library. */
export function liftsFor(show: ShowInput, library: readonly Omit<LiftEntry, "computedAt">[]): {
  used: Omit<LiftEntry, "computedAt">[];
  average: number | null;
  best: Omit<LiftEntry, "computedAt"> | null;
} {
  const own = show.referenceEventIds.length ? library.filter((e) => show.referenceEventIds.includes(e.eventId)) : [...library];
  const used = own.filter((e) => e.eventId !== show.eventId);
  if (used.length < 2) return { used, average: null, best: null };
  const average = used.reduce((sum, e) => sum + e.lift, 0) / used.length;
  const best = used.reduce((a, b) => (b.lift > a.lift ? b : a));
  return { used, average, best };
}
