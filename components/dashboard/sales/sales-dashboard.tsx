"use client";

import { useState, type ReactNode } from "react";

import { CHART_PLOT, PLOT_PAD, ChartDateLabels, ChartDot, SalesChart } from "@/components/dashboard/sales/sales-chart";
import { TILE_NAMES, tileSubline } from "@/components/dashboard/sales/tile-copy";
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
  type SalesSurface,
  type SalesTrajectory,
  type SingleTrajectory,
} from "@/lib/dashboard/sales-vs-spend";

export function SalesDashboard({
  model,
  surface,
  initialShowId,
  initialPeriod,
  initialIndex = false,
  pinHover = false,
  onQuery,
}: {
  model: SalesDashboardModel;
  surface: SalesSurface;
  initialShowId?: string;
  /** Since launch when the URL has no period (N5). */
  initialPeriod?: SalesPeriod;
  initialIndex?: boolean;
  pinHover?: boolean;
  /** Pages pass this to keep `show` and `period` in the query string. */
  onQuery?: (key: "show" | "period", value: string) => void;
}) {
  const presented = salesForSurface(model, surface);
  const [showId, setShowId] = useState(initialShowId ?? presented.initialShowId);
  const [period, setPeriod] = useState<SalesPeriod>(initialPeriod ?? "launch");
  const [includeFinished, setIncludeFinished] = useState(false);
  const [selected, setSelected] = useState<SalesMetricId[]>([...DEFAULT_ON_METRICS]);
  const [indexRequested, setIndexRequested] = useState(initialIndex);

  const chips = visibleShows(presented, includeFinished);
  const activeId = chips.some((chip) => chip.id === showId) ? showId : presented.initialShowId;
  const activeChip = chips.find((chip) => chip.id === activeId);
  const umbrella = activeChip?.kind === "umbrella";
  const view = presented.views[activeId] ?? presented.views[presented.initialShowId];
  if (!view) return null;
  const points = slicePoints(view.points, period, view.endDay);
  const tiles = tilesForPeriod(view.tiles, view.points, period, view.endDay, view.periods);
  const showScope = view.trajectory.kind === "all"
    ? {
        showsWithCounts: view.trajectory.bars.filter((bar) => bar.sold != null).length,
        shows: view.trajectory.bars.length,
      }
    : null;

  function chooseShow(id: string) {
    setShowId(id);
    writeQuery("show", id);
  }

  function choosePeriod(next: SalesPeriod) {
    setPeriod(next);
    writeQuery("period", next);
  }

  function writeQuery(key: "show" | "period", value: string) {
    onQuery?.(key, value);
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
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="sm:hidden">{view.narrowSubtitle}</span>
          <span className="hidden sm:inline">{view.subtitle}</span>
        </p>
        {view.umbrellaLine ? (
          <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{view.umbrellaLine}</p>
        ) : null}
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {presented.freshness.map((stamp) => (
            <li key={stamp.id} className={stamp.stale ? "text-warning" : "text-muted-foreground"}>
              <span className="sm:hidden">{stamp.narrow}</span>
              <span className="hidden sm:inline">{stamp.wide}</span>
            </li>
          ))}
        </ul>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const on = chip.id === activeId;
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={on}
              onClick={() => chooseShow(chip.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                chip.kind === "umbrella" ? "border-dashed" : "border-border"
              } ${chip.finished ? "text-muted-foreground" : ""} ${
                on ? "border-foreground bg-foreground text-background" : "bg-card"
              }`}
            >
              {chip.kind === "umbrella" ? "Umbrella" : (
                <>
                  <span className="sm:hidden">{chip.narrow}</span>
                  <span className="hidden sm:inline">{chip.wide}</span>
                </>
              )}
            </button>
          );
        })}
        <button
          type="button"
          aria-pressed={includeFinished}
          onClick={() => setIncludeFinished((value) => !value)}
          className={`rounded-full border border-border px-3 py-1 text-xs ${includeFinished ? "bg-muted" : "bg-card text-muted-foreground"}`}
        >
          Include finished
        </button>
      </div>

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
          const endLabel = shortDay(view.endDay);
          const authored = view.tiles.find((item) => item.id === tile.id);
          const soldDetail = tile.id === "sold" ? (authored?.detail ?? tile.detail) : null;
          const wideDetail = soldDetail ?? tile.detail;
          const narrowDetail = soldDetail ?? tile.narrowDetail;
          return (
            <li key={tile.id}>
              <button
                type="button"
                aria-pressed={on}
                title={tile.title}
                onClick={() => toggleMetric(tile.id)}
                className={`h-full w-full rounded-md border px-2.5 py-2 text-left ${
                  on ? "border-foreground bg-card" : "border-border bg-card text-muted-foreground"
                }`}
              >
                <span className="block text-[11px]">
                  <span className="sm:hidden">{names.narrow}</span>
                  <span className="hidden sm:inline">{names.wide}</span>
                </span>
                <TileValue className="mt-1 block">{tile.value}</TileValue>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  <span className="sm:hidden">{tileSubline(tile.id, narrowDetail, period, endLabel, showScope)}</span>
                  <span className="hidden sm:inline">{tileSubline(tile.id, wideDetail, period, endLabel, showScope)}</span>
                </span>
              </button>
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
          endDay={view.endDay}
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
  endDay,
  onSelectShow,
  crossClientNote,
  reviewLine,
}: {
  trajectory: SalesTrajectory;
  endDay: string;
  onSelectShow: (id: string) => void;
  crossClientNote: string | null;
  reviewLine: string | null;
}) {
  return (
    <div className="mt-4">
      {trajectory.kind === "all" ? (
        <AllTrajectoryView trajectory={trajectory} endDay={endDay} onSelectShow={onSelectShow} />
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

function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function AllTrajectoryView({
  trajectory,
  endDay,
  onSelectShow,
}: {
  trajectory: Extract<SalesTrajectory, { kind: "all" }>;
  endDay: string;
  onSelectShow: (id: string) => void;
}) {
  const sums = trajectorySums(trajectory.bars);
  const axisMax = trajectoryAxisMax(trajectory.bars);
  const soldShare = shareOf(sums.sold, sums.capacity);
  const highShare = shareOf(sums.high, sums.capacity);
  const counted = shortDay(endDay);
  return (
    <div>
      <h3 className="text-sm font-medium">Sales trajectory</h3>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <li className="rounded-md border border-border px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground">Sold · count of {counted}</p>
          <TileValue className="mt-1">{formatCount(sums.sold)}</TileValue>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {soldShare == null ? "—" : `${soldShare}% of ${formatCount(sums.capacity)} across ${sums.shows} shows`}
          </p>
        </li>
        <li className="rounded-md border border-border px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground">Projected on show day</p>
          <TileValue className="mt-1">{formatCount(sums.holds)}–{formatCount(sums.high)}</TileValue>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {highShare == null ? "—" : `up to ${highShare}% of ${formatCount(sums.capacity)} · each show capped at its capacity`}
          </p>
        </li>
        <li className="rounded-md border border-border px-2.5 py-2">
          <p className="text-[11px] text-muted-foreground">Pace, last 7 days</p>
          <p className="mt-1 leading-none">
            <TileValue>—</TileValue>
            <span className="text-[11px] font-normal text-muted-foreground"> a day</span>
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">14-day — a day</p>
        </li>
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

function UnlinkedPill() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
      Not linked to event
    </span>
  );
}
