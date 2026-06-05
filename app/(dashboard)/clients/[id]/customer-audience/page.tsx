/**
 * /clients/[id]/customer-audience
 *
 * Server-wrapper page for the Customer Audience Upload wizard.
 *
 * Loads the client's name and Meta ad account ID server-side (RLS-scoped),
 * then passes them as props to the browser-side wizard. The wizard handles all
 * CSV parsing, PII hashing (Web Crypto API), and chunked upload — raw PII
 * never leaves the browser.
 */

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { CustomerAudienceWizard } from "@/components/dashboard/clients/customer-audience-wizard";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClientCustomerAudiencePage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClientByIdServer(id);
  if (!client) notFound();

  return (
    <main className="flex-1">
      <CustomerAudienceWizard
        clientId={client.id}
        clientName={client.name ?? ""}
        adAccountId={client.meta_ad_account_id ?? ""}
      />
    </main>
  );
}
