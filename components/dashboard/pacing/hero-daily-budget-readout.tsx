"use client";

/**
 * components/dashboard/pacing/hero-daily-budget-readout.tsx
 *
 * The daily-budget gap readout inside the Hero Status Bar's "Days to event"
 * segment (tidy-up PR). Shows three values so the operator can see the gap
 * between what Meta is spending per day and what the funnel requires:
 *
 *   Budget   £135/day   (live Meta daily budget)
 *   Required £196/day   (canonical funnel)
 *   Room     −£61/day   (budget − required; red when negative)
 *
 * The Meta daily budget is read from the same in-memory module cache the
 * Performance tab populates (`getDailyBudgetUpdate`) — no new query, no Meta
 * call here. Mirrors the SSR-safe read+subscribe pattern used by the Daily
 * Spend Tracker: the server snapshot is empty, so first client render also
 * renders the "—" placeholder before the cache event arrives.
 */

import { useEffect, useState } from "react";

import {
  DAILY_BUDGET_UPDATED_EVENT,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "@/lib/share/venue-daily-budget-fetch";

const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function HeroDailyBudgetReadout({
  clientId,
  eventCode,
  requiredPerDay,
}: {
  clientId: string;
  eventCode: string;
  requiredPerDay: number | null;
}) {
  const [detail, setDetail] = useState<DailyBudgetUpdateDetail | null>(() =>
    getDailyBudgetUpdate(clientId, eventCode),
  );

  useEffect(() => {
    function onUpdate(e: Event) {
      const d = (e as CustomEvent<DailyBudgetUpdateDetail>).detail;
      if (d.clientId === clientId && d.eventCode === eventCode) setDetail(d);
    }
    window.addEventListener(DAILY_BUDGET_UPDATED_EVENT, onUpdate);
    return () =>
      window.removeEventListener(DAILY_BUDGET_UPDATED_EVENT, onUpdate);
  }, [clientId, eventCode]);

  const dailyBudget = detail?.dailyBudget ?? null;
  const room =
    dailyBudget != null && requiredPerDay != null
      ? dailyBudget - requiredPerDay
      : null;

  return (
    <dl className="mt-1.5 space-y-0.5 text-xs tabular-nums">
      <GapRow
        label="Budget"
        value={
          detail == null
            ? "—"
            : dailyBudget == null
              ? "No active spend"
              : `${GBP0.format(Math.round(dailyBudget))}/day`
        }
      />
      <GapRow
        label="Required"
        value={
          requiredPerDay == null
            ? "—"
            : `${GBP0.format(Math.round(requiredPerDay))}/day`
        }
      />
      <GapRow
        label="Room"
        value={
          room == null
            ? "—"
            : `${room >= 0 ? "+" : "−"}${GBP0.format(Math.abs(Math.round(room)))}/day`
        }
        valueClassName={
          room == null
            ? "text-muted-foreground"
            : room >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
        }
      />
    </dl>
  );
}

function GapRow({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`font-medium ${valueClassName}`}>{value}</dd>
    </div>
  );
}
