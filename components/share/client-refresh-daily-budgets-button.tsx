"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { runWithConcurrency } from "@/lib/dashboard/sync-button-helpers";

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
const dailyBudgetUpdates = new Map<string, DailyBudgetUpdateDetail>();

function updateKey(clientId: string, eventCode: string): string {
  return `${clientId}::${eventCode}`;
}

export function dispatchDailyBudgetUpdate(detail: DailyBudgetUpdateDetail) {
  dailyBudgetUpdates.set(updateKey(detail.clientId, detail.eventCode), detail);
  window.dispatchEvent(
    new CustomEvent<DailyBudgetUpdateDetail>(DAILY_BUDGET_UPDATED_EVENT, {
      detail,
    }),
  );
}

/**
 * Fetches one venue's daily Meta ad-set budget row and broadcasts it to
 * `DAILY_BUDGET_UPDATED_EVENT` (same contract as the bulk refresh button).
 * Used after Sync now with throttling so spam-clicking sync doesn't hammer Graph.
 */
export async function fetchVenueDailyBudgetDetail(opts: {
  clientId: string;
  eventCode: string;
  shareToken?: string;
}): Promise<DailyBudgetUpdateDetail> {
  let dispatched = false;
  try {
    const qs = new URLSearchParams();
    if (opts.shareToken) qs.set("client_token", opts.shareToken);
    const res = await fetch(
      `/api/clients/${encodeURIComponent(opts.clientId)}/venues/${encodeURIComponent(opts.eventCode)}/daily-budget${
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
      clientId: opts.clientId,
      eventCode: opts.eventCode,
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
    const msg =
      err instanceof Error ? err.message : "Daily budget unavailable";
    if (!dispatched) {
      dispatchDailyBudgetUpdate({
        clientId: opts.clientId,
        eventCode: opts.eventCode,
        dailyBudget: null,
        label: "daily",
        reason: "fetch_error",
        reasonLabel: msg,
      });
    }
    throw err instanceof Error ? err : new Error(msg);
  }
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
