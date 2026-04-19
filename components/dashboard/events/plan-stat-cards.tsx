"use client";

import { useMemo } from "react";
import { fmtCurrency } from "@/lib/dashboard/format";
import {
  OBJECTIVE_KEYS,
  readObjectiveBudget,
} from "@/lib/dashboard/objectives";
import type { AdPlan, AdPlanDay } from "@/lib/db/ad-plans";

/**
 * Five-card summary strip rendered between the plan header and the
 * daily grid.
 *
 * Client-only because "Today's daily spend" depends on the user's local
 * calendar day, not the Vercel function's UTC clock — around midnight
 * UK time (esp. during BST) a server-rendered today would drift by a
 * day and falsely report "Today outside plan". `toLocaleDateString("en-CA")`
 * is the idiomatic way to extract a tz-naive YYYY-MM-DD string.
 */
export function PlanStatCards({
  plan,
  days,
}: {
  plan: AdPlan;
  days: AdPlanDay[];
}) {
  // Local-tz YYYY-MM-DD, frozen at mount. The cards re-render naturally
  // on day-data changes; we don't need a live ticker for date crossover.
  const todayIso = useMemo(
    () => new Date().toLocaleDateString("en-CA"),
    [],
  );

  const dayCount = days.length;
  // "Plan allocated" = sum of every objective budget across every day +
  // any pre-plan spend (`legacy_spend`) declared on the plan header.
  // Legacy spend is money that has ALREADY been paid out toward the
  // event's marketing budget (e.g. a series teaser before the per-event
  // plan was authored), so it MUST count against budget remaining the
  // same way a daily allocation does. Null legacy_spend reads as 0.
  const dailyAllocated = useMemo(() => sumDailySpends(days), [days]);
  const legacySpend = plan.legacy_spend ?? 0;
  const planAllocated = dailyAllocated + legacySpend;

  const todayRow = useMemo(
    () => days.find((d) => d.day === todayIso) ?? null,
    [days, todayIso],
  );
  const todayDailySpend = todayRow ? sumObjectiveBudgets(todayRow) : null;

  const hasTotal = plan.total_budget != null;
  const avgDaily =
    hasTotal && dayCount > 0
      ? (plan.total_budget as number) / dayCount
      : null;
  const remaining = hasTotal
    ? (plan.total_budget as number) - planAllocated
    : null;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Campaign length"
        value={`${dayCount} day${dayCount === 1 ? "" : "s"}`}
      />
      <StatCard
        label="Avg daily budget"
        value={avgDaily != null ? fmtCurrency(avgDaily) : "—"}
      />
      <StatCard
        label="Plan allocated"
        value={
          dayCount > 0 || legacySpend > 0 ? fmtCurrency(planAllocated) : "—"
        }
        subLabel={
          legacySpend > 0
            ? `incl. pre-plan spend ${fmtCurrency(legacySpend)}`
            : undefined
        }
      />
      <StatCard
        label="Today's daily spend"
        value={todayRow ? fmtCurrency(todayDailySpend ?? 0) : "—"}
        subLabel={todayRow ? undefined : "Today outside plan"}
      />
      <StatCard
        label="Budget remaining"
        value={remaining != null ? fmtCurrency(remaining) : "—"}
        // Highlight overspend in destructive colour. Underspend stays
        // foreground — no badge, no "OVER BUDGET" tag for v1.
        valueClassName={
          remaining != null && remaining < 0 ? "text-destructive" : undefined
        }
      />
    </section>
  );
}

function StatCard({
  label,
  value,
  subLabel,
  valueClassName,
}: {
  label: string;
  value: string;
  subLabel?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold text-foreground ${valueClassName ?? ""}`.trim()}
      >
        {value}
      </p>
      {subLabel && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{subLabel}</p>
      )}
    </div>
  );
}

/** Sum every objective bucket on a single day. Mirrors the grid's Daily spend column. */
function sumObjectiveBudgets(day: AdPlanDay): number {
  let total = 0;
  for (const key of OBJECTIVE_KEYS) {
    total += readObjectiveBudget(day.objective_budgets, key);
  }
  return total;
}

function sumDailySpends(days: AdPlanDay[]): number {
  let total = 0;
  for (const d of days) total += sumObjectiveBudgets(d);
  return total;
}
