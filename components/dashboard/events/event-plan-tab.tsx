"use client";

import { useCallback, useState } from "react";
import { Users } from "lucide-react";
import { EventPlanCreateCta } from "@/components/dashboard/events/event-plan-create-cta";
import { PlanHeader } from "@/components/dashboard/events/plan-header";
import { PlanDailyGrid } from "@/components/dashboard/events/plan-daily-grid";
import {
  bulkUpdatePlanDays,
  updatePlanDay,
  type AdPlan,
  type AdPlanDay,
  type AdPlanDayBulkPatch,
  type AdPlanDayPatch,
} from "@/lib/db/ad-plans";
import type { EventRow } from "@/lib/db/events";

/**
 * Plan tab orchestrator. The parent server component prefetches the plan
 * + days; this component branches:
 *  - no plan → render EventPlanCreateCta
 *  - has plan → header + daily grid + audiences stub
 *
 * Owns the local mirror of `days` so optimistic edits + saves keep the
 * grid responsive without router.refresh() round-trips. The grid calls
 * back via onDaySaved when a save resolves so this mirror is the
 * authoritative client state until the next props refresh.
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

  const handleDaySaved = useCallback((saved: AdPlanDay) => {
    setDays((prev) => {
      const next = prev.slice();
      const idx = next.findIndex((d) => d.id === saved.id);
      if (idx >= 0) next[idx] = saved;
      return next;
    });
  }, []);

  const saveDay = useCallback(
    async (dayId: string, patch: AdPlanDayPatch) => {
      const saved = await updatePlanDay(dayId, patch);
      return saved;
    },
    [],
  );

  const saveDaysBulk = useCallback(async (patches: AdPlanDayBulkPatch[]) => {
    const saved = await bulkUpdatePlanDays(patches);
    return saved;
  }, []);

  if (!plan) {
    return <EventPlanCreateCta event={event} />;
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-destructive/70 hover:text-destructive"
          >
            Dismiss
          </button>
        </div>
      )}

      <PlanHeader plan={plan} />

      <PlanDailyGrid
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
