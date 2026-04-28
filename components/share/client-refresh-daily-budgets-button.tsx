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
  | { kind: "done"; total: number; ok: number; failed: number };

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
      async (eventCode) => {
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
          reasonLabel?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Daily budget unavailable");

        const detail: DailyBudgetUpdateDetail = {
          clientId,
          eventCode,
          dailyBudget: json.dailyBudget ?? null,
          label: json.label ?? "daily",
          reasonLabel: json.reasonLabel ?? json.error ?? null,
        };
        window.dispatchEvent(
          new CustomEvent<DailyBudgetUpdateDetail>(
            DAILY_BUDGET_UPDATED_EVENT,
            { detail },
          ),
        );
        return detail;
      },
      (completed, totalSoFar) => {
        setStatus({ kind: "pending", completed, total: totalSoFar });
      },
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    setStatus({ kind: "done", total, ok, failed: total - ok });
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
            status.failed === 0 ? "text-emerald-600" : "text-amber-600"
          }`}
        >
          {status.ok} of {status.total} refreshed
          {status.failed > 0 ? ` · ${status.failed} failed` : ""}
        </span>
      ) : null}
    </div>
  );
}
