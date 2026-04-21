import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { TicketingConnectionsPanel } from "@/components/dashboard/clients/ticketing-connections-panel";
import { createClient } from "@/lib/supabase/server";
import { getClientByIdServer } from "@/lib/db/clients-server";
import { listConnectionsForUser } from "@/lib/db/ticketing";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Per-client settings page. v1 surfaces the ticketing connections
 * panel; future tabs (D2C comms, Canva templates) bolt on alongside.
 *
 * The spec lists this path as `app/clients/[id]/settings/page.tsx` —
 * this repo's dashboard pages live under the `(dashboard)` route group
 * to inherit the dashboard chrome layout, so the file ships there
 * instead. The URL is identical because route groups are wrapped in
 * parens and don't appear in the path.
 */
export default async function ClientSettingsPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [client, connections] = await Promise.all([
    getClientByIdServer(id),
    listConnectionsForUser(supabase, { clientId: id }),
  ]);

  if (!client) notFound();

  // Strip credentials before handing rows to a client component (the API
  // route does this on its public surface; we mirror the rule here so a
  // direct server fetch stays consistent).
  const safeConnections = connections.map((c) => ({
    ...c,
    credentials: null as null,
  }));

  return (
    <>
      <PageHeader
        title={`${client.name} — settings`}
        description="Manage integrations for this client."
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <Link
            href={`/clients/${id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to client
          </Link>
          <TicketingConnectionsPanel
            clientId={id}
            initial={safeConnections}
          />
        </div>
      </main>
    </>
  );
}
