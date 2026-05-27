import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { createClient } from "@/lib/supabase/server";
import { CloneSavedAudienceForm } from "./clone-form";

interface Props {
  params: Promise<{ clientId: string }>;
}

export default async function CloneSavedAudiencePage({ params }: Props) {
  const { clientId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(clientId);
  if (!client) notFound();

  return (
    <>
      <PageHeader
        title="Clone Saved Audiences"
        description="Copy a Saved Audience set from one ad account to another within the same Business Manager. Underlying Custom Audiences are BM-shared and reused — no rebuild needed."
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
          <CloneSavedAudienceForm
            clientId={clientId}
            clientPreferredAdAccountId={client.meta_ad_account_id ?? null}
          />
        </div>
      </main>
    </>
  );
}
