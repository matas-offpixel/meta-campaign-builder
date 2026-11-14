/**
 * lib/dashboard/sales-calc/model.ts
 *
 * Fills `SalesDashboardModel` (lib/dashboard/sales-vs-spend.ts, shape
 * unchanged) from `SalesCalcInput`. One module for the internal page and
 * the share route (D11): the share takes `salesForSurface(model, "share")`
 * of the same object. Cross-client learnings are never computed here, so
 * nothing cross-client can reach a share.
 *
 * Words are the record's (DV1–DV3) and the fixture's; any new string is
 * listed in the PR for design.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import {
  LIBRARY_OPENS,
  MISSING_CAPACITY,
  MISSING_CAPACITY_SHORT,
  NO_CIRQLIN_PAGE,
  NO_TICKET_COUNTS,
  formatSalesNumber,
  type AllShowBar,
  type AllocationStep,
  type FreshnessStamp,
  type SalesCampaignRow,
  type SalesChartPoint,
  type SalesDashboardModel,
  type SalesMetricId,
  type SalesPeriod,
  type SalesShowChip,
  type SalesShowView,
  type SalesTile,
  type SalesPeriodView,
  type SalesVenue,
  type SingleTrajectory,
  type SalesTrajectory,
  type TrajectoryCase,
  type TrajectoryTile,
} from "../sales-vs-spend.ts";
import { dayDiff, shortDay, weekdayDay } from "./days.ts";
import {
  PERIOD_DAYS,
  PERIOD_IDS,
  buildLibrary,
  buildSeries,
  chartRows,
  endDayOf,
  latestCountDay,
  liftsFor,
  orderShows,
  periodCutoff,
  periodFigures,
  project,
  type CampaignFigures,
  type PeriodFigures,
  type PeriodId,
  type ShowSeries,
} from "./figures.ts";
import { PLATFORM_LABEL, type CountSource, type LiftEntry, type SalesCalcInput } from "./types.ts";
import { defaultVenue, groupVenues, headerSentence, spendToCountClause, spendTotal, type VenueGroup } from "./scope.ts";

export const ALL_SHOWS_ID = "all";
/** N5: v2 opens on since launch; the view's own tiles and campaigns are that period's (every period is in `periods`). */
export const BASE_PERIOD: SalesPeriod = "launch";
/** D13: a stamp turns amber when its source is more than 2 days behind yesterday. */
export const STALE_AFTER_DAYS = 2;

export const SOURCE_LABEL: Record<CountSource, string> = {
  internal_counts: "Internal Counts",
  manual: "Entered",
  xlsx_import: "Spreadsheet import",
  fourthefans: "4TheFans",
  foursomething: "4TheFans",
  eventbrite: "Eventbrite",
};

const ALL_NOTE =
  "Each show is capped at its own allocation before summing. A show with no capacity is left out of the total and says why.";
const CHECKOUT_TITLE = "Checkouts and add-to-carts. One person can do both.";
/** A finished show whose counts stop before show day. New words: listed for design. */
export const NO_FINAL_COUNT = "No final count yet";

export type PeriodView = SalesPeriodView;

/** The model (each view carries every period's tiles and campaigns in `periods`), plus the D10 library this run used. */
export interface SalesBuild {
  model: SalesDashboardModel;
  periods: Record<string, Record<SalesPeriod, PeriodView>>;
  /** Library entries computed this run that have no stored row yet (the internal loader stores them). */
  freshLibrary: Omit<LiftEntry, "computedAt">[];
  library: Omit<LiftEntry, "computedAt">[];
  excludedFromLibrary: { eventId: string; name: string; reason: string }[];
}

const count = (n: number) => formatSalesNumber("count", n);
const money = (n: number) => formatSalesNumber("money", n);
const rate = (n: number) => formatSalesNumber("rate", n);

function liftLabel(n: number): string {
  return `×${Number(n.toFixed(2))}`;
}

function periodPhrase(period: SalesPeriod): { wide: string; narrow: string } {
  if (period === "launch") return { wide: "since launch", narrow: "since launch" };
  if (period === "yesterday") return { wide: "yesterday", narrow: "yesterday" };
  return { wide: `in ${period} days`, narrow: `${period} days` };
}

function chipId(code: string): string {
  return code.toLowerCase();
}

function sourcesLabel(sources: readonly CountSource[]): string {
  const labels = [...new Set(sources.map((s) => SOURCE_LABEL[s]))];
  return labels.join(" and ");
}

function platformSplit(f: PeriodFigures): string {
  return f.platformsWithData.map((p) => `${PLATFORM_LABEL[p]} ${money(f.byPlatform[p])}`).join(" · ");
}

/** N7: every subline starts with its span. */
function span(period: SalesPeriod): { wide: string; narrow: string } {
  if (period === "launch") return { wide: "since launch", narrow: "since launch" };
  if (period === "yesterday") return { wide: "yesterday", narrow: "yesterday" };
  return { wide: `in ${period} days`, narrow: `${period} days` };
}

const oneDecimal = (n: number) => new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);

export const NO_COUNTS_BAR = "No ticket counts yet";
export const NOT_A_SHOW = "not a show";
/** Yesterday had no count (the last one is older): no sales or cost per ticket for it. Invented here (period-calc ticket). */
export const NO_COUNT_YESTERDAY = "no count yesterday";

interface TileContext {
  /** The scope named on the Spend tile ("NX Newcastle", "All venues", a show). Null for the umbrella. */
  scope: string | null;
  soldTitle: string;
  /** The umbrella's own view: its page slug and signup window. */
  umbrella: { pageSlug: string | null; window: string | null } | null;
  /** The venue's umbrella page signups, shown apart on Registrations (N8). Never added in. */
  umbrellaPage: { launch: number; byPeriod: Partial<Record<SalesPeriod, number>> } | null;
  shows: number;
  countedShows: number;
}

function tilesFor(f: PeriodFigures, sinceLaunch: PeriodFigures, period: SalesPeriod, endDay: string, ctx: TileContext): SalesTile[] {
  const sp = span(period);
  const split = platformSplit(f);
  const dash = (id: SalesMetricId, detail: string, narrow = detail, title = ""): SalesTile => ({ id, value: "—", detail, narrowDetail: narrow, title });
  const spendTile: SalesTile = {
    id: "spend",
    value: money(f.spend),
    detail: [ctx.scope, split, period === "launch" ? null : `of ${money(sinceLaunch.spend)} since launch`].filter(Boolean).join(" · ") || sp.wide,
    narrowDetail: split || sp.narrow,
    title: split ? `${split}.` : "",
  };
  const per = (value: number | null, id: SalesMetricId, title: string): SalesTile =>
    value == null ? dash(id, sp.wide, sp.narrow) : { id, value: rate(value), detail: sp.wide, narrowDetail: sp.narrow, title };
  const checkout: SalesTile = {
    id: "checkoutActions",
    value: count(f.checkoutActions),
    detail: `${sp.wide} · actions, one person can do both`,
    narrowDetail: `${sp.narrow} · actions`,
    title: CHECKOUT_TITLE,
  };
  const lpv: SalesTile = { id: "lpv", value: count(f.landingPageViews), detail: sp.wide, narrowDetail: sp.narrow, title: "Landing page views on Meta." };
  const clicks: SalesTile = { id: "clicks", value: count(f.linkClicks), detail: sp.wide, narrowDetail: sp.narrow, title: "Link clicks on Meta." };
  const engagement = [
    checkout,
    per(f.costPerCheckout, "costPerCheckout", "Meta spend divided by checkouts and add-to-carts."),
    lpv,
    per(f.costPerLpv, "costPerLpv", "Meta spend divided by landing page views."),
    clicks,
    per(f.cpc, "cpc", "Meta spend divided by clicks."),
  ];

  if (ctx.umbrella) {
    const slug = ctx.umbrella.pageSlug;
    const regs: SalesTile =
      f.registrations == null
        ? dash("registrations", NO_CIRQLIN_PAGE)
        : {
            id: "registrations",
            value: count(f.registrations),
            detail: [period === "launch" ? "to date" : `${sp.wide} · ${count(sinceLaunch.registrations ?? 0)} to date`, slug].filter(Boolean).join(" · "),
            narrowDetail: period === "launch" ? "to date" : sp.narrow,
            title: "",
          };
    const cpr: SalesTile =
      f.costPerRegistration == null
        ? dash("costPerRegistration", f.registrations == null ? NO_CIRQLIN_PAGE : sp.wide)
        : {
            id: "costPerRegistration",
            value: rate(f.costPerRegistration),
            detail: `all umbrella spend${ctx.umbrella.window ? `, ${ctx.umbrella.window}` : ""}`,
            narrowDetail: "all umbrella spend",
            title: "All umbrella spend inside its page's signup window, over the page's signups. Umbrella spend also drives show sales.",
          };
    return [
      spendTile,
      dash("sold", NOT_A_SHOW),
      dash("tickets", NOT_A_SHOW),
      dash("costPerTicket", NOT_A_SHOW),
      ...engagement,
      regs,
      cpr,
    ];
  }

  const soldTile: SalesTile =
    f.sold == null || f.soldDay == null
      ? dash("sold", NO_TICKET_COUNTS)
      : (() => {
          const source = `${sourcesLabel(f.soldSources)}, ${shortDay(f.soldDay)}`;
          const named = `to date · ${f.soldIsFinal ? `Final count · ${source}` : source}`;
          const shows = ctx.shows > 1 ? ` · ${ctx.countedShows} shows` : "";
          return {
            id: "sold",
            value: count(f.sold),
            detail: `${named}${shows}${f.soldComps ? ` · plus ${count(f.soldComps)} comps` : ""}`,
            narrowDetail: named,
            title: ctx.soldTitle,
          };
        })();
  const days = PERIOD_DAYS[period as PeriodId];
  const toCount = !f.ticketDays
    ? ""
    : f.ticketDaysDiffer
      ? " to each show's last count"
      : f.ticketDays.to < endDay
        ? ` to the ${shortDay(f.ticketDays.to)} count`
        : "";
  // D13 in the header's own words, where the period's spend runs past a show's last count.
  const capClause = period !== "launch" && f.ticketDays ? spendToCountClause({ soldDay: f.ticketDays.to, soldDaysDiffer: f.ticketDaysDiffer, spendPastCount: f.spendPastCount }) : "";
  const noCount = period === "yesterday" && f.tickets == null && f.sold != null ? NO_COUNT_YESTERDAY : NO_TICKET_COUNTS;
  const ticketsTile: SalesTile =
    f.tickets == null
      ? dash("tickets", noCount)
      : {
          id: "tickets",
          value: count(f.tickets),
          detail: period === "launch" ? `since launch, to ${shortDay(f.soldDay ?? endDay)}` : `${sp.wide}${toCount} · ${oneDecimal(f.tickets / (days ?? 1))} a day`,
          narrowDetail: sp.narrow,
          title: "",
        };
  const cptTile: SalesTile =
    f.costPerTicket == null
      ? dash("costPerTicket", f.tickets == null ? noCount : sp.wide)
      : {
          id: "costPerTicket",
          value: rate(f.costPerTicket),
          detail: `${sp.wide} · ${ctx.countedShows < ctx.shows ? `the ${ctx.countedShows} shows with counts` : "blended"}${capClause.replace(/^, /, " · ")}`,
          narrowDetail: `${sp.narrow} · blended`,
          title:
            period === "launch"
              ? `All channels' spend to each show's latest count, over tickets sold${spendToCountClause(f)}.`
              : periodCptTitle(f, ctx.countedShows, days ?? 1, capClause),
        };
  // N4: only when the umbrella page has signups; at 0, or before its first sync, the clause is dropped.
  const umbrellaPart = (n: number | undefined) => (ctx.umbrellaPage && n != null && n > 0 ? ` · plus ${count(n)} on the umbrella page` : "");
  const regsTile: SalesTile =
    f.registrations == null
      ? dash("registrations", NO_CIRQLIN_PAGE)
      : {
          id: "registrations",
          value: count(f.registrations),
          detail:
            period === "launch"
              ? `to date · signup pages close at on-sale${umbrellaPart(ctx.umbrellaPage?.launch)}`
              : `${sp.wide} · ${count(sinceLaunch.registrations ?? 0)} to date${umbrellaPart(ctx.umbrellaPage?.byPeriod[period])}`,
          narrowDetail: period === "launch" ? "to date" : sp.narrow,
          title: "",
        };
  const cprTile: SalesTile =
    f.costPerRegistration == null
      ? dash("costPerRegistration", f.registrations == null ? NO_CIRQLIN_PAGE : sp.wide)
      : {
          id: "costPerRegistration",
          value: rate(f.costPerRegistration),
          detail: "show pages, inside their signup windows",
          narrowDetail: "show pages",
          title: "Spend between each show page's first and last signup day, over its signups.",
        };
  return [spendTile, soldTile, ticketsTile, cptTile, ...engagement, regsTile, cprTile];
}

function campaignRows(list: readonly ShowSeries[], period: SalesPeriod, endDay: string): SalesCampaignRow[] {
  const cutoff = periodCutoff(period as PeriodId, endDay);
  const phrase = periodPhrase(period).wide;
  const rows: { row: SalesCampaignRow; inPeriod: number; since: number }[] = [];
  for (const s of list) {
    for (const c of s.campaigns) {
      const inPeriod = periodSpend(c, cutoff, endDay);
      const spending = c.lastSpendDay === endDay;
      const delivery = spending ? "Spending" : c.lastSpendDay ? `Stopped ${shortDay(c.lastSpendDay)}` : "Stopped";
      const base = `${money(inPeriod)} ${phrase}. ${money(c.sinceLaunch)} since launch.`;
      rows.push({
        inPeriod,
        since: c.sinceLaunch,
        row: {
          id: c.campaignId,
          name: c.name,
          delivery,
          unlinked: c.unlinked,
          periodSpend: money(inPeriod),
          sinceLaunch: money(c.sinceLaunch),
          title: c.unlinked ? `Tagged ${s.show.code}. ${base}` : spending ? base : `${base} ${delivery}.`,
        },
      });
    }
  }
  rows.sort((a, b) => b.inPeriod - a.inPeriod || b.since - a.since || a.row.name.localeCompare(b.row.name));
  return rows.map((r) => r.row);
}

function periodSpend(c: CampaignFigures, cutoff: string | null, endDay: string): number {
  let total = 0;
  for (const [day, spend] of c.byDay) if (day <= endDay && (cutoff == null || day >= cutoff)) total += spend;
  return total;
}

function chartPoints(list: readonly ShowSeries[], endDay: string): SalesChartPoint[] {
  return chartRows(list, endDay).map((r) => ({
    day: r.day,
    estimated: r.estimatedBetween != null,
    count: r.count,
    estimateNote: r.estimatedBetween ? `Estimated between counts on ${shortDay(r.estimatedBetween.from)} and ${shortDay(r.estimatedBetween.to)}` : null,
    carryNote: r.carriedFrom ? `carried over from the ${shortDay(r.carriedFrom)} count` : null,
    values: {
      spend: r.spend,
      sold: r.sold,
      tickets: r.ticketsPerDay,
      costPerTicket: r.costPerTicket,
      checkoutActions: r.checkoutActions,
      costPerCheckout: r.costPerCheckout,
      lpv: r.landingPageViews,
      costPerLpv: r.costPerLpv,
      clicks: r.linkClicks,
      cpc: r.cpc,
      registrations: r.registrations,
      costPerRegistration: r.costPerRegistration,
    },
  }));
}

function allocationSteps(s: ShowSeries): AllocationStep[] {
  if (!s.show.allocationFromTiers || s.show.allocation == null || !s.startDay) return [];
  return [{ day: s.startDay, value: s.show.allocation }];
}

function libraryNote(used: readonly Omit<LiftEntry, "computedAt">[], excluded: { name: string; reason: string }[]): string | null {
  if (!used.length) return null;
  const shows = orderShows(used.map((e) => ({ ...e, code: e.code }))).map((e) => `${e.name} (${shortDay(e.showDate)})`).join(", ");
  const out = excluded
    .filter((e) => e.reason === "sold_out_early")
    .map((e) => ` ${e.name} is out: it sold out before its final week.`)
    .join("");
  return `Average and best from ${used.length} finished shows: ${shows}.${out}`;
}

function singleTrajectory(
  s: ShowSeries,
  library: Omit<LiftEntry, "computedAt">[],
  excluded: { name: string; reason: string }[],
  endDay: string,
): SalesTrajectory {
  const show = s.show;
  const base = {
    kind: "single" as const,
    showDay: shortDay(show.showDate),
    showDayIso: null,
    allocation: show.allocation,
    sold: null,
    counts: s.counts.map((c) => ({ day: c.day, sold: c.sold })),
    pace: null,
    needed: null,
    cases: [] as TrajectoryCase[],
    opensAfter: null,
    libraryNote: null,
    missingCapacity: null,
    narrowNote: null,
  };
  if (s.finished) {
    const last = s.counts[s.counts.length - 1];
    const own = library.find((e) => e.eventId === show.eventId);
    const words =
      last && s.finalDay
        ? `Final count · ${SOURCE_LABEL[last.source]}, ${shortDay(s.finalDay)}: ${count(last.sold)}`
        : last
          ? NO_FINAL_COUNT
          : NO_TICKET_COUNTS;
    return {
      ...base,
      wideRange: words,
      narrowRange: words,
      sold: last?.sold ?? null,
      libraryNote: own ? `Final week ${liftLabel(own.lift)} on the 14 days before.` : null,
    };
  }
  if (show.allocation == null) {
    return { ...base, wideRange: MISSING_CAPACITY, narrowRange: MISSING_CAPACITY, missingCapacity: MISSING_CAPACITY };
  }
  const lifts = liftsFor(show, library);
  const p = project(s, { average: lifts.average, best: lifts.best?.lift ?? null });
  if (!p || p.holds == null) {
    return { ...base, wideRange: NO_TICKET_COUNTS, narrowRange: NO_TICKET_COUNTS, sold: p?.sold ?? null };
  }
  const opens = lifts.best == null;
  const cases: TrajectoryCase[] = [{ id: "holds", label: "Holds", value: p.holds }];
  if (!opens && p.average != null && p.best != null && lifts.average != null && lifts.best) {
    cases.push({ id: "average", label: `Like your average finish (${liftLabel(lifts.average)}, ${lifts.used.length} shows)`, value: p.average });
    cases.push({ id: "best", label: `Like your best finish (${liftLabel(lifts.best.lift)}, ${lifts.best.name})`, value: p.best });
  }
  const high = Math.max(...cases.map((c) => c.value));
  const sellsOut: SingleTrajectory["sellsOut"] = p.holds >= p.allocation! ? "holds" : high >= p.allocation! ? "best" : null;
  const alloc = count(p.allocation!);
  const range = high > p.holds ? `${count(p.holds)}–${count(high)}` : count(p.holds);
  const needed = p.neededPerDay != null ? `needed ${count(Math.ceil(p.neededPerDay))} a day` : null;
  const finish = p.sellsOutOn ? `sells out ${shortDay(p.sellsOutOn)} at this pace` : `${count(Math.max(0, p.allocation! - p.holds))} short at this pace`;
  const tail = [needed, finish].filter(Boolean);
  return {
    ...base,
    wideRange: [`Projected on show day: ${range} of ${alloc}`, ...tail].join(" · "),
    narrowRange: `${range} of ${alloc} on show day`,
    narrowNote: tail.length ? `${capitalise(tail.join(" · "))}.` : null,
    showDayIso: show.showDate,
    sold: p.sold,
    pace: {
      fromDay: p.base7.day,
      fromSold: p.base7.sold,
      toDay: p.asOf,
      toSold: p.sold,
      fanDay: p.fanDay,
      fanSold: p.fanSold,
    },
    needed: { showDaySold: p.allocation! },
    cases,
    opensAfter: opens ? LIBRARY_OPENS : null,
    libraryNote: opens ? null : libraryNote(lifts.used, excluded),
    sellsOut,
    // MB3: the phone's Pace and Projected tiles, in N6's words, for one show.
    summary: {
      projected: {
        label: "Projected on show day",
        value: range,
        detail: `up to ${Math.round((100 * Math.min(high, p.allocation!)) / p.allocation!)}% of ${alloc}`,
      },
      pace: paceTile([s], endDay),
    },
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * N6 / MB3 "Pace, last 7 days" and its 14-day line: the period's Sales over
 * its days (the same sales the 7- and 14-day Sales tiles show), so the two tie
 * out. D6's projection keeps its own count-to-count pace.
 */
function paceTile(list: readonly ShowSeries[], endDay: string): TrajectoryTile {
  const a = periodFigures(list, "7", endDay).tickets;
  const b = periodFigures(list, "14", endDay).tickets;
  return {
    label: "Pace, last 7 days",
    value: a == null ? "— a day" : `${oneDecimal(a / 7)} a day`,
    detail: `14-day ${b == null ? "—" : oneDecimal(b / 14)} a day`,
  };
}

/**
 * The period Cost per ticket's hover: which spend, which days, which tickets,
 * and D13's cap in the header's words ("on spend to the 12 Nov count").
 */
function periodCptTitle(f: PeriodFigures, countedShows: number, days: number, capClause: string): string {
  if (!f.ticketDays) return "";
  const which = countedShows === 1 ? "this show's" : `the ${countedShows} shows with counts'`;
  const span = days === 1 ? "day" : `${days} days`;
  const daysWords = f.ticketDaysDiffer
    ? `${span} to each show's last count`
    : `${span} ${shortDay(f.ticketDays.from)}–${shortDay(f.ticketDays.to)}`;
  return `Spend on ${which} ${daysWords}, over the ${count(Math.round(f.tickets ?? 0))} tickets they sold in those days${capClause}.`;
}

function allTrajectory(list: readonly ShowSeries[], library: Omit<LiftEntry, "computedAt">[], endDay: string): SalesTrajectory {
  const bars: AllShowBar[] = [];
  let low = 0;
  let high = 0;
  let alloc = 0;
  let sold = 0;
  let n = 0;
  // The one count date (the same as the view's countDay), not each projection's own.
  const countDay = latestCountDay(list);
  const left: string[] = [];
  for (const s of list) {
    const label = `${s.show.name} · ${shortDay(s.show.showDate)}`;
    const id = chipId(s.show.code);
    if (s.show.allocation == null) {
      bars.push({ id, label, sold: null, low: null, high: null, allocation: null, caption: MISSING_CAPACITY_SHORT, sellsOut: null });
      left.push(`${s.show.name} has no capacity`);
      continue;
    }
    const lifts = liftsFor(s.show, library);
    const p = project(s, { average: lifts.average, best: lifts.best?.lift ?? null });
    if (!p || p.holds == null) {
      bars.push({ id, label, sold: null, low: null, high: null, allocation: s.show.allocation, caption: NO_COUNTS_BAR, sellsOut: null });
      left.push(`${s.show.name} has ${NO_TICKET_COUNTS}`);
      continue;
    }
    const cap = p.allocation!;
    const top = Math.max(p.holds, p.average ?? p.holds, p.best ?? p.holds);
    // N6: capped at capacity; say when the pace (or only the best case) sells it out.
    const sellsOut: AllShowBar["sellsOut"] = p.holds >= cap ? "holds" : top >= cap ? "best" : null;
    const caption =
      sellsOut === "holds"
        ? `${count(p.sold)} → sells out at this pace`
        : sellsOut === "best"
          ? `${count(p.sold)} → ${count(p.holds)}–${count(cap)} · sells out if best`
          : `${count(p.sold)} → ${top > p.holds ? `${count(p.holds)}–${count(top)}` : count(p.holds)}`;
    bars.push({ id, label, sold: p.sold, low: p.holds, high: top, allocation: cap, caption, sellsOut });
    low += p.holds;
    high += top;
    alloc += cap;
    sold += p.sold;
    n += 1;
  }
  const range = high > low ? `${count(low)}–${count(high)}` : count(low);
  const why = [...left, "umbrella excluded"].join("; ");
  const pct = (x: number) => `${Math.round((100 * x) / alloc)}%`;
  return {
    kind: "all",
    wideRange: n ? `Projected on show day: ${range} of ${count(alloc)} across ${n} shows (${why})` : MISSING_CAPACITY,
    narrowRange: n ? `${range} of ${count(alloc)} on show day` : MISSING_CAPACITY,
    bars,
    note: ALL_NOTE,
    summary: n
      ? {
          sold: { label: `Sold · count of ${shortDay(countDay!)}`, value: count(sold), detail: `${pct(sold)} of ${count(alloc)} across ${n} shows` },
          projected: { label: "Projected on show day", value: range, detail: `up to ${pct(high)} of ${count(alloc)} · each show capped at its capacity` },
          pace: paceTile(list, endDay),
        }
      : undefined,
  };
}

function freshness(series: readonly ShowSeries[], endDay: string): FreshnessStamp[] {
  const out: FreshnessStamp[] = [];
  const stale = (day: string) => dayDiff(day, endDay) > STALE_AFTER_DAYS;
  const shows = series.filter((s) => !s.show.isUmbrella);
  const countDays = shows.flatMap((s) => (s.finished ? [] : s.counts.map((c) => c.day)));
  const spendDays = series.flatMap((s) => [...s.days.values()].filter((f) => f.spend > 0).map((f) => f.day));
  const signupDays = shows.filter((s) => s.show.cirqlinPageId != null).flatMap((s) => [...s.days.values()].map((f) => f.day).filter((d) => s.days.get(d)!.signups > 0));
  const stamp = (id: FreshnessStamp["id"], word: string, days: string[]) => {
    if (!days.length) return;
    const last = days.sort().pop()!;
    out.push({ id, wide: `${word} to ${shortDay(last)}`, narrow: `${word} ${shortDay(last)}`, stale: stale(last) });
  };
  stamp("counts", "Counts", countDays);
  stamp("spend", "Spend", spendDays);
  stamp("signups", "Signups", signupDays);
  return out;
}

function viewTitle(name: string, clientName: string): string {
  return `${name} · ${clientName}`;
}

export function buildSalesDashboard(input: SalesCalcInput): SalesBuild {
  const endDay = endDayOf(input);
  const series = buildSeries(input);
  const { entries: library, fresh, excluded } = buildLibrary(series, input.library, input.today);
  const ordered = orderShows([...series.values()].map((s) => ({ ...s, showDate: s.show.showDate, code: s.show.code })));
  const upcoming = ordered.filter((s) => !s.finished && !s.show.isUmbrella);
  const umbrellas = ordered.filter((s) => s.show.isUmbrella && !s.finished);
  const finished = ordered.filter((s) => s.finished && !s.show.isUmbrella && (s.counts.length > 0 || s.days.size > 0));
  const clientName = input.client.name;
  const launchOf = new Map<string, PeriodFigures>();
  const launch = (s: ShowSeries) => {
    let f = launchOf.get(s.show.eventId);
    if (!f) launchOf.set(s.show.eventId, (f = periodFigures([s], "launch", endDay)));
    return f;
  };

  // N2: venues from venue_key only.
  const groups = groupVenues(ordered, (s) => launch(s).spend);
  const live = groups.filter((g) => g.live.length > 0);
  const multiVenue = live.length > 1;
  const venueOf = new Map<string, VenueGroup>();
  for (const g of groups) for (const s of [...g.live, ...g.umbrellas, ...g.finished]) venueOf.set(s.show.eventId, g);
  // N8: "{Venue} umbrella". With no venue_key yet, the client's name stands in (D1's wording).
  const umbrellaVenue = (s: ShowSeries) => {
    const g = venueOf.get(s.show.eventId);
    return g?.key != null ? g.name : clientName;
  };
  const umbrellaName = (s: ShowSeries) => `${umbrellaVenue(s)} umbrella`;
  const umbrellaAmounts = (list: readonly ShowSeries[]) => list.map((u) => ({ venue: umbrellaVenue(u), amount: launch(u).spend }));
  const umbrellaLineFor = (list: readonly ShowSeries[]) => {
    const amounts = umbrellaAmounts(list).filter((u) => u.amount > 0);
    if (!amounts.length) return null;
    return amounts.length === 1 ? `Separate ${amounts[0].venue} umbrella spend ${money(amounts[0].amount)}` : `Separate umbrella spend: ${amounts.map((u) => `${u.venue} ${money(u.amount)}`).join(", ")}`;
  };
  const umbrellaPageFor = (list: readonly ShowSeries[]): TileContext["umbrellaPage"] => {
    const paged = list.filter((u) => u.show.cirqlinPageId != null);
    if (!paged.length) return null;
    const byPeriod: Partial<Record<SalesPeriod, number>> = {};
    for (const period of PERIOD_IDS) byPeriod[period] = periodFigures(paged, period, endDay).registrations ?? 0;
    return { launch: byPeriod.launch ?? 0, byPeriod };
  };

  const views: Record<string, SalesShowView> = {};
  const periods: Record<string, Record<SalesPeriod, PeriodView>> = {};

  const fill = (
    id: string,
    list: ShowSeries[],
    header: Pick<SalesShowView, "title" | "narrowTitle" | "subtitle" | "narrowSubtitle" | "umbrellaLine">,
    trajectory: SalesTrajectory,
    ctx: Omit<TileContext, "soldTitle" | "shows" | "countedShows">,
    allocation: AllocationStep[],
    totals: {
      scope: string;
      venueKey: string | null;
      kind: "venue" | "all" | "show" | "umbrella";
      parts: { id: string; label: string; list: ShowSeries[]; children?: { id: string; label: string; list: ShowSeries[] }[] }[];
      leftOut: ShowSeries[];
      finishedLeftOut: boolean;
      sentenceName: string;
      venues?: number;
    },
  ) => {
    const launchF = periodFigures(list, "launch", endDay);
    const soldTitle = soldHover(list, launchF);
    const shows = list.length;
    const countedShows = list.filter((s) => s.counts.length > 0).length;
    const perPeriod = {} as Record<SalesPeriod, PeriodView>;
    for (const period of PERIOD_IDS) {
      const f = period === "launch" ? launchF : periodFigures(list, period, endDay);
      perPeriod[period] = {
        tiles: tilesFor(f, launchF, period, endDay, { ...ctx, soldTitle, shows, countedShows }),
        campaigns: campaignRows(list, period, endDay),
        spendTotal: spendTotal({
          scope: totals.scope,
          figures: f,
          parts: totals.parts.map((part) => ({
            id: part.id,
            label: part.label,
            figures: periodFigures(part.list, period, endDay),
            ...(part.children ? { children: part.children.map((c) => ({ id: c.id, label: c.label, figures: periodFigures(c.list, period, endDay) })) } : {}),
          })),
          span: span(period).wide,
          endDay,
          leftOut: totals.leftOut.map((u) => ({ label: umbrellaName(u), amount: periodFigures([u], period, endDay).spend })),
          finishedLeftOut: totals.finishedLeftOut,
        }),
      };
    }
    periods[id] = perPeriod;
    const lastDay = list.map((s) => s.lastDay).sort().pop() ?? endDay;
    views[id] = {
      ...header,
      tiles: perPeriod[BASE_PERIOD].tiles,
      endDay: lastDay < endDay ? lastDay : endDay,
      countDay: launchF.soldDay,
      showCounts: { counted: countedShows, shows },
      points: chartPoints(list, endDay),
      allocation,
      trajectory,
      campaigns: perPeriod[BASE_PERIOD].campaigns,
      venueKey: totals.venueKey,
      header: headerSentence({
        kind: totals.kind,
        name: totals.sentenceName,
        launch: launchF,
        endDay,
        sourceLabels: SOURCE_LABEL,
        countedShows,
        venues: totals.venues,
        umbrellas: umbrellaAmounts(totals.leftOut),
        pageSignups: totals.kind === "umbrella" ? launchF.registrations : undefined,
        finishedLeftOut: totals.finishedLeftOut,
      }),
      spendTotal: perPeriod.launch.spendTotal,
      periods: perPeriod,
    };
  };

  const capacityNote = (list: ShowSeries[]) => {
    const noCapacity = list.filter((s) => s.show.allocation == null).map((s) => s.show.name);
    const withCapacity = list.length - noCapacity.length;
    return {
      subtitle: noCapacity.length ? `${withCapacity} shows with a capacity · ${noCapacity.join(", ")} left out` : `${list.length} shows`,
      narrowSubtitle: noCapacity.length ? `${withCapacity} shows · ${noCapacity.join(", ")} left out` : `${list.length} shows`,
    };
  };

  // All venues (the client): "all", as before.
  fill(
    ALL_SHOWS_ID,
    upcoming,
    { title: viewTitle(multiVenue ? "All venues" : "All shows", clientName), narrowTitle: multiVenue ? "All venues" : "All shows", ...capacityNote(upcoming), umbrellaLine: umbrellaLineFor(umbrellas) },
    allTrajectory(upcoming, library, endDay),
    { scope: multiVenue ? "All venues" : live[0]?.name ?? clientName, umbrella: null, umbrellaPage: umbrellaPageFor(umbrellas) },
    [],
    {
      scope: multiVenue ? "All venues" : live[0]?.name ?? clientName,
      venueKey: null,
      kind: multiVenue ? "all" : "venue",
      parts: multiVenue
        ? live.map((g) => ({
            id: g.viewId,
            label: g.name,
            list: g.live,
            // "Venue not set": its shows by name, for the share's hover (Q6).
            ...(g.key == null ? { children: g.live.map((s) => ({ id: chipId(s.show.code), label: s.show.name, list: [s] })) } : {}),
          }))
        : upcoming.map((s) => ({ id: chipId(s.show.code), label: s.show.name, list: [s] })),
      leftOut: umbrellas,
      finishedLeftOut: true,
      sentenceName: multiVenue ? clientName : live[0]?.name ?? clientName,
      venues: live.length,
    },
  );

  // One All shows view per venue.
  for (const g of groups) {
    if (!g.live.length && !g.umbrellas.length) continue;
    fill(
      g.viewId,
      g.live,
      { title: viewTitle("All shows", g.name), narrowTitle: g.name, ...capacityNote(g.live), umbrellaLine: umbrellaLineFor(g.umbrellas) },
      allTrajectory(g.live, library, endDay),
      { scope: g.name, umbrella: null, umbrellaPage: umbrellaPageFor(g.umbrellas) },
      [],
      {
        scope: g.name,
        venueKey: g.key,
        kind: "venue",
        parts: g.live.map((s) => ({ id: chipId(s.show.code), label: s.show.name, list: [s] })),
        leftOut: g.umbrellas,
        finishedLeftOut: true,
        sentenceName: g.name,
      },
    );
  }

  for (const s of [...upcoming, ...finished]) {
    const when = weekdayDay(s.show.showDate);
    const sub = s.finished ? `${when} · finished` : s.show.allocation != null ? `${when} · allocation ${count(s.show.allocation)}` : when;
    const g = venueOf.get(s.show.eventId);
    fill(
      chipId(s.show.code),
      [s],
      { title: viewTitle(s.show.name, clientName), narrowTitle: viewTitle(s.show.name, clientName), subtitle: sub, narrowSubtitle: sub, umbrellaLine: s.finished ? null : umbrellaLineFor(g?.umbrellas ?? []) },
      singleTrajectory(s, library, excluded, endDay),
      { scope: s.show.name, umbrella: null, umbrellaPage: null },
      allocationSteps(s),
      { scope: s.show.name, venueKey: g?.key ?? null, kind: "show", parts: [], leftOut: [], finishedLeftOut: false, sentenceName: s.show.name },
    );
  }

  for (const s of umbrellas) {
    const g = venueOf.get(s.show.eventId);
    const name = umbrellaName(s);
    const w = s.signupWindow;
    fill(
      chipId(s.show.code),
      [s],
      { title: name, narrowTitle: name, subtitle: `${s.show.name} · not a show: no tickets and no trajectory`, narrowSubtitle: s.show.name, umbrellaLine: null },
      {
        kind: "single",
        wideRange: "An umbrella has no Total sold, Sales or Cost per ticket, and no trajectory.",
        narrowRange: "Not a show: no trajectory.",
        narrowNote: null,
        showDay: null,
        showDayIso: null,
        allocation: null,
        sold: null,
        counts: [],
        pace: null,
        needed: null,
        cases: [],
        opensAfter: null,
        libraryNote: null,
        missingCapacity: null,
        sellsOut: null,
      },
      { scope: null, umbrella: { pageSlug: s.show.cirqlinPageSlug ?? null, window: w ? `${shortDay(w.first)}–${shortDay(w.last)}` : null }, umbrellaPage: null },
      [],
      { scope: name, venueKey: g?.key ?? null, kind: "umbrella", parts: [], leftOut: [], finishedLeftOut: false, sentenceName: name },
    );
  }

  const chip = (s: ShowSeries, kind: SalesShowChip["kind"]): SalesShowChip => ({
    id: chipId(s.show.code),
    // N8: the chip reads "Umbrella" in every chip row; "{Venue} umbrella" is for text outside a chip row.
    wide: kind === "umbrella" ? "Umbrella" : `${s.show.name} · ${shortDay(s.show.showDate)}`,
    narrow: kind === "umbrella" ? "Umbrella" : s.show.name,
    kind,
    finished: s.finished,
  });

  const venues: SalesVenue[] = groups
    .filter((g) => g.live.length || g.umbrellas.length)
    .map((g) => ({
      key: g.key,
      name: g.name,
      liveShows: g.live.length,
      viewId: g.viewId,
      shows: [
        { id: g.viewId, wide: "All shows", narrow: "All", kind: "all" as const, finished: false },
        ...g.live.map((s) => chip(s, "show")),
        ...g.umbrellas.map((s) => chip(s, "umbrella")),
      ],
      finishedShows: g.finished.map((s) => chip(s, "show")),
    }));
  const initial = defaultVenue(groups);

  const model: SalesDashboardModel = {
    clientName,
    freshness: freshness(ordered, endDay),
    shows: [
      { id: ALL_SHOWS_ID, wide: multiVenue ? "All venues" : "All shows", narrow: "All", kind: "all", finished: false },
      ...upcoming.map((s) => chip(s, "show")),
      ...umbrellas.map((s) => chip(s, "umbrella")),
    ],
    finishedShows: finished.map((s) => chip(s, "show")),
    // N2: open on the venue with the most live shows; N5: since launch.
    initialShowId: initial?.viewId ?? ALL_SHOWS_ID,
    initialPeriod: BASE_PERIOD,
    crossClientNote: null,
    reviewLine: null,
    views,
    venues,
    initialVenueViewId: initial?.viewId ?? ALL_SHOWS_ID,
  };
  return { model, periods, freshLibrary: fresh, library, excludedFromLibrary: excluded };
}

function soldHover(list: readonly ShowSeries[], launch: PeriodFigures): string {
  if (launch.sold == null) return "";
  if (list.length === 1) {
    const s = list[0];
    const last = s.counts[s.counts.length - 1];
    const day = shortDay(s.finalDay ?? last.day);
    return launch.soldComps ? `${SOURCE_LABEL[last.source]}, ${day}. ${count(launch.soldComps)} comps on top.` : `${SOURCE_LABEL[last.source]}, ${day}.`;
  }
  const counted = list.filter((s) => s.counts.length > 0);
  const parts = counted.map((s) => count(s.counts[s.counts.length - 1].sold)).join(" + ");
  const missing = list.filter((s) => s.counts.length === 0).map((s) => s.show.name);
  return missing.length ? `${parts}. ${missing.join(", ")} ${missing.length === 1 ? "has" : "have"} no counts.` : `${parts}.`;
}
