import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  bumpShareView,
  getOwnerFacebookToken,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import { fetchEventInsights } from "@/lib/insights/meta";
import {
  DATE_PRESETS,
  type DatePreset,
  type InsightsResult,
} from "@/lib/insights/types";
import { PublicReport } from "@/components/report/public-report";
import { ReportUnavailable } from "@/components/report/report-unavailable";

function parseDatePreset(value: string | string[] | undefined): DatePreset {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && (DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw as DatePreset;
  }
  return "maximum";
}

/**
 * Public client-facing event report.
 *
 *   - Cached for 5 minutes per token via `revalidate = 300`.
 *   - No authentication; the token IS the credential.
 *   - The only identifier exposed in the URL is the token. No internal
 *     event_id / client_id / user_id ever leaves this server component —
 *     the props passed to <PublicReport> deliberately exclude them.
 *
 * Failure modes:
 *   - Unknown / disabled / expired token → `notFound()` → 404 page.
 *   - Owner token expired or insights call failed → ReportUnavailable.
 */

interface Props {
  params: Promise<{ token: string }>;
  /**
   * `?tf=<DatePreset>` drives the timeframe selector. Reading it here in
   * the RSC means each preset gets its own 5-minute cache bucket — a
   * timeframe flick triggers one fresh Meta call, then the next four
   * minutes of visitors hit the same cached payload. Unknown / missing
   * values fall back to "maximum" via `parseDatePreset`.
   */
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const revalidate = 300;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    title: `Event Report · Off Pixel`,
    robots: { index: false, follow: false },
    // Each token gets its own metadata; we still don't leak event names
    // into the page <title> beyond a generic label so the link preview
    // doesn't accidentally reveal an unannounced event.
    openGraph: {
      title: "Event Report by Off Pixel",
      description: "Live performance for your event.",
      url: `/share/report/${token}`,
    },
  };
}

// `EventReportView` (rendered inside `<PublicReport>`) is a client
// component, so the timeframe selector handler lives there. The RSC's
// only job for the timeframe is to read `?tf=` and pass the narrowed
// preset down so insights are fetched against the correct window.
interface ResolvedEvent {
  name: string;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  eventDate: string | null;
  eventStartAt: string | null;
  eventCode: string | null;
  paidMediaBudget: number | null;
  ticketsSold: number | null;
  adAccountId: string | null;
}

export default async function PublicReportPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const datePreset = parseDatePreset(sp.tf);

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok) {
    // Single 404 surface for missing / disabled / expired so an attacker
    // probing the token namespace can't distinguish.
    notFound();
  }

  const { event_id, user_id } = resolved.share;

  // Fan-out: event lookup + owner token in parallel. Both are required
  // before we can call Meta.
  const [eventRow, providerToken] = await Promise.all([
    admin
      .from("events")
      .select(
        "name, venue_name, venue_city, venue_country, event_date, event_start_at, event_code, budget_marketing, tickets_sold, client:clients ( meta_ad_account_id )",
      )
      .eq("id", event_id)
      .maybeSingle(),
    getOwnerFacebookToken(user_id, admin),
  ]);

  if (eventRow.error || !eventRow.data) {
    console.error(
      `[share/report] event lookup failed for token=${token}:`,
      eventRow.error?.message ?? "no row",
    );
    notFound();
  }

  const clientRel = eventRow.data.client as
    | { meta_ad_account_id: string | null }
    | { meta_ad_account_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);

  const event: ResolvedEvent = {
    name: eventRow.data.name as string,
    venueName: (eventRow.data.venue_name as string | null) ?? null,
    venueCity: (eventRow.data.venue_city as string | null) ?? null,
    venueCountry: (eventRow.data.venue_country as string | null) ?? null,
    eventDate: (eventRow.data.event_date as string | null) ?? null,
    eventStartAt: (eventRow.data.event_start_at as string | null) ?? null,
    eventCode: (eventRow.data.event_code as string | null) ?? null,
    paidMediaBudget:
      (eventRow.data.budget_marketing as number | null) ?? null,
    ticketsSold: (eventRow.data.tickets_sold as number | null) ?? null,
    adAccountId,
  };

  // Bump the view counter best-effort — non-blocking.
  // Wrapped in a fire-and-forget so a slow update doesn't add to LCP.
  bumpShareView(token, admin).catch(() => undefined);

  // Resolve insights. Any failure renders the "temporarily unavailable"
  // UI rather than a 500, with the event header still visible so the
  // recipient knows they have the right link.
  let insights: InsightsResult;
  if (!providerToken) {
    insights = {
      ok: false,
      error: {
        reason: "no_owner_token",
        message: "Owner Facebook token unavailable or expired.",
      },
    };
  } else if (!event.eventCode) {
    insights = {
      ok: false,
      error: {
        reason: "no_event_code",
        message: "Event has no event_code set.",
      },
    };
  } else if (!event.adAccountId) {
    insights = {
      ok: false,
      error: {
        reason: "no_ad_account",
        message: "Client has no Meta ad account linked.",
      },
    };
  } else {
    insights = await fetchEventInsights({
      eventCode: event.eventCode,
      adAccountId: event.adAccountId,
      token: providerToken,
      datePreset,
    });
  }

  if (!insights.ok) {
    console.warn(
      `[share/report] insights unavailable token=${token} reason=${insights.error.reason} msg=${insights.error.message}`,
    );
    return (
      <ReportUnavailable
        eventName={event.name}
        venueName={event.venueName}
        venueCity={event.venueCity}
        eventDate={event.eventDate}
        reason={insights.error.reason}
      />
    );
  }

  return (
    <PublicReport
      event={{
        name: event.name,
        venueName: event.venueName,
        venueCity: event.venueCity,
        venueCountry: event.venueCountry,
        eventDate: event.eventDate,
        eventStartAt: event.eventStartAt,
        paidMediaBudget: event.paidMediaBudget,
        ticketsSold: event.ticketsSold,
      }}
      insights={insights.data}
      shareToken={token}
      datePreset={datePreset}
    />
  );
}
