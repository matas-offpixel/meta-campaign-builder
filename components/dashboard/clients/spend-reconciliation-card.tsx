"use client";

/**
 * Spend Reconciliation Card — client component (PR-C / PR-D of issue #467).
 *
 * Receives server-computed `VenueSpendReconciliation` as a prop and
 * augments it with the live Meta daily budget, which is only available
 * client-side (fetched from Meta Graph API by `VenuePaidMediaDailySpendTracker`
 * on the Performance tab and cached in the `getDailyBudgetUpdate` module store).
 *
 * If the live budget has not been fetched yet (user landed on Funnel Pacing
 * before Performance tab auto-fetches), the Daily budget row shows "—".
 * No network call is made here — we only read from the in-memory cache.
 *
 * Sources (all matching Performance Summary):
 *   - spent    = SUM(ad_spend_allocated + ad_spend_presale) — no COALESCE fallback
 *   - allocated = MAX(budget_marketing) per event_code via aggregateSharedVenueBudget
 *   - liveCPT  = spent / events.tickets_sold
 *   - dailyBudget = getDailyBudgetUpdate(clientId, eventCode).dailyBudget
 */

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import type { VenueSpendReconciliation } from "@/lib/dashboard/venue-canonical-funnel";
import {
  DAILY_BUDGET_UPDATED_EVENT,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "@/lib/share/venue-daily-budget-fetch";

const NUM = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const GBP_2DP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function SpendReconciliationCard({
  reconciliation: r,
  daysToEvent,
  clientId,
  eventCode,
}: {
  reconciliation: VenueSpendReconciliation;
  /** From `backwardRead.daysToEvent` — displayed as "Days remaining". */
  daysToEvent: number | null;
  /** For live Meta daily budget lookup via in-memory module cache. */
  clientId: string;
  eventCode: string;
}) {
  const [budgetDetail, setBudgetDetail] =
    useState<DailyBudgetUpdateDetail | null>(() =>
      getDailyBudgetUpdate(clientId, eventCode),
    );

  useEffect(() => {
    function onUpdate(e: Event) {
      const detail = (e as CustomEvent<DailyBudgetUpdateDetail>).detail;
      if (detail.clientId === clientId && detail.eventCode === eventCode) {
        setBudgetDetail(detail);
      }
    }
    window.addEventListener(DAILY_BUDGET_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(DAILY_BUDGET_UPDATED_EVENT, onUpdate);
  }, [clientId, eventCode]);

  const dailyBudget = budgetDetail?.dailyBudget ?? null;

  return (
    <article
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      data-testid="funnel-pacing-spend-reconciliation"
    >
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Spend vs Budget
      </p>

      {/* 2-column grid */}
      <div className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {/* Row 1: Spent | Allocated */}
        <SpendRow label="Spent" value={GBP.format(r.spent)} />

        {r.allocated != null ? (
          <SpendRow
            label="Allocated"
            value={GBP.format(r.allocated)}
            sub={r.remaining != null ? `${GBP.format(r.remaining)} remaining` : undefined}
          />
        ) : null}

        {/* Row 2: Spent per day | Required per day */}
        <SpendRow
          label="Spent per day"
          value={r.spentPerDay == null ? "—" : GBP.format(r.spentPerDay)}
          sub={
            r.daysSinceFirstSpend != null
              ? `over ${NUM.format(r.daysSinceFirstSpend)} days`
              : undefined
          }
        />

        <RequiredPerDayRow r={r} />

        {/* Row 3: Daily budget (live Meta) | Days remaining */}
        <SpendRow
          label="Daily budget (Meta)"
          value={dailyBudget == null ? "—" : GBP.format(dailyBudget)}
          sub={
            dailyBudget == null
              ? budgetDetail == null
                ? "Awaiting sync"
                : (budgetDetail.reasonLabel ?? undefined)
              : `Live Meta ad sets`
          }
        />

        <SpendRow
          label="Days remaining"
          value={
            daysToEvent == null
              ? "—"
              : daysToEvent <= 0
                ? "Event passed"
                : NUM.format(daysToEvent)
          }
        />
      </div>

      {/* CPT sub-line */}
      {r.liveCostPerTicket != null && (
        <p className="mt-3 text-xs text-muted-foreground tabular-nums">
          Live CPT: {GBP_2DP.format(r.liveCostPerTicket)} per ticket
          {r.requiredPerDay != null && daysToEvent != null && daysToEvent > 0 && (
            <span>
              {" "}
              · {GBP.format(r.requiredPerDay * daysToEvent)} to sell out
            </span>
          )}
        </p>
      )}

      {/* Warning banner */}
      {r.warning != null && r.allocated != null && (
        <WarningBanner warning={r.warning} warningAmount={r.warningAmount} />
      )}
    </article>
  );
}

function RequiredPerDayRow({ r }: { r: VenueSpendReconciliation }) {
  if (r.requiredPerDayState === "event_passed") {
    return <SpendRow label="Required per day" value="Event passed" />;
  }
  if (r.requiredPerDayState === "sold_out") {
    return (
      <SpendRow label="Required per day" value="Sold out" sub="No further spend required" />
    );
  }
  if (
    r.requiredPerDayState === "no_tickets_yet" ||
    r.requiredPerDayState === "no_event_date"
  ) {
    return <SpendRow label="Required per day" value="—" />;
  }
  return (
    <SpendRow
      label="Required per day"
      value={r.requiredPerDay == null ? "—" : GBP.format(r.requiredPerDay)}
      sub={
        r.requiredPerDay != null
          ? `${GBP.format(r.requiredPerDay)}/day to sell out`
          : undefined
      }
    />
  );
}

function WarningBanner({
  warning,
  warningAmount,
}: {
  warning: "additional_needed" | "pace_covered";
  warningAmount: number | null;
}) {
  if (warning === "additional_needed") {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          Required spend exceeds remaining budget
          {warningAmount != null ? ` by ${GBP.format(warningAmount)}` : ""} —
          additional budget needed.
        </span>
      </div>
    );
  }
  return (
    <div className="mt-4 flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
      <span>Remaining budget covers required pace to sell out.</span>
    </div>
  );
}

function SpendRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col py-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-heading text-base tabular-nums">{value}</span>
      {sub ? (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {sub}
        </span>
      ) : null}
    </div>
  );
}
