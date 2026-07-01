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
  const draftsAwaitingReview = sends.filter((s) => s.status === "draft_ready").length;

  return (
    <>
      <PageHeader
        title={`${event.name} — D2C orchestration`}
        description="Review the brief-generated campaign, set the community URL, and approve each send."
        actions={
          draftsAwaitingReview > 0 ? (
            <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800">
              {draftsAwaitingReview} draft
              {draftsAwaitingReview === 1 ? "" : "s"} awaiting review
            </span>
          ) : undefined
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl">
          <EventApprovalPanel
            eventId={id}
            eventName={event.name}
            artworkUrl={copy?.artwork_url ?? null}
            initialCommunityUrl={copy?.whatsapp_community_url ?? null}
            initialSends={sends}
            copyBundle={copy?.copy_jsonb ?? {}}
            canApprove={canApprove}
          />
        </div>
      </main>
    </>
  );
}
