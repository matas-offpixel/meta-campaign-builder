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
  SALES_METRICS,
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
  type SalesTrajectory,
  type TrajectoryCase,
} from "../sales-vs-spend.ts";
import { dayDiff, shortDay, weekdayDay } from "./days.ts";
import {
  PERIOD_IDS,
  buildLibrary,
  buildSeries,
  chartRows,
  endDayOf,
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

export const ALL_SHOWS_ID = "all";
/** The tiles and campaigns the view carries are this period's (the layout's `tilesForPeriod` treats them as 14 days). */
export const BASE_PERIOD: SalesPeriod = "14";
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
const UMBRELLA_TILE = "Not in All shows";
/** A finished show whose counts stop before show day. New words: listed for design. */
export const NO_FINAL_COUNT = "No final count yet";

export interface PeriodView {
  tiles: SalesTile[];
  campaigns: SalesCampaignRow[];
}

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

/** "1 action", "388 actions". */
function several(n: number, word: string): string {
  return `${count(n)} ${Math.round(n) === 1 ? word : `${word}s`}`;
}

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

function tilesFor(
  f: PeriodFigures,
  sinceLaunch: PeriodFigures,
  period: SalesPeriod,
  endDay: string,
  opts: { soldTitle: string; umbrella: boolean },
): SalesTile[] {
  const phrase = periodPhrase(period);
  const split = platformSplit(f);
  const spendDetail = [split, period === "launch" ? null : `of ${money(sinceLaunch.spend)} since launch`].filter(Boolean).join(" · ");
  const spendTile: SalesTile = {
    id: "spend",
    value: money(f.spend),
    detail: opts.umbrella ? "Separate from the shows" : spendDetail || phrase.wide,
    narrowDetail: opts.umbrella ? "Separate from the shows" : split || phrase.narrow,
    title: split ? `${split}.` : "",
  };
  if (opts.umbrella) {
    return SALES_METRICS.map((metric) =>
      metric.id === "spend" ? spendTile : { id: metric.id, value: "—", detail: UMBRELLA_TILE, narrowDetail: UMBRELLA_TILE, title: "" },
    );
  }

  const dash = (id: SalesMetricId, detail: string, narrow = detail, title = ""): SalesTile => ({ id, value: "—", detail, narrowDetail: narrow, title });
  const soldTile: SalesTile =
    f.sold == null || f.soldDay == null
      ? dash("sold", NO_TICKET_COUNTS)
      : (() => {
          const source = `${sourcesLabel(f.soldSources)}, ${shortDay(f.soldDay)}`;
          const named = f.soldIsFinal ? `Final count · ${source}` : source;
          return {
            id: "sold",
            value: count(f.sold),
            detail: f.soldComps ? `${named} · plus ${count(f.soldComps)} comps` : named,
            narrowDetail: named,
            title: opts.soldTitle,
          };
        })();
  const endLabel = shortDay(endDay);
  const ticketsTile: SalesTile =
    f.tickets == null
      ? dash("tickets", NO_TICKET_COUNTS)
      : {
          id: "tickets",
          value: count(f.tickets),
          detail: phrase.wide,
          narrowDetail: phrase.narrow,
          title: period === "launch" ? "" : `${count(f.tickets)} tickets ${phrase.wide === "yesterday" ? "yesterday" : `in the ${period} days to ${endLabel}`}.`,
        };
  const cptTile: SalesTile =
    f.costPerTicket == null
      ? dash("costPerTicket", f.tickets == null ? NO_TICKET_COUNTS : "—")
      : {
          id: "costPerTicket",
          value: rate(f.costPerTicket),
          detail: period === "launch" ? "blended · to the latest count" : "blended · complete windows",
          narrowDetail: "blended",
          title: period === "launch" ? "Spend to the latest count over tickets sold." : "Blended cost per ticket, complete windows only.",
        };
  const regsTile: SalesTile =
    f.registrations == null
      ? dash("registrations", NO_CIRQLIN_PAGE)
      : f.signupsClosed
        ? dash("registrations", "signups closed at on-sale", "signups closed", "Signups closed when the show went on sale.")
        : { id: "registrations", value: count(f.registrations), detail: phrase.wide, narrowDetail: phrase.narrow, title: "" };
  const cprTile: SalesTile =
    f.registrations == null
      ? dash("costPerRegistration", NO_CIRQLIN_PAGE)
      : f.costPerRegistration == null
        ? dash("costPerRegistration", f.signupsClosed ? "signups closed at on-sale" : "—", f.signupsClosed ? "signups closed" : "—", "No signup days in this window.")
        : {
            id: "costPerRegistration",
            value: rate(f.costPerRegistration),
            detail: several(f.registrations, "signup"),
            narrowDetail: several(f.registrations, "signup"),
            title: "Spend between the first and last signup day, over signups.",
          };
  const per = (value: number | null, detail: string, title: string, id: SalesMetricId): SalesTile =>
    value == null ? dash(id, "—") : { id, value: rate(value), detail, narrowDetail: detail, title };

  return [
    spendTile,
    soldTile,
    ticketsTile,
    cptTile,
    {
      id: "checkoutActions",
      value: count(f.checkoutActions),
      detail: f.costPerCheckout == null ? phrase.wide : `${rate(f.costPerCheckout)} each`,
      narrowDetail: f.costPerCheckout == null ? phrase.narrow : `${rate(f.costPerCheckout)} each`,
      title: CHECKOUT_TITLE,
    },
    per(f.costPerCheckout, several(f.checkoutActions, "action"), CHECKOUT_TITLE, "costPerCheckout"),
    { id: "lpv", value: count(f.landingPageViews), detail: phrase.wide, narrowDetail: phrase.narrow, title: "Landing page views on Meta." },
    per(f.costPerLpv, several(f.landingPageViews, "view"), "Meta spend divided by landing page views.", "costPerLpv"),
    { id: "clicks", value: count(f.linkClicks), detail: phrase.wide, narrowDetail: phrase.narrow, title: "Link clicks on Meta." },
    per(f.cpc, "blended", "Meta spend divided by clicks.", "cpc"),
    regsTile,
    cprTile,
  ];
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
    cases.push({ id: "average", label: `Like your average finish ${liftLabel(lifts.average)}`, value: p.average });
    cases.push({ id: "best", label: `Like your best finish ${liftLabel(lifts.best.lift)}`, value: p.best });
  }
  const high = Math.max(...cases.map((c) => c.value));
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
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function allTrajectory(list: readonly ShowSeries[], library: Omit<LiftEntry, "computedAt">[]): SalesTrajectory {
  const bars: AllShowBar[] = [];
  let low = 0;
  let high = 0;
  let alloc = 0;
  let n = 0;
  const left: string[] = [];
  for (const s of list) {
    const label = `${s.show.name} · ${shortDay(s.show.showDate)}`;
    const id = chipId(s.show.code);
    if (s.show.allocation == null) {
      bars.push({ id, label, sold: null, low: null, high: null, allocation: null, caption: MISSING_CAPACITY_SHORT });
      left.push(`${s.show.name} has no capacity`);
      continue;
    }
    const lifts = liftsFor(s.show, library);
    const p = project(s, { average: lifts.average, best: lifts.best?.lift ?? null });
    if (!p || p.holds == null) {
      bars.push({ id, label, sold: null, low: null, high: null, allocation: s.show.allocation, caption: NO_TICKET_COUNTS });
      left.push(`${s.show.name} has ${NO_TICKET_COUNTS}`);
      continue;
    }
    const top = Math.max(p.holds, p.average ?? p.holds, p.best ?? p.holds);
    bars.push({ id, label, sold: p.sold, low: p.holds, high: top, allocation: p.allocation, caption: `${count(p.sold)} · ${top > p.holds ? `${count(p.holds)}–${count(top)}` : count(p.holds)}` });
    low += p.holds;
    high += top;
    alloc += p.allocation!;
    n += 1;
  }
  const range = high > low ? `${count(low)}–${count(high)}` : count(low);
  const why = [...left, "umbrella excluded"].join("; ");
  return {
    kind: "all",
    wideRange: n ? `Projected on show day: ${range} of ${count(alloc)} across ${n} shows (${why})` : MISSING_CAPACITY,
    narrowRange: n ? `${range} of ${count(alloc)} on show day` : MISSING_CAPACITY,
    bars,
    note: ALL_NOTE,
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

  const umbrellaSpend = umbrellas.reduce((sum, s) => sum + periodFigures([s], "launch", endDay).spend, 0);
  const umbrellaLine = umbrellas.length && umbrellaSpend > 0 ? `Separate ${clientName} umbrella spend ${money(umbrellaSpend)}` : null;

  const views: Record<string, SalesShowView> = {};
  const periods: Record<string, Record<SalesPeriod, PeriodView>> = {};

  const fill = (id: string, list: ShowSeries[], header: Pick<SalesShowView, "title" | "narrowTitle" | "subtitle" | "narrowSubtitle" | "umbrellaLine">, trajectory: SalesTrajectory, umbrella: boolean, allocation: AllocationStep[]) => {
    const launch = periodFigures(list, "launch", endDay);
    const soldTitle = soldHover(list, launch);
    const perPeriod = {} as Record<SalesPeriod, PeriodView>;
    for (const period of PERIOD_IDS) {
      const f = period === "launch" ? launch : periodFigures(list, period, endDay);
      perPeriod[period] = { tiles: tilesFor(f, launch, period, endDay, { soldTitle, umbrella }), campaigns: campaignRows(list, period, endDay) };
    }
    periods[id] = perPeriod;
    const lastDay = list.map((s) => s.lastDay).sort().pop() ?? endDay;
    views[id] = {
      ...header,
      tiles: perPeriod[BASE_PERIOD].tiles,
      endDay: lastDay < endDay ? lastDay : endDay,
      points: chartPoints(list, endDay),
      allocation,
      trajectory,
      campaigns: perPeriod[BASE_PERIOD].campaigns,
      periods: perPeriod,
    };
  };

  const noCapacity = upcoming.filter((s) => s.show.allocation == null).map((s) => s.show.name);
  const withCapacity = upcoming.length - noCapacity.length;
  fill(
    ALL_SHOWS_ID,
    upcoming,
    {
      title: viewTitle("All shows", clientName),
      narrowTitle: "All shows",
      subtitle: noCapacity.length ? `${withCapacity} shows with a capacity · ${noCapacity.join(", ")} left out` : `${upcoming.length} shows`,
      narrowSubtitle: noCapacity.length ? `${withCapacity} shows · ${noCapacity.join(", ")} left out` : `${upcoming.length} shows`,
      umbrellaLine,
    },
    allTrajectory(upcoming, library),
    false,
    [],
  );

  for (const s of [...upcoming, ...finished]) {
    const when = weekdayDay(s.show.showDate);
    const sub = s.finished ? `${when} · finished` : s.show.allocation != null ? `${when} · allocation ${count(s.show.allocation)}` : when;
    fill(
      chipId(s.show.code),
      [s],
      { title: viewTitle(s.show.name, clientName), narrowTitle: viewTitle(s.show.name, clientName), subtitle: sub, narrowSubtitle: sub, umbrellaLine: s.finished ? null : umbrellaLine },
      singleTrajectory(s, library, excluded),
      false,
      allocationSteps(s),
    );
  }

  for (const s of umbrellas) {
    fill(
      chipId(s.show.code),
      [s],
      { title: viewTitle(s.show.name, clientName), narrowTitle: s.show.name, subtitle: UMBRELLA_TILE, narrowSubtitle: UMBRELLA_TILE, umbrellaLine: null },
      {
        kind: "single",
        wideRange: `${UMBRELLA_TILE}.`,
        narrowRange: `${UMBRELLA_TILE}.`,
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
      },
      true,
      [],
    );
  }

  const chip = (s: ShowSeries, kind: SalesShowChip["kind"]): SalesShowChip => ({
    id: chipId(s.show.code),
    wide: kind === "umbrella" ? s.show.name : `${s.show.name} · ${shortDay(s.show.showDate)}`,
    narrow: s.show.name,
    kind,
    finished: s.finished,
  });

  const model: SalesDashboardModel = {
    clientName,
    freshness: freshness(ordered, endDay),
    shows: [
      { id: ALL_SHOWS_ID, wide: "All shows", narrow: "All", kind: "all", finished: false },
      ...upcoming.map((s) => chip(s, "show")),
      ...umbrellas.map((s) => chip(s, "umbrella")),
    ],
    finishedShows: finished.map((s) => chip(s, "show")),
    initialShowId: ALL_SHOWS_ID,
    initialPeriod: BASE_PERIOD,
    crossClientNote: null,
    reviewLine: null,
    views,
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
