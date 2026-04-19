"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { EventPlanCreateCta } from "@/components/dashboard/events/event-plan-create-cta";
import { PlanHeader } from "@/components/dashboard/events/plan-header";
import {
  PlanDailyGrid,
  type PlanGridHandle,
} from "@/components/dashboard/events/plan-daily-grid";
import { PlanInlineBanner } from "@/components/dashboard/events/plan-inline-banner";
import {
  bulkUpdatePlanDays,
  updatePlanDay,
  type AdPlan,
  type AdPlanDay,
  type AdPlanDayBulkPatch,
  type AdPlanDayPatch,
} from "@/lib/db/ad-plans";
import type { EventRow } from "@/lib/db/events";

const INFO_AUTO_DISMISS_MS = 4000;

/**
 * Plan tab orchestrator. The parent server component prefetches the plan
 * + days; this component branches:
 *  - no plan → render EventPlanCreateCta
 *  - has plan → header + daily grid + audiences stub
 *
 * Owns:
 *  - the local mirror of `days` (kept in sync with the grid via the
 *    grid's updated_at-aware re-seed)
 *  - the imperative ref to the grid for parent-level bulk actions that
 *    need to flush per-cell debounces first (e.g. Even spread)
 *  - the inline banner state for both error + info paths
 */
export function EventPlanTab({
  event,
  plan,
  initialDays,
}: {
  event: EventRow;
  plan: AdPlan | null;
  initialDays: AdPlanDay[];
}) {
  const [days, setDays] = useState<AdPlanDay[]>(initialDays);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const gridRef = useRef<PlanGridHandle>(null);

  // Auto-dismiss success banner. Cleared if the user dismisses manually
  // or if a fresh info message replaces it before the timer fires.
  useEffect(() => {
    if (!info) return;
    const t = setTimeout(() => setInfo(null), INFO_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [info]);

  const handleDaySaved = useCallback((saved: AdPlanDay) => {
    setDays((prev) => {
      const next = prev.slice();
      const idx = next.findIndex((d) => d.id === saved.id);
      if (idx >= 0) next[idx] = saved;
      return next;
    });
  }, []);

  const saveDay = useCallback(
    async (dayId: string, patch: AdPlanDayPatch) => updatePlanDay(dayId, patch),
    [],
  );

  const saveDaysBulk = useCallback(
    async (patches: AdPlanDayBulkPatch[]) => bulkUpdatePlanDays(patches),
    [],
  );

  const handleApplyEvenSpread = useCallback(async () => {
    if (!plan?.total_budget || plan.total_budget <= 0 || days.length === 0) {
      // The header guards against this but defend in depth — bail silently.
      return;
    }
    setError(null);
    // Quiesce the grid first: any pending per-cell debounce or in-flight
    // bulk must settle before we fire ours, otherwise a 300ms-stale save
    // could overwrite the conversion column we're about to set.
    try {
      await gridRef.current?.flushPendingSaves();
    } catch {
      // flushPendingSaves catches its own per-cell save errors and
      // funnels them to onError; nothing to do here.
    }

    const total = plan.total_budget;
    const patches = buildEvenSpreadPatches(days, total);
    const perDay = patches[0]?.objective_budgets?.conversion ?? 0;

    try {
      const saved = await bulkUpdatePlanDays(patches);
      // Replace local rows with persisted ones so the grid's
      // updated_at-wins sync picks them up on the next render.
      setDays((prev) => {
        const byId = new Map(saved.map((r) => [r.id, r]));
        return prev.map((d) => byId.get(d.id) ?? d);
      });
      setInfo(
        `Applied £${perDay.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })}/day × ${days.length} day${days.length === 1 ? "" : "s"} to Conversion.`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to apply even spread.",
      );
      // Re-throw so the header's local "working" state resets via its
      // catch — keeps the confirmation row from getting stuck.
      throw err;
    }
  }, [plan, days]);

  if (!plan) {
    return <EventPlanCreateCta event={event} />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <PlanInlineBanner variant="error" onDismiss={() => setError(null)}>
          {error}
        </PlanInlineBanner>
      )}

      {info && (
        <PlanInlineBanner variant="info" onDismiss={() => setInfo(null)}>
          {info}
        </PlanInlineBanner>
      )}

      <PlanHeader
        plan={plan}
        daysCount={days.length}
        onApplyEvenSpread={handleApplyEvenSpread}
      />

      <PlanDailyGrid
        ref={gridRef}
        plan={plan}
        days={days}
        onDaySaved={handleDaySaved}
        onError={setError}
        saveDay={saveDay}
        saveDaysBulk={saveDaysBulk}
      />

      <section className="rounded-md border border-dashed border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Users className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="font-heading text-base tracking-wide">
              Audiences coming soon
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Per-objective audience rows (geo, age, placements, budget)
              will live here in the next slice. Schema is already in
              place — UI is wiring only.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * Build patches that distribute `total` evenly across `days` and write
 * the result into the conversion key of each day's objective_budgets,
 * preserving every other key already there (Traffic, Reach, TikTok…).
 *
 * Pennies lost to rounding accumulate on the LAST day so the column
 * sum equals `total` exactly:
 *   perDay = round(total / N, 2dp)
 *   lastDay = round(total - perDay × (N - 1), 2dp)
 */
function buildEvenSpreadPatches(
  days: AdPlanDay[],
  total: number,
): AdPlanDayBulkPatch[] {
  const N = days.length;
  if (N === 0) return [];
  const perDay = Math.round((total / N) * 100) / 100;
  const lastDay = Math.round((total - perDay * (N - 1)) * 100) / 100;

  return days.map((d, i) => ({
    id: d.id,
    objective_budgets: {
      ...(d.objective_budgets ?? {}),
      conversion: i === N - 1 ? lastDay : perDay,
    },
  }));
}
