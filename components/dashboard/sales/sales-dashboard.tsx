"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { CHART_PLOT, PLOT_PAD, ChartDateLabels, ChartDot, SalesChart } from "@/components/dashboard/sales/sales-chart";
import { TILE_NAMES, spendScopeLine, tileSubline } from "@/components/dashboard/sales/tile-copy";
import type { SalesQueryUpdate } from "@/components/dashboard/sales/venue-query";
import { shortDay } from "@/lib/dashboard/sales-calc/days";
import { barOutcome, capacityTicks, formatCount, shareOf, trajectoryAxisMax, trajectorySums } from "@/components/dashboard/sales/trajectory-bars";
import {
  campaignsForPeriod,
  DEFAULT_ON_METRICS,
  SALES_METRICS,
  keepDate,
  SALES_PERIODS,
  salesForSurface,
  slicePoints,
  tilesForPeriod,
  visibleShows,
  type AllShowBar,
  type SalesDashboardModel,
  type SalesMetricId,
  type SalesPeriod,
  type SalesShowChip,
  type SalesSurface,
  type SalesTotal,
  type SalesTrajectory,
  type SalesVenue,
  type SingleTrajectory,
} from "@/lib/dashboard/sales-vs-spend";

export function SalesDashboard({
  model,
  surface,
  initialShowId,
  initialPeriod,
  initialIndex = false,
  pinHover = false,
  pinSpend = false,
  initialVenueKey,
  onQuery,
}: {
  model: SalesDashboardModel;
  surface: SalesSurface;
  initialShowId?: string;
  /** Since launch when the URL has no period (N5). */
  initialPeriod?: SalesPeriod;
  initialIndex?: boolean;
  pinHover?: boolean;
  /** NV5 leaves the spend breakdown open. */
  pinSpend?: boolean;
  /** `venue` in the URL: a venue key, or "all". */
  initialVenueKey?: string;
  /** Pages pass this to keep `show`, `period` and `venue` in the query string. */
  /** Every key a click changes, in one call. */
  onQuery?: (updates: SalesQueryUpdate) => void;
}) {
  const presented = salesForSurface(model, surface);
  const venues = (presented.venues ?? []).filter((venue) => venue.liveShows > 0);
  const multiVenue = venues.length >= 2;
  const [showId, setShowId] = useState(initialShowId ?? presented.initialShowId);
  const [venueKey, setVenueKey] = useState(() =>
    startingVenueKey(presented, initialShowId ?? presented.initialShowId, initialVenueKey),
  );
  const [period, setPeriod] = useState<SalesPeriod>(initialPeriod ?? "launch");
  const [includeFinished, setIncludeFinished] = useState(false);
  const [selected, setSelected] = useState<SalesMetricId[]>([...DEFAULT_ON_METRICS]);
  const [indexRequested, setIndexRequested] = useState(initialIndex);
  const [spendHover, setSpendHover] = useState<"tile" | "header" | null>(pinSpend ? "tile" : null);
  const venueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    venueButtonRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [venueKey]);

  const selectedVenue = venues.find((venue) => venueToken(venue) === venueKey) ?? null;
  const grouped = multiVenue && venueKey === "all";
  const chips = !multiVenue
    ? visibleShows(presented, includeFinished)
    : grouped
      ? venues.flatMap((venue) => [...venue.shows, ...(includeFinished ? venue.finishedShows : [])])
      : [...(selectedVenue?.shows ?? []), ...(includeFinished ? selectedVenue?.finishedShows ?? [] : [])];
  const activeId = chips.some((chip) => chip.id === showId)
    ? showId
    : grouped
      ? showId
      : selectedVenue?.viewId ?? presented.initialShowId;
  const activeChip = chips.find((chip) => chip.id === activeId);
  const umbrella = activeChip?.kind === "umbrella";
  const view = presented.views[activeId] ?? presented.views[presented.initialShowId];
  if (!view) return null;
  const points = slicePoints(view.points, period, view.endDay);
  const tiles = tilesForPeriod(view.tiles, view.points, period, view.endDay, view.periods);
  // The model's count, the same one the header uses. A show with counts but no capacity has a bar with no sold figure, so bars can't be counted here.
  const showScope = view.showCounts
    ? { showsWithCounts: view.showCounts.counted, shows: view.showCounts.shows }
    : view.trajectory.kind === "all"
      ? {
          showsWithCounts: view.trajectory.bars.filter((bar) => bar.sold != null).length,
          shows: view.trajectory.bars.length,
        }
      : null;
  const launchTotal = view.spendTotal ?? null;
  const periodTotal = period === "launch" ? launchTotal : (view.periods?.[period]?.spendTotal ?? null);

  function chooseShow(id: string) {
    setShowId(id);
    writeQuery({ show: id });
  }

  function choosePeriod(next: SalesPeriod) {
    setPeriod(next);
    writeQuery({ period: next });
  }

  function chooseVenue(venue: SalesVenue | "all") {
    if (venue === "all") {
      setVenueKey("all");
      setShowId("all");
      writeQuery({ venue: "all", show: "all" });
      return;
    }
    setVenueKey(venueToken(venue));
    setShowId(venue.viewId);
    writeQuery({ venue: venue.key ?? venue.viewId, show: venue.viewId });
  }

  function writeQuery(updates: SalesQueryUpdate) {
    onQuery?.(updates);
  }

  function hoverSpend(which: "tile" | "header") {
    setSpendHover(which);
  }

  function leaveSpend() {
    if (!pinSpend) setSpendHover(null);
  }

  function toggleMetric(id: SalesMetricId) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
      <header>
        <h2 className="text-xl font-medium tracking-tight sm:text-2xl">
          {umbrella ? `${presented.clientName} umbrella` : (
            <>
              <span className="sm:hidden">{view.narrowTitle}</span>
              <span className="hidden sm:inline">{view.title}</span>
            </>
          )}
        </h2>
        {umbrella && view.header ? (
          <p className="mt-1 text-xs text-muted-foreground">{view.subtitle}</p>
        ) : null}
        {view.header ? (
          <div className="relative" onMouseEnter={() => hoverSpend("header")} onMouseLeave={leaveSpend}>
            <p className="mt-1 max-w-3xl text-sm leading-snug">{view.header.sentence}</p>
            {channelLineHasSplit(view.header.channelLine) ? (
              <p className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{view.header.channelLine}</p>
            ) : null}
            {spendHover === "header" && launchTotal ? <SpendHover total={launchTotal} /> : null}
          </div>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="sm:hidden">{view.narrowSubtitle}</span>
              <span className="hidden sm:inline">{view.subtitle}</span>
            </p>
            {view.umbrellaLine ? (
              <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{view.umbrellaLine}</p>
            ) : null}
          </>
        )}
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {presented.freshness.map((stamp) => (
            <li key={stamp.id} className={stamp.stale ? "text-warning" : "text-muted-foreground"}>
              <span className="sm:hidden">{stamp.narrow}</span>
              <span className="hidden sm:inline">{stamp.wide}</span>
            </li>
          ))}
        </ul>
      </header>

      {multiVenue ? (
        <div className="mt-4 flex items-center gap-2">
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Venue</span>
          <div className="flex overflow-x-auto">
            {venues.map((venue, index) => {
              const on = venueToken(venue) === venueKey;
              return (
                <button
                  key={venue.viewId}
                  ref={on ? venueButtonRef : undefined}
                  type="button"
                  aria-pressed={on}
                  onClick={() => chooseVenue(venue)}
                  className={`shrink-0 border border-border px-3 py-1 text-xs ${index === 0 ? "rounded-l-full" : "-ml-px"} ${
                    on ? "relative z-10 bg-foreground text-background" : "bg-card"
                  }`}
                >
                  {venue.name}
                </button>
              );
            })}
            <button
              ref={venueKey === "all" ? venueButtonRef : undefined}
              type="button"
              aria-pressed={venueKey === "all"}
              onClick={() => chooseVenue("all")}
              className={`-ml-px shrink-0 rounded-r-full border border-border px-3 py-1 text-xs ${
                venueKey === "all" ? "relative z-10 bg-foreground text-background" : "bg-card"
              }`}
            >
              All venues
            </button>
          </div>
        </div>
      ) : null}

      {grouped ? (
        <div className="mt-3 space-y-2">
          {venues.map((venue) => (
            <div key={venue.viewId} className="flex items-center gap-2 overflow-x-auto">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{venue.name}</span>
              <ShowChip
                chip={{ id: venue.viewId, wide: `All ${venue.name}`, narrow: "All", kind: "all", finished: false }}
                on={activeId === venue.viewId}
                label={`All ${venue.name}`}
                onSelect={() => chooseShow(venue.viewId)}
              />
              {venue.shows.filter((chip) => chip.kind !== "all").map((chip) => (
                <ShowChip key={`${venue.viewId}-${chip.id}`} chip={chip} on={chip.id === activeId} onSelect={() => chooseShow(chip.id)} />
              ))}
              {includeFinished
                ? venue.finishedShows.map((chip) => (
                    <ShowChip key={`${venue.viewId}-fin-${chip.id}`} chip={chip} on={chip.id === activeId} onSelect={() => chooseShow(chip.id)} />
                  ))
                : null}
            </div>
          ))}
          <FinishedToggle includeFinished={includeFinished} onToggle={() => setIncludeFinished((value) => !value)} />
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto">
          {chips.map((chip) => (
            <ShowChip
              key={`${chip.id}-${chip.finished ? "fin" : "live"}-${chip.kind}`}
              chip={chip}
              on={chip.id === activeId}
              onSelect={() => chooseShow(chip.id)}
            />
          ))}
          <FinishedToggle includeFinished={includeFinished} onToggle={() => setIncludeFinished((value) => !value)} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {SALES_PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={period === item.id}
            onClick={() => choosePeriod(item.id)}
            className={`rounded-full border border-border px-3 py-1 text-xs ${
              period === item.id ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setSelected(SALES_METRICS.map((metric) => metric.id))}>
          All
        </button>
        <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setSelected([])}>
          None
        </button>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.filter((tile) => !umbrella || (tile.id !== "sold" && tile.id !== "tickets" && tile.id !== "costPerTicket")).map((tile) => {
          const on = selected.includes(tile.id);
          const names = TILE_NAMES[tile.id];
          // The count date, never the spend date: Total sold and Sales since launch read the latest count.
          const countLabel = shortDay(view.countDay ?? view.endDay);
          const authored = view.tiles.find((item) => item.id === tile.id);
          const soldDetail = tile.id === "sold" ? (authored?.detail ?? tile.detail) : null;
          const wideDetail = soldDetail ?? tile.detail;
          const narrowDetail = soldDetail ?? tile.narrowDetail;
          const spendTotal = tile.id === "spend" ? periodTotal : null;
          const wideSub = spendTotal ? spendScopeLine(spendTotal, period, launchTotal) : tileSubline(tile.id, wideDetail, period, countLabel, showScope, true);
          const narrowSub = spendTotal ? spendScopeLine(spendTotal, period, launchTotal) : tileSubline(tile.id, narrowDetail, period, countLabel, showScope, false);
          const hovered = tile.id === "spend" && spendHover === "tile" && spendTotal;
          return (
            <li
              key={tile.id}
              className="relative"
              onMouseEnter={tile.id === "spend" ? () => hoverSpend("tile") : undefined}
              onMouseLeave={tile.id === "spend" ? leaveSpend : undefined}
            >
              <button
                type="button"
                aria-pressed={on}
                title={tile.title}
                onClick={() => toggleMetric(tile.id)}
                onFocus={tile.id === "spend" ? () => hoverSpend("tile") : undefined}
                onBlur={tile.id === "spend" ? leaveSpend : undefined}
                className={`h-full w-full rounded-md border px-2.5 py-2 text-left ${
                  on ? "border-foreground bg-card" : "border-border bg-card text-muted-foreground"
                }`}
              >
                <span className="block text-[11px]">
                  <span className="sm:hidden">{names.narrow}</span>
                  <span className="hidden sm:inline">{names.wide}</span>
                </span>
                <TileValue className="mt-1 block">{spendTotal ? spendTotal.text : tile.value}</TileValue>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  <span className="sm:hidden">{narrowSub}</span>
                  <span className="hidden sm:inline">{wideSub}</span>
                </span>
              </button>
              {hovered && spendTotal ? <SpendHover total={spendTotal} /> : null}
            </li>
          );
        })}
      </ul>

      <SalesChart
        points={points}
        allocation={view.allocation}
        selected={umbrella ? selected.filter((id) => id !== "sold" && id !== "tickets" && id !== "costPerTicket") : selected}
        indexRequested={indexRequested}
        onIndex={setIndexRequested}
        showAllocation={view.allocation.length > 0 && !umbrella}
        pinnedDay={pinHover ? points.at(-1)?.day ?? null : null}
      />

      {umbrella ? (
        <p className="mt-4 text-xs text-muted-foreground">An umbrella has no Total sold, Sales or Cost per ticket tile, and no trajectory.</p>
      ) : (
        <Trajectory
          trajectory={view.trajectory}
          countDay={view.countDay ?? view.endDay}
          onSelectShow={chooseShow}
          crossClientNote={presented.crossClientNote}
          reviewLine={presented.reviewLine}
        />
      )}

      <Campaigns rows={campaignsForPeriod(view, period)} />
    </section>
  );
}

function Trajectory({
  trajectory,
  countDay,
  onSelectShow,
  crossClientNote,
  reviewLine,
}: {
  trajectory: SalesTrajectory;
  countDay: string;
  onSelectShow: (id: string) => void;
  crossClientNote: string | null;
  reviewLine: string | null;
}) {
  return (
    <div className="mt-4">
      {trajectory.kind === "all" ? (
        <AllTrajectoryView trajectory={trajectory} countDay={countDay} onSelectShow={onSelectShow} />
      ) : (
        <SingleTrajectoryView trajectory={trajectory} />
      )}
      {crossClientNote ? <p className="mt-2 text-[11px] text-muted-foreground">{crossClientNote}</p> : null}
      {reviewLine ? <p className="mt-1 text-[11px] text-muted-foreground">{reviewLine}</p> : null}
    </div>
  );
}

const CASE_COLOR: Record<SingleTrajectory["cases"][number]["id"], string> = {
  holds: "var(--foreground)",
  average: "var(--warning-foreground)",
  best: "var(--success)",
};

function SingleTrajectoryView({ trajectory }: { trajectory: SingleTrajectory }) {
  if (trajectory.missingCapacity) {
    return <p className="text-xs text-muted-foreground">{trajectory.missingCapacity}</p>;
  }
  const cases = trajectory.opensAfter
    ? trajectory.cases.filter((item) => item.id === "holds")
    : trajectory.cases;
  const chart = trajectoryChart(trajectory, cases);
  return (
    <div>
      <p className="text-xs">
        <span className="sm:hidden">{trajectory.narrowRange}</span>
        <span className="hidden sm:inline">{trajectory.wideRange}</span>
      </p>
      {trajectory.narrowNote ? <p className="mt-1 text-xs text-muted-foreground sm:hidden">{trajectory.narrowNote}</p> : null}
      {chart}
      {cases.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[11px]">
          {cases.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="18" y2="3" stroke={CASE_COLOR[item.id]} strokeWidth="1.6" />
                </svg>
                {item.label}
              </span>
              <span>{item.value.toLocaleString("en-GB")}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {trajectory.opensAfter ? <p className="mt-2 text-[11px] text-muted-foreground">{trajectory.opensAfter}</p> : null}
      {trajectory.libraryNote ? <p className="mt-2 max-w-xl text-[11px] text-muted-foreground">{trajectory.libraryNote}</p> : null}
    </div>
  );
}

function trajectoryChart(trajectory: SingleTrajectory, cases: SingleTrajectory["cases"]) {
  const pace = trajectory.pace;
  const needed = trajectory.needed;
  if (!pace || !needed || !trajectory.showDayIso || trajectory.allocation == null) return null;
  const start = Date.parse(`${pace.fromDay}T00:00:00Z`);
  const end = Date.parse(`${trajectory.showDayIso}T00:00:00Z`);
  const span = Math.max(1, end - start);
  const yMax = Math.max(trajectory.allocation, needed.showDaySold, ...cases.map((item) => item.value), pace.fanSold);
  const x = (day: string) => PLOT_PAD + ((Date.parse(`${day}T00:00:00Z`) - start) / span) * (CHART_PLOT - PLOT_PAD * 2);
  const y = (sold: number) => PLOT_PAD + (1 - sold / yMax) * (CHART_PLOT - PLOT_PAD * 2);
  const dates = [pace.fromDay, pace.toDay, pace.fanDay, trajectory.showDayIso];
  const allocationY = y(trajectory.allocation);
  return (
    <figure className="mt-3">
      <div className="relative h-64 w-full">
        <svg viewBox={`0 0 ${CHART_PLOT} ${CHART_PLOT}`} preserveAspectRatio="none" role="img" aria-label="Trajectory to show day" className="absolute inset-0 h-full w-full">
          <line x1="0" y1={allocationY} x2={CHART_PLOT} y2={allocationY} stroke="var(--foreground)" strokeOpacity="0.35" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          <line x1={x(trajectory.showDayIso)} y1="0" x2={x(trajectory.showDayIso)} y2={CHART_PLOT} stroke="var(--foreground)" strokeOpacity="0.45" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          <polyline
            fill="none"
            stroke="var(--foreground)"
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
            points={trajectory.counts.map((count) => `${x(count.day)},${y(count.sold)}`).join(" ")}
          />
          <line
            x1={x(pace.toDay)}
            y1={y(pace.toSold)}
            x2={x(pace.fanDay)}
            y2={y(pace.fanSold)}
            stroke="var(--foreground)"
            strokeWidth="1.6"
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
          />
          {cases.map((item) => (
            <line
              key={item.id}
              x1={x(pace.fanDay)}
              y1={y(pace.fanSold)}
              x2={x(trajectory.showDayIso!)}
              y2={y(item.value)}
              stroke={CASE_COLOR[item.id]}
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1={x(pace.toDay)}
            y1={y(pace.toSold)}
            x2={x(trajectory.showDayIso)}
            y2={y(needed.showDaySold)}
            stroke="var(--foreground)"
            strokeWidth="1.6"
            strokeDasharray="1 3"
            strokeOpacity="0.7"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className="absolute left-1 text-xs text-muted-foreground"
          style={{ top: `${(allocationY / CHART_PLOT) * 100}%`, transform: allocationY < CHART_PLOT * 0.1 ? "translateY(2px)" : "translateY(-100%)" }}
        >
          {trajectory.allocation.toLocaleString("en-GB")}
        </span>
        {trajectory.counts.map((count) => (
          <ChartDot key={count.day} x={x(count.day)} y={y(count.sold)} color="var(--foreground)" />
        ))}
      </div>
      <ChartDateLabels
        ticks={[...new Set(dates)].map((day) => ({ key: day, x: x(day), label: shortDay(day) }))}
      />
    </figure>
  );
}

function AllTrajectoryView({
  trajectory,
  countDay,
  onSelectShow,
}: {
  trajectory: Extract<SalesTrajectory, { kind: "all" }>;
  /** The view's one count date: the Sold tile's fallback and the legend. */
  countDay: string;
  onSelectShow: (id: string) => void;
}) {
  const sums = trajectorySums(trajectory.bars);
  const axisMax = trajectoryAxisMax(trajectory.bars);
  const soldShare = shareOf(sums.sold, sums.capacity);
  const highShare = shareOf(sums.high, sums.capacity);
  const counted = shortDay(countDay);
  const soldTile = trajectory.summary?.sold ?? {
    label: `Sold · count of ${counted}`,
    value: formatCount(sums.sold),
    detail: soldShare == null ? "—" : `${soldShare}% of ${formatCount(sums.capacity)} across ${sums.shows} shows`,
  };
  const projectedTile = trajectory.summary?.projected ?? {
    label: "Projected on show day",
    value: `${formatCount(sums.holds)}–${formatCount(sums.high)}`,
    detail: highShare == null ? "—" : `up to ${highShare}% of ${formatCount(sums.capacity)} · each show capped at its capacity`,
  };
  const paceTile = trajectory.summary?.pace ?? {
    label: "Pace, last 7 days",
    value: "— a day",
    detail: "14-day — a day",
  };
  return (
    <div>
      <h3 className="text-sm font-medium">Sales trajectory</h3>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[soldTile, projectedTile, paceTile].map((tile) => (
          <li key={tile.label} className="rounded-md border border-border px-2.5 py-2">
            <p className="text-[11px] text-muted-foreground">{tile.label}</p>
            <SummaryValue value={tile.value} />
            <p className="mt-1 text-[11px] text-muted-foreground">{tile.detail}</p>
          </li>
        ))}
      </ul>
      <ul className="mt-3 space-y-2">
        {trajectory.bars.map((bar) => (
          <li key={bar.id}>
            <ShowBar bar={bar} axisMax={axisMax} onSelect={() => onSelectShow(bar.id)} />
          </li>
        ))}
      </ul>
      <CapacityAxis max={axisMax} />
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 bg-foreground" />Sold, count of {counted}</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 bg-foreground/45" />Holds at the last 7 days&apos; pace</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 bg-foreground/20" />Like your best finish</li>
        <li className="flex items-center gap-1.5"><span className="inline-block h-3 border-l border-dashed border-foreground" />Capacity</li>
      </ul>
      <p className="mt-2 max-w-xl text-[11px] text-muted-foreground">{trajectory.note}</p>
    </div>
  );
}

function TileValue({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`text-lg leading-none ${className}`}
      style={{ fontFamily: 'var(--font-bebas, "Bebas Neue"), "Arial Narrow", sans-serif', letterSpacing: "0.04em" }}
    >
      {children}
    </span>
  );
}

function BarOutcomeText({ outcome }: { outcome: ReturnType<typeof barOutcome> }) {
  if (!outcome.sellout) return <span className="text-muted-foreground">{outcome.text}</span>;
  return (
    <span className="text-muted-foreground">
      {outcome.text}{" "}
      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-destructive">SELLS OUT</span>
      {" "}{outcome.sellout}
    </span>
  );
}

function ShowBar({ bar, axisMax, onSelect }: { bar: AllShowBar; axisMax: number; onSelect: () => void }) {
  const outcome = barOutcome(bar);
  const scale = axisMax > 0 ? axisMax : 1;
  const cap = bar.allocation;
  const sold = bar.sold;
  const holdEnd = cap == null || bar.low == null ? null : Math.min(bar.low, cap);
  const highEnd = cap == null || bar.high == null ? null : Math.min(bar.high, cap);
  const soldEnd = sold == null || cap == null ? null : Math.min(sold, cap);
  return (
    <button type="button" onClick={onSelect} className="w-full text-left">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_14rem] sm:items-center sm:gap-3">
        <span>{bar.label}</span>
        <span className="relative hidden h-2 rounded-full bg-muted sm:block">
          <BarLayers soldEnd={soldEnd} holdEnd={holdEnd} highEnd={highEnd} cap={cap} scale={scale} />
        </span>
        <BarOutcomeText outcome={outcome} />
      </span>
      <span className="relative mt-1 block h-2 rounded-full bg-muted sm:hidden">
        <BarLayers soldEnd={soldEnd} holdEnd={holdEnd} highEnd={highEnd} cap={cap} scale={scale} />
      </span>
    </button>
  );
}

function BarLayers({
  soldEnd,
  holdEnd,
  highEnd,
  cap,
  scale,
}: {
  soldEnd: number | null;
  holdEnd: number | null;
  highEnd: number | null;
  cap: number | null;
  scale: number;
}) {
  const width = (value: number) => `${Math.max(0, Math.min(100, (value / scale) * 100))}%`;
  return (
    <>
      {soldEnd != null ? <span className="absolute inset-y-0 left-0 bg-foreground" style={{ width: width(soldEnd) }} /> : null}
      {soldEnd != null && holdEnd != null && holdEnd > soldEnd ? (
        <span className="absolute inset-y-0 bg-foreground/45" style={{ left: width(soldEnd), width: width(holdEnd - soldEnd) }} />
      ) : null}
      {holdEnd != null && highEnd != null && highEnd > holdEnd ? (
        <span className="absolute inset-y-0 bg-foreground/20" style={{ left: width(holdEnd), width: width(highEnd - holdEnd) }} />
      ) : null}
      {cap != null ? <span className="absolute inset-y-0 border-l border-dashed border-foreground" style={{ left: width(cap) }} /> : null}
    </>
  );
}

function CapacityAxis({ max }: { max: number }) {
  if (max <= 0) return null;
  return (
    <>
      <div className="relative mt-1 h-4 text-[10px] text-muted-foreground sm:hidden">
        {capacityTicks(max, 1000).map((tick) => (
          <span key={tick} className={`absolute whitespace-nowrap ${tick === 0 ? "" : tick === max ? "right-0" : "-translate-x-1/2"}`} style={tick === 0 || tick === max ? undefined : { left: `${(tick / max) * 100}%` }}>
            {tick === max ? `${formatCount(tick)} capacity` : formatCount(tick)}
          </span>
        ))}
      </div>
      <div className="mt-1 hidden sm:grid sm:grid-cols-[9rem_minmax(0,1fr)_14rem] sm:gap-3">
        <span />
        <div className="relative h-4 text-[10px] text-muted-foreground">
          {capacityTicks(max, 500).map((tick) => (
            <span key={tick} className={`absolute whitespace-nowrap ${tick === 0 ? "" : tick === max ? "right-0" : "-translate-x-1/2"}`} style={tick === 0 || tick === max ? undefined : { left: `${(tick / max) * 100}%` }}>
              {tick === max ? `${formatCount(tick)} capacity` : formatCount(tick)}
            </span>
          ))}
        </div>
        <span />
      </div>
    </>
  );
}

function Campaigns({ rows }: { rows: SalesDashboardModel["views"][string]["campaigns"] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className="text-sm font-medium">Campaigns</h3>
      <ul className="mt-2 space-y-3 sm:hidden">
        {rows.map((row) => (
          <li key={row.id} className="border-t border-border pt-2 text-xs" title={row.title}>
            <p className="flex flex-wrap items-center gap-2">
              <span>{row.name}</span>
              {row.unlinked ? <UnlinkedPill /> : null}
            </p>
            <p className="mt-1 whitespace-nowrap text-muted-foreground">{keepDate(row.delivery)}</p>
            <p className="mt-1 flex justify-between">
              <span>{row.periodSpend}</span>
              <span>{row.sinceLaunch}</span>
            </p>
          </li>
        ))}
      </ul>
      <table className="mt-2 hidden w-full text-left text-xs sm:table">
        <thead className="text-[11px] text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-normal">Campaign</th>
            <th className="py-1 pr-3 font-normal">Status</th>
            <th className="py-1 pr-3 font-normal">In this period</th>
            <th className="py-1 font-normal">Since launch</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-border" title={row.title}>
              <td className="py-2 pr-3">
                <span className="inline-flex flex-wrap items-center gap-2">
                  {row.name}
                  {row.unlinked ? <UnlinkedPill /> : null}
                </span>
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{keepDate(row.delivery)}</td>
              <td className="py-2 pr-3">{row.periodSpend}</td>
              <td className="py-2 text-muted-foreground">{row.sinceLaunch}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShowChip({
  chip,
  on,
  label,
  onSelect,
}: {
  chip: SalesShowChip;
  on: boolean;
  label?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onSelect}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
        chip.kind === "umbrella" ? "border-dashed" : "border-border"
      } ${chip.finished ? "text-muted-foreground" : ""} ${
        on ? "border-foreground bg-foreground text-background" : "bg-card"
      }`}
    >
      {label ?? (chip.kind === "umbrella" ? "Umbrella" : (
        <>
          <span className="sm:hidden">{chip.narrow}</span>
          <span className="hidden sm:inline">{chip.wide}</span>
        </>
      ))}
    </button>
  );
}

function FinishedToggle({ includeFinished, onToggle }: { includeFinished: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={includeFinished}
      onClick={onToggle}
      className={`shrink-0 rounded-full border border-border px-3 py-1 text-xs ${includeFinished ? "bg-muted" : "bg-card text-muted-foreground"}`}
    >
      Include finished
    </button>
  );
}

function SpendHover({ total }: { total: SalesTotal }) {
  return (
    <div className="absolute left-0 top-full z-20 mt-1 w-72 border border-border bg-card p-3 text-left text-[11px] leading-snug shadow-sm">
      <p className="font-mono text-[9px] font-bold uppercase leading-none tracking-[0.16em] text-muted-foreground">{total.headline}</p>
      <div className="mt-2 space-y-1">
        {total.parts.map((part) => (
          <div key={part.id}>
            <SpendLine label={part.label} amount={part.text} />
            {part.channels.length > 0 ? (
              <SpendLine
                indent
                label={part.channels.map((channel) => channel.label).join(" · ")}
                amount={part.channels.map((channel) => channel.text).join(" · ")}
              />
            ) : null}
            {part.children?.map((child) => (
              <div key={child.id}>
                <SpendLine nest label={child.label} amount={child.text} />
                {child.channels.length > 0 ? (
                  <SpendLine
                    nest
                    label={child.channels.map((channel) => channel.label).join(" · ")}
                    amount={child.channels.map((channel) => channel.text).join(" · ")}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      {total.notIncluded ? <p className="mt-2 text-muted-foreground">{total.notIncluded}</p> : null}
    </div>
  );
}

function SpendLine({ label, amount, indent = false, nest = false }: { label: string; amount: string; indent?: boolean; nest?: boolean }) {
  return (
    <p className={`flex justify-between gap-4 ${nest ? "pl-6 text-muted-foreground" : indent ? "pl-3 text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="shrink-0">{amount}</span>
    </p>
  );
}

function SummaryValue({ value }: { value: string }) {
  const pace = /^(.*) a day$/.exec(value);
  if (!pace) return <TileValue className="mt-1 block">{value}</TileValue>;
  return (
    <p className="mt-1 leading-none">
      <TileValue>{pace[1]}</TileValue>
      <span className="text-[11px] font-normal text-muted-foreground"> a day</span>
    </p>
  );
}

/** A date alone ("to 12 Nov") is not a channel split. The line needs a money figure. */
function channelLineHasSplit(line: string): boolean {
  return line.includes("£");
}

function venueToken(venue: SalesVenue): string {
  return venue.key ?? venue.viewId;
}

/** Default is the venue with the most live shows. "all" is All venues. */
function startingVenueKey(model: SalesDashboardModel, showId: string, explicit?: string): string {
  const venues = (model.venues ?? []).filter((venue) => venue.liveShows > 0);
  if (venues.length < 2) return "all";
  if (explicit === "all") return "all";
  if (explicit) {
    const found = venues.find((venue) => venue.key === explicit || venue.viewId === explicit);
    if (found) return venueToken(found);
  }
  const owner = venues.find(
    (venue) =>
      venue.viewId === showId ||
      venue.shows.some((chip) => chip.id === showId) ||
      venue.finishedShows.some((chip) => chip.id === showId),
  );
  if (owner) return venueToken(owner);
  const initial = venues.find((venue) => venue.viewId === model.initialVenueViewId);
  return initial ? venueToken(initial) : "all";
}

function UnlinkedPill() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      Not linked to event
    </span>
  );
}
