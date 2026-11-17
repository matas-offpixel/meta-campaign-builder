/**
 * /clients/[id]/customer-audience
 *
 * Server-wrapper page for the Customer Audience Upload wizard.
 *
 * Loads the client's name and Meta ad account ID server-side (RLS-scoped),
 * then hands them to the browser-side wizard. The wizard handles all CSV
 * parsing, PII hashing (Web Crypto API), and chunked upload — raw PII
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

  // HR2: the client's upcoming shows, so a list can carry its show (and a role) for the Retargeting campaign.
  const today = new Date().toISOString().slice(0, 10);
  const { data: events } = await supabase
    .from("events")
    .select("id, name, event_code, event_date")
    .eq("client_id", client.id)
    .gte("event_date", today)
    .neq("status", "cancelled")
    .order("event_date", { ascending: true })
    .range(0, 199);
  const shows = ((events ?? []) as { id: string; name: string; event_code: string | null; event_date: string | null }[]).map((event) => ({ id: event.id, label: [event.event_code, event.name].filter(Boolean).join(" · ") }));

  return (
    <main className="flex-1">
      <CustomerAudienceWizard
        clientId={client.id}
        clientName={client.name ?? ""}
        adAccountId={client.meta_ad_account_id ?? ""}
        shows={shows}
      />
    </main>
  );
}
