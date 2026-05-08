"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { fmtCurrencyCompact } from "@/lib/dashboard/format";
import { VENUE_REPORT_SYNC_COMPLETE_EVENT } from "@/lib/dashboard/venue-report-sync-events";
import {
  ClientRefreshDailyBudgetsButton,
  DAILY_BUDGET_UPDATED_EVENT,
  fetchVenueDailyBudgetDetail,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "@/components/share/client-refresh-daily-budgets-button";

const SYNC_BUDGET_MIN_MS = 25_000;

function staggerMs(eventCode: string): number {
  let hash = 0;
  for (const ch of eventCode) hash = (hash * 31 + ch.charCodeAt(0)) % 8000;
  return hash;
}

/**
 * Meta Graph: sum of active ad sets’ daily budgets vs lifetime paid-media spend
 * vs allocated budget — lives inside the Paid media performance summary card.
 */
export function VenuePaidMediaDailySpendTracker({
  clientId,
  eventCode,
  shareToken = "",
  paidMediaBudget,
  paidMediaSpent,
}: {
  clientId: string;
  eventCode: string;
  /** Venue-scope share token for `/share/venue/*` — omit on internal routes. */
  shareToken?: string;
  paidMediaBudget: number;
  paidMediaSpent: number;
}) {
  /** Prefer latest broadcast detail; fall back to module cache from bulk refresh. */
  const [eventRow, setEventRow] = useState<DailyBudgetUpdateDetail | null>(null);
  const displayRow =
    eventRow ?? getDailyBudgetUpdate(clientId, eventCode);

  const lastSyncFetchAt = useRef(0);

  const refreshOne = useCallback(async () => {
    try {
      await fetchVenueDailyBudgetDetail({
        clientId,
        eventCode,
        shareToken: shareToken || undefined,
      });
    } catch {
      // `fetchVenueDailyBudgetDetail` dispatches error state to the same event bus.
    }
  }, [clientId, eventCode, shareToken]);

  useEffect(() => {
    const onBudget = (event: Event) => {
      const custom = event as CustomEvent<DailyBudgetUpdateDetail>;
      const d = custom.detail;
      if (d.clientId !== clientId || d.eventCode !== eventCode) return;
      setEventRow(d);
    };
    window.addEventListener(DAILY_BUDGET_UPDATED_EVENT, onBudget);
    return () => {
      window.removeEventListener(DAILY_BUDGET_UPDATED_EVENT, onBudget);
    };
  }, [clientId, eventCode]);

  useEffect(() => {
    const onVenueSyncComplete = () => {
      const now = Date.now();
      if (now - lastSyncFetchAt.current < SYNC_BUDGET_MIN_MS) return;
      lastSyncFetchAt.current = now;
      void refreshOne();
    };
    window.addEventListener(VENUE_REPORT_SYNC_COMPLETE_EVENT, onVenueSyncComplete);
    return () => {
      window.removeEventListener(
        VENUE_REPORT_SYNC_COMPLETE_EVENT,
        onVenueSyncComplete,
      );
    };
  }, [refreshOne]);

  useEffect(() => {
    let cancelled = false;
    const delay = staggerMs(eventCode);
    const t = window.setTimeout(() => {
      if (cancelled) return;
      if (!getDailyBudgetUpdate(clientId, eventCode)) void refreshOne();
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [clientId, eventCode, refreshOne]);

  const dailyLabel =
    displayRow?.label === "effective_daily"
      ? "Effective daily (active ad sets)"
      : "Daily budget (active ad sets)";

  return (
    <div
      className="mt-4 border-t border-border pt-3"
      data-testid="venue-daily-spend-tracker"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Daily spend tracker
        </p>
        <ClientRefreshDailyBudgetsButton
          clientId={clientId}
          eventCodes={[eventCode]}
          shareToken={shareToken || undefined}
        />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Live Meta total daily budget for running ad sets vs allocated paid media
        and lifetime spend — use with Sync now to spot paused sets still showing
        historic spend.
      </p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">{dailyLabel}</dt>
          <dd className="font-heading tabular-nums tracking-wide text-foreground">
            {displayRow == null ? (
              <span className="text-muted-foreground">…</span>
            ) : displayRow.dailyBudget != null ? (
              fmtCurrencyCompact(displayRow.dailyBudget)
            ) : (
              <span
                className="text-muted-foreground"
                title={displayRow.reasonLabel ?? undefined}
              >
                —
              </span>
            )}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Lifetime paid media spent</dt>
          <dd className="font-heading tabular-nums tracking-wide text-foreground">
            {paidMediaSpent > 0 ? fmtCurrencyCompact(paidMediaSpent) : "—"}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground">Paid media allocated</dt>
          <dd className="font-heading tabular-nums tracking-wide text-foreground">
            {paidMediaBudget > 0 ? fmtCurrencyCompact(paidMediaBudget) : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
