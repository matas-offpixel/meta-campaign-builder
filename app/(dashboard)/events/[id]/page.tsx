import { notFound, redirect } from "next/navigation";
import { EventDetail } from "@/components/dashboard/events/event-detail";
import { parseEventTab } from "@/lib/dashboard/format";
import { createClient } from "@/lib/supabase/server";
import {
  getEventByIdServer,
  listDraftsForEventServer,
} from "@/lib/db/events-server";
import {
  getLatestTicketsSoldForEvent,
  getPlanByEventIdServer,
  listDaysForPlanServer,
} from "@/lib/db/ad-plans-server";
import { listMomentsForEventServer } from "@/lib/db/event-key-moments-server";
import { getShareForEvent } from "@/lib/db/report-shares";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function EventDetailPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const activeTab = parseEventTab(sp.tab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts already enforces auth; this is a defensive fallback.
  if (!user) redirect("/login");

  // Plan + days are fetched in parallel with event + drafts so the Plan
  // tab paints from prefetched data even on first nav. Days are fetched
  // sequentially after the plan because they depend on plan.id.
  //
  // Plan fetches are wrapped defensively: a schema mismatch or a missing
  // migration should degrade to the "no plan yet" CTA, not a hard 500.
  // Moments are fetched alongside event/drafts/plan so the plan grid
  // overlays moment labels on first paint. Fetch is wrapped defensively
  // for the same reason as the plan fetches: until migration 008 ships
  // to every environment, a missing table should degrade to "no
  // moments" rather than a hard 500.
  // Share row is fetched in parallel with event data so the Reporting
  // tab paints the current toggle state on first load — no client
  // round-trip. Failure is non-fatal: a missing share row is the
  // expected state for events that have never been shared.
  // Plan-side cumulative tickets-sold lookup runs in the same fan-out:
  // the Reporting tab needs it to render the "From campaign plan ·
  // {date}" sub-line on the Tickets sold card and to flip the panel to
  // read-only when a plan exists.
  const [event, drafts, planResult, keyMoments, share, planTickets] =
    await Promise.all([
      getEventByIdServer(id),
      listDraftsForEventServer(id),
      getPlanByEventIdServer(id).catch((err) => {
        console.error("[EventDetailPage] getPlanByEventIdServer failed:", err);
        return null;
      }),
      listMomentsForEventServer(id).catch((err) => {
        console.error("[EventDetailPage] listMomentsForEventServer failed:", err);
        return [];
      }),
      getShareForEvent(id).catch((err) => {
        console.error("[EventDetailPage] getShareForEvent failed:", err);
        return null;
      }),
      getLatestTicketsSoldForEvent(id).catch((err) => {
        console.error(
          "[EventDetailPage] getLatestTicketsSoldForEvent failed:",
          err,
        );
        return null;
      }),
    ]);

  if (!event) notFound();

  const plan = planResult ?? null;

  const planDays = plan
    ? await listDaysForPlanServer(plan.id).catch((err) => {
        console.error("[EventDetailPage] listDaysForPlanServer failed:", err);
        return [];
      })
    : [];

  return (
    <EventDetail
      event={event}
      drafts={drafts}
      userId={user.id}
      activeTab={activeTab}
      plan={plan}
      planDays={planDays}
      keyMoments={keyMoments}
      initialShare={share}
      initialTicketsSold={event.tickets_sold ?? null}
      planTickets={planTickets}
    />
  );
}
