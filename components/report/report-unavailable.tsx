import { fmtDate } from "@/lib/dashboard/format";
import type { InsightsErrorReason } from "@/lib/insights/types";

import { AutoRetry } from "./auto-retry";

interface Props {
  eventName: string;
  venueName: string | null;
  venueCity: string | null;
  eventDate: string | null;
  reason: InsightsErrorReason;
}

/**
 * Neutral fallback when the report can't render numbers (owner token
 * expired, no ad account linked, Meta API down, etc).
 *
 * Per the Slice U brief: never serve stale cached data — misleading
 * clients is worse than telling them the report is paused. The event
 * header stays visible so the recipient knows their link is real.
 *
 * The copy now distinguishes transient Meta-side outages (which the
 * user should just wait out — and which we auto-retry on their behalf
 * via `<AutoRetry>`) from hard auth failures (which need agency
 * intervention and won't fix themselves on a reload).
 */
export function ReportUnavailable({
  eventName,
  venueName,
  venueCity,
  eventDate,
  reason,
}: Props) {
  const venue = [venueName, venueCity].filter(Boolean).join(", ");
  const copy = resolveCopy(reason);
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Event Report by Off Pixel
          </p>
          <h1 className="font-heading text-3xl tracking-wide text-foreground">
            {eventName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[venue, eventDate ? fmtDate(eventDate) : null]
              .filter(Boolean)
              .join(" · ") || "—"}
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-12">
        <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
          <h2 className="font-heading text-lg tracking-wide text-foreground">
            {copy.title}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {copy.body}
          </p>
          {/*
            Reason is rendered as a tiny diagnostic line. We deliberately
            avoid surfacing the underlying Meta error (which can leak
            campaign IDs) — the reason code is enough for the agency to
            pattern-match against server logs.
          */}
          <p className="mt-6 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Status: {copy.status}
          </p>
          {/*
            AutoRetry only on transient reasons — anything that won't
            resolve itself without operator action (config, expired
            tokens, bad date range) gets no countdown so the visitor
            isn't tricked into waiting on a screen that can't recover.
          */}
          {isTransientReason(reason) ? <AutoRetry intervalSec={45} /> : null}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        Powered by Off Pixel
      </footer>
    </main>
  );
}

interface UnavailableCopy {
  title: string;
  body: string;
  status: string;
}

/**
 * Map an `InsightsErrorReason` to user-facing copy + the short
 * status label rendered as a diagnostic line. Distinguishes
 * transient Meta-side outages (rate-limit / 5xx / network blip)
 * from hard configuration / auth failures so the visitor sees
 * something honest about the cause.
 */
function resolveCopy(reason: InsightsErrorReason): UnavailableCopy {
  switch (reason) {
    case "meta_api_error":
      return {
        title: "Meta is taking a moment",
        body: "This usually clears in a few minutes. Please try again shortly.",
        status: "upstream error",
      };
    case "owner_token_expired":
      return {
        title: "Report temporarily unavailable",
        body: "Connection to the ad account has expired. The agency has been notified.",
        status: "reconnect required",
      };
    case "no_owner_token":
      return {
        title: "Report temporarily unavailable",
        body: "The ad account isn't connected yet. The agency has been notified.",
        status: "reconnect required",
      };
    case "no_event_code":
    case "no_ad_account":
      return {
        title: "Report not yet available",
        body:
          "This event doesn't have its Meta setup completed yet. The agency has been notified.",
        status: "configuration",
      };
    case "no_campaigns_matched":
      return {
        title: "No campaigns yet",
        body:
          "We couldn't find any Meta campaigns linked to this event. " +
          "If campaigns have just been launched, please check back shortly.",
        status: "no campaigns yet",
      };
    case "invalid_custom_range":
      return {
        title: "That date range isn't valid",
        body:
          "Please widen the From / To dates and try again. Meta only " +
          "retains insights for the last 37 months and dates can't sit in the future.",
        status: "invalid date range",
      };
  }
}

/**
 * Reasons we'll auto-retry on the visitor's behalf. Transient Meta
 * upstream errors are the only ones likely to clear without operator
 * intervention; anything else needs the agency to fix something at
 * the source, so a countdown would be misleading.
 */
function isTransientReason(reason: InsightsErrorReason): boolean {
  return reason === "meta_api_error";
}
