"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({ datePreset });
    if (datePreset === "custom" && customRange) {
      qs.set("since", customRange.since);
      qs.set("until", customRange.until);
    }
    fetch(`/api/insights/event/${encodeURIComponent(eventId)}?${qs.toString()}`, {
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
  }, [eventId, datePreset, customRange?.since, customRange?.until]);

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
      insights={state.data}
      datePreset={datePreset}
      customRange={customRange}
      creativesSource={{ kind: "internal", eventId }}
      onTimeframeChange={handleTimeframeChange}
      variant="embedded"
    />
  );
}
