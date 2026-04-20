import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { VenuesList } from "@/components/dashboard/venues/venues-list";
import { countEventsByVenue, listVenues } from "@/lib/db/venues";
import { createClient } from "@/lib/supabase/server";

export default async function VenuesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [venues, eventCounts] = await Promise.all([
    listVenues(user.id),
    countEventsByVenue(user.id),
  ]);

  const counts: Record<string, number> = {};
  for (const [k, v] of eventCounts.entries()) counts[k] = v;

  return (
    <>
      <PageHeader
        title="Venues"
        description="Master records for venues. Linking events here unlocks venue rollups, lookalikes, and capacity-aware reporting."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <VenuesList initialVenues={venues} eventCounts={counts} />
        </div>
      </main>
    </>
  );
}
