"use client";

import { useState } from "react";

import { SalesChart } from "@/components/dashboard/sales/sales-chart";
import {
  DEFAULT_ON_METRICS,
  INDEX_TO_PEAK,
  SALES_METRICS,
  keepDate,
  SALES_PERIODS,
  planAxes,
  salesForSurface,
  salesMetric,
  slicePoints,
  tilesForPeriod,
  visibleShows,
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
  onQuery,
}: {
  model: SalesDashboardModel;
  surface: SalesSurface;
  initialShowId?: string;
  initialPeriod?: SalesPeriod;
  /** Pages pass this to keep `show` and `period` in the query string. */
  onQuery?: (key: "show" | "period", value: string) => void;
}) {
  const presented = salesForSurface(model, surface);
  const [showId, setShowId] = useState(initialShowId ?? presented.initialShowId);
  const [period, setPeriod] = useState<SalesPeriod>(initialPeriod ?? presented.initialPeriod);
  const [includeFinished, setIncludeFinished] = useState(false);
  const [selected, setSelected] = useState<SalesMetricId[]>([...DEFAULT_ON_METRICS]);
  const [indexRequested, setIndexRequested] = useState(false);

  const chips = visibleShows(presented, includeFinished);
  const activeId = chips.some((chip) => chip.id === showId) ? showId : presented.initialShowId;
  const view = presented.views[activeId] ?? presented.views[presented.initialShowId];
  if (!view) return null;
  const points = slicePoints(view.points, period, view.endDay);
  const tiles = tilesForPeriod(view.tiles, view.points, period, view.endDay);
  const units = selected.map((id) => salesMetric(id).unit);
  const axes = planAxes(units, indexRequested);
  const indexForced = axes.mode === "index" && new Set(units).size >= 3;

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
          <span className="sm:hidden">{view.narrowTitle}</span>
          <span className="hidden sm:inline">{view.title}</span>
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
              <span className="sm:hidden">{chip.narrow}</span>
              <span className="hidden sm:inline">{chip.wide}</span>
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
        <label className="ml-1 flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={axes.mode === "index"}
            disabled={indexForced}
            onChange={(event) => setIndexRequested(event.target.checked)}
          />
          {INDEX_TO_PEAK}
        </label>
      </div>

      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => {
          const on = selected.includes(tile.id);
          const metric = salesMetric(tile.id);
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
                  <span className="sm:hidden">{metric.narrow}</span>
                  <span className="hidden sm:inline">{metric.label}</span>
                </span>
                <span className="mt-1 block font-heading text-lg leading-none">{tile.value}</span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  <span className="sm:hidden">{tile.narrowDetail}</span>
                  <span className="hidden sm:inline">{tile.detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <SalesChart
        points={points}
        allocation={view.allocation}
        selected={selected}
        indexRequested={indexRequested}
        showAllocation={view.allocation.length > 0}
      />

      <Trajectory
        trajectory={view.trajectory}
        onSelectShow={chooseShow}
        crossClientNote={presented.crossClientNote}
        reviewLine={presented.reviewLine}
      />

      <Campaigns rows={view.campaigns} />
    </section>
  );
}

function Trajectory({
  trajectory,
  onSelectShow,
  crossClientNote,
  reviewLine,
}: {
  trajectory: SalesTrajectory;
  onSelectShow: (id: string) => void;
  crossClientNote: string | null;
  reviewLine: string | null;
}) {
  return (
    <div className="mt-4">
      {trajectory.kind === "all" ? (
        <AllTrajectoryView trajectory={trajectory} onSelectShow={onSelectShow} />
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
  const x = (day: string) => 16 + ((Date.parse(`${day}T00:00:00Z`) - start) / span) * 608;
  const y = (sold: number) => 228 - (sold / yMax) * 212;
  const dates = [pace.fromDay, pace.toDay, pace.fanDay, trajectory.showDayIso];
  return (
    <figure className="mt-3">
      <svg viewBox="0 0 640 240" role="img" aria-label="Trajectory to show day" className="block h-64 w-full">
        <line x1="16" y1={y(trajectory.allocation)} x2="624" y2={y(trajectory.allocation)} stroke="var(--foreground)" strokeOpacity="0.35" />
        <text x="20" y={y(trajectory.allocation) - 6} fontSize="12" fill="currentColor" className="text-muted-foreground">
          {trajectory.allocation.toLocaleString("en-GB")}
        </text>
        <line x1={x(trajectory.showDayIso)} y1="12" x2={x(trajectory.showDayIso)} y2="228" stroke="var(--foreground)" strokeOpacity="0.45" />
        <polyline
          fill="none"
          stroke="var(--foreground)"
          strokeWidth="1.6"
          points={trajectory.counts.map((count) => `${x(count.day)},${y(count.sold)}`).join(" ")}
        />
        {trajectory.counts.map((count) => (
          <circle key={count.day} cx={x(count.day)} cy={y(count.sold)} r="4" fill="var(--foreground)" />
        ))}
        <line
          x1={x(pace.toDay)}
          y1={y(pace.toSold)}
          x2={x(pace.fanDay)}
          y2={y(pace.fanSold)}
          stroke="var(--foreground)"
          strokeDasharray="5 4"
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
          />
        ))}
        <line
          x1={x(pace.toDay)}
          y1={y(pace.toSold)}
          x2={x(trajectory.showDayIso)}
          y2={y(needed.showDaySold)}
          stroke="var(--foreground)"
          strokeDasharray="1 3"
          strokeOpacity="0.7"
        />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        {[...new Set(dates)].map((day) => (
          <span key={day} className="whitespace-nowrap">{keepDate(shortDay(day))}</span>
        ))}
      </div>
    </figure>
  );
}

function shortDay(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function AllTrajectoryView({
  trajectory,
  onSelectShow,
}: {
  trajectory: Extract<SalesTrajectory, { kind: "all" }>;
  onSelectShow: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-xs">
        <span className="sm:hidden">{trajectory.narrowRange}</span>
        <span className="hidden sm:inline">{trajectory.wideRange}</span>
      </p>
      <ul className="mt-3 space-y-2">
        {trajectory.bars.map((bar) => (
          <li key={bar.id}>
            <button type="button" onClick={() => onSelectShow(bar.id)} className="w-full text-left">
              <span className="flex justify-between text-[11px]">
                <span>{bar.label}</span>
                <span className="text-muted-foreground">{bar.caption}</span>
              </span>
              {bar.allocation != null && bar.sold != null ? (
                <span className="relative mt-1 block h-2 rounded-full bg-muted">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-foreground/80" style={{ width: `${(bar.sold / bar.allocation) * 100}%` }} />
                  {bar.low != null ? (
                    <span className="absolute top-0 h-2 w-px bg-foreground/50" style={{ left: `${(bar.low / bar.allocation) * 100}%` }} />
                  ) : null}
                  {bar.high != null ? (
                    <span className="absolute top-0 h-2 w-px bg-foreground/50" style={{ left: `${(bar.high / bar.allocation) * 100}%` }} />
                  ) : null}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 max-w-xl text-[11px] text-muted-foreground">{trajectory.note}</p>
    </div>
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
