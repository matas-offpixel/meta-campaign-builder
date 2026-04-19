import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { GoogleAdsPlanBuilder } from "@/components/google-ads/plan-builder";
import { listEventsServer } from "@/lib/db/events-server";
import { createClient } from "@/lib/supabase/server";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Google Ads plan builder route.
 *
 * Server-fetches the current user's events to populate the event
 * picker, then hands off to the client builder. Persistence flows
 * through POST /api/google-ads/plans which writes to google_ad_plans
 * (migration 017).
 */
export default async function NewGoogleAdsPlanPage({ searchParams }: Props) {
  const sp = await searchParams;
  const eventIdParam = typeof sp.eventId === "string" ? sp.eventId : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const events = await listEventsServer(user.id);

  return (
    <>
      <PageHeader
        title="New Google Ads plan"
        description="Five-section builder mirroring the J2 Melodic Search plan: strategy, campaigns, geo, RLSA, conversion tracking."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-5xl">
          <GoogleAdsPlanBuilder
            events={events.map((e) => ({
              id: e.id,
              name: e.name,
              venue_city: e.venue_city,
            }))}
            defaultEventId={eventIdParam}
          />
        </div>
      </main>
    </>
  );
}
