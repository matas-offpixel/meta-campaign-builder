"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type {
  CustomDateRange,
  DatePreset,
  EventInsightsPayload,
} from "@/lib/insights/types";

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
}

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

  return (
    <EventReportView
      event={event}
      meta={meta}
      tiktok={tiktok}
      datePreset={datePreset}
      customRange={customRange}
      creativesSource={{ kind: "share", token: shareToken }}
      onTimeframeChange={handleTimeframeChange}
      isRefreshing={isPending}
      creativesSlot={creativesSlot}
      eventDailySlot={eventDailySlot}
      headlineUnavailable={headlineUnavailable}
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
