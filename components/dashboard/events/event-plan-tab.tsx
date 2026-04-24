"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { EventPlanCreateCta } from "@/components/dashboard/events/event-plan-create-cta";
import { PlanActualsTable } from "@/components/dashboard/events/plan-actuals-table";
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
import { updateEventRow, type EventRow } from "@/lib/db/events";
import type { EventKeyMoment } from "@/lib/db/event-key-moments";
import { computeSmartSpread } from "@/lib/dashboard/pacing";
import {
  OBJECTIVE_KEYS,
  type ObjectiveBudgets,
} from "@/lib/dashboard/objectives";

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
  initialKeyMoments = [],
}: {
  event: EventRow;
  plan: AdPlan | null;
  initialDays: AdPlanDay[];
  /**
   * Server-prefetched moments for this event (countdown phases + manual
   * lineup/press rows). Read-only here — passed straight through to the
   * grid for inline overlay in the Day column. Empty when the moments
   * table doesn't exist yet (pre-migration-008 environments).
   */
  initialKeyMoments?: EventKeyMoment[];
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
  const [actuals, setActuals] = useState<ActualsState>({ kind: "loading" });
  const gridRef = useRef<PlanGridHandle>(null);
  const router = useRouter();

  // Local-tz YYYY-MM-DD frozen at mount. Same idiom PlanStatCards uses
  // — we don't need a live ticker for date crossover; component
  // re-renders on day-data changes anyway, and the value is shared
  // with PlanActualsTable so both components agree on "today" within
  // a single render pass.
  const todayIso = useMemo(
    () => new Date().toLocaleDateString("en-CA"),
    [],
  );

  // Lazy per-day Meta spend. Window = plan.start_date → min(end_date,
  // todayIso) — Meta's API rejects future `until` dates, and there's
  // no point asking about days that haven't happened. The fetch keys
  // on (eventId, plan.start_date, capped end) so a header re-sync that
  // shifts the plan window also re-fetches actuals.
  const actualSince = plan?.start_date ?? null;
  const actualUntil =
    plan != null ? minIso(plan.end_date, todayIso) : null;
  // Plan starts in the future → no actuals possible yet; surface an
  // empty "ok" payload so the table renders planned/zero/delta without
  // a Loading badge that never resolves.
  const futurePlan =
    actualSince != null &&
    actualUntil != null &&
    actualSince > actualUntil;

  // Reset the actuals state in render whenever the fetch key changes
  // (React 19 "adjust state when props change" idiom). Using useEffect
  // for this would trigger react-hooks/set-state-in-effect because the
  // setState fires synchronously on every key change. The async fetch
  // itself stays in useEffect below.
  const fetchKey = `${event.id}:${actualSince ?? ""}:${actualUntil ?? ""}:${
    futurePlan ? "future" : "live"
  }`;
  const [trackedKey, setTrackedKey] = useState<string>(fetchKey);
  if (trackedKey !== fetchKey) {
    setTrackedKey(fetchKey);
    setActuals(
      futurePlan
        ? { kind: "ok", actualByDay: new Map() }
        : { kind: "loading" },
    );
  }

  useEffect(() => {
    if (!plan || !actualSince || !actualUntil || futurePlan) return;
    let cancelled = false;
    const url = `/api/insights/event/${encodeURIComponent(event.id)}/spend-by-day?since=${actualSince}&until=${actualUntil}`;
    fetch(url, { method: "GET", cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as
          | { ok: true; days: { day: string; spend: number }[] }
          | { ok: false; error: { reason: string; message: string } }
          | { error: string };
        if (cancelled) return;
        if ("ok" in json && json.ok) {
          const map = new Map<string, number>();
          for (const row of json.days) map.set(row.day, row.spend);
          setActuals({ kind: "ok", actualByDay: map });
          return;
        }
        if ("ok" in json && !json.ok) {
          setActuals({
            kind: "error",
            reason: json.error.reason,
            message: json.error.message,
          });
          return;
        }
        setActuals({
          kind: "error",
          reason: "meta_api_error",
          message: ("error" in json && json.error) || "Unknown error",
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setActuals({
          kind: "error",
          reason: "meta_api_error",
          message: err instanceof Error ? err.message : "Network error",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [event.id, plan, actualSince, actualUntil, futurePlan]);

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

  const handleEventMarketingBudgetPatch = useCallback(
    async (patch: { total_marketing_budget: number | null }) => {
      setError(null);
      try {
        await updateEventRow(event.id, patch);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update event.",
        );
      }
    },
    [event.id, router],
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

    const { perDay, appliedCount } = computeSmartSpread({
      days,
      event,
      totalBudget: plan.total_budget,
    });

    // Smart spread is overwrite-and-rebalance across ALL channels: the
    // pacing engine only models Traffic + Conversion, but plans ingested
    // from external sources (e.g. the Junction 2 Bridge sheets) carry
    // values in Reach / Post engagement / TikTok / Google too. Leaving
    // those intact would silently double-count budget against the
    // pacing-engine values we're writing. Strip every objective key
    // first, then layer the new (traffic, conversion) split on top.
    // Zero values are dropped to keep the persisted map sparse —
    // mirrors writeObjectiveBudget's deletion semantics.
    const patches: AdPlanDayBulkPatch[] = [];
    for (const d of days) {
      const share = perDay.get(d.day);
      if (!share) continue;
      const merged: ObjectiveBudgets = { ...(d.objective_budgets ?? {}) };
      for (const k of OBJECTIVE_KEYS) delete merged[k];
      if (share.traffic > 0) merged.traffic = share.traffic;
      if (share.conversion > 0) merged.conversion = share.conversion;
      patches.push({ id: d.id, objective_budgets: merged });
    }

    try {
      const saved = await bulkUpdatePlanDays(patches);
      setDays((prev) => {
        const byId = new Map(saved.map((r) => [r.id, r]));
        return prev.map((d) => byId.get(d.id) ?? d);
      });
      setInfo(
        `Smart spread applied to ${appliedCount} day${
          appliedCount === 1 ? "" : "s"
        }. All objective budgets replaced with Traffic + Conversion.`,
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
        `Applied £${perDay.toLocaleString("en-GB", {
          maximumFractionDigits: 2,
        })}/day × ${days.length} day${
          days.length === 1 ? "" : "s"
        } to Conversion. All other objectives cleared.`,
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
        eventTotalMarketingBudget={event.total_marketing_budget ?? null}
        onApplyEvenSpread={handleApplyEvenSpread}
        onApplySmartSpread={handleApplySmartSpread}
        onResync={handleResync}
        onPatch={handlePlanPatch}
        onPatchEvent={handleEventMarketingBudgetPatch}
      />

      <PlanStatCards plan={plan} days={days} />

      <PlanDailyGrid
        ref={gridRef}
        plan={plan}
        days={days}
        keyMoments={initialKeyMoments}
        onDaySaved={handleDaySaved}
        onError={setError}
        saveDay={saveDay}
        saveDaysBulk={saveDaysBulk}
      />

      <PlanActualsTable
        plan={plan}
        days={days}
        todayIso={todayIso}
        status={actuals}
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
 * Discriminated state for the lazy spend-by-day fetch. Mirrors the
 * shape PlanActualsTable consumes; "loading" is the initial state +
 * the in-flight state on every re-fetch, "ok" carries the per-day
 * map, "error" carries the typed reason so the table can render the
 * graceful-fail badge.
 */
type ActualsState =
  | { kind: "loading" }
  | { kind: "error"; reason: string; message: string }
  | { kind: "ok"; actualByDay: Map<string, number> };

/** YYYY-MM-DD lexicographic min — both inputs are date-only ISO strings. */
function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * Build patches that distribute `total` evenly across `days`:
 *   - Writes Conversion = perDay (last day absorbs rounding drift).
 *   - CLEARS every other objective key (Traffic, Reach, Post eng.,
 *     TikTok, Google). Without this, ingested plans that carry channel
 *     spend in any of those buckets would silently double-count budget
 *     against the Conversion value we're writing. We loop over the
 *     canonical OBJECTIVE_KEYS list so a future channel addition stays
 *     covered automatically.
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

  return days.map((d, i) => {
    const merged: ObjectiveBudgets = { ...(d.objective_budgets ?? {}) };
    for (const k of OBJECTIVE_KEYS) delete merged[k];
    merged.conversion = i === N - 1 ? lastDay : perDay;
    return { id: d.id, objective_budgets: merged };
  });
}
