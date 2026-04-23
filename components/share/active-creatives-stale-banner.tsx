"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { CustomDateRange, DatePreset } from "@/lib/insights/types";

/**
 * components/share/active-creatives-stale-banner.tsx
 *
 * Subtle banner rendered ABOVE the public share report's "Active
 * creatives" section when the rendering RSC served the section
 * from a cached `active_creatives_snapshots` row that's already
 * past its `expires_at`. The RSC has ALREADY fired the
 * fire-and-forget background refresh by the time this banner
 * mounts — the button is purely a viewer-driven "I'd like to
 * wait for the new numbers" affordance, not the only way to
 * trigger a refresh. The cron + the RSC's auto-kick remain the
 * primary refreshers.
 *
 * Why client component
 *   - Relative timestamp ("12 minutes ago") is evaluated in the
 *     viewer's clock, not the server's, so it stays accurate
 *     across tab restores / long-open windows.
 *   - The Refresh button calls
 *     `/api/internal/refresh-active-creatives` directly and then
 *     `router.refresh()`s the RSC tree to pick up the freshly-
 *     written snapshot row. Server components can't do
 *     `router.refresh()`.
 *
 * Why this lives inside the slot, not a `PublicReport` prop
 *   The share RSC already owns the snapshot read AND the
 *   `(eventId, preset, customRange)` triple this banner needs to
 *   drive its Refresh call. Wrapping the slot at the RSC level
 *   (rather than threading six new props through PublicReport →
 *   EventReportView → MetaReportBlock) keeps the cache shape
 *   contained to the share-report tree.
 *
 * Concurrency
 *   `isRefreshing` is a local boolean — concurrent clicks during
 *   an in-flight refresh are no-ops. The internal route is
 *   itself idempotent (skips the Meta call when the snapshot is
 *   fresh and isStale=false), so a stray double-click can't
 *   double-spend rate-limit budget either way.
 */

interface Props {
  /** ISO string from the snapshot's `fetched_at` column. */
  fetchedAt: string;
  eventId: string;
  preset: DatePreset;
  customRange?: CustomDateRange;
}

export function ActiveCreativesStaleBanner({
  fetchedAt,
  eventId,
  preset,
  customRange,
}: Props) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/internal/refresh-active-creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          event_id: eventId,
          preset,
          custom_range: customRange ?? null,
        }),
      });
      // 207 = partial success (some preset wrote, some skipped) —
      // still counts as a meaningful refresh from the viewer's
      // perspective; let `router.refresh()` re-read whatever
      // landed.
      if (!res.ok && res.status !== 207) {
        // 401/403 are expected on this surface for unauthenticated
        // viewers — the route only accepts CRON_SECRET or an
        // owner session, and the public share viewer has neither.
        // The RSC's own background kick ALSO targets this route
        // and uses the cron secret, so the eventual refresh still
        // happens; the manual button just can't accelerate it
        // here. Surface a friendly note rather than the raw
        // status.
        if (res.status === 401 || res.status === 403) {
          setError("Sign in as the owner to force a refresh.");
        } else {
          setError(`Refresh failed (HTTP ${res.status}).`);
        }
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }, [customRange, eventId, isRefreshing, preset, router]);

  return (
    <div className="rounded-lg border border-dashed border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Data as of <RelativeTime iso={fetchedAt} /> ago. New numbers are on
          the way.
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
        {error ? (
          <span className="text-destructive" role="status">
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tiny relative-time formatter. Avoids pulling in
 * date-fns/formatDistanceToNow just for one banner — the share
 * page bundle is already big enough and the seven canned
 * brackets below cover every cadence the cron can produce
 * (tightest TTL = 2h, default = 6h; staleness past that is
 * always "X hours" or "X days").
 *
 * Reads `Date.now()` from a `useState` initializer + a
 * `useEffect` re-tick on mount instead of inline at render —
 * inline reads of `Date.now()` violate React 19's purity rule
 * and the build-time `react-hooks/purity` lint catches it. The
 * banner only re-renders when its parent (the share RSC) re-
 * renders OR when the visitor clicks Refresh (which triggers
 * `router.refresh()` and re-mounts this component anyway), so
 * a static read at mount is the right semantic.
 */
function RelativeTime({ iso }: { iso: string }) {
  // Subscribe to the wall clock — re-tick every 30s so a tab
  // left open through the cron's 6-hour cadence still shows a
  // meaningful relative time. The interval is a legitimate
  // external-system subscription per the
  // `react-hooks/set-state-in-effect` lint exception. The
  // useState initializer reads the clock at mount; pending the
  // first tick the displayed value is whatever the server
  // rendered, which may be a few hundred ms stale — fine for a
  // bracketed "X min" display, never visible for the cron's
  // tightest TTL.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return <span>some time</span>;
  const diffSeconds = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSeconds < 60) return <span>{diffSeconds}s</span>;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return <span>{diffMinutes} min</span>;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return <span>{diffHours}h</span>;
  }
  const diffDays = Math.floor(diffHours / 24);
  return <span>{diffDays} day{diffDays === 1 ? "" : "s"}</span>;
}
