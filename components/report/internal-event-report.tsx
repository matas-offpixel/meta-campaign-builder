"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import type {
  CustomDateRange,
  EventInsightsPayload,
  InsightsResult,
  DatePreset,
} from "@/lib/insights/types";

import {
  EventReportView,
  type EventReportViewEvent,
} from "./event-report-view";
import { ReportUnavailable } from "./report-unavailable";

interface Props {
  eventId: string;
  event: EventReportViewEvent;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; data: EventInsightsPayload }
  | { kind: "unavailable"; reason: string };

/**
 * Build the auth insights URL. When `force` is true the route's
 * `?force=1` cache-bust signal is added (PR #57 #3) — used by the
 * manual Refresh button on the live report footer to skip the
 * server-side 5-minute cache for the current bucket.
 */
function buildInsightsUrl(
  eventId: string,
  datePreset: DatePreset,
  customRange: CustomDateRange | undefined,
  force: boolean,
): string {
  const qs = new URLSearchParams({ datePreset });
  if (datePreset === "custom" && customRange) {
    qs.set("since", customRange.since);
    qs.set("until", customRange.until);
  }
  if (force) qs.set("force", "1");
  return `/api/insights/event/${encodeURIComponent(eventId)}?${qs.toString()}`;
}

/**
 * Internal mirror of the public report — same `EventReportView` body,
 * different transport.
 *
 * The public share page is an RSC that reads `?tf=` from the URL and
 * re-fetches insights on each timeframe change. The internal Reporting
 * tab can't easily piggyback on that pattern because the tab is one
 * panel inside a larger client component (`EventDetail`), and pushing
 * `?tf=` would compete with `?tab=`. So we keep the timeframe in local
 * state here and fetch via the auth route `/api/insights/event/[id]`.
 *
 * Failure modes mirror the public side: any non-200 / `ok: false`
 * payload renders the same `ReportUnavailable` neutral state — never
 * stale numbers, never a half-rendered grid.
 */
export function InternalEventReport({ eventId, event }: Props) {
  const [datePreset, setDatePreset] = useState<DatePreset>("maximum");
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(
    undefined,
  );
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  // Reset to "loading" synchronously when any of (eventId, datePreset,
  // customRange) changes, then let the effect kick off the fetch.
  // Using the React 19 "adjust state in render" pattern instead of an
  // effect setState call clears `react-hooks/set-state-in-effect` and
  // avoids the user briefly seeing stale numbers from the previous
  // window between the prop change and the loading flash.
  const trackedNext = `${eventId}:${datePreset}:${customRange?.since ?? ""}:${customRange?.until ?? ""}`;
  const [trackedKey, setTrackedKey] = useState<string>(trackedNext);
  if (trackedKey !== trackedNext) {
    setTrackedKey(trackedNext);
    setState({ kind: "loading" });
  }

  const handleTimeframeChange = (
    preset: DatePreset,
    nextRange?: CustomDateRange,
  ) => {
    setDatePreset(preset);
    if (preset === "custom") {
      setCustomRange(nextRange);
    } else {
      setCustomRange(undefined);
    }
  };

  // Deps below intentionally pin `customRange?.since/until` rather
  // than the whole `customRange` reference, so a fresh
  // `setCustomRange({since, until})` with the same dates doesn't
  // re-fire the fetch. We rebuild the range object locally so the
  // URL still reflects the active window.
  const since = customRange?.since;
  const until = customRange?.until;
  useEffect(() => {
    let cancelled = false;
    const activeRange =
      datePreset === "custom" && since && until ? { since, until } : undefined;
    fetch(buildInsightsUrl(eventId, datePreset, activeRange, false), {
      // Route-segment revalidate already handles per-bucket caching;
      // `no-store` here forces a fresh fetch so a timeframe flick
      // bypasses any stale browser cache and surfaces the latest numbers.
      cache: "no-store",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setState({
            kind: "unavailable",
            reason: "no_owner_token",
          });
          return;
        }
        if (!res.ok) {
          setState({
            kind: "unavailable",
            reason: "meta_api_error",
          });
          return;
        }
        const json = (await res.json()) as InsightsResult;
        if (!json.ok) {
          setState({ kind: "unavailable", reason: json.error.reason });
          return;
        }
        setState({ kind: "ok", data: json.data });
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[InternalEventReport] fetch failed:", err);
        setState({ kind: "unavailable", reason: "meta_api_error" });
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, datePreset, since, until]);

  /**
   * Manual refresh — wired to the Refresh button in the live
   * report footer. Re-runs the insights fetch with `?force=1` so
   * the route bypasses the 5-minute server-side cache for the
   * current (event, timeframe) bucket only. Other buckets keep
   * their TTL — switching back to a freshly-warmed preset still
   * hits the cache. Throws on failure so `<RefreshReportButton>`
   * can render its inline error line.
   */
  const handleManualRefresh = useCallback(async () => {
    const res = await fetch(
      buildInsightsUrl(eventId, datePreset, customRange, true),
      { cache: "no-store" },
    );
    if (res.status === 401) {
      throw new Error("Session expired");
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = (await res.json()) as InsightsResult;
    if (!json.ok) {
      throw new Error(json.error.message ?? json.error.reason);
    }
    setState({ kind: "ok", data: json.data });
  }, [eventId, datePreset, customRange]);

  if (state.kind === "loading") {
    return (
      <section className="rounded-md border border-border bg-card p-8">
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading report…
        </div>
      </section>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <ReportUnavailable
        eventName={event.name}
        venueName={event.venueName}
        venueCity={event.venueCity}
        eventDate={event.eventDate}
        // The InsightsErrorReason union is intentionally narrow —
        // assertion here is fine because every path that produces
        // `unavailable` set `reason` from one of the union members
        // (or "meta_api_error" as the catch-all default).
        reason={
          state.reason as
            | "no_event_code"
            | "no_owner_token"
            | "owner_token_expired"
            | "no_ad_account"
            | "meta_api_error"
            | "no_campaigns_matched"
            | "invalid_custom_range"
        }
      />
    );
  }

  return (
    <EventReportView
      event={event}
      meta={state.data}
      datePreset={datePreset}
      customRange={customRange}
      creativesSource={{ kind: "internal", eventId }}
      onTimeframeChange={handleTimeframeChange}
      onManualRefresh={handleManualRefresh}
      variant="embedded"
    />
  );
}
