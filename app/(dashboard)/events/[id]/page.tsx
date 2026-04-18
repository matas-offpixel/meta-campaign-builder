import { notFound, redirect } from "next/navigation";
import { EventDetail } from "@/components/dashboard/events/event-detail";
import { parseEventTab } from "@/components/dashboard/events/event-detail-tabs";
import { createClient } from "@/lib/supabase/server";
import {
  getEventByIdServer,
  listDraftsForEventServer,
} from "@/lib/db/events-server";

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

  const [event, drafts] = await Promise.all([
    getEventByIdServer(id),
    listDraftsForEventServer(id),
  ]);

  if (!event) notFound();

  return (
    <EventDetail
      event={event}
      drafts={drafts}
      userId={user.id}
      activeTab={activeTab}
    />
  );
}
