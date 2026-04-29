"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { CustomRangePicker, TimeframeSelector } from "@/components/report/timeframe-controls";
import {
  DAILY_BUDGET_UPDATED_EVENT,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "@/components/share/client-refresh-daily-budgets-button";
import { fmtCurrencyCompact, fmtDate } from "@/lib/dashboard/format";
import { paidSpendOf } from "@/lib/dashboard/paid-spend";
import { fullDaysUntilEventUtc } from "@/lib/dashboard/report-pacing";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import { AdditionalSpendCard } from "@/components/dashboard/events/additional-spend-card";
import { VenueDailyReportBlock } from "./venue-daily-report-block";

/**
 * components/share/venue-full-report.tsx
 *
 * Linear venue report page used by both the internal full-report route
 * and the external venue share route. This intentionally does NOT reuse
 * the collapsed client-portal venue card shell; the full report should
 * follow the same top-to-bottom order as the per-event share report.
 *
 * Single-responsibility: this file does NO data fetching; the
 * parent page pre-filters the portal payload down to the venue
 * scope before passing it in.
 */

interface Props {
  /**
   * Token forwarded to `ClientPortalVenueTable` for the per-row
   * tickets/additional-spend endpoints. External usage passes a
   * venue-scope share token; internal usage passes empty string —
   * the table falls back to event-detail navigation for editing
   * (see `VenueTicketsClickEdit`).
   */
  token?: string;
  clientId: string;
  /** The venue's `event_code` — the pivot key for venue-scope writes. */
  eventCode: string;
  events: PortalEvent[];
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  londonOnsaleSpend: number | null;
  londonPresaleSpend: number | null;
  isInternal?: boolean;
  /**
   * Controls whether the venue additional-spend card renders in
   * read-only mode on the share surface. Defaults to read-only for
   * external shares that weren't explicitly flagged editable — matches
   * the per-event share card's contract.
   */
  canEdit?: boolean;
  datePreset?: DatePreset;
  customRange?: CustomDateRange;
}

export function VenueFullReport({
  token = "",
  clientId,
  eventCode,
  events: initialEvents,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  isInternal = false,
  canEdit = false,
  datePreset = "maximum",
  customRange,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  // Venue-scope additional spend. Internal surface: cookie auth,
  // always editable. Share surface: token auth, editable iff the
  // share row was minted with `can_edit=true`.
  const mode: "dashboard" | "share" = isInternal ? "dashboard" : "share";
  const readOnly = !isInternal && !canEdit;
  const handleTimeframeChange = (
    preset: DatePreset,
    nextCustomRange?: CustomDateRange,
  ) => {
    const params = new URLSearchParams();
    if (preset !== "maximum") params.set("tf", preset);
    if (preset === "custom" && nextCustomRange) {
      params.set("from", nextCustomRange.since);
      params.set("to", nextCustomRange.until);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="space-y-6">
      <VenueLiveReportTabs
        clientId={clientId}
        eventCode={eventCode}
        events={initialEvents}
        dailyRollups={dailyRollups}
        shareToken={mode === "share" ? token : ""}
        datePreset={datePreset}
        customRange={customRange}
        onTimeframeChange={handleTimeframeChange}
      />
      <div className="rounded-md border border-border bg-background p-4">
        <AdditionalSpendCard
          scope={{ kind: "venue", clientId, venueEventCode: eventCode }}
          mode={mode}
          shareToken={mode === "share" ? token : undefined}
          readOnly={readOnly}
          onAfterMutate={() => router.refresh()}
        />
      </div>
      <VenueDailyReportBlock
        eventCode={eventCode}
        events={initialEvents}
        dailyEntries={dailyEntries}
        dailyRollups={dailyRollups}
        additionalSpend={additionalSpend}
        mode={mode}
        datePreset={datePreset}
        customRange={customRange}
      />
    </div>
  );
}

function VenueLiveReportTabs({
  clientId,
  eventCode,
  events,
  dailyRollups,
  shareToken,
  datePreset,
  customRange,
  onTimeframeChange,
}: {
  clientId: string;
  eventCode: string;
  events: PortalEvent[];
  dailyRollups: DailyRollupRow[];
  shareToken: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  onTimeframeChange: (
    preset: DatePreset,
    customRange?: CustomDateRange,
  ) => void;
}) {
  const earliestUpcomingDate = earliestUpcomingEventDate(events);
  const daysUntil = fullDaysUntilEventUtc(earliestUpcomingDate);
  const windowDays = useMemo(
    () => resolvePresetToDays(datePreset, customRange),
    [datePreset, customRange],
  );
  const windowSpend = useMemo(
    () => sumWindowMetaSpend(dailyRollups, events.length > 1, windowDays),
    [dailyRollups, events.length, windowDays],
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Live report
          </p>
          <h2 className="font-heading text-lg tracking-wide">
            Channel performance
          </h2>
        </div>
        <div
          role="tablist"
          aria-label="Live report channels"
          className="inline-flex rounded-md border border-border bg-muted/30 p-1 text-xs"
        >
          {(["Meta", "TikTok", "Google Ads"] as const).map((label, index) => {
            const active = index === 0;
            return (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={!active}
                className={`rounded px-3 py-1.5 font-medium transition ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground opacity-60"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Days until event"
          value={daysUntil != null ? daysUntilLabel(daysUntil) : "Date TBC"}
          sub={earliestUpcomingDate ? fmtDate(earliestUpcomingDate) : null}
        />
      </div>
      <div className="space-y-2">
        <TimeframeSelector
          active={datePreset}
          disabled={false}
          onChange={(preset) => onTimeframeChange(preset)}
        />
        <CustomRangePicker
          active={datePreset === "custom"}
          disabled={false}
          initialRange={customRange ?? null}
          onApply={(range) => onTimeframeChange("custom", range)}
        />
      </div>
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Campaign performance
        </h2>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Paid media
            </p>
            <div className="mt-3 space-y-2 text-foreground">
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {windowSpend > 0 ? (
                  <>
                    {fmtCurrencyCompact(windowSpend)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      Spent
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              {windowSpend > 0 ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Meta spend (this window)
                </p>
              ) : null}
              <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-heading text-xl tracking-wide tabular-nums">
                <span className="text-sm font-normal text-muted-foreground">
                  Daily budget:
                </span>
                <VenueDailyBudgetValue
                  clientId={clientId}
                  eventCode={eventCode}
                  shareToken={shareToken}
                />
              </p>
            </div>
          </div>
        </div>
      </section>
      <div className="rounded-md border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        Venue-scoped Meta stats, breakdowns and active creatives will attach
        here in the next tiers using the selected timeframe.
      </div>
    </section>
  );
}

function VenueDailyBudgetValue({
  clientId,
  eventCode,
  shareToken,
}: {
  clientId: string;
  eventCode: string;
  shareToken: string;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; dailyBudget: number | null; reason: string | null }
    | { kind: "error"; reason: string | null }
  >(() => {
    const cached = getDailyBudgetUpdate(clientId, eventCode);
    if (!cached) return { kind: "loading" };
    return {
      kind: "ready",
      dailyBudget: cached.dailyBudget,
      reason: cached.reasonLabel,
    };
  });

  useEffect(() => {
    const onBudgetUpdated = (event: Event) => {
      const detail = (event as CustomEvent<DailyBudgetUpdateDetail>).detail;
      if (detail.clientId !== clientId || detail.eventCode !== eventCode) return;
      setState({
        kind: "ready",
        dailyBudget: detail.dailyBudget,
        reason: detail.reasonLabel,
      });
    };
    window.addEventListener(DAILY_BUDGET_UPDATED_EVENT, onBudgetUpdated);
    return () => {
      window.removeEventListener(DAILY_BUDGET_UPDATED_EVENT, onBudgetUpdated);
    };
  }, [clientId, eventCode]);

  useEffect(() => {
    const cached = getDailyBudgetUpdate(clientId, eventCode);
    if (cached) {
      setState({
        kind: "ready",
        dailyBudget: cached.dailyBudget,
        reason: cached.reasonLabel,
      });
      return;
    }
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const qs = new URLSearchParams();
        if (shareToken) qs.set("client_token", shareToken);
        const res = await fetch(
          `/api/clients/${encodeURIComponent(clientId)}/venues/${encodeURIComponent(eventCode)}/daily-budget${
            qs.size > 0 ? `?${qs.toString()}` : ""
          }`,
        );
        const json = (await res.json()) as {
          dailyBudget?: number | null;
          reasonLabel?: string | null;
          error?: string;
        };
        if (!res.ok) throw new Error(json.error ?? "Daily budget unavailable");
        if (!cancelled) {
          setState({
            kind: "ready",
            dailyBudget: json.dailyBudget ?? null,
            reason: json.reasonLabel ?? json.error ?? null,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            reason:
              err instanceof Error ? err.message : "Daily budget unavailable",
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [clientId, eventCode, shareToken]);

  if (state.kind === "loading") {
    return <span className="text-muted-foreground">...</span>;
  }
  if (state.kind === "error") {
    return (
      <span className="text-muted-foreground" title={state.reason ?? undefined}>
        —
      </span>
    );
  }
  return (
    <span
      className={state.dailyBudget == null ? "text-muted-foreground" : undefined}
      title={state.dailyBudget == null ? (state.reason ?? undefined) : undefined}
    >
      {state.dailyBudget != null && state.dailyBudget > 0
        ? fmtCurrencyCompact(state.dailyBudget)
        : "—"}
    </span>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-xl tracking-wide text-foreground">
        {value}
      </p>
      {sub ? <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function earliestUpcomingEventDate(events: PortalEvent[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .map((event) => event.event_date)
    .filter((date): date is string => !!date && date >= today)
    .sort();
  if (upcoming.length > 0) return upcoming[0];
  return null;
}

function daysUntilLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  return `${d} days`;
}

function sumWindowMetaSpend(
  rollups: DailyRollupRow[],
  isMultiEventVenue: boolean,
  windowDays: string[] | null,
): number {
  const windowDaySet = windowDays === null ? null : new Set(windowDays);
  let total = 0;
  for (const row of rollups) {
    if (windowDaySet && !windowDaySet.has(row.date)) continue;
    const hasAllocatedSpend =
      row.ad_spend_allocated != null || row.ad_spend_presale != null;
    const spend = hasAllocatedSpend
      ? (row.ad_spend_allocated ?? 0) + (row.ad_spend_presale ?? 0)
      : isMultiEventVenue
        ? null
        : row.ad_spend;
    total += paidSpendOf({ ad_spend: spend, tiktok_spend: null });
  }
  return total;
}
