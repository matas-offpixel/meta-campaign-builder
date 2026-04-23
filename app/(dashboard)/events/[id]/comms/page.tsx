import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { EventCommsPanel } from "@/components/dashboard/events/event-comms-panel";
import { createClient } from "@/lib/supabase/server";
import { getEventByIdServer } from "@/lib/db/events-server";
import {
  listD2CConnectionsForUser,
  listD2CTemplatesForUser,
  listScheduledSendsForEvent,
} from "@/lib/db/d2c";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Per-event comms planning UI. Lists scheduled D2C sends, lets the
 * user add a new one (template + provider + schedule). With
 * FEATURE_D2C_LIVE off, the API forces dry-run mode and the UI
 * surfaces a [DRY RUN] badge on every row.
 *
 * Reuses the existing dashboard chrome via the route group.
 */
export default async function EventCommsPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const event = await getEventByIdServer(id);
  if (!event) notFound();

  const [connections, templates, sends] = await Promise.all([
    listD2CConnectionsForUser(supabase, { clientId: event.client_id }),
    listD2CTemplatesForUser(supabase, {
      clientId: event.client_id,
    }),
    listScheduledSendsForEvent(supabase, id),
  ]);

  const canApproveD2C = isD2CApprover(user.id);

  const safeConnections = connections.map((c) => ({
    ...c,
    credentials: null as null,
  }));

  return (
    <>
      <PageHeader
        title={`${event.name} — comms`}
        description="Plan and dry-run D2C messaging for this event."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Link
            href={`/events/${id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to event
          </Link>
          <EventCommsPanel
            eventId={id}
            clientId={event.client_id}
            connections={safeConnections}
            templates={templates}
            initialSends={sends}
            canApproveD2C={canApproveD2C}
          />
        </div>
      </main>
    </>
  );
}
