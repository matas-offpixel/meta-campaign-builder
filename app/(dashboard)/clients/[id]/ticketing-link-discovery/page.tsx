import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import { TicketingLinkDiscovery } from "@/components/dashboard/clients/ticketing-link-discovery";

/**
 * /clients/[id]/ticketing-link-discovery
 *
 * Operator sweep for events that should be linked to Eventbrite but
 * aren't yet. Backs the bulk-link workflow documented in
 * `docs/CLIENT_DASHBOARD_BRIEF_2026-04-27.md` PR 5.
 *
 * Server responsibilities:
 *   - Gate auth + ownership. The underlying API routes also gate RLS
 *     on every query, but surfacing a clean 404 here avoids an empty
 *     page render when the URL is tampered with.
 *   - Emit a short page header + breadcrumb. All heavy lifting
 *     (discovery fetch, candidate table, bulk-link POST) happens
 *     client-side so the operator can re-scan without a full nav.
 */

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TicketingLinkDiscoveryPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: client } = await supabase
    .from("clients")
    .select("id, name, user_id")
    .eq("id", id)
    .maybeSingle();
  if (!client) notFound();
  if (client.user_id !== user.id) notFound();

  return (
    <>
      <PageHeader
        title={`${client.name} · Ticketing link discovery`}
        description="Scan unlinked events for candidate ticketing matches and bulk-link them. Linked events kick off a rollup-sync immediately so tickets + revenue land without waiting for the cron."
        actions={
          <Link
            href={`/clients/${id}/dashboard`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to dashboard
          </Link>
        }
      />
      <nav
        aria-label="Breadcrumb"
        className="mx-auto max-w-6xl px-6 pt-4 text-xs text-muted-foreground"
      >
        <Link href="/clients" className="hover:text-foreground">
          Clients
        </Link>
        <span className="mx-1">›</span>
        <Link
          href={`/clients/${id}/dashboard`}
          className="hover:text-foreground"
        >
          {client.name}
        </Link>
        <span className="mx-1">›</span>
        <span className="text-foreground">Link discovery</span>
      </nav>
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <TicketingLinkDiscovery clientId={id} />
      </div>
    </>
  );
}
