import { redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { BriefIngestForm } from "@/components/dashboard/d2c/brief-ingest-form";
import { createClient } from "@/lib/supabase/server";

/**
 * Brief → campaign ingestion page. Upload a PDF brief (or paste text), pick the
 * client, and the parser builds the event + six scheduled sends. The form polls
 * job status and redirects to the event orchestration page on success.
 */
export default async function BriefIngestPage() {
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

  return (
    <>
      <PageHeader
        title="Brief ingest"
        description="Turn an event brief into a fully scheduled multi-channel campaign."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-2xl">
          <BriefIngestForm clients={(clients ?? []) as { id: string; name: string }[]} />
        </div>
      </main>
    </>
  );
}
