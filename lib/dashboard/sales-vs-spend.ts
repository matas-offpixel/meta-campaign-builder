/**
 * Props for the sales-vs-spend layout (design record D1–D13, DV1–DV3).
 *
 * `SalesDashboardModel` is the whole payload. The layout reads nothing else.
 * The server calc (HD3) replaces the fixture by filling this type; the
 * component tree stays.
 *
 * A missing capacity is `null`. The layout prints the record's sentence
 * and never substitutes a default.
 */

export type SalesSurface = "internal" | "share";

export type SalesPeriod = "launch" | "30" | "14" | "7" | "3" | "yesterday";

export type SalesMetricId =
  | "spend"
  | "sold"
  | "tickets"
  | "costPerTicket"
  | "checkoutActions"
  | "costPerCheckout"
  | "lpv"
  | "costPerLpv"
  | "clicks"
  | "cpc"
  | "registrations"
  | "costPerRegistration";

export type SalesUnit = "money" | "count" | "rate";

export const MISSING_CAPACITY = "Set capacity on the event to see the sell-out line";
export const MISSING_CAPACITY_SHORT = "Set capacity on the event";
export const NO_CIRQLIN_PAGE = "No CIRQLIN page";
export const NO_TICKET_COUNTS = "no ticket counts yet";
export const PICK_A_METRIC = "Pick at least one metric";
export const INDEX_TO_PEAK = "Index to own peak";
export const LIBRARY_OPENS = "Opens after your 2nd finished show with counts";

export const SALES_PERIODS: { id: SalesPeriod; label: string; days: number | null }[] = [
  { id: "launch", label: "Since launch", days: null },
  { id: "30", label: "30 days", days: 30 },
  { id: "14", label: "14 days", days: 14 },
  { id: "7", label: "7 days", days: 7 },
  { id: "3", label: "3 days", days: 3 },
  { id: "yesterday", label: "Yesterday", days: 1 },
];

export type SalesMetricDef = {
  id: SalesMetricId;
  label: string;
  narrow: string;
  unit: SalesUnit;
  /** Cost metrics draw dashed, in the colour of this volume metric. */
  costOf: SalesMetricId | null;
};

export const SALES_METRICS: readonly SalesMetricDef[] = [
  { id: "spend", label: "Spend", narrow: "Spend", unit: "money", costOf: null },
  { id: "sold", label: "Total sold", narrow: "Total sold", unit: "count", costOf: null },
  { id: "tickets", label: "Tickets", narrow: "Tickets", unit: "count", costOf: null },
  { id: "costPerTicket", label: "Cost per ticket", narrow: "Cost / ticket", unit: "rate", costOf: "tickets" },
  { id: "checkoutActions", label: "Checkout actions", narrow: "Checkout actions", unit: "count", costOf: null },
  { id: "costPerCheckout", label: "£ per checkout action", narrow: "£ / action", unit: "rate", costOf: "checkoutActions" },
  { id: "lpv", label: "LPVs", narrow: "LPVs", unit: "count", costOf: null },
  { id: "costPerLpv", label: "£ per LPV", narrow: "£ / LPV", unit: "rate", costOf: "lpv" },
  { id: "clicks", label: "Clicks", narrow: "Clicks", unit: "count", costOf: null },
  { id: "cpc", label: "CPC", narrow: "CPC", unit: "rate", costOf: "clicks" },
  { id: "registrations", label: "Registrations", narrow: "Registrations", unit: "count", costOf: null },
  { id: "costPerRegistration", label: "£ per registration", narrow: "£ / registration", unit: "rate", costOf: "registrations" },
];

export const DEFAULT_ON_METRICS: readonly SalesMetricId[] = ["spend", "sold"];

const METRIC_BY_ID = new Map(SALES_METRICS.map((metric) => [metric.id, metric]));

export function salesMetric(id: SalesMetricId): SalesMetricDef {
  const metric = METRIC_BY_ID.get(id);
  if (!metric) throw new Error(`unknown sales metric ${id}`);
  return metric;
}

export type FreshnessStamp = {
  id: "counts" | "spend" | "signups";
  wide: string;
  narrow: string;
  /** Amber when the source is more than two days behind yesterday. */
  stale: boolean;
};

export type SalesShowChip = {
  id: string;
  wide: string;
  narrow: string;
  kind: "all" | "show" | "umbrella";
  finished: boolean;
};

export type SalesTile = {
  id: SalesMetricId;
  value: string;
  detail: string;
  narrowDetail: string;
  /** Hover sentence. Empty when the tile has nothing extra to say. */
  title: string;
};

export type SalesChartPoint = {
  /** ISO day, yyyy-mm-dd. Today is never included. */
  day: string;
  estimated: boolean;
  /** A real ticket count. The chart dots Total sold on these days only. */
  count: boolean;
  estimateNote: string | null;
  values: Partial<Record<SalesMetricId, number | null>>;
};

export type AllocationStep = {
  day: string;
  /** Cumulative allocation released by this day. */
  value: number;
};

export type TrajectoryCase = {
  id: "holds" | "average" | "best";
  label: string;
  value: number;
};

export type TrajectoryCount = {
  day: string;
  sold: number;
};

/**
 * Pace measured count-to-count. The dashed line runs from the latest
 * count to D−7 (`fanDay`); the cases fan out from there to show day.
 */
export type TrajectoryPace = {
  fromDay: string;
  fromSold: number;
  toDay: string;
  toSold: number;
  fanDay: string;
  fanSold: number;
};

/** Dotted line from the latest count to this sold on show day. */
export type TrajectoryNeeded = {
  showDaySold: number;
};

export type SingleTrajectory = {
  kind: "single";
  wideRange: string;
  narrowRange: string;
  narrowNote: string | null;
  /** Display label, "21 Nov". */
  showDay: string | null;
  /** ISO day the show-day rule is drawn on. Null when the chart is not drawn. */
  showDayIso: string | null;
  allocation: number | null;
  sold: number | null;
  /** Real counts. Drawn as dots. */
  counts: TrajectoryCount[];
  pace: TrajectoryPace | null;
  needed: TrajectoryNeeded | null;
  cases: TrajectoryCase[];
  /** Set when fewer than two finished shows have counts. Only Holds is drawn. */
  opensAfter: string | null;
  /** This client's own finished shows. Safe on the share. */
  libraryNote: string | null;
  /** Set when the event has no capacity. No sell-out line is drawn. */
  missingCapacity: string | null;
  /** N6: the projection reaches capacity at the holds pace, or only in the best case. */
  sellsOut?: "holds" | "best" | null;
};

export type AllShowBar = {
  id: string;
  label: string;
  sold: number | null;
  low: number | null;
  high: number | null;
  allocation: number | null;
  caption: string;
  /** N6: the holds case reaches capacity ("holds"), or only the best case does ("best"). */
  sellsOut?: "holds" | "best" | null;
};

/** N6: one of the three tiles above the All shows bars. */
export type TrajectoryTile = {
  label: string;
  value: string;
  detail: string;
};

export type AllTrajectory = {
  kind: "all";
  wideRange: string;
  narrowRange: string;
  bars: AllShowBar[];
  note: string;
  /** N6: "Sold · count of {date}", "Projected on show day", "Pace, last 7 days". */
  summary?: { sold: TrajectoryTile; projected: TrajectoryTile; pace: TrajectoryTile };
};

export type SalesTrajectory = SingleTrajectory | AllTrajectory;

export type SalesCampaignRow = {
  id: string;
  name: string;
  /** "Spending" or "Stopped 6 Nov". Shown on every row, including a tagged one. */
  delivery: string;
  /** Internal only. A pill beside the name. The share drops it and keeps `delivery`. */
  unlinked: boolean;
  periodSpend: string;
  /** A money figure, "£1,980". Never the words "since launch". */
  sinceLaunch: string;
  /** Hover: the figures behind the rounded cells. */
  title: string;
};

/** Keep a day and its month on one line (#620). */
export function keepDate(label: string): string {
  return label.replace(/(\d+) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, "$1\u00a0$2");
}

export type SalesShowView = {
  title: string;
  narrowTitle: string;
  subtitle: string;
  narrowSubtitle: string;
  /** Own-client umbrella line. Null when this client has no umbrella spend. */
  umbrellaLine: string | null;
  tiles: SalesTile[];
  /** Last day with data. Periods count back from here. Today is already excluded. */
  endDay: string;
  points: SalesChartPoint[];
  allocation: AllocationStep[];
  trajectory: SalesTrajectory;
  campaigns: SalesCampaignRow[];
  /** N2: the venue this view is scoped to; null for All venues. */
  venueKey?: string | null;
  /** N4: always to date. */
  header?: SalesHeader;
  /** N3: since-launch spend with its breakdown (each period's is in `periods`). */
  spendTotal?: SalesTotal;
  /**
   * The server calc's tiles and campaign rows for each period (HD3). When a
   * period is here, `tilesForPeriod` and `campaignsForPeriod` return it as
   * is; otherwise they behave as before (the fixture sends none).
   */
  periods?: Partial<Record<SalesPeriod, SalesPeriodView>>;
};

export type SalesPeriodView = {
  tiles: SalesTile[];
  campaigns: SalesCampaignRow[];
  /** N3: the period's spend total with its scope, channels, parts and exclusions. */
  spendTotal?: SalesTotal;
};

export type SalesPlatform = "meta" | "tiktok" | "google";

/** One channel's part of a total. A platform with no data isn't listed; a real £0 is (D12). */
export type SalesChannelAmount = {
  platform: SalesPlatform;
  label: string;
  /** Unrounded. */
  amount: number;
  /** "£16,736". Rounded from its own amount, never fudged to sum (N3). */
  text: string;
};

export type SalesTotalPart = {
  /** A venue key (under All venues) or a show id (under a venue). */
  id: string;
  label: string;
  amount: number;
  text: string;
  channels: SalesChannelAmount[];
};

/**
 * N3: a money total that ties out. `parts` sum to `amount` before rounding:
 * by venue under All venues, by show under a venue, empty for one show.
 */
export type SalesTotal = {
  /** "NX Newcastle", "All venues", or the show's name. */
  scope: string;
  amount: number;
  text: string;
  channels: SalesChannelAmount[];
  parts: SalesTotalPart[];
  /** "£18,860 since launch · to 12 Nov". */
  headline: string;
  /** "Not in this total: NX Newcastle umbrella £4,220. Finished shows (Include finished adds them)." Null when nothing is left out. */
  notIncluded: string | null;
};

/** N4: the sentence the view opens with, always to date, and its channel line. */
export type SalesHeader = {
  sentence: string;
  /** "Meta £16,736 · TikTok £12 · Google £32 · to 12 Nov · finished shows not included". */
  channelLine: string;
};

/**
 * N2: one venue (events.venue_key, exactly as stored). `name` is venue_name
 * as written on its next show. `key` null is "Venue not set" (internal only;
 * the share drops it).
 */
export type SalesVenue = {
  key: string | null;
  name: string;
  liveShows: number;
  /** The venue's All shows view. */
  viewId: string;
  /** "All shows", the shows by date, the venue's umbrella last. */
  shows: SalesShowChip[];
  finishedShows: SalesShowChip[];
};

/**
 * Everything the layout renders. One object, same on the internal page
 * and the share route. `crossClientNote` and unlinked campaign pills are
 * internal; `salesForSurface` strips them for the share.
 */
export type SalesDashboardModel = {
  clientName: string;
  freshness: FreshnessStamp[];
  shows: SalesShowChip[];
  /** Chips revealed when Include finished is on. Drawn grey. */
  finishedShows: SalesShowChip[];
  initialShowId: string;
  initialPeriod: SalesPeriod;
  /** Cross-client learning. The share variant never renders this. */
  crossClientNote: string | null;
  /** Audit or review line. The share variant never renders this. */
  reviewLine: string | null;
  views: Record<string, SalesShowView>;
  /**
   * N2: the venue row, most live shows first; "All venues" is `shows` /
   * the "all" view. Shown when two or more venues have live shows.
   */
  venues?: SalesVenue[];
  /** N2: the default venue's All shows view (most live shows, then spend). */
  initialVenueViewId?: string;
};

export type AxisPlan =
  | { mode: "index"; label: typeof INDEX_TO_PEAK }
  | { mode: "dual"; left: SalesUnit; right: SalesUnit }
  | { mode: "single"; unit: SalesUnit };

/**
 * Three unit types force indexing. Two types share a left and a right
 * axis. One type uses a single axis. The index switch is a request
 * until three types make it mandatory.
 */
export function planAxes(units: SalesUnit[], indexRequested: boolean): AxisPlan {
  const unique = [...new Set(units)];
  if (unique.length >= 3) return { mode: "index", label: INDEX_TO_PEAK };
  if (indexRequested) return { mode: "index", label: INDEX_TO_PEAK };
  if (unique.length === 2) return { mode: "dual", left: unique[0], right: unique[1] };
  return { mode: "single", unit: unique[0] ?? "count" };
}

/**
 * A metric's unbroken runs of days with a value, as point indexes. An
 * empty day (null) ends a run, so the chart breaks the line there: no
 * bridge across the gap and no £0 (design, D13c, 14 Nov).
 */
export function metricRuns(points: readonly SalesChartPoint[], id: SalesMetricId): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  points.forEach((point, index) => {
    if (point.values[id] == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(index);
  });
  if (run.length) runs.push(run);
  return runs;
}

export function slicePoints(points: SalesChartPoint[], period: SalesPeriod, endDay: string): SalesChartPoint[] {
  if (period === "launch") return points.filter((point) => point.day <= endDay);
  const days = SALES_PERIODS.find((item) => item.id === period)?.days ?? null;
  if (days == null) return points;
  const start = shiftIsoDay(endDay, -(days - 1));
  return points.filter((point) => point.day >= start && point.day <= endDay);
}

export function visibleShows(model: SalesDashboardModel, includeFinished: boolean): SalesShowChip[] {
  if (!includeFinished) return model.shows;
  return [...model.shows, ...model.finishedShows];
}

/**
 * Share copy of the model. Drops cross-client learnings, the review line,
 * and the "Not linked to event" pill. Campaign names stay.
 */
export function salesForSurface(model: SalesDashboardModel, surface: SalesSurface): SalesDashboardModel {
  if (surface === "internal") return model;
  const views: Record<string, SalesShowView> = {};
  for (const [id, view] of Object.entries(model.views)) {
    const periods = view.periods
      ? Object.fromEntries(
          Object.entries(view.periods).map(([period, slice]) => [period, slice ? { ...slice, campaigns: shareCampaigns(slice.campaigns) } : slice]),
        )
      : undefined;
    views[id] = { ...view, campaigns: shareCampaigns(view.campaigns), ...(periods ? { periods } : {}) };
  }
  // "Venue not set" is internal only (N2).
  const venues = model.venues?.filter((venue) => venue.key != null);
  return { ...model, crossClientNote: null, reviewLine: null, views, ...(model.venues ? { venues } : {}) };
}

function shareCampaigns(rows: SalesCampaignRow[]): SalesCampaignRow[] {
  return rows.map((row) =>
    row.unlinked ? { ...row, unlinked: false, title: `${row.periodSpend} in this period. ${row.sinceLaunch} since launch.` } : row,
  );
}

export function formatSalesNumber(unit: SalesUnit, value: number): string {
  if (unit === "count") return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(value));
  const digits = unit === "rate" && Math.abs(value) < 100 ? 2 : 0;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** The campaign rows for a period: the server calc's when it sent them (HD3), else the view's own. */
export function campaignsForPeriod(view: Pick<SalesShowView, "campaigns" | "periods">, period: SalesPeriod): SalesCampaignRow[] {
  return view.periods?.[period]?.campaigns ?? view.campaigns;
}

export function tilesForPeriod(
  tiles: SalesTile[],
  points: SalesChartPoint[],
  period: SalesPeriod,
  endDay: string,
  periods?: SalesShowView["periods"],
): SalesTile[] {
  const sent = periods?.[period]?.tiles;
  if (sent) return sent;
  if (period === "14") return tiles;
  const slice = slicePoints(points, period, endDay);
  const phrase = period === "yesterday" ? "yesterday" : period === "launch" ? "since launch" : `in ${period} days`;
  return tiles.map((tile) => {
    const metric = salesMetric(tile.id);
    const first = slice.find((point) => point.values[tile.id] != null)?.values[tile.id];
    const last = [...slice].reverse().find((point) => point.values[tile.id] != null)?.values[tile.id];
    if (tile.value === "—" || first == null || last == null) return { ...tile, detail: phrase, narrowDetail: phrase };
    const amount = metric.unit === "rate" ? last : Math.max(0, last - first);
    return { ...tile, value: formatSalesNumber(metric.unit, amount), detail: phrase, narrowDetail: phrase };
  });
}

function shiftIsoDay(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
