"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { DatePreset, EventInsightsPayload } from "@/lib/insights/types";

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
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleTimeframeChange = (preset: DatePreset) => {
    if (preset === datePreset) return;
    const sp = new URLSearchParams(searchParams?.toString() ?? "");
    if (preset === "maximum") {
      // "maximum" is the default — drop the param so the canonical URL
      // doesn't grow `?tf=maximum` for the home preset.
      sp.delete("tf");
    } else {
      sp.set("tf", preset);
    }
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <EventReportView
      event={event}
      insights={insights}
      datePreset={datePreset}
      creativesSource={{ kind: "share", token: shareToken }}
      onTimeframeChange={handleTimeframeChange}
    />
  );
}
