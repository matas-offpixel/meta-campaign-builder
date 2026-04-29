"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { RefreshReportButton } from "@/components/report/refresh-report-button";
import { CustomRangePicker, TimeframeSelector } from "@/components/report/timeframe-controls";
import { fmtInt } from "@/components/report/meta-insights-sections";
import {
  DAILY_BUDGET_UPDATED_EVENT,
  getDailyBudgetUpdate,
  type DailyBudgetUpdateDetail,
} from "@/components/share/client-refresh-daily-budgets-button";
import { fmtCurrencyCompact, fmtDate } from "@/lib/dashboard/format";
import { paidSpendOf } from "@/lib/dashboard/paid-spend";
import { aggregateSharedVenueBudget } from "@/lib/db/client-dashboard-aggregations";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import type { EventLinkedDraft } from "@/lib/db/events";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import { AdditionalSpendCard } from "@/components/dashboard/events/additional-spend-card";
import { VenueActiveCreatives } from "./venue-active-creatives";
import { VenueDailyReportBlock } from "./venue-daily-report-block";
import { VenueLiveReportInsights } from "./venue-live-report-insights";

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
  linkedDrafts?: EventLinkedDraft[];
}

export function VenueFullReport({
  token = "",
  clientId,
  eventCode,
  events: initialEvents,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  weeklyTicketSnapshots,
  isInternal = false,
  canEdit = false,
  datePreset = "maximum",
  customRange,
  linkedDrafts = [],
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshNonce, setRefreshNonce] = useState(0);
  // Venue-scope additional spend. Internal surface: cookie auth,
  // always editable. Share surface: token auth, editable iff the
  // share row was minted with `can_edit=true`.
  const mode: "dashboard" | "share" = isInternal ? "dashboard" : "share";
  const readOnly = !isInternal && !canEdit;
  const handleRefresh = async () => {
    setRefreshNonce((value) => value + 1);
    router.refresh();
  };
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
        additionalSpend={additionalSpend}
        linkedDrafts={linkedDrafts}
        weeklyTicketSnapshots={weeklyTicketSnapshots}
        refreshNonce={refreshNonce}
        onRefresh={handleRefresh}
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
        weeklyTicketSnapshots={weeklyTicketSnapshots}
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
  additionalSpend,
  linkedDrafts,
  weeklyTicketSnapshots,
  refreshNonce,
  onRefresh,
  onTimeframeChange,
}: {
  clientId: string;
  eventCode: string;
  events: PortalEvent[];
  dailyRollups: DailyRollupRow[];
  shareToken: string;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  additionalSpend: AdditionalSpendRow[];
  linkedDrafts: EventLinkedDraft[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  refreshNonce: number;
  onRefresh: () => Promise<void>;
  onTimeframeChange: (
    preset: DatePreset,
    customRange?: CustomDateRange,
  ) => void;
}) {
  const displayEventDate = displayVenueEventDate(events);
  const daysUntil = computeDaysUntil(displayEventDate);
  const windowDays = useMemo(
    () => resolvePresetToDays(datePreset, customRange),
    [datePreset, customRange],
  );
  const windowSpend = useMemo(
    () => sumWindowMetaSpend(dailyRollups, events.length > 1, windowDays),
    [dailyRollups, events.length, windowDays],
  );
  const performance = useMemo(
    () =>
      computeVenuePerformance(
        events,
        dailyRollups,
        additionalSpend,
        weeklyTicketSnapshots,
      ),
    [additionalSpend, dailyRollups, events, weeklyTicketSnapshots],
  );
  const lastUpdatedIso = latestRollupTimestamp(dailyRollups);

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
          sub={displayEventDate ? fmtDate(displayEventDate) : null}
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
              Total marketing
            </p>
            <div className="mt-3 space-y-2 text-foreground">
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {performance.totalMarketing > 0 ? (
                  <>
                    {fmtCurrencyCompact(performance.totalMarketing)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      · {fmtCurrencyCompact(performance.paidMediaBudget)} Paid
                      media + {fmtCurrencyCompact(performance.additionalSpend)}{" "}
                      Additional
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
          </div>
          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Paid media
            </p>
            <div className="mt-3 space-y-2 text-foreground">
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {performance.paidMediaBudget > 0 ? (
                  <>
                    {fmtCurrencyCompact(performance.paidMediaBudget)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      Allocated (paid media only)
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
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
          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Tickets
            </p>
            <div className="mt-3 space-y-2 text-foreground">
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {performance.tickets != null ? (
                  performance.capacity != null ? (
                    <>
                      {fmtInt(performance.tickets)} / {fmtInt(performance.capacity)}{" "}
                      sold
                      {performance.sellThroughPct != null ? (
                        <span className="text-sm font-normal text-muted-foreground">
                          {" "}
                          ({performance.sellThroughPct.toFixed(1)}%)
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <>{fmtInt(performance.tickets)} sold</>
                  )
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {performance.costPerTicket != null ? (
                  <>
                    {fmtCurrencyCompact(performance.costPerTicket)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      cost per ticket
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>
      <VenueLiveReportInsights
        clientId={clientId}
        eventCode={eventCode}
        shareToken={shareToken}
        datePreset={datePreset}
        customRange={customRange}
        isInternal={shareToken === ""}
        refreshNonce={refreshNonce}
      />
      <VenueActiveCreatives
        token={shareToken}
        clientId={clientId}
        isInternal={shareToken === ""}
        eventCode={eventCode}
        venueLabel={events[0]?.venue_name ?? eventCode}
        datePreset={datePreset}
        customRange={customRange}
        refreshNonce={refreshNonce}
        fullReport
      />
      <LinkedCampaigns drafts={linkedDrafts} />
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Last updated {fmtRelativeShort(lastUpdatedIso)} · click refresh for latest
        </p>
        <RefreshReportButton onRefresh={onRefresh} />
      </div>
    </section>
  );
}

function LinkedCampaigns({ drafts }: { drafts: EventLinkedDraft[] }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base tracking-wide text-foreground">
        Linked campaigns
      </h2>
      {drafts.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          No linked campaign drafts for this venue yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <ul className="divide-y divide-border bg-card">
            {drafts.map((draft) => (
              <li
                key={draft.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {draft.name ?? "Untitled campaign"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {draft.objective ?? "No objective"} · Updated{" "}
                    {fmtRelativeShort(draft.updated_at)}
                  </p>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {draft.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
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

function displayVenueEventDate(events: PortalEvent[]): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .map((event) => event.event_date)
    .filter((date): date is string => !!date && date >= today)
    .sort();
  if (upcoming.length > 0) return upcoming[0];
  return events
    .map((event) => event.event_date)
    .filter((date): date is string => !!date)
    .sort()
    .at(-1) ?? null;
}

function computeDaysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00`);
  if (!Number.isFinite(target)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now.getTime()) / 86_400_000);
}

function daysUntilLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < -1) return `${Math.abs(d)} days ago`;
  return `${d} days`;
}

function computeVenuePerformance(
  events: PortalEvent[],
  rollups: DailyRollupRow[],
  additionalSpend: AdditionalSpendRow[],
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
): {
  paidMediaBudget: number;
  additionalSpend: number;
  totalMarketing: number;
  capacity: number | null;
  tickets: number | null;
  sellThroughPct: number | null;
  costPerTicket: number | null;
} {
  const paidMediaBudget = aggregateSharedVenueBudget(events) ?? 0;
  const eventIds = new Set(events.map((event) => event.id));
  const additionalSpendTotal = sumNumbers(
    additionalSpend
      .filter((row) =>
        row.scope === "venue"
          ? row.venue_event_code === events[0]?.event_code
          : eventIds.has(row.event_id),
      )
      .map((row) => row.amount),
  );
  const capacity = nullableSum(events.map((event) => event.capacity));
  const tickets =
    sumTickets(rollups, null) ?? latestVenueSnapshotTickets(weeklyTicketSnapshots);
  const paidSpend = sumWindowMetaSpend(rollups, events.length > 1, null);
  const sellThroughPct =
    capacity != null && capacity > 0 && tickets != null
      ? (tickets / capacity) * 100
      : null;
  const costPerTicket =
    tickets != null && tickets > 0 && paidSpend > 0 ? paidSpend / tickets : null;
  return {
    paidMediaBudget,
    additionalSpend: additionalSpendTotal,
    totalMarketing: paidMediaBudget + additionalSpendTotal,
    capacity,
    tickets,
    sellThroughPct,
    costPerTicket,
  };
}

function latestRollupTimestamp(rollups: DailyRollupRow[]): string {
  const latest = rollups
    .flatMap((row) => [row.source_meta_at, row.source_eventbrite_at, row.updated_at])
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
  return latest ?? new Date().toISOString();
}

function fmtRelativeShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "just now";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function sumTickets(
  rollups: DailyRollupRow[],
  windowDays: string[] | null,
): number | null {
  if (rollups.length === 0) return null;
  const windowDaySet = windowDays === null ? null : new Set(windowDays);
  let total = 0;
  let any = false;
  for (const row of rollups) {
    if (windowDaySet && !windowDaySet.has(row.date)) continue;
    if (row.tickets_sold != null) {
      total += row.tickets_sold;
      any = true;
    }
  }
  return any ? total : null;
}

function latestVenueSnapshotTickets(
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[],
): number | null {
  if (weeklyTicketSnapshots.length === 0) return null;
  const latestByEvent = new Map<string, WeeklyTicketSnapshotRow>();
  for (const row of weeklyTicketSnapshots) {
    const current = latestByEvent.get(row.event_id);
    if (!current || row.snapshot_at > current.snapshot_at) {
      latestByEvent.set(row.event_id, row);
    }
  }
  if (latestByEvent.size === 0) return null;
  let total = 0;
  for (const row of latestByEvent.values()) total += row.tickets_sold;
  return total;
}

function nullableSum(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (value == null) continue;
    total += value;
    any = true;
  }
  return any ? total : null;
}

function sumNumbers(values: Array<number | null | undefined>): number {
  return nullableSum(values) ?? 0;
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
