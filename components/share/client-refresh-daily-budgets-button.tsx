"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import {
  extractErrorMessage,
  isSyncSuccessful,
  runWithConcurrency,
  safeJson,
  type SyncResponseBody,
} from "@/lib/dashboard/sync-button-helpers";

export const DAILY_BUDGET_UPDATED_EVENT = "venue-daily-budget:updated";

export interface DailyBudgetUpdateDetail {
  clientId: string;
  eventCode: string;
  dailyBudget: number | null;
  label: "daily" | "effective_daily";
  reason: string | null;
  reasonLabel: string | null;
}

interface Props {
  clientId: string;
  eventCodes: string[];
  /** Event UUIDs — when present and not using a public share token, rollup-sync runs after budgets refresh. */
  eventIds?: string[];
  /** Public client token when rendered on /share/client/[token]. */
  shareToken?: string;
}

const NO_EVENT_IDS: readonly string[] = [];

type Phase = "budget" | "rollup";

type Status =
  | { kind: "idle" }
  | {
      kind: "pending";
      phase: Phase;
      completed: number;
      total: number;
    }
  | {
      kind: "done";
      totalVenues: number;
      withBudget: number;
      noActiveAdsets: number;
      noBudgetOther: number;
      budgetFailed: number;
      rollupOk: number;
      rollupFailed: number;
    };

const CONCURRENCY = 3;
const dailyBudgetUpdates = new Map<string, DailyBudgetUpdateDetail>();

function updateKey(clientId: string, eventCode: string): string {
  return `${clientId}::${eventCode}`;
}

export function getDailyBudgetUpdate(
  clientId: string,
  eventCode: string,
): DailyBudgetUpdateDetail | null {
  return dailyBudgetUpdates.get(updateKey(clientId, eventCode)) ?? null;
}

export function ClientRefreshDailyBudgetsButton({
  clientId,
  eventCodes,
  eventIds: eventIdsProp,
  shareToken = "",
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const eventIds = eventIdsProp ?? NO_EVENT_IDS;

  const venues = useMemo(
    () => Array.from(new Set(eventCodes.filter(Boolean))).sort(),
    [eventCodes],
  );
  const venueTotal = venues.length;

  const rollupIds = useMemo(() => {
    if (shareToken) return [];
    const ids = [...eventIds].filter(Boolean);
    return Array.from(new Set(ids));
  }, [eventIds, shareToken]);

  const runRollupPhase = rollupIds.length > 0;

  const refresh = useCallback(async () => {
    if (status.kind === "pending" || venueTotal === 0) return;

    setStatus({
      kind: "pending",
      phase: "budget",
      completed: 0,
      total: venueTotal,
    });

    const budgetResults = await runWithConcurrency(
      venues,
      CONCURRENCY,
      async (eventCode) => {
        let dispatched = false;
        try {
          const qs = new URLSearchParams();
          if (shareToken) qs.set("client_token", shareToken);
          const res = await fetch(
            `/api/clients/${encodeURIComponent(clientId)}/venues/${encodeURIComponent(eventCode)}/daily-budget${
              qs.size > 0 ? `?${qs.toString()}` : ""
            }`,
            { cache: "no-store" },
          );
          const json = (await res.json()) as {
            dailyBudget?: number | null;
            label?: "daily" | "effective_daily";
            reason?: string | null;
            reasonLabel?: string | null;
            error?: string;
          };
          const reason =
            json.reasonLabel ?? json.error ?? "Daily budget unavailable";
          const detail: DailyBudgetUpdateDetail = {
            clientId,
            eventCode,
            dailyBudget: json.dailyBudget ?? null,
            label: json.label ?? "daily",
            reason: json.reason ?? (res.ok ? null : "fetch_error"),
            reasonLabel: reason,
          };
          dispatchDailyBudgetUpdate(detail);
          dispatched = true;
          if (!res.ok) throw new Error(reason);
          return detail;
        } catch (err) {
          const reason =
            err instanceof Error ? err.message : "Daily budget unavailable";
          if (!dispatched) {
            dispatchDailyBudgetUpdate({
              clientId,
              eventCode,
              dailyBudget: null,
              label: "daily",
              reason: "fetch_error",
              reasonLabel: reason,
            });
          }
          throw err;
        }
      },
      (completed, totalSoFar) => {
        setStatus({
          kind: "pending",
          phase: "budget",
          completed,
          total: totalSoFar,
        });
      },
    );

    let withBudget = 0;
    let noActiveAdsets = 0;
    let noBudgetOther = 0;
    let budgetFailed = 0;
    for (const result of budgetResults) {
      if (result.status === "rejected") {
        budgetFailed += 1;
        continue;
      }
      if (result.value.dailyBudget != null) {
        withBudget += 1;
      } else if (result.value.reason === "no_active_adsets") {
        noActiveAdsets += 1;
      } else if (result.value.reason === "fetch_error") {
        budgetFailed += 1;
      } else {
        noBudgetOther += 1;
      }
    }

    let rollupOk = 0;
    let rollupFailed = 0;

    if (runRollupPhase) {
      setStatus({
        kind: "pending",
        phase: "rollup",
        completed: 0,
        total: rollupIds.length,
      });

      const rollupResults = await runWithConcurrency(
        rollupIds,
        CONCURRENCY,
        async (eventId) => {
          const url = `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(eventId)}`;
          const r = await fetch(url, { method: "POST" });
          let body: SyncResponseBody;
          try {
            body = await safeJson<SyncResponseBody>(r);
          } catch (parseErr) {
            const message =
              parseErr instanceof Error ? parseErr.message : String(parseErr);
            throw new Error(message);
          }
          if (!r.ok && r.status !== 207) {
            throw new Error(extractErrorMessage(body) + ` (HTTP ${r.status})`);
          }
          if (!isSyncSuccessful(body)) {
            throw new Error(extractErrorMessage(body));
          }
          return body;
        },
        (completed, totalSoFar) => {
          setStatus({
            kind: "pending",
            phase: "rollup",
            completed,
            total: totalSoFar,
          });
        },
      );

      rollupOk = rollupResults.filter((r) => r.status === "fulfilled").length;
      rollupFailed = rollupIds.length - rollupOk;
    }

    setStatus({
      kind: "done",
      totalVenues: venueTotal,
      withBudget,
      noActiveAdsets,
      noBudgetOther,
      budgetFailed,
      rollupOk,
      rollupFailed,
    });

    if (withBudget > 0 || rollupOk > 0) router.refresh();
  }, [
    clientId,
    rollupIds,
    runRollupPhase,
    router,
    shareToken,
    status.kind,
    venueTotal,
    venues,
  ]);

  const disabled = status.kind === "pending" || venueTotal === 0;

  const pendingLabel =
    status.kind === "pending"
      ? status.phase === "budget"
        ? `Refreshing ${status.completed} of ${status.total} budgets`
        : `Syncing spend ${status.completed} of ${status.total}`
      : null;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={disabled}
        aria-busy={status.kind === "pending"}
        className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        title={
          venueTotal === 0
            ? "No venues to refresh"
            : runRollupPhase
              ? `Refresh ${venueTotal} venue daily budgets then rollup (${CONCURRENCY} concurrent each step)`
              : `Refresh ${venueTotal} venue daily budgets, ${CONCURRENCY} at a time`
        }
      >
        {status.kind === "pending" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {pendingLabel}...
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Refresh daily budgets
          </>
        )}
      </button>
      {status.kind === "done" ? (
        <span
          className={`text-[11px] ${
            status.budgetFailed === 0 &&
            status.noBudgetOther === 0 &&
            status.rollupFailed === 0
              ? "text-emerald-600"
              : "text-amber-600"
          }`}
        >
          {runRollupPhase ? (
            <>
              Refreshed {status.totalVenues} daily budgets · spend + ticketing
              synced ({status.rollupOk}/{rollupIds.length} rollups)
            </>
          ) : (
            <>Refreshed {status.totalVenues} daily budgets</>
          )}
          {status.noActiveAdsets > 0
            ? ` · ${status.noActiveAdsets} had no active ad sets`
            : ""}
          {status.noBudgetOther > 0
            ? ` · ${status.noBudgetOther} no matching budget`
            : ""}
          {status.budgetFailed > 0 ? ` · ${status.budgetFailed} budget failed` : ""}
          {runRollupPhase && status.rollupFailed > 0
            ? ` · ${status.rollupFailed} rollup failed`
            : ""}
        </span>
      ) : null}
    </div>
  );
}

function dispatchDailyBudgetUpdate(detail: DailyBudgetUpdateDetail) {
  dailyBudgetUpdates.set(updateKey(detail.clientId, detail.eventCode), detail);
  window.dispatchEvent(
    new CustomEvent<DailyBudgetUpdateDetail>(DAILY_BUDGET_UPDATED_EVENT, {
      detail,
    }),
  );
}
