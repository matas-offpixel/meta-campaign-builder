export type TrendGranularity = "daily" | "weekly";

/** Controls which metric anchors the leading edge of the trimmed chart range. */
export type TrendChartLeadingAnchor = "spend_only" | "spend_or_registrations";

export interface TrendChartPoint {
  date: string;
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
  ticketsKind?: "additive" | "cumulative_snapshot";
  /**
   * When true, the tickets value on this point came from a
   * `tier_channel_sales_daily_history` row with
   * source_kind = 'smoothed_historical'. The trend chart tooltip shows
   * a muted "(est.)" suffix so the operator knows the day's exact total
   * is a proportional estimate rather than a live cron snapshot.
   */
  ticketsSmoothed?: boolean;
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
  leadingAnchor: TrendChartLeadingAnchor,
): boolean {
  // Zero is treated as "no signal" — backfill rows for newly-onboarded events
  // carry numeric 0 for all metrics (not null), which would push the X-axis
  // back to the first backfilled date (~80 days ago). Only positive values
  // anchor the trim range.
  //
  // Cumulative-snapshot mode (BUG-4 fix):
  //   Only positive spend anchors the leading edge by default (`spend_only`).
  //
  //   Brand_campaign charts pass `spend_or_registrations` so the Mailchimp
  //   curve is visible from the first subscriber day even before paid spend
  //   launches — matching how pre-sale ticket activity would appear on a
  //   venue trend chart.
  //
  //   - `linkClicks > 0` alone is NOT an anchor in cumulative mode.
  //   - `revenue > 0` follows the same reasoning.
  //
  // Additive (non-cumulative) mode retains the full original set of anchors
  // — all four metrics, any positive value.
  if (hasCumulativeTickets) {
    if (leadingAnchor === "spend_or_registrations") {
      return (
        (day.spend !== null && day.spend > 0) ||
        (day.tickets !== null && day.tickets > 0)
      );
    }
    return day.spend !== null && day.spend > 0;
  }
  return (
    (day.spend !== null && day.spend > 0) ||
    (day.revenue !== null && day.revenue > 0) ||
    (day.linkClicks !== null && day.linkClicks > 0) ||
    (day.tickets !== null && day.tickets > 0)
  );
}

function trimEmptyRange(
  days: TrendChartDay[],
  hasCumulativeTickets: boolean,
  leadingAnchor: TrendChartLeadingAnchor,
): TrendChartDay[] {
  const first = days.findIndex((day) =>
    hasRangeAnchorMetric(day, hasCumulativeTickets, leadingAnchor),
  );
  if (first === -1) return [];

  let last = days.length - 1;
  while (
    last > first &&
    !hasRangeAnchorMetric(days[last]!, hasCumulativeTickets, leadingAnchor) &&
    !(hasCumulativeTickets && days[last]!.tickets !== null)
  ) {
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
  options?: { leadingAnchor?: TrendChartLeadingAnchor },
): TrendChartDay[] {
  const leadingAnchor = options?.leadingAnchor ?? "spend_only";
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
  const dailyRange = trimEmptyRange(daily, hasCumulativeTickets, leadingAnchor);

  if (hasCumulativeTickets) {
    // Cumulative-mode tooltip semantics (PR fix/venue-trend-tier-channel-snapshot):
    //
    //   tickets  ← carry-forward of the latest cumulative snapshot (so a
    //              day without a fresh snapshot shows the prior total
    //              instead of "—").
    //   spend    ← stays per-day (the chart line shows how spend
    //              fluctuates day-to-day; lifetime spend is the
    //              denominator for the lifetime CPT below, not the line).
    //   cpt      ← lifetime spend through this date / cumulative tickets
    //              through this date. The previous code divided per-day
    //              spend by cumulative tickets, producing meaningless
    //              "Spend £92.86, Tickets 843, CPT £0.11" tooltips on
    //              the Manchester WC26 venue report.
    //
    // Ratio uses lifetime/lifetime so the tooltip CPT matches the
    // venue-card top-line CPT pill at the right edge of the chart.
    //
    // ticketsSmoothed carries forward alongside tickets so the tooltip
    // "(est.)" indicator appears on all carry-forward days until a real
    // cron snapshot arrives.
    let latestTickets: number | null = null;
    let latestSmoothed = false;
    let runningSpend = 0;
    let hasAnySpend = false;
    for (const day of daily) {
      if (day.tickets != null) {
        latestTickets = day.tickets;
        latestSmoothed = day.ticketsSmoothed === true;
      }
      day.tickets = latestTickets;
      day.ticketsSmoothed = latestSmoothed || day.ticketsSmoothed;
      if (day.spend != null) {
        runningSpend += day.spend;
        hasAnySpend = true;
      }
      day.cpt =
        hasAnySpend &&
        runningSpend > 0 &&
        day.tickets !== null &&
        day.tickets > 0
          ? runningSpend / day.tickets
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

  const weeklyDays = [...weekly.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, v]) => deriveMetrics(date, v));

  if (hasCumulativeTickets) {
    // Same lifetime/lifetime CPT semantics as the daily path — weekly
    // tickets is the week-ending cumulative, weekly CPT is the
    // running lifetime spend through the end of that week divided by
    // that cumulative. Without this re-pass, weekly CPT would be
    // (weekSpend / cumulative_tickets), which still mixes daily and
    // lifetime denominators.
    let runningSpend = 0;
    let hasAnySpend = false;
    for (const week of weeklyDays) {
      if (week.spend != null) {
        runningSpend += week.spend;
        hasAnySpend = true;
      }
      week.cpt =
        hasAnySpend &&
        runningSpend > 0 &&
        week.tickets !== null &&
        week.tickets > 0
          ? runningSpend / week.tickets
          : null;
    }
  }

  return weeklyDays;
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
