"use client";

/**
 * MB6 (dashboard v2 on a phone): the chart shows 30 days at a time and
 * scrolls sideways inside its own frame; the page never does. The axes sit
 * in fixed columns outside the scroller and are computed from the whole
 * period, so nothing rescales as you swipe. Opens on the latest day. A press
 * and hold (300 ms) puts the dotted rule on a day and its figures in a strip
 * over the titles row. Used below 640 px for periods longer than 30 days;
 * shorter periods and desktop keep SalesChart.
 */

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";

import { anchoredDateIndexes, axisTicks } from "@/components/dashboard/sales/chart-axes";
import { CHART_DOT, CHART_HOW, INDEX_LABEL } from "@/components/dashboard/sales/phone-copy";
import {
  CHART_PLOT,
  ChartDot,
  PLOT_PAD,
  allocationBand,
  axisScales,
  axisTitle,
  drawSeries,
  formatTick,
  moneyOnTheLeft,
  xAt,
  yAt,
} from "@/components/dashboard/sales/sales-chart";
import { shortDay } from "@/lib/dashboard/sales-calc/days";
import {
  PICK_A_METRIC,
  formatSalesNumber,
  keepDate,
  planAxes,
  salesMetric,
  type AllocationStep,
  type SalesChartPoint,
  type SalesMetricId,
} from "@/lib/dashboard/sales-vs-spend";
import { TILE_NAMES } from "@/components/dashboard/sales/tile-copy";

export const PHONE_WINDOW_DAYS = 30;
const INTERVALS = 3;
const HOLD_MS = 300;
const SWIPE_PX = 8;

/** The first and last index in view, from the scroller's position. */
export function visibleRange(count: number, scrollLeft: number, clientWidth: number, scrollWidth: number): [number, number] {
  if (count === 0) return [0, 0];
  if (scrollWidth <= 0 || clientWidth <= 0) return [Math.max(0, count - PHONE_WINDOW_DAYS), count - 1];
  const first = Math.max(0, Math.min(count - 1, Math.round((scrollLeft / scrollWidth) * count)));
  const last = Math.max(first, Math.min(count - 1, Math.round(((scrollLeft + clientWidth) / scrollWidth) * count) - 1));
  return [first, last];
}

/** "30 Sep · Spend £164 · Total sold 4,173 · Internal Count". A day between counts says it's an estimate (D5). */
export function readoutText(point: SalesChartPoint, selected: readonly SalesMetricId[]): string {
  const figures = selected.map((id) => {
    const value = point.values[id];
    return `${TILE_NAMES[id].wide} ${value == null ? "—" : formatSalesNumber(salesMetric(id).unit, value)}`;
  });
  const tail = point.count ? "Internal Count" : point.estimated && point.estimateNote ? point.estimateNote : null;
  return [shortDay(point.day), ...figures, tail].filter(Boolean).join(" · ");
}

const DATE_HALF_PX = 26;

/** MB6: the latest day at the right end; frames can open at the start or with a day in the middle. */
function placeScroller(el: HTMLElement, openAt: string, days: readonly string[]) {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(openAt) ? days.indexOf(openAt) : -1;
  el.scrollLeft =
    openAt === "start" ? 0 : at >= 0 ? (xAt(at, days.length) / CHART_PLOT) * el.scrollWidth - el.clientWidth / 2 : el.scrollWidth;
}

/** MB6: a centred date label at `percent` of the content would be cut by the frame's edge where the scroller now sits. */
export function labelCut(percent: number, scroll: { left: number; client: number; width: number }): boolean {
  if (scroll.width <= 0 || scroll.client <= 0) return percent < 2;
  const x = (percent / 100) * scroll.width - scroll.left;
  return x - DATE_HALF_PX < 0 || x + DATE_HALF_PX > scroll.client;
}

/** The point nearest an x (0–1 across the whole content). */
export function indexAt(fraction: number, count: number): number {
  if (count <= 1) return 0;
  const plot = (fraction * CHART_PLOT - PLOT_PAD) / (CHART_PLOT - PLOT_PAD * 2);
  return Math.max(0, Math.min(count - 1, Math.round(plot * (count - 1))));
}

export function PhoneChart({
  points,
  allocation,
  selected,
  indexRequested,
  onIndex,
  showAllocation,
  pinnedHoldDay = null,
  openAt = "end",
}: {
  points: SalesChartPoint[];
  allocation: AllocationStep[];
  selected: SalesMetricId[];
  indexRequested: boolean;
  onIndex?: (next: boolean) => void;
  showAllocation: boolean;
  /** A day whose readout stays open, for the frames. */
  pinnedHoldDay?: string | null;
  /** Frames only: "start" opens on the earliest dates; an ISO day opens with that day in the middle (MBV3b). */
  openAt?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; fraction: number } | null>(null);
  const [scroll, setScroll] = useState({ left: 0, client: 0, width: 0 });
  const [hold, setHold] = useState<number | null>(null);

  const units = selected.map((id) => salesMetric(id).unit);
  const indexForced = new Set(units).size >= 3;
  const plan = moneyOnTheLeft(planAxes(units, indexRequested));
  // One scale for the whole period: computed from every point, not the 30 in view.
  const scales = axisScales(points, selected, plan, allocation, INTERVALS);
  const drawn = selected.length === 0 ? [] : drawSeries(points, selected, plan, allocation, scales);
  const countCeiling = scales.rightUnit === "count" ? scales.rightCeiling : scales.leftCeiling;
  const band = showAllocation && plan.mode !== "index" && selected.includes("sold") ? allocationBand(points, allocation, countCeiling) : null;
  const leftTicks = plan.mode === "index" ? [0, 50, 100] : axisTicks(scales.leftPeak, INTERVALS);
  const rightTicks = plan.mode !== "index" && scales.rightUnit ? axisTicks(scales.rightPeak, INTERVALS) : [];
  const days = points.map((p) => p.day);
  const dateIndexes = anchoredDateIndexes(days, 7);
  const pinned = pinnedHoldDay == null ? -1 : days.indexOf(pinnedHoldDay);
  const active = hold ?? (pinned >= 0 ? pinned : null);
  const [first, last] = visibleRange(points.length, scroll.left, scroll.client, scroll.width);
  const contentPct = (Math.max(points.length, PHONE_WINDOW_DAYS) / PHONE_WINDOW_DAYS) * 100;

  function measure() {
    const el = scrollerRef.current;
    if (el) setScroll({ left: el.scrollLeft, client: el.clientWidth, width: el.scrollWidth });
  }

  // Opens on the latest day: scrolled to the right end. Placed again whenever the frame or its content changes
  // size (the stylesheet can land after hydration, when the content isn't wide yet), until the person moves it.
  const userMoved = useRef(false);

  useLayoutEffect(() => {
    userMoved.current = false;
    const el = scrollerRef.current;
    if (!el) return;
    placeScroller(el, openAt, days);
    setScroll({ left: el.scrollLeft, client: el.clientWidth, width: el.scrollWidth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt, points.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!userMoved.current) placeScroller(el, openAt, days);
      setScroll({ left: el.scrollLeft, client: el.clientWidth, width: el.scrollWidth });
    });
    observer.observe(el);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAt, points.length]);

  function fractionOf(event: PointerEvent<HTMLDivElement>): number {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return (event.clientX - rect.left) / rect.width;
  }

  function clearTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const fraction = fractionOf(event);
    start.current = { x: event.clientX, fraction };
    clearTimer();
    timer.current = setTimeout(() => setHold(indexAt(fraction, points.length)), HOLD_MS);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (hold != null) {
      setHold(indexAt(fractionOf(event), points.length));
      return;
    }
    // A swipe before the hold fires is a scroll, not a hold.
    if (start.current && Math.abs(event.clientX - start.current.x) > SWIPE_PX) clearTimer();
  }

  function onPointerEnd() {
    clearTimer();
    start.current = null;
    setHold(null);
  }

  if (selected.length === 0) return <p className="px-2 py-8 text-center text-xs text-muted-foreground">{PICK_A_METRIC}</p>;

  const thumbLeft = scroll.width > 0 ? (scroll.left / scroll.width) * 100 : 100 - (PHONE_WINDOW_DAYS / Math.max(points.length, 1)) * 100;
  const thumbWidth = scroll.width > 0 ? (scroll.client / scroll.width) * 100 : (PHONE_WINDOW_DAYS / Math.max(points.length, 1)) * 100;

  return (
    <figure className="mt-1" data-phone-chart>
      <div className="flex min-h-5 items-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {active != null ? (
          // The readout sits over the titles row, above the plot, so a finger never covers it. It wraps rather than lose the estimate words.
          <p className="min-w-0 flex-1 text-[11px] normal-case leading-snug tracking-normal text-foreground" data-readout>
            {keepDate(readoutText(points[active], selected))}
          </p>
        ) : (
          <>
            {/* The axis titles size to their words: in a fixed column "TOTAL SOLD" spilled past the phone's edge. */}
            <span className="shrink-0 whitespace-nowrap">{axisTitle(scales.leftUnit, selected)}</span>
            <span className="min-w-0 flex-1 truncate px-2 text-center normal-case tracking-normal" data-range>
              {points.length ? `${keepDate(shortDay(points[first].day))} – ${keepDate(shortDay(points[last].day))}` : ""}
            </span>
            <span className="shrink-0 whitespace-nowrap text-right">{scales.rightUnit && plan.mode !== "index" ? axisTitle(scales.rightUnit, selected) : ""}</span>
          </>
        )}
      </div>
      <div className="mt-1 flex items-start" data-phone-plot>
        <div className="relative h-[176px] w-10 shrink-0 text-[10px] text-muted-foreground">
          {leftTicks.map((tick) => (
            <span
              key={tick}
              className="absolute right-1 -translate-y-1/2 whitespace-nowrap"
              style={{ top: `${(yAt(plan.mode === "index" ? tick / 100 : tick / (scales.leftCeiling || 1)) / CHART_PLOT) * 100}%` }}
            >
              {plan.mode === "index" ? `${tick}%` : formatTick(scales.leftUnit, tick, true)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={scrollerRef}
            onScroll={measure}
            onPointerDownCapture={() => (userMoved.current = true)}
            onWheel={() => (userMoved.current = true)}
            onKeyDown={() => (userMoved.current = true)}
            className="min-w-0 max-w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ touchAction: "pan-x pan-y" }}
          >
            <div
              ref={contentRef}
              className="relative select-none [-webkit-touch-callout:none]"
              style={{ width: `${contentPct}%` }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerEnd}
              onPointerCancel={onPointerEnd}
              onPointerLeave={onPointerEnd}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="relative h-[176px]">
                <svg viewBox={`0 0 ${CHART_PLOT} ${CHART_PLOT}`} preserveAspectRatio="none" role="img" aria-label="Sales and spend" className="absolute inset-0 h-full w-full">
                  {leftTicks.map((tick, index) => {
                    const y = yAt(plan.mode === "index" ? tick / 100 : tick / (scales.leftCeiling || 1));
                    return <line key={tick} x1={0} x2={CHART_PLOT} y1={y} y2={y} stroke="currentColor" className="text-border" strokeOpacity={index === 0 ? 0.7 : 0.35} vectorEffect="non-scaling-stroke" />;
                  })}
                  {band}
                  {drawn.flatMap((series) =>
                    series.runs.map((run, index) => (
                      <polyline
                        key={`${series.id}-${index}`}
                        fill="none"
                        stroke={series.color}
                        strokeWidth="1.6"
                        strokeLinecap={run.length === 1 ? "round" : undefined}
                        vectorEffect="non-scaling-stroke"
                        strokeDasharray={series.dashed ? "4 3" : undefined}
                        points={(run.length === 1 ? [run[0], run[0]] : run).map((coord) => `${coord.x},${coord.y}`).join(" ")}
                      />
                    )),
                  )}
                  {active != null ? (
                    <line x1={xAt(active, points.length)} x2={xAt(active, points.length)} y1={PLOT_PAD} y2={CHART_PLOT - PLOT_PAD} stroke="currentColor" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
                  ) : null}
                </svg>
                {drawn
                  .filter((series) => series.id === "sold")
                  .flatMap((series) => series.coords.filter((coord) => coord.count).map((coord) => <ChartDot key={`${coord.x}-${coord.y}`} x={coord.x} y={coord.y} color={series.color} />))}
              </div>
              <div className="relative h-[22px] text-[11px] text-muted-foreground">
                {dateIndexes.map((index) => {
                  const percent = (xAt(index, points.length) / CHART_PLOT) * 100;
                  const isLast = index === points.length - 1;
                  // A label the frame's edge would cut in half isn't drawn. The last day sits flush right.
                  if (!isLast && labelCut(percent, scroll)) return null;
                  return (
                    <span key={days[index]} className="absolute top-1 whitespace-nowrap" style={{ left: `${percent}%`, transform: isLast ? "translateX(-100%)" : "translateX(-50%)" }}>
                      {keepDate(shortDay(days[index]))}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          {scroll.left > 1 ? <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent" data-left-fade /> : null}
          <div className="relative mt-1 h-[3px] rounded-full bg-muted" aria-hidden data-position>
            <span className="absolute inset-y-0 rounded-full bg-foreground/50" style={{ left: `${Math.max(0, thumbLeft)}%`, width: `${Math.min(100, thumbWidth)}%` }} />
          </div>
        </div>
        <div className="relative h-[176px] w-9 shrink-0 text-[10px] text-muted-foreground">
          {rightTicks.map((tick) => (
            <span key={tick} className="absolute left-1 -translate-y-1/2 whitespace-nowrap" style={{ top: `${(yAt(tick / (scales.rightCeiling || 1)) / CHART_PLOT) * 100}%` }}>
              {formatTick(scales.rightUnit!, tick, true)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {CHART_HOW} {selected.includes("sold") ? `${CHART_DOT} ` : ""}
        {onIndex ? (
          <label className="inline-flex items-center gap-1 align-middle">
            <input type="checkbox" checked={plan.mode === "index"} disabled={indexForced} onChange={(event) => onIndex(event.target.checked)} />
            {INDEX_LABEL}
          </label>
        ) : null}
      </p>
    </figure>
  );
}
