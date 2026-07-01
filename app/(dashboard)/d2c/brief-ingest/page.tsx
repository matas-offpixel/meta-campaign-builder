import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { BriefIngestForm } from "@/components/dashboard/d2c/brief-ingest-form";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";

interface Props {
  searchParams: Promise<{ client_id?: string }>;
}

/**
 * Brief → campaign ingestion page. Upload a PDF brief (or paste text), pick the
 * client, and the parser builds the event + six scheduled sends. The form polls
 * job status and redirects to the event orchestration page on success.
 */
export default async function BriefIngestPage({ searchParams }: Props) {
  const { client_id: clientIdParam } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: clients } = await supabase
    .from("clients")
    .select("id, name")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  const clientList = (clients ?? []) as { id: string; name: string }[];

  // Pre-select when ?client_id= resolves to a client this user owns (RLS on
  // getClientByIdServer). Unknown / foreign ids are ignored silently.
  let initialClientId: string | undefined;
  if (clientIdParam?.trim()) {
    const owned = await getClientByIdServer(clientIdParam.trim());
    if (owned && clientList.some((c) => c.id === owned.id)) {
      initialClientId = owned.id;
    }
  }

  return (
    <>
      <PageHeader
        title="Brief ingest"
        description="Turn an event brief into a fully scheduled multi-channel campaign."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <BriefIngestForm clients={clientList} initialClientId={initialClientId} />
        </div>
      </main>
    </>
  );
}
