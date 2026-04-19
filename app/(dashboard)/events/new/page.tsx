import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EventForm } from "@/components/dashboard/events/event-form";
import { PageHeader } from "@/components/dashboard/page-header";
import { parseDateParam } from "@/lib/dashboard/format";

interface Props {
  searchParams: Promise<{ clientId?: string; date?: string }>;
}

export default async function NewEventPage({ searchParams }: Props) {
  const sp = await searchParams;
  const clientId = sp.clientId;
  const initialDate = parseDateParam(sp.date) ?? undefined;

  return (
    <>
      <PageHeader
        title="New event"
        description="A single show belonging to a client."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Link
            href="/events"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            All events
          </Link>
          <EventForm
            mode="create"
            defaultClientId={clientId}
            initialDate={initialDate}
          />
        </div>
      </main>
    </>
  );
}
