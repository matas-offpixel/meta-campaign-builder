"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { EventForm } from "@/components/dashboard/events/event-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { getEventById, type EventWithClient } from "@/lib/db/events";

interface Props {
  params: Promise<{ id: string }>;
}

export default function EditEventPage({ params }: Props) {
  const { id } = use(params);
  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<EventWithClient | null>(null);

  useEffect(() => {
    async function load() {
      const row = await getEventById(id);
      setEvent(row);
      setLoading(false);
    }
    load();
  }, [id]);

  return (
    <>
      <PageHeader
        title={event ? `Edit ${event.name}` : "Edit event"}
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

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !event ? (
            <p className="text-sm text-muted-foreground">Event not found.</p>
          ) : (
            <EventForm mode="edit" initial={event} />
          )}
        </div>
      </main>
    </>
  );
}
