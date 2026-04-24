"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type {
  CustomDateRange,
  DatePreset,
  EventInsightsPayload,
} from "@/lib/insights/types";

import type { SellOutPacingResult } from "@/lib/dashboard/report-pacing";

import {
  EventReportView,
  type EventReportViewEvent,
} from "./event-report-view";
import type { TikTokReportBlockData } from "./tiktok-report-block";

interface Props {
  event: EventReportViewEvent;
  /**
   * Meta insights payload. `null` when the client has no Meta ad account
   * linked (or no event_code, or Meta upstream errored on a token still
   * in scope) — in that case the share page is expected to also pass a
   * non-null `tiktok` snapshot so something still renders. The page-level
   * fallback (ReportUnavailable) catches the both-null case before this
   * component is ever instantiated.
   */
  meta: EventInsightsPayload | null;
  /**
   * Latest manual TikTok report snapshot for this event, or null when no
   * import has happened yet. Either `meta` or `tiktok` (often both) is
   * non-null when this component renders.
   */
  tiktok: TikTokReportBlockData | null;
  /**
   * Public share token. Already in the URL — rendering it in the page
   * (via the lazy creative loader's source prop) doesn't add exposure.
   * Internal IDs (event_id, client_id, user_id, ad_account_id)
   * deliberately do NOT appear in the prop shape.
   */
  shareToken: string;
  /**
   * Active timeframe, resolved by the RSC from `?tf=`. Drives the
   * timeframe selector + the cache bucket the RSC re-fetches under
   * when the user clicks a different preset.
   */
  datePreset: DatePreset;
  /**
   * Active custom range when `datePreset === "custom"`. Resolved by
   * the RSC from `?from` + `?to`. Ignored for any preset value.
   */
  customRange?: CustomDateRange;
  /**
   * Optional server-rendered slot that replaces the lazy "Creative
   * performance" section. Pre-rendered upstream (in the share RSC)
   * so the client-facing report doesn't depend on a separate fetch
   * round-trip from the visitor's browser.
   *
   * ReactNode (not a render fn) so a server component can be passed
   * straight through this client component.
   */
  creativesSlot?: React.ReactNode;
  /**
   * Optional server-rendered slot for the per-event daily report
   * block (summary header + trend chart + tracker table). Server-
   * rendered upstream so the public visitor doesn't need a separate
   * authenticated round-trip — the share token IS the credential and
   * the RSC has already resolved the timeline through the service-
   * role client.
   *
   * Same ReactNode contract as `creativesSlot` so a server component
   * passes straight through this client wrapper.
   */
  eventDailySlot?: React.ReactNode;
  /**
   * True when the share RSC's headline insights call failed but
   * the active-creatives call succeeded. Drives a partial render:
   * `meta` will be null in this case, the headline metric grid is
   * suppressed, and a muted banner explains the state above the
   * still-live creative breakdown.
   */
  headlineUnavailable?: boolean;
  /** Additional spend rows for Campaign performance Meta / Other split. */
  additionalSpendEntries?: ReadonlyArray<{ date: string; amount: number }>;
  /** Lifetime-rollups sell-out pacing for the Tickets card. */
  sellOutPacing?: SellOutPacingResult | null;
  /** Token-scoped additional spend editor (share page only). */
  additionalSpendSlot?: ReactNode;
}

/*
 * Re snapshot-first active-creatives stale banner: lives INSIDE
 * the `creativesSlot` rather than as a `PublicReport` prop. The
 * slot wrapper is composed in the share RSC
 * (`app/share/report/[token]/page.tsx`) which already owns the
 * snapshot read and the eventId / preset / customRange the
 * banner needs to drive its Refresh button — keeping it co-
 * located with the slot avoids prop-drilling six fields down
 * three component layers and keeps `PublicReport` agnostic of
 * the cache shape. See `<ActiveCreativesStaleBanner />`.
 */

/**
 * Public-side wrapper around `EventReportView`.
 *
 * The body of the report is the shared client component
 * `EventReportView`. This file only owns the public-specific bit: when
 * the user picks a new timeframe, push `?tf=<preset>` onto the URL so
 * the RSC re-renders, re-fetches insights against the new window, and
 * the next visitor lands directly on the new preset. Cleaner than
 * mounting the whole report in client state — keeps the deep link
 * shareable.
 *
 * The report layout itself (headers, stats, tables, lazy creatives,
 * footer) lives in `event-report-view.tsx` so the internal Reporting
 * tab mirror can render the same JSX without copy-paste drift.
 */
export function PublicReport({
  event,
  meta,
  tiktok,
  shareToken,
  datePreset,
  customRange,
  creativesSlot,
  eventDailySlot,
  headlineUnavailable = false,
  additionalSpendEntries,
  sellOutPacing = null,
  additionalSpendSlot,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // useTransition gives us a pending flag for the duration of the
  // RSC navigation triggered by `router.push`. Without this the
  // visitor sees no feedback for 300-800ms when a pre-warmed preset
  // resolves from cache — pills don't move, content doesn't change,
  // looks like the click was lost. Wrapping the push lets us flip
  // a sticky shimmer + dim the metric grid for the in-flight window
  // even on cache hits where there's no Suspense fallback.
  const [isPending, startTransition] = useTransition();

  const handleTimeframeChange = (
    preset: DatePreset,
    nextRange?: CustomDateRange,
  ) => {
    // No-op when nothing changed — prevents `tf=custom` Apply from
    // pushing a duplicate URL when the user re-clicks Apply with the
    // same dates.
    if (
      preset === datePreset &&
      preset !== "custom" &&
      !rangeChanged(customRange, nextRange)
    ) {
      return;
    }

    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (preset === "custom") {
      if (!nextRange) return; // Defensive — picker guards Apply.
      sp.set("tf", "custom");
      sp.set("from", nextRange.since);
      sp.set("to", nextRange.until);
    } else {
      // Drop from/to whenever a preset is picked so the canonical URL
      // for, say, last_7d doesn't carry stale custom params.
      sp.delete("from");
      sp.delete("to");
      if (preset === "maximum") {
        // "maximum" is the default — drop the param so the canonical
        // URL doesn't grow `?tf=maximum` for the home preset.
        sp.delete("tf");
      } else {
        sp.set("tf", preset);
      }
    }
    const qs = sp.toString();
    startTransition(() => {
      router.push(qs ? `${pathname}?${qs}` : pathname);
    });
  };

  // Resolves a pending refresh promise once `isPending` flips back
  // to false (i.e. the RSC navigation has settled). Without this
  // we can't reliably await the transition — `startTransition`
  // doesn't return a promise and `router.push` resolves before the
  // RSC has even started rendering. PR #63 — without this hop the
  // cleanup `router.replace` below would supersede the in-flight
  // `?refresh=1` push and the share RSC would never bypass the
  // snapshot cache (visitor sees the same stale creative names
  // they came in with).
  const transitionResolveRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!isPending && transitionResolveRef.current) {
      const resolve = transitionResolveRef.current;
      transitionResolveRef.current = null;
      resolve();
    }
  }, [isPending]);

  /**
   * Manual refresh — wired to the Refresh button on the Meta Live
   * Report block's footer (PR #57 #3 / PR #63 / PR #71).
   *
   * Two phases:
   *
   *   Phase 1 — Rollup-sync (PR #71). POST the public-safe
   *   `/api/ticketing/rollup-sync/by-share-token/[token]` to write
   *   today's Meta + Eventbrite rows into `event_daily_rollups`
   *   BEFORE the share RSC re-reads them. Pre-PR #71 this only
   *   fired on internal event-page mount, so a client viewing the
   *   share URL after midnight saw a stale Daily Tracker (today's
   *   row missing) until a staffer opened the dashboard. The route
   *   is auth'd by the share token itself — same credential the
   *   visitor used to load the page — and resolves the event +
   *   owning user from `report_shares`, so we don't expose write
   *   access to arbitrary events. Promise.allSettled posture: a
   *   rollup-sync failure must NOT block the cache busts; the
   *   failure is surfaced inline as `Rollup: <msg>`.
   *
   *   Phase 2 — Snapshot bust. Push the URL with `?refresh=1` so
   *   the share RSC bypasses its `share_snapshots` lookup for this
   *   (event, timeframe) bucket and writes a fresh entry. The
   *   snapshot bundles BOTH headline insights AND active creatives
   *   in the same row, so a single bust covers both surfaces — no
   *   need to call two separate endpoints the way the internal
   *   Reporting tab does. The RSC also re-reads
   *   `event_daily_rollups` for the daily tracker block, so the
   *   freshly-written row from Phase 1 lands in the same render.
   *
   * Critically: the cleanup `router.replace` is gated on the push
   * actually completing — see `transitionResolveRef` above. Pre-PR
   * #63 the resolve fired immediately after `router.push` returned,
   * which let the cleanup `router.replace` cancel the in-flight
   * push. Result: the share RSC was re-rendered without
   * `?refresh=1`, the snapshot was re-read from cache, and the
   * visitor saw the same stale creative names.
   *
   * Returns once both phases settle, so `<RefreshReportButton>`
   * can clear its spinner.
   */
  const handleManualRefresh = useCallback(async () => {
    // Phase 1 — Rollup-sync via the public-safe share-token route.
    // Run sequentially BEFORE the snapshot bust so the freshly
    // upserted `event_daily_rollups` row is visible to the share
    // RSC's daily-timeline read. Failures are caught and recorded
    // but never block Phase 2 — the user spec is "if rollup-sync
    // fails, still do the cache busts and surface error as
    // 'Rollup: <msg>'".
    let rollupError: string | null = null;
    try {
      const res = await fetch(
        `/api/ticketing/rollup-sync/by-share-token/${encodeURIComponent(
          shareToken,
        )}`,
        { method: "POST", cache: "no-store" },
      );
      // 207 = partial success — treat as success at this layer; the
      // per-leg detail is logged server-side.
      if (!res.ok && res.status !== 207) {
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // Non-JSON body — fall through to the HTTP code.
        }
        rollupError = message;
      }
    } catch (err) {
      rollupError = err instanceof Error ? err.message : "Unknown error";
    }

    // Phase 2 — Snapshot bust via `?refresh=1` push, awaited so the
    // cleanup `router.replace` doesn't cancel the in-flight push.
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    sp.set("refresh", "1");
    const qs = sp.toString();
    await new Promise<void>((resolve) => {
      transitionResolveRef.current = resolve;
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    });
    // Strip the bust param so the canonical URL stays clean.
    // `replace` avoids stacking history entries; safe to fire now
    // because the push above has fully settled — the snapshot has
    // been re-written under the new (event, timeframe) key, so a
    // re-render at the clean URL reads the fresh entry from cache.
    const cleanup = new URLSearchParams(searchParams?.toString() ?? "");
    cleanup.delete("refresh");
    cleanup.delete("force");
    const cleanQs = cleanup.toString();
    router.replace(cleanQs ? `${pathname}?${cleanQs}` : pathname);

    // Surface the rollup-sync failure (if any) to the
    // RefreshReportButton inline error line. The cache busts have
    // still completed at this point, so the visible report will
    // already reflect the latest snapshot.
    if (rollupError) {
      throw new Error(`Rollup: ${rollupError}`);
    }
  }, [
    pathname,
    router,
    searchParams,
    shareToken,
    startTransition,
  ]);

  return (
    <EventReportView
      event={event}
      meta={meta}
      tiktok={tiktok}
      datePreset={datePreset}
      customRange={customRange}
      creativesSource={{ kind: "share", token: shareToken }}
      onTimeframeChange={handleTimeframeChange}
      onManualRefresh={handleManualRefresh}
      isRefreshing={isPending}
      creativesSlot={creativesSlot}
      eventDailySlot={eventDailySlot}
      headlineUnavailable={headlineUnavailable}
      additionalSpendEntries={additionalSpendEntries}
      sellOutPacing={sellOutPacing}
      additionalSpendSlot={additionalSpendSlot}
      onShareReportDataMutated={() => router.refresh()}
    />
  );
}

function rangeChanged(
  prev: CustomDateRange | undefined,
  next: CustomDateRange | undefined,
): boolean {
  if (!prev && !next) return false;
  if (!prev || !next) return true;
  return prev.since !== next.since || prev.until !== next.until;
}
