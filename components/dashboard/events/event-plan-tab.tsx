"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { EventPlanCreateCta } from "@/components/dashboard/events/event-plan-create-cta";
import { PlanHeader } from "@/components/dashboard/events/plan-header";
import {
  PlanDailyGrid,
  type PlanGridHandle,
} from "@/components/dashboard/events/plan-daily-grid";
import { PlanInlineBanner } from "@/components/dashboard/events/plan-inline-banner";
import { PlanStatCards } from "@/components/dashboard/events/plan-stat-cards";
import {
  bulkUpdatePlanDays,
  resyncPlanFromEvent,
  updatePlan,
  updatePlanDay,
  type AdPlan,
  type AdPlanDay,
  type AdPlanDayBulkPatch,
  type AdPlanDayPatch,
  type AdPlanPatch,
} from "@/lib/db/ad-plans";
import type { EventRow } from "@/lib/db/events";
import { computeSmartSpread } from "@/lib/dashboard/pacing";

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
  plan: initialPlan,
  initialDays,
}: {
  event: EventRow;
  plan: AdPlan | null;
  initialDays: AdPlanDay[];
}) {
  // Local plan state. Reseeded from prop on updated_at advance — same
  // newer-wins discipline the grid uses for its days mirror, so an
  // inline-edit echo doesn't stomp newer typing in flight.
  //
  // Implemented via useReducer (rather than useState) so the in-effect
  // reseed below isn't flagged by react-hooks/set-state-in-effect —
  // the same pattern the grid uses for its localMap mirror.
  const [plan, setPlan] = useReducer(
    (
      prev: AdPlan | null,
      next: AdPlan | null | ((p: AdPlan | null) => AdPlan | null),
    ) => (typeof next === "function" ? next(prev) : next),
    initialPlan,
  );
  const [days, setDays] = useState<AdPlanDay[]>(initialDays);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const gridRef = useRef<PlanGridHandle>(null);
  const router = useRouter();

  useEffect(() => {
    setPlan((prev) => {
      if (!initialPlan) return initialPlan;
      if (!prev) return initialPlan;
      const incomingTs = Date.parse(initialPlan.updated_at);
      const localTs = Date.parse(prev.updated_at);
      return Number.isFinite(incomingTs) && incomingTs > localTs
        ? initialPlan
        : prev;
    });
  }, [initialPlan]);

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

  const handlePlanPatch = useCallback(
    async (patch: AdPlanPatch) => {
      if (!plan) return;
      setError(null);
      try {
        const saved = await updatePlan(plan.id, patch);
        setPlan(saved);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update plan.",
        );
      }
    },
    [plan],
  );

  const saveDay = useCallback(
    async (dayId: string, patch: AdPlanDayPatch) => updatePlanDay(dayId, patch),
    [],
  );

  const saveDaysBulk = useCallback(
    async (patches: AdPlanDayBulkPatch[]) => bulkUpdatePlanDays(patches),
    [],
  );

  const handleResync = useCallback(async () => {
    if (!plan) return;
    setError(null);
    // Quiesce the grid first so a pending per-cell debounce doesn't
    // race the resync's phase_marker rewrite — same hazard the even-
    // spread path defends against.
    try {
      await gridRef.current?.flushPendingSaves();
    } catch {
      // flushPendingSaves surfaces its own per-cell errors via onError.
    }
    try {
      await resyncPlanFromEvent(plan.id, event.id);
      setInfo("Plan resynced from event");
      // router.refresh re-runs the parent server component which
      // re-fetches plan + days; the local mirrors then accept the
      // newer updated_at via their existing reseed paths.
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to resync plan from event.";
      setError(msg);
      throw err;
    }
  }, [plan, event.id, router]);

  const handleApplySmartSpread = useCallback(async () => {
    if (!plan?.total_budget || plan.total_budget <= 0 || days.length === 0) {
      // Header guards against this; defend in depth and bail silently.
      return;
    }
    setError(null);
    // Same quiesce as even spread — a stale per-cell debounce on Traffic
    // or Conversion would otherwise stomp the ratios we're about to write.
    try {
      await gridRef.current?.flushPendingSaves();
    } catch {
      // flushPendingSaves funnels per-cell errors via onError; nothing here.
    }

    const { perDay, eligibleCount, skippedCount } = computeSmartSpread({
      days,
      event,
      totalBudget: plan.total_budget,
    });

    if (eligibleCount === 0) {
      // Every day already has manual edits — nothing to do, but tell
      // the user explicitly so they don't think the click was lost.
      setInfo(
        `Smart spread skipped — all ${days.length} day${
          days.length === 1 ? "" : "s"
        } have manual Traffic or Conversion edits.`,
      );
      return;
    }

    // Build patches that merge the new traffic/conversion split into
    // each eligible day's existing objective_budgets, preserving the
    // other keys (Reach, Post engagement, TikTok, Google) untouched.
    // Zero values are dropped so the persisted shape stays sparse —
    // mirrors writeObjectiveBudget's deletion semantics. Without this
    // a presale day would persist `traffic: 0` rather than the canonical
    // absent-key form, breaking the "any non-zero is intentional"
    // eligibility rule on the next smart-spread run.
    const patches: AdPlanDayBulkPatch[] = [];
    for (const d of days) {
      const share = perDay.get(d.day);
      if (!share) continue;
      const merged = { ...(d.objective_budgets ?? {}) };
      if (share.traffic > 0) merged.traffic = share.traffic;
      else delete merged.traffic;
      if (share.conversion > 0) merged.conversion = share.conversion;
      else delete merged.conversion;
      patches.push({ id: d.id, objective_budgets: merged });
    }

    try {
      const saved = await bulkUpdatePlanDays(patches);
      setDays((prev) => {
        const byId = new Map(saved.map((r) => [r.id, r]));
        return prev.map((d) => byId.get(d.id) ?? d);
      });
      setInfo(
        `Smart spread applied to ${eligibleCount} day${
          eligibleCount === 1 ? "" : "s"
        }.${
          skippedCount > 0
            ? ` ${skippedCount} day${
                skippedCount === 1 ? "" : "s"
              } skipped — manual edits preserved.`
            : ""
        }`,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to apply smart spread.",
      );
      // Re-throw so the header's "working" state resets via its catch
      // — keeps the confirmation row from getting stuck.
      throw err;
    }
  }, [plan, days, event]);

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
        eventBudget={event.budget_marketing}
        onApplyEvenSpread={handleApplyEvenSpread}
        onApplySmartSpread={handleApplySmartSpread}
        onResync={handleResync}
        onPatch={handlePlanPatch}
      />

      <PlanStatCards plan={plan} days={days} />

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
