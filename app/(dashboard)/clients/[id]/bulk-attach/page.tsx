import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { ClientBulkAttachWizard } from "./wizard";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClientBulkAttachPage({ params }: Props) {
  const { id: clientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(clientId);
  if (!client) notFound();

  const adAccountId = client.meta_ad_account_id;

  if (!adAccountId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <p className="text-sm text-muted-foreground">
          No Meta ad account is configured for{" "}
          <span className="font-medium text-foreground">{client.name}</span>.
          Set one in{" "}
          <Link
            href={`/clients/${clientId}/edit`}
            className="underline underline-offset-2 hover:text-foreground"
          >
            client settings
          </Link>{" "}
          before running a bulk attach.
        </p>
        <Link
          href={`/clients/${clientId}?tab=campaigns`}
          className="mt-4 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          ← Back to Campaigns
        </Link>
      </div>
    );
  }

  return (
    <ClientBulkAttachWizard
      clientId={clientId}
      clientName={client.name}
      adAccountId={adAccountId}
    />
  );
}
