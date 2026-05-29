"use client";

/**
 * components/dashboard/clients/daily-spend-tracker.tsx
 *
 * Daily Spend Tracker (visual-overhaul PR) — the load-bearing missing
 * piece. A mini horizontal bar chart of the trailing 14 days of daily
 * allocated spend, with two reference lines: the current Meta daily
 * budget (dashed) and the required £/day to sell out (dotted). Bars
 * colour by how the day compares to the required pace.
 *
 * Data: `pacing.dailySpendSeries` (the one new canonical derived field)
 * + `requiredPerDay` (canonical) + the live Meta daily budget read from
 * the in-memory module cache populated by the Performance tab. No new
 * queries, no network call here.
 */

import { useEffect, useMemo, useState } from "react";

import type { DailySpendPoint } from "@/lib/dashboard/venue-canonical-funnel";
import {
  DAILY_BUDGET_UPDATED_EVENT,
  fetchVenueDailyBudgetDetail,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "@/lib/share/venue-daily-budget-fetch";
import { toneColors, type PacingTone } from "@/lib/dashboard/pacing-presentation";

const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

function dayTone(spent: number, required: number | null): PacingTone {
  if (required == null || required <= 0) return "neutral";
  const ratio = spent / required;
  if (ratio >= 1) return "above";
  if (ratio >= 0.8) return "within";
  return "below";
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function DailySpendTracker({
  series,
  requiredPerDay,
  remaining,
  daysToEvent,
  clientId,
  eventCode,
}: {
  series: DailySpendPoint[];
  requiredPerDay: number | null;
  /** Remaining budget (allocated − spent). `null` when no budget set. */
  remaining: number | null;
  daysToEvent: number | null;
  clientId: string;
  eventCode: string;
}) {
  const [budgetDetail, setBudgetDetail] =
    useState<DailyBudgetUpdateDetail | null>(() =>
      getDailyBudgetUpdate(clientId, eventCode),
    );
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<DailyBudgetUpdateDetail>).detail;
      if (detail.clientId === clientId && detail.eventCode === eventCode) {
        setBudgetDetail(detail);
      }
    }
    window.addEventListener(DAILY_BUDGET_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(DAILY_BUDGET_UPDATED_EVENT, onUpdate);
  }, [clientId, eventCode]);

  // Trigger a fresh fetch when the cache is cold (e.g. landing directly on
  // the Funnel Pacing tab without having visited the Performance tab first).
  // fetchVenueDailyBudgetDetail dispatches DAILY_BUDGET_UPDATED_EVENT on
  // completion, so HeroDailyBudgetReadout automatically receives the value.
  useEffect(() => {
    if (getDailyBudgetUpdate(clientId, eventCode) != null) return;
    void fetchVenueDailyBudgetDetail({ clientId, eventCode }).catch(() => {
      // Error state is dispatched on the event bus by the fetch helper.
    });
    // Intentionally runs once on mount; clientId/eventCode don't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dailyBudget = budgetDetail?.dailyBudget ?? null;

  const { maxVal, avg } = useMemo(() => {
    if (series.length === 0) return { maxVal: 1, avg: 0 };
    const max = Math.max(
      ...series.map((d) => d.spent),
      requiredPerDay ?? 0,
      dailyBudget ?? 0,
      1,
    );
    const total = series.reduce((s, d) => s + d.spent, 0);
    return { maxVal: max, avg: total / series.length };
  }, [series, requiredPerDay, dailyBudget]);

  const hasData = series.length > 0;

  return (
    <article
      className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      data-testid="funnel-pacing-daily-tracker"
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Daily Spend Tracker
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            Last {series.length || 14} days
          </h3>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <LegendSwatch className="border-b-2 border-dashed border-foreground/60">
            Daily budget (Meta)
          </LegendSwatch>
          <LegendSwatch className="border-b-2 border-dotted border-foreground/60">
            Required/day
          </LegendSwatch>
        </div>
      </div>

      {hasData ? (
        <div
          className="relative flex h-40 items-end gap-1 sm:gap-1.5"
          onMouseLeave={() => setHover(null)}
        >
          {/* required-per-day reference (dotted) */}
          {requiredPerDay != null && requiredPerDay <= maxVal && (
            <ReferenceLine
              fraction={requiredPerDay / maxVal}
              variant="dotted"
              label={GBP0.format(Math.round(requiredPerDay))}
            />
          )}
          {/* daily budget reference (dashed) */}
          {dailyBudget != null && dailyBudget <= maxVal && (
            <ReferenceLine
              fraction={dailyBudget / maxVal}
              variant="dashed"
              label={GBP0.format(Math.round(dailyBudget))}
            />
          )}

          {series.map((d, i) => {
            const tone = dayTone(d.spent, requiredPerDay);
            const c = toneColors(tone);
            const heightPct = (d.spent / maxVal) * 100;
            const delta =
              requiredPerDay != null ? d.spent - requiredPerDay : null;
            return (
              <div
                key={d.date}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
              >
                <div
                  className={`w-full rounded-t ${c.bar} transition-opacity ${hover != null && hover !== i ? "opacity-60" : ""}`}
                  style={{ height: `${Math.max(2, heightPct)}%` }}
                />
                {hover === i && (
                  <div
                    className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 w-40 -translate-x-1/2 rounded-md border border-border bg-card px-2.5 py-2 text-[11px] shadow-lg"
                  >
                    <p className="mb-1 font-medium">{formatDay(d.date)}</p>
                    <Row label="Spent" value={GBP0.format(Math.round(d.spent))} />
                    <Row
                      label="Required"
                      value={
                        requiredPerDay == null
                          ? "—"
                          : GBP0.format(Math.round(requiredPerDay))
                      }
                    />
                    <Row
                      label="Delta"
                      value={
                        delta == null
                          ? "—"
                          : `${delta >= 0 ? "+" : ""}${GBP0.format(Math.round(delta))}`
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          No daily spend recorded in the trailing window yet.
        </div>
      )}

      {/* 3-stat strip */}
      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
        <MiniStat label="Avg daily" value={GBP0.format(Math.round(avg))} />
        <MiniStat
          label="Required"
          value={
            requiredPerDay == null
              ? "—"
              : GBP0.format(Math.round(requiredPerDay))
          }
        />
        <MiniStat
          label={`Remaining${daysToEvent != null && daysToEvent > 0 ? ` over ${daysToEvent}d` : ""}`}
          value={remaining == null ? "—" : GBP0.format(Math.round(remaining))}
        />
      </div>
    </article>
  );
}

function ReferenceLine({
  fraction,
  variant,
  label,
}: {
  fraction: number;
  variant: "dashed" | "dotted";
  /** Optional £ value label shown at the right edge of the line. */
  label?: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 border-t-2 border-foreground/50 ${variant === "dashed" ? "border-dashed" : "border-dotted"}`}
      style={{ bottom: `${Math.min(100, fraction * 100)}%` }}
      aria-hidden
    >
      {label && (
        <span className="absolute right-0 -translate-y-full rounded-sm bg-card/80 px-1 text-[9px] font-medium tabular-nums text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

function LegendSwatch({
  children,
  className,
}: {
  children: React.ReactNode;
  className: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-0 w-5 ${className}`} aria-hidden />
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3 tabular-nums">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </p>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 font-heading text-lg tracking-wide tabular-nums">
        {value}
      </p>
    </div>
  );
}
