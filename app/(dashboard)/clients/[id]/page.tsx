import { notFound, redirect } from "next/navigation";
import { ClientDetail } from "@/components/dashboard/clients/client-detail";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { listEventsServer } from "@/lib/db/events-server";
import { getShareForClient } from "@/lib/db/report-shares";

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

  const [client, events, share] = await Promise.all([
    getClientByIdServer(id),
    listEventsServer(user.id, { clientId: id }),
    getShareForClient(id),
  ]);

  if (!client) notFound();

  const initialShare = share
    ? { token: share.token, enabled: share.enabled }
    : null;

  return (
    <ClientDetail client={client} events={events} initialShare={initialShare} />
  );
}
