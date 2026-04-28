import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import { TicketingImportForm } from "@/components/dashboard/clients/ticketing-import-form";

/**
 * /clients/[id]/ticketing-import
 *
 * Operator route for catching up a client's event roster with
 * historical weekly ticket numbers from an xlsx export. Backs
 * the workflow the 4theFans team runs every Monday — the client
 * emails a spreadsheet; we previously had to re-key the numbers
 * into the Daily Tracker. The importer:
 *
 *   1. Accepts the xlsx upload (stage 1 parse — see
 *      `/api/clients/[id]/ticketing-import/parse`).
 *   2. Shows a reconciliation preview — matched / unmatched /
 *      errored — so the operator can verify coverage before
 *      writing anything.
 *   3. On confirm, commits the rows to `ticket_sales_snapshots`
 *      with `source='xlsx_import'` so the chart on the client
 *      dashboard picks them up.
 *
 * Ownership is enforced server-side in the API routes; the page
 * itself just guards the auth wall.
 */
interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TicketingImportPage({ params }: Props) {
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
        title={`${client.name} · Historical ticket import`}
        description="Upload the weekly ticketing xlsx. Rows are matched against events under this client and persisted as ticket_sales_snapshots with source='xlsx_import'."
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
        className="mx-auto max-w-5xl px-6 pt-4 text-xs text-muted-foreground"
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
        <span className="text-foreground">Ticketing import</span>
      </nav>
      <div className="mx-auto max-w-5xl px-6 pt-6">
        <TicketingImportForm clientId={id} clientName={client.name} />
      </div>
    </>
  );
}
