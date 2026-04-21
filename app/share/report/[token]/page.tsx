import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  bumpShareView,
  getOwnerFacebookToken,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import { getLatestTicketsSoldForEventAdmin } from "@/lib/db/ad-plans-server";
import { fetchEventInsights } from "@/lib/insights/meta";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
  type EventInsightsPayload,
  type InsightsErrorReason,
  type InsightsResult,
} from "@/lib/insights/types";
import type { TikTokManualReportSnapshot } from "@/lib/types/tiktok";
import { PublicReport } from "@/components/report/public-report";
import type { TikTokReportBlockData } from "@/components/report/tiktok-report-block";
import { ReportUnavailable } from "@/components/report/report-unavailable";

function parseDatePreset(value: string | string[] | undefined): DatePreset {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "custom") return "custom";
  if (raw && (DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw as DatePreset;
  }
  return "maximum";
}

function pickQueryParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Build the customRange when the URL carries `?tf=custom&from=…&to=…`.
 * Shape-only — `fetchEventInsights` validates the dates and returns a
 * typed `invalid_custom_range` error if they're off. Missing from/to
 * with `tf=custom` reaches Meta as a missing range and surfaces the
 * same error reason in the UI.
 */
function parseCustomRange(
  preset: DatePreset,
  from: string | null,
  to: string | null,
): CustomDateRange | undefined {
  if (preset !== "custom") return undefined;
  if (!from || !to) return undefined;
  return { since: from, until: to };
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
  ticketsSoldSource: "plan" | "manual" | null;
  ticketsSoldAsOf: string | null;
  adAccountId: string | null;
}

export default async function PublicReportPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const datePreset = parseDatePreset(sp.tf);
  const customRange = parseCustomRange(
    datePreset,
    pickQueryParam(sp.from),
    pickQueryParam(sp.to),
  );

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok) {
    // Single 404 surface for missing / disabled / expired / malformed so
    // an attacker probing the token namespace can't distinguish.
    notFound();
  }

  // This page only renders event-scope tokens. Client-scope tokens belong
  // on the client portal (see `app/share/client/[token]`), so route them
  // to the same generic 404 surface as missing/disabled. The discriminated
  // union keeps `event_id` typed as `string` (non-null) inside this branch.
  if (resolved.share.scope !== "event") {
    notFound();
  }
  const { event_id, user_id } = resolved.share;

  // Fan-out: event lookup + owner token + plan-side tickets cumulative
  // + latest TikTok manual report in parallel. Plan-tickets reuses the
  // same admin client so no extra Supabase connection is opened. The
  // TikTok read returns null on any failure so a missing snapshot never
  // poisons the Meta path — TikTok is purely additive here.
  const [eventRow, providerToken, planTickets, tiktokRow] = await Promise.all([
    admin
      .from("events")
      .select(
        "name, venue_name, venue_city, venue_country, event_date, event_start_at, event_code, budget_marketing, tickets_sold, client:clients ( meta_ad_account_id )",
      )
      .eq("id", event_id)
      .maybeSingle(),
    getOwnerFacebookToken(user_id, admin),
    getLatestTicketsSoldForEventAdmin(admin, event_id),
    fetchLatestTikTokSnapshot(admin, event_id, token).catch(() => null),
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

  // Plan-side cumulative wins when present — see the JSDoc on
  // `getLatestTicketsSoldForEvent` for the rationale (dated history,
  // mirrors the Plan tab the client already sees). Manual override on
  // `events.tickets_sold` is the fallback for D2C shows with no plan.
  const manualTicketsSold =
    (eventRow.data.tickets_sold as number | null) ?? null;
  let resolvedTicketsSold: number | null;
  let ticketsSoldSource: "plan" | "manual" | null;
  let ticketsSoldAsOf: string | null;
  if (planTickets) {
    resolvedTicketsSold = planTickets.value;
    ticketsSoldSource = "plan";
    ticketsSoldAsOf = planTickets.asOfDay;
  } else if (manualTicketsSold != null) {
    resolvedTicketsSold = manualTicketsSold;
    ticketsSoldSource = "manual";
    ticketsSoldAsOf = null;
  } else {
    resolvedTicketsSold = null;
    ticketsSoldSource = null;
    ticketsSoldAsOf = null;
  }

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
    ticketsSold: resolvedTicketsSold,
    ticketsSoldSource,
    ticketsSoldAsOf,
    adAccountId,
  };

  // Bump the view counter best-effort — non-blocking.
  // Wrapped in a fire-and-forget so a slow update doesn't add to LCP.
  bumpShareView(token, admin).catch(() => undefined);

  // Resolve Meta insights.
  //
  // Two of the previous "fatal" reasons — `no_event_code` and
  // `no_ad_account` — are now soft: they mean the client never set up
  // Meta for this event, which is a perfectly valid TikTok-only state
  // (e.g. brand campaigns on Black Butter Records). Soft-failing them
  // to `meta=null` lets the page fall through to the TikTok block when
  // a manual snapshot is present, instead of slamming up the
  // ReportUnavailable screen.
  //
  // Genuine failures — no owner token, expired token, Meta upstream
  // error, no campaigns matched, invalid date range — still surface
  // their reason so the page-level fallback can render the right
  // diagnostic, but only when there's also no TikTok snapshot to fall
  // back on.
  let metaPayload: EventInsightsPayload | null = null;
  let metaErrorReason: InsightsErrorReason | null = null;
  if (!event.adAccountId || !event.eventCode) {
    // Soft-skip: client/event isn't set up for Meta. Not an error.
    metaPayload = null;
  } else if (!providerToken) {
    metaErrorReason = "no_owner_token";
  } else {
    const insights: InsightsResult = await fetchEventInsights({
      eventCode: event.eventCode,
      adAccountId: event.adAccountId,
      token: providerToken,
      datePreset,
      customRange,
    });
    if (insights.ok) {
      metaPayload = insights.data;
    } else {
      metaErrorReason = insights.error.reason;
      console.warn(
        `[share/report] meta insights failed token=${token} reason=${insights.error.reason} msg=${insights.error.message}`,
      );
    }
  }

  // Final fatal branch: only when there is genuinely nothing to render
  // — no Meta payload AND no TikTok snapshot. ReportUnavailable's reason
  // diagnostic uses the Meta error if we have one; otherwise we fall
  // back to `no_ad_account` (the most common cause of a TikTok-only
  // client also lacking a TikTok import).
  if (!metaPayload && !tiktokRow) {
    return (
      <ReportUnavailable
        eventName={event.name}
        venueName={event.venueName}
        venueCity={event.venueCity}
        eventDate={event.eventDate}
        reason={metaErrorReason ?? "no_ad_account"}
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
        ticketsSoldSource: event.ticketsSoldSource,
        ticketsSoldAsOf: event.ticketsSoldAsOf,
      }}
      meta={metaPayload}
      tiktok={tiktokRow}
      shareToken={token}
      datePreset={datePreset}
      customRange={customRange}
    />
  );
}

/**
 * Fetch the latest `tiktok_manual_reports` row for an event, mapped to
 * the shape consumed by `<TikTokReportBlock>`. Returns null on missing
 * row or any DB error — the share page treats TikTok purely as an
 * optional add-on, never a hard dependency.
 *
 * Uses the admin (service-role) client because the share token is the
 * only auth we have here; RLS would otherwise block the read entirely.
 * The fan-out caller wraps this in a try/catch one more time as
 * defense-in-depth.
 */
async function fetchLatestTikTokSnapshot(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventId: string,
  token: string,
): Promise<TikTokReportBlockData | null> {
  const { data, error } = await admin
    .from("tiktok_manual_reports")
    .select(
      "id, campaign_name, date_range_start, date_range_end, imported_at, snapshot_json",
    )
    .eq("event_id", eventId)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      `[share/report] tiktok lookup failed for token=${token}: ${error.message}`,
    );
    return null;
  }
  if (!data) return null;

  return {
    id: data.id as string,
    campaign_name: data.campaign_name as string,
    date_range_start: data.date_range_start as string,
    date_range_end: data.date_range_end as string,
    imported_at: data.imported_at as string,
    snapshot: data.snapshot_json as unknown as TikTokManualReportSnapshot,
  };
}
