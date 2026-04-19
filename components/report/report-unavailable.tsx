import { fmtDate } from "@/lib/dashboard/format";
import type { InsightsErrorReason } from "@/lib/insights/types";

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
 */
export function ReportUnavailable({
  eventName,
  venueName,
  venueCity,
  eventDate,
  reason,
}: Props) {
  const venue = [venueName, venueCity].filter(Boolean).join(", ");
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
            Report temporarily unavailable
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            We&rsquo;re unable to load the latest performance numbers right
            now. The agency has been notified — please try again shortly.
          </p>
          {/*
            Reason is rendered as a tiny diagnostic line. We deliberately
            avoid surfacing the underlying Meta error (which can leak
            campaign IDs) — the reason code is enough for the agency to
            pattern-match against server logs.
          */}
          <p className="mt-6 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Status: {reasonLabel(reason)}
          </p>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        Powered by Off Pixel
      </footer>
    </main>
  );
}

function reasonLabel(reason: InsightsErrorReason): string {
  switch (reason) {
    case "no_event_code":
      return "configuration";
    case "no_ad_account":
      return "configuration";
    case "no_owner_token":
    case "owner_token_expired":
      return "reconnect required";
    case "no_campaigns_matched":
      return "no campaigns yet";
    case "meta_api_error":
      return "upstream error";
    case "invalid_custom_range":
      // Bad client input rather than a true outage. Surface as
      // "invalid date range" so the visitor knows to widen / fix
      // the From / To inputs rather than retrying.
      return "invalid date range";
  }
}
