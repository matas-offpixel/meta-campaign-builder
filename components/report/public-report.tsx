"use client";

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

interface Props {
  event: EventReportViewEvent;
  insights: EventInsightsPayload;
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
  insights,
  shareToken,
  datePreset,
  customRange,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <EventReportView
      event={event}
      insights={insights}
      datePreset={datePreset}
      customRange={customRange}
      creativesSource={{ kind: "share", token: shareToken }}
      onTimeframeChange={handleTimeframeChange}
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
