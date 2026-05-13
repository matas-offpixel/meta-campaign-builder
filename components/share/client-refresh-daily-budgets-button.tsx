"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { runWithConcurrency } from "@/lib/dashboard/sync-button-helpers";
import {
  DAILY_BUDGET_UPDATED_EVENT,
  type DailyBudgetUpdateDetail,
  dispatchDailyBudgetUpdate,
  fetchVenueDailyBudgetDetail,
  getDailyBudgetUpdate,
} from "@/lib/share/venue-daily-budget-fetch";

export {
  DAILY_BUDGET_UPDATED_EVENT,
  dispatchDailyBudgetUpdate,
  fetchVenueDailyBudgetDetail,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
};

interface Props {
  clientId: string;
  eventCodes: string[];
  /** Public client token when rendered on /share/client/[token]. */
  shareToken?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "pending"; completed: number; total: number }
  | {
      kind: "done";
      total: number;
      withBudget: number;
      noActiveAdsets: number;
      noBudgetOther: number;
      failed: number;
      /** First failure reason label — shown inline so the operator can act. */
      firstFailureReason: string | null;
    };

const CONCURRENCY = 3;

export function ClientRefreshDailyBudgetsButton({
  clientId,
  eventCodes,
  shareToken = "",
}: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const venues = useMemo(
    () => Array.from(new Set(eventCodes.filter(Boolean))).sort(),
    [eventCodes],
  );
  const total = venues.length;

  const refresh = useCallback(async () => {
    if (status.kind === "pending" || total === 0) return;
    setStatus({ kind: "pending", completed: 0, total });

    const results = await runWithConcurrency(
      venues,
      CONCURRENCY,
      (eventCode) =>
        fetchVenueDailyBudgetDetail({ clientId, eventCode, shareToken }),
      (completed, totalSoFar) => {
        setStatus({ kind: "pending", completed, total: totalSoFar });
      },
    );

    let withBudget = 0;
    let noActiveAdsets = 0;
    let noBudgetOther = 0;
    let failed = 0;
    let firstFailureReason: string | null = null;
    for (const result of results) {
      if (result.status === "rejected") {
        failed += 1;
        if (!firstFailureReason) {
          firstFailureReason =
            result.reason instanceof Error
              ? result.reason.message
              : "Unknown error";
        }
        continue;
      }
      if (result.value.dailyBudget != null) {
        withBudget += 1;
      } else if (result.value.reason === "no_active_adsets") {
        noActiveAdsets += 1;
      } else if (result.value.reason === "fetch_error") {
        failed += 1;
        if (!firstFailureReason) {
          firstFailureReason = result.value.reasonLabel ?? "Fetch error";
        }
      } else {
        noBudgetOther += 1;
      }
    }
    setStatus({
      kind: "done",
      total,
      withBudget,
      noActiveAdsets,
      noBudgetOther,
      failed,
      firstFailureReason,
    });
  }, [clientId, shareToken, status.kind, total, venues]);

  const disabled = status.kind === "pending" || total === 0;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={refresh}
        disabled={disabled}
        aria-busy={status.kind === "pending"}
        className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        title={
          total === 0
            ? "No venues to refresh"
            : `Refresh ${total} venue daily budgets, ${CONCURRENCY} at a time`
        }
      >
        {status.kind === "pending" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Refreshing {status.completed} of {status.total}...
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
            status.failed === 0 && status.noBudgetOther === 0
              ? "text-emerald-600"
              : "text-amber-600"
          }`}
        >
          {status.withBudget} of {status.total} returned a budget
          {status.noActiveAdsets > 0
            ? ` · ${status.noActiveAdsets} had no active ad sets`
            : ""}
          {status.noBudgetOther > 0
            ? ` · ${status.noBudgetOther} no matching budget`
            : ""}
          {status.failed > 0
            ? ` · ${status.failed} failed${status.firstFailureReason ? ` (${status.firstFailureReason})` : ""}`
            : ""}
        </span>
      ) : null}
    </div>
  );
}
