export type TrendGranularity = "daily" | "weekly";

export interface TrendChartPoint {
  date: string;
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
  ticketsKind?: "additive" | "cumulative_snapshot";
}

export interface TrendChartDay extends TrendChartPoint {
  cpt: number | null;
  roas: number | null;
  cpc: number | null;
}

export interface TrendSummary {
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
  cpt: number | null;
  roas: number | null;
  cpc: number | null;
}

interface PointAccumulator {
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
}

function addNullable(
  current: number | null,
  value: number | null,
): number | null {
  return value != null ? (current ?? 0) + value : current;
}

function isoWeekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function deriveMetrics(date: string, v: PointAccumulator): TrendChartDay {
  const cpt =
    v.spend !== null && v.spend > 0 && v.tickets !== null && v.tickets > 0
      ? v.spend / v.tickets
      : null;
  const roas =
    v.revenue !== null && v.revenue > 0 && v.spend !== null && v.spend > 0
      ? v.revenue / v.spend
      : null;
  const cpc =
    v.spend !== null &&
    v.spend > 0 &&
    v.linkClicks !== null &&
    v.linkClicks > 0
      ? v.spend / v.linkClicks
      : null;
  return {
    date,
    spend: v.spend,
    tickets: v.tickets,
    revenue: v.revenue,
    linkClicks: v.linkClicks,
    cpt,
    roas,
    cpc,
  };
}

function hasRangeAnchorMetric(
  day: TrendChartDay,
  hasCumulativeTickets: boolean,
): boolean {
  return (
    day.spend !== null ||
    day.revenue !== null ||
    day.linkClicks !== null ||
    (!hasCumulativeTickets && day.tickets !== null)
  );
}

function trimEmptyRange(
  days: TrendChartDay[],
  hasCumulativeTickets: boolean,
): TrendChartDay[] {
  const first = days.findIndex((day) =>
    hasRangeAnchorMetric(day, hasCumulativeTickets),
  );
  if (first === -1) return [];

  let last = days.length - 1;
  while (last > first && !hasRangeAnchorMetric(days[last]!, hasCumulativeTickets)) {
    last -= 1;
  }
  return days.slice(first, last + 1);
}

export function hasCumulativeTicketPoints(points: TrendChartPoint[]): boolean {
  return points.some((point) => point.ticketsKind === "cumulative_snapshot");
}

export function aggregateTrendChartPoints(
  points: TrendChartPoint[],
  granularity: TrendGranularity,
): TrendChartDay[] {
  const hasCumulativeTickets = hasCumulativeTicketPoints(points);
  const map = new Map<string, PointAccumulator>();
  for (const point of points) {
    const cur =
      map.get(point.date) ??
      ({
        spend: null,
        tickets: null,
        revenue: null,
        linkClicks: null,
      } as PointAccumulator);
    cur.spend = addNullable(cur.spend, point.spend);
    cur.tickets = hasCumulativeTickets
      ? point.tickets != null
        ? point.tickets
        : cur.tickets
      : addNullable(cur.tickets, point.tickets);
    cur.revenue = addNullable(cur.revenue, point.revenue);
    cur.linkClicks = addNullable(cur.linkClicks, point.linkClicks);
    map.set(point.date, cur);
  }

  const daily = [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => deriveMetrics(date, v));
  const dailyRange = trimEmptyRange(daily, hasCumulativeTickets);

  if (hasCumulativeTickets) {
    let latestTickets: number | null = null;
    for (const day of daily) {
      if (day.tickets != null) latestTickets = day.tickets;
      day.tickets = latestTickets;
      day.cpt =
        day.spend !== null &&
        day.spend > 0 &&
        day.tickets !== null &&
        day.tickets > 0
          ? day.spend / day.tickets
          : null;
    }
  }

  const trimmedDaily = dailyRange.map((day) => ({ ...day }));

  if (granularity === "daily") return trimmedDaily;

  const weekly = new Map<string, PointAccumulator>();
  for (const day of trimmedDaily) {
    const key = isoWeekStart(day.date);
    const cur =
      weekly.get(key) ??
      ({
        spend: null,
        tickets: null,
        revenue: null,
        linkClicks: null,
      } as PointAccumulator);
    cur.spend = addNullable(cur.spend, day.spend);
    cur.tickets = hasCumulativeTickets
      ? day.tickets != null
        ? day.tickets
        : cur.tickets
      : addNullable(cur.tickets, day.tickets);
    cur.revenue = addNullable(cur.revenue, day.revenue);
    cur.linkClicks = addNullable(cur.linkClicks, day.linkClicks);
    weekly.set(key, cur);
  }

  return [...weekly.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => deriveMetrics(date, v));
}

export function summarizeTrendChartPoints(
  days: TrendChartDay[],
  hasCumulativeTickets: boolean,
): TrendSummary {
  let spend: number | null = null;
  let tickets: number | null = null;
  let revenue: number | null = null;
  let linkClicks: number | null = null;
  for (const day of days) {
    spend = addNullable(spend, day.spend);
    revenue = addNullable(revenue, day.revenue);
    linkClicks = addNullable(linkClicks, day.linkClicks);
    if (day.tickets != null) {
      tickets = hasCumulativeTickets
        ? Math.max(tickets ?? 0, day.tickets)
        : (tickets ?? 0) + day.tickets;
    }
  }
  return deriveMetrics("", { spend, tickets, revenue, linkClicks });
}
