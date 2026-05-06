"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2 } from "lucide-react";

import type { TimelineRow } from "@/lib/db/event-daily-timeline";
import { computeSellOutPacing } from "@/lib/dashboard/report-pacing";
import type {
  CustomDateRange,
  EventInsightsPayload,
  InsightsResult,
  DatePreset,
} from "@/lib/insights/types";

import { ADDITIONAL_SPEND_CHANGED } from "@/components/dashboard/events/additional-spend-card";
import {
  EventReportView,
  type EventReportViewEvent,
} from "./event-report-view";
import {
  InternalActiveCreativesSection,
  type InternalActiveCreativesHandle,
} from "./internal-active-creatives-section";
import { ReportUnavailable } from "./report-unavailable";
import { EnhancementFlagBanner } from "@/components/dashboard/EnhancementFlagBanner";

interface Props {
  eventId: string;
  /** Client UUID — enables `/api/meta/thumbnail-proxy` for active creative thumbs. */
  clientId?: string;
  event: EventReportViewEvent;
  /** Controlled timeframe — mirrors Performance summary + Meta insights window. */
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  onTimeframeChange: (preset: DatePreset, nextRange?: CustomDateRange) => void;
  /** Fired when a fetch starts (`null`), succeeds (`data`), or fails (`null`). */
  onInsightsPayload?: (payload: EventInsightsPayload | null) => void;
  /** Additional spend editor — same placement as public share (below Campaign performance). */
  additionalSpendSlot?: ReactNode;
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
export function InternalEventReport({
  eventId,
  clientId,
  event,
  datePreset,
  customRange,
  onTimeframeChange,
  onInsightsPayload,
  additionalSpendSlot,
}: Props) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [additionalSpendEntries, setAdditionalSpendEntries] = useState<
    readonly { date: string; amount: number }[]
  >([]);
  const [rollupTimeline, setRollupTimeline] = useState<TimelineRow[]>([]);

  const loadRollupTimeline = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/ticketing/rollup?eventId=${encodeURIComponent(eventId)}`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        timeline?: TimelineRow[];
      };
      if (res.ok && json.ok && Array.isArray(json.timeline)) {
        setRollupTimeline(json.timeline);
      }
    } catch {
      setRollupTimeline([]);
    }
  }, [eventId]);

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

  // Deps below intentionally pin `customRange?.since/until` rather
  // than the whole `customRange` reference, so a fresh
  // `setCustomRange({since, until})` with the same dates doesn't
  // re-fire the fetch. We rebuild the range object locally so the
  // URL still reflects the active window.
  const since = customRange?.since;
  const until = customRange?.until;
  useEffect(() => {
    let cancelled = false;
    onInsightsPayload?.(null);
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
          onInsightsPayload?.(null);
          return;
        }
        if (!res.ok) {
          setState({
            kind: "unavailable",
            reason: "meta_api_error",
          });
          onInsightsPayload?.(null);
          return;
        }
        const json = (await res.json()) as InsightsResult;
        if (!json.ok) {
          setState({ kind: "unavailable", reason: json.error.reason });
          onInsightsPayload?.(null);
          return;
        }
        setState({ kind: "ok", data: json.data });
        onInsightsPayload?.(json.data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[InternalEventReport] fetch failed:", err);
        setState({ kind: "unavailable", reason: "meta_api_error" });
        onInsightsPayload?.(null);
      });

    return () => {
      cancelled = true;
    };
  }, [eventId, datePreset, since, until, onInsightsPayload]);

  const loadAdditionalSpendEntries = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/additional-spend`,
        { cache: "no-store" },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        entries?: Array<{ date: string; amount: number | string }>;
      };
      if (!json.ok || !Array.isArray(json.entries)) return;
      setAdditionalSpendEntries(
        json.entries.map((e) => ({
          date: e.date,
          amount: Number(e.amount),
        })),
      );
    } catch {
      setAdditionalSpendEntries([]);
    }
  }, [eventId]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAdditionalSpendEntries();
    });
  }, [loadAdditionalSpendEntries]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<{ eventId?: string }>).detail;
      if (detail?.eventId === eventId) void loadAdditionalSpendEntries();
    };
    window.addEventListener(ADDITIONAL_SPEND_CHANGED, onChanged);
    return () => window.removeEventListener(ADDITIONAL_SPEND_CHANGED, onChanged);
  }, [eventId, loadAdditionalSpendEntries]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadRollupTimeline();
    });
  }, [loadRollupTimeline]);

  const sellOutPacing = useMemo(
    () =>
      computeSellOutPacing({
        capacity: event.capacity,
        eventDate: event.eventDate,
        preregSpend: event.preregSpend ?? null,
        metaSpendCached: event.metaSpendCached ?? null,
        timeline: rollupTimeline,
        additionalSpendEntries,
      }),
    [
      event.capacity,
      event.eventDate,
      event.preregSpend,
      event.metaSpendCached,
      rollupTimeline,
      additionalSpendEntries,
    ],
  );

  // Imperative handle on the active creatives section so the manual
  // refresh below can ALSO bust that endpoint — not just the headline
  // insights cache. Pre-PR #63 the Refresh button only re-fetched the
  // headline payload, leaving the already-loaded creative cards on
  // the previous (cached) data. A Meta-side rename of "Loading Bars
  // - Copy" → "Loading Bars" never propagated until the staffer
  // bounced the timeframe pill.
  const creativesRef = useRef<InternalActiveCreativesHandle>(null);

  /**
   * Manual refresh — wired to the Refresh button in the live
   * report footer. Three parallel sub-tasks:
   *
   *   1. Rollup-sync (PR #71) — POSTs `/api/ticketing/rollup-sync`
   *      to pull today's Meta + Eventbrite rows into
   *      `event_daily_rollups`. Pre-PR #71 this only ran on
   *      EventDailyReportBlock mount, so a refresh from the Meta
   *      block left the Daily Tracker stale (today's row missing)
   *      until the user separately clicked "Sync now" on the
   *      tracker. Now both buttons converge on the same source of
   *      truth.
   *
   *   2. Insights cache-bust (PR #57 #3) — `?force=1` on the
   *      headline insights route bypasses the 5-minute server-side
   *      cache for the current (event, timeframe) bucket only.
   *
   *   3. Active-creatives cache-bust (PR #63) — calls into the
   *      section's imperative `refresh()` so the cards re-fetch with
   *      `?force=1`. No-op when the section hasn't been expanded.
   *
   * All three run via `Promise.allSettled` so the spinner stays on
   * until the slowest side returns. Combined error message names
   * which surface failed (`Rollup: …` / `Insights: …` / `Creatives:
   * …`) so a partial outage is still actionable from the inline
   * "Refresh failed: …" line.
   *
   * The EventDailyReportBlock owns its own cached `timeline` state
   * via local `useState`, so the freshly-written rollup rows won't
   * appear in the tracker until either the page is reloaded or the
   * Daily Tracker's "Sync now" button is clicked. The new
   * `event_daily_rollups` rows are still written though — this
   * handler just makes sure the source of truth stays current.
   */
  const handleManualRefresh = useCallback(async () => {
    const rollupTask = (async () => {
      const res = await fetch(
        `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(eventId)}`,
        { method: "POST", cache: "no-store" },
      );
      // 207 = partial success (one leg failed). Treat as success at
      // this layer — the per-leg detail is logged server-side and
      // the EventDailyReportBlock's own SyncStatusPanel covers the
      // dedicated UX when a staffer needs the diagnostic.
      if (!res.ok && res.status !== 207) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // Non-JSON body — fall through to the HTTP code.
        }
        throw new Error(message);
      }
    })();

    const insightsTask = (async () => {
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
    })();

    // No-op when the creatives section hasn't been opened — the
    // imperative handle short-circuits in that case so we don't pay
    // the Meta fan-out for a section the user hasn't expanded.
    const creativesTask =
      creativesRef.current?.refresh() ?? Promise.resolve();

    const results = await Promise.allSettled([
      rollupTask,
      insightsTask,
      creativesTask,
    ]);
    const failures: string[] = [];
    if (results[0].status === "rejected") {
      const reason = results[0].reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      failures.push(`Rollup: ${msg}`);
    }
    if (results[1].status === "rejected") {
      const reason = results[1].reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      failures.push(`Insights: ${msg}`);
    }
    if (results[2].status === "rejected") {
      const reason = results[2].reason;
      const msg = reason instanceof Error ? reason.message : String(reason);
      failures.push(`Creatives: ${msg}`);
    }
    if (failures.length > 0) {
      throw new Error(failures.join(" · "));
    }
    void loadRollupTimeline();
  }, [eventId, datePreset, customRange, loadRollupTimeline]);

  const flagBanner =
    clientId ? (
      <div className="mb-4">
        <EnhancementFlagBanner clientId={clientId} eventIds={[eventId]} />
      </div>
    ) : null;

  if (state.kind === "loading") {
    return (
      <>
        {flagBanner}
        <section className="rounded-md border border-border bg-card p-8">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading report…
          </div>
        </section>
      </>
    );
  }

  if (state.kind === "unavailable") {
    return (
      <>
        {flagBanner}
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
      </>
    );
  }

  return (
    <>
      {flagBanner}
      <EventReportView
      event={event}
      meta={state.data}
      datePreset={datePreset}
      customRange={customRange}
      creativesSource={{ kind: "internal", eventId }}
      onTimeframeChange={onTimeframeChange}
      onManualRefresh={handleManualRefresh}
      // PR #62 #1 — drop the per-placement preview tile row in favour
      // of the same concept-card summary the public share view renders.
      // Identical surface on both views; same lazy-load opt-in so the
      // Meta fan-out stays off the critical path of opening the tab.
      creativesSlot={
        <InternalActiveCreativesSection
          ref={creativesRef}
          eventId={eventId}
          clientId={clientId}
          datePreset={datePreset}
          customRange={customRange}
        />
      }
      variant="embedded"
      additionalSpendEntries={additionalSpendEntries}
      sellOutPacing={sellOutPacing}
      additionalSpendSlot={additionalSpendSlot}
    />
    </>
  );
}
