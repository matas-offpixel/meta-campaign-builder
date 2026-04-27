import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ClientRolloutView } from "@/components/dashboard/clients/rollout/client-rollout-view";
import { createClient } from "@/lib/supabase/server";
import { loadClientRollout } from "@/lib/db/client-rollout-query";

/**
 * /clients/[id]/rollout — internal admin audit page.
 *
 * Lists every event for a client next to a readiness checklist
 * (event_code / capacity / share link / ticketing / general_sale_at) and
 * provides bulk actions the operator can run from one screen: generate
 * missing share links, run rollup-sync in parallel, audit Meta campaign
 * names, and export a copy-paste markdown block for client comms.
 *
 * Owner-scoped via RLS; the loader additionally asserts client.user_id
 * matches the signed-in user before returning anything.
 */
interface Props {
  params: Promise<{ id: string }>;
}

export default async function ClientRolloutPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const data = await loadClientRollout(id, user.id);
  if (!data) notFound();

  const { client, events, counts } = data;
  const readyCopy =
    counts.total === 0
      ? "No events yet"
      : `${counts.ready} ready · ${counts.partial} need attention · ${counts.blocked} blocked`;

  return (
    <>
      <PageHeader
        title={`${client.name} · Rollout audit`}
        description={readyCopy}
        actions={
          <Link
            href={`/clients/${id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to client
          </Link>
        }
      />
      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-4">
          <nav
            aria-label="Breadcrumb"
            className="text-xs text-muted-foreground"
          >
            <Link href="/clients" className="hover:text-foreground">
              Clients
            </Link>
            <span className="mx-1">›</span>
            <Link href={`/clients/${id}`} className="hover:text-foreground">
              {client.name}
            </Link>
            <span className="mx-1">›</span>
            <span className="text-foreground">Rollout</span>
          </nav>

          <ClientRolloutView
            clientId={client.id}
            clientName={client.name}
            metaAdAccountId={client.meta_ad_account_id ?? null}
            counts={counts}
            rows={events.map((r) => ({
              eventId: r.event.id,
              name: r.event.name ?? null,
              eventCode: r.event.event_code ?? null,
              eventDate: r.event.event_date ?? null,
              venueName: r.event.venue_name ?? null,
              capacity: r.event.capacity ?? null,
              generalSaleAt: r.event.general_sale_at ?? null,
              status: r.readiness.status,
              missing: r.readiness.missing,
              warnings: r.readiness.warnings,
              ticketingMode: r.readiness.ticketingMode,
              hasShare: r.readiness.hasShare,
              shareToken: r.share?.token ?? null,
              shareCanEdit: r.share?.can_edit ?? false,
              shareEnabled: r.share?.enabled ?? false,
              primaryProvider: r.primaryConnection?.provider ?? null,
              primaryConnectionStatus:
                r.primaryConnection?.status ?? null,
              externalEventId:
                r.ticketingLinks[0]?.external_event_id ?? null,
            }))}
          />
        </div>
      </main>
    </>
  );
}
