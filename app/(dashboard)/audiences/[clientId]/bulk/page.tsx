import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { buildPrefixOptions } from "@/lib/audiences/event-code-prefix-scanner";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { createClient } from "@/lib/supabase/server";
import { BulkVideoForm } from "./bulk-form";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function BulkVideoPage({ params }: Props) {
  const { clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(clientId);
  if (!client) notFound();

  // Load all event codes for this client to derive prefix options
  const { data: eventsData } = await supabase
    .from("events")
    .select("event_code")
    .eq("client_id", clientId)
    .eq("user_id", user.id);

  const eventCodes = ((eventsData ?? []) as { event_code: string | null }[]).map(
    (e) => e.event_code,
  );
  const prefixOptions = buildPrefixOptions(eventCodes);
  const writesEnabled =
    process.env.OFFPIXEL_META_AUDIENCE_WRITES_ENABLED === "true";

  return (
    <>
      <PageHeader
        title="Bulk video views audiences"
        description="Generate Top + Mid + Bottom funnel video views audiences across multiple events at once."
        actions={
          <Link
            href={`/audiences/${clientId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to audiences
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-4xl">
          <BulkVideoForm
            clientId={clientId}
            clientName={client.name}
            prefixOptions={prefixOptions}
            writesEnabled={writesEnabled}
          />
        </div>
      </main>
    </>
  );
}
