import { notFound, redirect } from "next/navigation";
import { EventDetail } from "@/components/dashboard/events/event-detail";
import { parseEventTab } from "@/components/dashboard/events/event-detail-tabs";
import { createClient } from "@/lib/supabase/server";
import {
  getEventByIdServer,
  listDraftsForEventServer,
} from "@/lib/db/events-server";
import {
  getPlanByEventIdServer,
  listDaysForPlanServer,
} from "@/lib/db/ad-plans-server";

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
  const [event, drafts, plan] = await Promise.all([
    getEventByIdServer(id),
    listDraftsForEventServer(id),
    getPlanByEventIdServer(id),
  ]);

  if (!event) notFound();

  const planDays = plan ? await listDaysForPlanServer(plan.id) : [];

  return (
    <EventDetail
      event={event}
      drafts={drafts}
      userId={user.id}
      activeTab={activeTab}
      plan={plan}
      planDays={planDays}
    />
  );
}
