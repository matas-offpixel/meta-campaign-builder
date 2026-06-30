import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { EventApprovalPanel } from "@/components/dashboard/d2c/event-approval-panel";
import { createClient } from "@/lib/supabase/server";
import { getEventByIdServer } from "@/lib/db/events-server";
import { getD2CEventCopy, listScheduledSendsForEvent } from "@/lib/db/d2c";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * D2C event orchestration page — shows the parsed event, resolved artwork, and
 * the brief-generated scheduled sends with their approval state. Matas sets the
 * WhatsApp community URL and approves each send (or bulk-approves).
 */
export default async function D2CEventPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const event = await getEventByIdServer(id);
  if (!event) notFound();

  const [copy, sends] = await Promise.all([
    getD2CEventCopy(supabase, id),
    listScheduledSendsForEvent(supabase, id),
  ]);

  const canApprove = isD2CApprover(user.id);

  return (
    <>
      <PageHeader
        title={`${event.name} — D2C orchestration`}
        description="Review the brief-generated campaign, set the community URL, and approve each send."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl">
          <EventApprovalPanel
            eventId={id}
            eventName={event.name}
            artworkUrl={copy?.artwork_url ?? null}
            initialCommunityUrl={copy?.whatsapp_community_url ?? null}
            initialSends={sends}
            canApprove={canApprove}
          />
        </div>
      </main>
    </>
  );
}
