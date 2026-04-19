import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EventForm } from "@/components/dashboard/events/event-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { getEventByIdServer } from "@/lib/db/events-server";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditEventPage({ params }: Props) {
  const { id } = await params;
  const event = await getEventByIdServer(id);
  if (!event) notFound();

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
        </div>
      </main>
    </>
  );
}
