import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import { VenueFullReport } from "@/components/share/venue-full-report";
import { getShareForVenue } from "@/lib/db/report-shares";
import { VenueShareControls } from "@/components/dashboard/clients/venue-share-controls";

/**
 * /clients/[id]/venues/[event_code]
 *
 * Internal venue full-report page. Replaces the placeholder that
 * shipped alongside PR #117 with a full-width render of every section
 * the venue card exposes on the dashboard — performance summary,
 * daily trend + tracker, weekly trends chart, active creatives —
 * scoped to a single `event_code` under this client.
 *
 * Data flow:
 *   - `loadClientPortalByClientId` fetches the whole client payload
 *     (same shape the external `/share/client/[token]` route uses).
 *     The venue page filters down to `event_code` at render time; a
 *     dedicated loader wasn't worth the duplication since the full
 *     payload is already ≤a few hundred rows for the 4theFans
 *     roster.
 *   - `VenueFullReport` takes the same props the client portal
 *     accepts and renders the filtered venue with `forceExpandAll`
 *     on, so there's no collapsed affordance (the venue IS the page).
 *   - `VenueShareControls` lives in the header actions slot; it
 *     hits `POST /api/share/venue` on first click to mint a
 *     scope='venue' token (migration 052) and then surfaces the
 *     copyable URL.
 *
 * 404 semantics: we 404 when the event_code either doesn't exist
 * under the client or is owned by a different user. Matches the
 * placeholder's ownership guard so probing `/venues/<random>`
 * stays indistinguishable from a revoked share.
 */
interface Props {
  params: Promise<{ id: string; event_code: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientVenueReportPage({ params }: Props) {
  const { id, event_code: eventCodeRaw } = await params;
  const eventCode = decodeURIComponent(eventCodeRaw);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, user_id")
    .eq("id", id)
    .maybeSingle();
  if (clientErr || !client) notFound();
  if (client.user_id !== user.id) notFound();

  // Existence guard — make sure this event_code actually belongs to
  // the client before we load the full portal payload. Cheaper than
  // loading first and then filtering to zero rows.
  const { data: anyEvent } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", id)
    .eq("event_code", eventCode)
    .limit(1)
    .maybeSingle();
  if (!anyEvent) notFound();

  const [portal, existingShare] = await Promise.all([
    loadClientPortalByClientId(id),
    getShareForVenue(id, eventCode),
  ]);
  if (!portal.ok) notFound();

  // Filter the payload to the chosen venue. `event_code` is the
  // canonical pivot across the whole data layer — events, rollups,
  // snapshots, additional spend all FK to event_id so a set-of-ids
  // derived from the filtered events is the cheapest way to narrow
  // the rest.
  const venueEvents = portal.events.filter(
    (e) => e.event_code === eventCode,
  );
  const eventIdSet = new Set(venueEvents.map((e) => e.id));
  const venueDailyEntries = portal.dailyEntries.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueDailyRollups = portal.dailyRollups.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueAdditionalSpend = portal.additionalSpend.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueWeeklyTicketSnapshots = portal.weeklyTicketSnapshots.filter(
    (r) => eventIdSet.has(r.event_id),
  );

  const venueTitle = venueEvents[0]?.venue_name ?? eventCode;

  return (
    <div className="space-y-6 p-6">
      <Link
        href={`/clients/${id}/dashboard`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {client.name} dashboard
      </Link>
      <PageHeader
        title={`${venueTitle} · Full venue report`}
        description={`${venueEvents.length} event${venueEvents.length === 1 ? "" : "s"} under event code ${eventCode}.`}
        actions={
          <VenueShareControls
            clientId={id}
            eventCode={eventCode}
            initialShareToken={existingShare?.token ?? null}
            initialCanEdit={existingShare?.can_edit ?? null}
            initialEnabled={existingShare?.enabled ?? null}
          />
        }
      />
      <VenueFullReport
        clientId={id}
        eventCode={eventCode}
        client={portal.client}
        events={venueEvents}
        dailyEntries={venueDailyEntries}
        dailyRollups={venueDailyRollups}
        additionalSpend={venueAdditionalSpend}
        weeklyTicketSnapshots={venueWeeklyTicketSnapshots}
        londonOnsaleSpend={portal.londonOnsaleSpend}
        londonPresaleSpend={portal.londonPresaleSpend}
        isInternal
      />
    </div>
  );
}
