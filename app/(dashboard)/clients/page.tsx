import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ClientsList } from "@/components/dashboard/clients/clients-list";
import { listClientsServer } from "@/lib/db/clients-server";
import { createClient } from "@/lib/supabase/server";
import {
  parseClientStatus,
  parseQuery,
} from "@/lib/dashboard/format";

interface Props {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * Server-side filtered clients list. URL contract:
 *   ?status=<client-status>   filter by clients.status (whitelisted)
 *   ?q=<text>                 case-insensitive substring on name
 *
 * Filter strip lives in <ClientsList /> as a Suspense-wrapped client
 * child so the route stays statically prerenderable.
 */
export default async function ClientsPage({ searchParams }: Props) {
  const sp = await searchParams;

  const status = parseClientStatus(sp.status) ?? undefined;
  const q = parseQuery(sp.q) ?? undefined;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const clients = await listClientsServer(user.id, { status, q });
  const filtersActive = Boolean(status || q);

  return (
    <Suspense fallback={null}>
      <ClientsList clients={clients} filtersActive={filtersActive} />
    </Suspense>
  );
}
