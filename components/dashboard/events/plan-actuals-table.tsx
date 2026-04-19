"use client";

import { fmtCurrency, fmtDayWithWeekday, isWeekend } from "@/lib/dashboard/format";
import {
  OBJECTIVE_KEYS,
  readObjectiveBudget,
} from "@/lib/dashboard/objectives";
import type { AdPlan, AdPlanDay } from "@/lib/db/ad-plans";

/**
 * components/dashboard/events/plan-actuals-table.tsx
 *
 * Sibling table that lives below the PlanDailyGrid and shows actual
 * Meta spend per day vs the planned daily allocation, plus a totals
 * row that includes pre-plan (legacy) spend.
 *
 * Why a sibling rather than two new computed columns inside the grid?
 *   The grid in plan-daily-grid.tsx is a tightly-coupled cell-edit
 *   surface (TSV copy/paste, drag-fill, keyboard nav) whose column
 *   model is a module-level const. Threading externally-fetched
 *   per-day data into that const requires either parameterising every
 *   COLUMNS callsite (16+ touch points) or wrapping the array in a
 *   useMemo and re-validating the selection clamp — both expand the
 *   blast radius of V.3 well beyond what the spec needs. The sibling
 *   table reuses the exact same per-day plumbing without touching
 *   the grid's selection / paste machinery.
 *
 * Phase 1 = Meta only. TikTok + Google actuals are 0 by spec — the
 * caveat line under the table makes that explicit so an internal
 * reader doesn't read "actual £X" as a cross-channel total.
 */

type Status =
  | { kind: "loading" }
  | { kind: "error"; reason: string; message: string }
  | { kind: "ok"; actualByDay: Map<string, number> };

interface Props {
  plan: AdPlan;
  days: AdPlanDay[];
  /**
   * Local-tz YYYY-MM-DD frozen at parent mount. Days strictly after
   * this render as em-dash for actuals (future = no data possible).
   * Centralised here rather than recomputing per render so tests +
   * stat cards use the same notion of "today" within a render pass.
   */
  todayIso: string;
  status: Status;
}

export function PlanActualsTable({ plan, days, todayIso, status }: Props) {
  const legacySpend = plan.legacy_spend ?? 0;
  const plannedTotalDaily = sumDailyPlanned(days);
  const plannedTotal = plannedTotalDaily + legacySpend;
  const actualByDay =
    status.kind === "ok" ? status.actualByDay : new Map<string, number>();
  const actualTotal = sumActuals(days, actualByDay, todayIso);
  const deltaTotal = plannedTotal - actualTotal;

  const dayCount = days.length;
  if (dayCount === 0) return null;

  return (
    <section className="space-y-2">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-sm tracking-wide">
          Actual spend vs plan
        </h3>
        <StatusBadge status={status} />
      </header>

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[520px] border-collapse text-xs">
          <thead className="bg-background text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <Th align="left">Day</Th>
              <Th align="right">Planned</Th>
              <Th align="right">Actual (Meta)</Th>
              <Th align="right">Delta</Th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => {
              const planned = sumObjectiveBudgets(day);
              const isFuture = day.day > todayIso;
              const actual = isFuture
                ? null
                : status.kind === "ok"
                  ? (actualByDay.get(day.day) ?? 0)
                  : status.kind === "loading"
                    ? null
                    : null;
              const delta = actual != null ? planned - actual : null;
              const weekendRow = isWeekend(new Date(day.day + "T00:00:00"));
              return (
                <tr
                  key={day.id}
                  className={`border-t border-border ${
                    weekendRow ? "text-muted-foreground" : ""
                  }`}
                >
                  <Td align="left">
                    {fmtDayWithWeekday(new Date(day.day + "T00:00:00"))}
                  </Td>
                  <Td align="right">{fmtCurrency(planned)}</Td>
                  <Td align="right">
                    {actual == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      fmtCurrency(actual)
                    )}
                  </Td>
                  <Td align="right">
                    {delta == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <DeltaCell value={delta} />
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-background font-medium">
              <Td align="left">
                Totals
                {legacySpend > 0 ? (
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground">
                    incl. pre-plan {fmtCurrency(legacySpend)}
                  </span>
                ) : null}
              </Td>
              <Td align="right">{fmtCurrency(plannedTotal)}</Td>
              <Td align="right">
                {status.kind === "ok" ? (
                  <span>
                    {fmtCurrency(actualTotal)}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      Meta only
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Td>
              <Td align="right">
                {status.kind === "ok" ? (
                  <DeltaCell value={deltaTotal} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </Td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Actual spend shows Meta spend only. TikTok + Google Ads
        integrations coming soon.
      </p>
    </section>
  );
}

function StatusBadge({ status }: { status: Status }) {
  switch (status.kind) {
    case "loading":
      return (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Loading…
        </span>
      );
    case "error":
      return (
        <span
          className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-400"
          title={status.message}
        >
          Meta unavailable · {humaniseReason(status.reason)}
        </span>
      );
    case "ok":
      return null;
  }
}

function DeltaCell({ value }: { value: number }) {
  // Negative delta = planned < actual = OVER spent. Show in destructive
  // colour to draw the eye. Positive (under-spent) and zero are
  // neutral — under-spending is desirable, not alarming.
  const tone =
    value < 0
      ? "text-destructive"
      : value > 0
        ? "text-foreground"
        : "text-muted-foreground";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value);
  return (
    <span className={tone}>
      {sign}
      {fmtCurrency(abs)}
    </span>
  );
}

function Th({
  align,
  children,
}: {
  align: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      className={`px-3 py-2 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  align,
  children,
}: {
  align: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${
        align === "right" ? "text-right tabular-nums" : "text-left"
      }`}
    >
      {children}
    </td>
  );
}

function humaniseReason(reason: string): string {
  switch (reason) {
    case "no_event_code":
      return "no event code";
    case "no_ad_account":
      return "no Meta ad account linked";
    case "no_owner_token":
      return "no Meta token";
    case "owner_token_expired":
      return "Meta token expired";
    case "invalid_custom_range":
      return "invalid date range";
    case "no_campaigns_matched":
      return "no matching campaigns";
    case "meta_api_error":
      return "Meta API error";
    default:
      return reason;
  }
}

function sumObjectiveBudgets(day: AdPlanDay): number {
  let total = 0;
  for (const key of OBJECTIVE_KEYS) {
    total += readObjectiveBudget(day.objective_budgets, key);
  }
  return total;
}

function sumDailyPlanned(days: AdPlanDay[]): number {
  let total = 0;
  for (const d of days) total += sumObjectiveBudgets(d);
  return total;
}

/**
 * Sum actual spend across days that are <= today. Future-day rows
 * always contribute 0 to the actual total because Meta cannot have
 * reported on a day that hasn't happened yet — counting them would
 * inflate the under-spend delta.
 */
function sumActuals(
  days: AdPlanDay[],
  actualByDay: Map<string, number>,
  todayIso: string,
): number {
  let total = 0;
  for (const d of days) {
    if (d.day > todayIso) continue;
    total += actualByDay.get(d.day) ?? 0;
  }
  return total;
}
