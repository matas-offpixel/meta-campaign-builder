import { notFound, redirect } from "next/navigation";
import { ClientDetail } from "@/components/dashboard/clients/client-detail";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { listEventsServer } from "@/lib/db/events-server";
import {
  listInvoicesForClientWithRefsServer,
  listQuotesServer,
} from "@/lib/db/invoicing-server";
import type { SettlementTiming } from "@/lib/pricing/calculator";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts already enforces auth on dashboard routes; this is a defensive
  // fallback in case a route slips through.
  if (!user) redirect("/login");

  const [client, events, clientInvoices, clientQuotes] = await Promise.all([
    getClientByIdServer(id),
    listEventsServer(user.id, { clientId: id }),
    listInvoicesForClientWithRefsServer(user.id, id),
    listQuotesServer(user.id, { client_id: id }),
  ]);

  if (!client) notFound();

  // The two default_* columns ship with migration 019 and are not in the
  // generated Supabase types yet — fall back to global defaults so the
  // page renders cleanly pre-migration.
  // TODO(post-019): drop the cast once types regenerate.
  const clientWithDefaults = client as unknown as typeof client & {
    default_upfront_pct?: number | null;
    default_settlement_timing?: SettlementTiming | null;
  };
  const defaults = {
    upfront_pct: clientWithDefaults.default_upfront_pct ?? 75,
    settlement_timing:
      clientWithDefaults.default_settlement_timing ?? "1_month_before",
  };

  return (
    <ClientDetail
      client={client}
      events={events}
      clientInvoices={clientInvoices}
      clientQuotes={clientQuotes}
      defaults={defaults}
    />
  );
}
