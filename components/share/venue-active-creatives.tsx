"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import ShareActiveCreativesClient from "@/components/share/share-active-creatives-client";
import type { CustomDateRange, DatePreset } from "@/lib/insights/types";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import type { MetaThumbnailProxyAuth } from "@/lib/dashboard/meta-thumbnail-proxy-url";

/**
 * components/share/venue-active-creatives.tsx
 *
 * Lazy-loaded "Active creatives" strip embedded in each expanded
 * venue card on the multi-venue client portal
 * (`/share/client/[token]`). Fires a one-shot fetch against
 * `/api/share/client/[token]/venue-creatives/[event_code]` the first
 * time it mounts, then hands the resolved concept groups to the
 * existing `<ShareActiveCreativesClient>` card grid so the visual
 * language matches the per-event share page exactly.
 *
 * Why lazy and not server-rendered:
 *
 *   - The portal renders 16+ venue cards for a wide client. Fanning
 *     16 Meta Graph round-trips out of the share RSC on first paint
 *     would tip the per-account rate budget and double the TTFB.
 *   - Cards are collapsed by default except for the 3-4 most active.
 *     Fetching creatives for every card, when most are never
 *     opened, is wasted work.
 *
 * "Top 4" rule:
 *
 *   Server-side sort is spend DESC already — we just slice the first
 *   four. A "View all N" toggle expands to the full list inline (no
 *   modal swap, no navigation) so the operator can dig deeper without
 *   losing their scroll position in the venue stack.
 *
 * Solo venue / no event_code:
 *
 *   Groups without a shared `event_code` never get a creatives strip
 *   — Meta's /ads query is keyed by the bracket-wrapped event_code so
 *   there's nothing to correlate against. The caller guards this by
 *   not rendering the component.
 */

interface Props {
  /**
   * Share token for external portal (`/share/client/[token]`). Empty
   * string when the strip is rendered inside the internal dashboard —
   * `isInternal` takes precedence in that case.
   */
  token: string;
  eventCode: string;
  /**
   * Display copy for the section header (e.g. "Leeds" or the
   * venue's display name). Kept on the props surface so the caller
   * can label the strip without the component having to re-derive
   * it from the event_code.
   */
  venueLabel: string;
  /**
   * When true, fetch from the session-authenticated internal route
   * (`/api/internal/clients/[clientId]/venue-creatives/[event_code]`)
   * instead of the share-token route. Required because internal
   * dashboards don't carry a token — passing an empty token to the
   * share route produced a malformed URL that Next served as an HTML
   * 404, which the operator then saw as "Creative breakdown
   * unavailable" with a raw DOCTYPE in the error message.
   */
  isInternal?: boolean;
  /**
   * Client UUID. Only consulted when `isInternal` is true — gates the
   * ownership check on the internal route so the operator can't probe
   * creatives under a client they don't own.
   */
  clientId?: string;
  datePreset?: DatePreset;
  customRange?: CustomDateRange;
  refreshNonce?: number;
  fullReport?: boolean;
}

type ApiResponse =
  | {
      ok: true;
      groups: ConceptGroupRow[];
      meta: {
        campaigns_total: number;
        ads_fetched: number;
        truncated: boolean;
      };
    }
  | {
      ok: false;
      error: string;
    };

type State =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      groups: ConceptGroupRow[];
      campaignsTotal: number;
      adsFetched: number;
      truncated: boolean;
    }
  | { status: "empty" }
  | { status: "error"; message: string };

const TOP_N = 4;

/**
 * Robust JSON parser for fetch responses. Distinguishes three failure
 * modes that the naive `res.json()` collapses:
 *
 *   1. Empty body (HEAD redirects, misrouted 200s) — surfaces the
 *      HTTP status so the caller isn't left with a mysterious
 *      `SyntaxError: Unexpected end of JSON input`.
 *   2. HTML body (Next.js default 404 page, auth redirect to /login,
 *      WAF blocks) — clips the first 200 chars into the error so the
 *      operator can see "Not Found" or "<!DOCTYPE html>" inline and
 *      diagnose the routing problem without reaching for devtools.
 *   3. Valid JSON — returned as-is.
 *
 * The shared pattern from PR #113 (`components/dashboard/events/additional-spend-card.tsx`).
 */
async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${res.status}: empty response body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status}: non-JSON response — ${text.slice(0, 200)}`,
    );
  }
}

export function VenueActiveCreatives({
  token,
  eventCode,
  venueLabel,
  isInternal,
  clientId,
  datePreset = "maximum",
  customRange,
  refreshNonce = 0,
  fullReport = false,
}: Props) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [showAll, setShowAll] = useState(false);
  const [manualRefreshNonce, setManualRefreshNonce] = useState(0);
  const effectiveRefreshNonce = refreshNonce + manualRefreshNonce;

  useEffect(() => {
    // Inline AbortController handles React strict-mode's double-
    // invocation in development and the unusual case of a user
    // collapsing the venue card mid-fetch (the enclosing component
    // keys off `isExpanded`, so an unmount is the remount on
    // re-expand).
    const ctrl = new AbortController();
    let cancelled = false;

    async function run() {
      setState({ status: "loading" });
      // Route selection — internal dashboard uses session auth, the
      // external share portal uses the token. Bail early with a
      // helpful error rather than firing a malformed URL when the
      // caller hands us nothing to route with.
      let url: string;
      if (isInternal) {
        if (!clientId) {
          if (!cancelled) {
            setState({
              status: "error",
              message: "Missing clientId for internal creatives fetch",
            });
          }
          return;
        }
        url = `/api/internal/clients/${encodeURIComponent(clientId)}/venue-creatives/${encodeURIComponent(eventCode)}`;
      } else {
        if (!token) {
          if (!cancelled) {
            setState({
              status: "error",
              message: "Missing share token for creatives fetch",
            });
          }
          return;
        }
        url = `/api/share/client/${encodeURIComponent(token)}/venue-creatives/${encodeURIComponent(eventCode)}`;
      }
      const qs = new URLSearchParams();
      qs.set("datePreset", datePreset);
      if (datePreset === "custom" && customRange) {
        qs.set("since", customRange.since);
        qs.set("until", customRange.until);
      }
      if (effectiveRefreshNonce > 0) {
        qs.set("force", "1");
        qs.set("nonce", String(effectiveRefreshNonce));
      }
      url = `${url}?${qs.toString()}`;

      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          // The underlying fetcher already busts its own cache; we
          // don't want the browser to serve a stale 304 when the
          // operator collapses + re-expands a card while Meta is
          // actively delivering fresh spend.
          cache: "no-store",
        });
        let payload: ApiResponse;
        try {
          payload = await safeJson<ApiResponse>(res);
        } catch (parseErr) {
          if (cancelled) return;
          // `safeJson` already prefixed the HTTP status + clipped the
          // body; nothing to add here. The inline error surface
          // shows the full message so the operator can tell
          // "403 Forbidden" from "404 Not Found" from a raw HTML
          // auth redirect.
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          setState({ status: "error", message });
          return;
        }
        if (cancelled) return;
        if (!res.ok || !payload.ok) {
          const message =
            !payload.ok && payload.error
              ? payload.error
              : `HTTP ${res.status}`;
          setState({ status: "error", message });
          return;
        }
        if (payload.groups.length === 0) {
          setState({ status: "empty" });
          return;
        }
        setState({
          status: "ready",
          groups: payload.groups,
          campaignsTotal: payload.meta.campaigns_total,
          adsFetched: payload.meta.ads_fetched,
          truncated: payload.meta.truncated,
        });
      } catch (err) {
        if (cancelled) return;
        // AbortError bubbles here when the user navigates away or
        // collapses the card; silently drop rather than flashing a
        // spurious error to someone who has already moved on.
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ status: "error", message });
      }
    }

    void run();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [
    token,
    eventCode,
    isInternal,
    clientId,
    datePreset,
    customRange?.since,
    customRange?.until,
    customRange,
    effectiveRefreshNonce,
  ]);

  return (
    <section
      className={
        fullReport ? "space-y-3" : "border-t border-border bg-card px-4 py-4"
      }
    >
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        {fullReport ? (
          <h2 className="font-heading text-base tracking-wide text-foreground">
            Active creatives
          </h2>
        ) : (
          <h3 className="font-heading text-sm tracking-wide text-foreground">
            Top creatives · {venueLabel}
          </h3>
        )}
        <Caveat
          state={state}
          showAll={showAll}
          onToggle={() => setShowAll((v) => !v)}
          onRefresh={() => setManualRefreshNonce((value) => value + 1)}
          fullReport={fullReport}
        />
      </header>

      {state.status === "loading" && <LoadingGrid />}
      {state.status === "empty" && (
        <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-4 text-xs text-muted-foreground">
          No active creatives for this venue yet — the campaign may be
          paused, or the creative concepts haven&rsquo;t started
          delivering.
        </p>
      )}
      {state.status === "error" && (
        <p className="rounded-md border border-dashed border-border bg-muted/50 px-3 py-4 text-xs text-muted-foreground">
          Creative breakdown unavailable
          <span className="ml-2 text-muted-foreground/60">
            ({state.message})
          </span>
        </p>
      )}
      {state.status === "ready" && (
        <ShareActiveCreativesClient
          groups={fullReport || showAll ? state.groups : state.groups.slice(0, TOP_N)}
          thumbnailAuth={thumbnailProxyAuth({
            isInternal,
            clientId,
            token,
            eventCode,
          })}
        />
      )}
    </section>
  );
}

function thumbnailProxyAuth(input: {
  isInternal?: boolean;
  clientId?: string;
  token: string;
  eventCode: string;
}): MetaThumbnailProxyAuth | null {
  if (input.isInternal && input.clientId) {
    return { kind: "session", clientId: input.clientId };
  }
  if (!input.isInternal && input.token) {
    return {
      kind: "share",
      shareToken: input.token,
      eventCode: input.eventCode,
    };
  }
  return null;
}

function Caveat({
  state,
  showAll,
  onToggle,
  onRefresh,
  fullReport,
}: {
  state: State;
  showAll: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  fullReport: boolean;
}) {
  if (state.status === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        Fetching active ads…
      </span>
    );
  }
  if (state.status !== "ready") {
    return (
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
      >
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        Refresh Creatives
      </button>
    );
  }
  const { groups, adsFetched, campaignsTotal } = state;
  const summary = fullReport || groups.length <= TOP_N ? (
      <span className="text-[11px] text-muted-foreground">
        {groups.length} concept{groups.length === 1 ? "" : "s"} ·{" "}
        {adsFetched} ad{adsFetched === 1 ? "" : "s"} across{" "}
        {campaignsTotal} campaign{campaignsTotal === 1 ? "" : "s"}
      </span>
  ) : (
    <button
      type="button"
      onClick={onToggle}
      className="text-[11px] font-medium text-primary hover:text-primary-hover underline underline-offset-2"
    >
      {showAll
        ? `Show top ${TOP_N} only`
        : `View all ${groups.length} concepts →`}
    </button>
  );
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {summary}
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
      >
        <RefreshCw className="h-3 w-3" aria-hidden="true" />
        Refresh Creatives
      </button>
    </span>
  );
}

function LoadingGrid() {
  // Match the ShareActiveCreativesClient layout (sm:grid-cols-2 /
  // lg:grid-cols-3) so the skeleton frame collapses into the
  // populated grid without a layout shift when data arrives.
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: TOP_N }).map((_, i) => (
        <div
          key={i}
          className="h-[220px] animate-pulse rounded-md border border-border bg-muted/50"
        />
      ))}
    </div>
  );
}
