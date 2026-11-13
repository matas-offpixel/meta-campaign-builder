import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EventConfigPanel } from "@/components/dashboard/events/event-config-panel";
import { EventForm } from "@/components/dashboard/events/event-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { loadEventConfigPanel } from "@/lib/event-config/panel";
import { getEventByIdServer } from "@/lib/db/events-server";
import { createClient } from "@/lib/supabase/server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditEventPage({ params }: Props) {
  const { id } = await params;
  const event = await getEventByIdServer(id);
  if (!event) notFound();

  // D9 config (migration 235). Until 235 is applied the read fails, and the
  // panel says so rather than taking the edit page down.
  const supabase = await createClient();
  const config = await loadEventConfigPanel(supabase, event.id, event.client_id ?? null).catch((err) => {
    console.error("[EditEventPage] loadEventConfigPanel failed:", err);
    return null;
  });

  return (
    <>
      <PageHeader
        title={`Edit ${event.name}`}
        description="Update event details."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Link
            href={`/events/${id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
          <EventForm mode="edit" initial={event} />
          {config ? (
            <EventConfigPanel eventId={event.id} data={config} />
          ) : (
            <section className="rounded-md border border-border bg-card p-5">
              <h2 className="font-heading text-base tracking-wide">Dashboard</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Capacity and the dashboard settings can&apos;t be read right now.
              </p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
