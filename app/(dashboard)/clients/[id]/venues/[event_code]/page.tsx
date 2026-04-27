import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";

/**
 * /clients/[id]/venues/[event_code]
 *
 * Placeholder for the dedicated per-venue report page. Shipped ahead
 * of its real content so the "View full venue report" CTA on
 * `/clients/[id]/dashboard` has somewhere to land without dead-
 * linking. The follow-up PR replaces this with a full-width render
 * of the venue card components (header, per-event table, trend,
 * tracker, creatives) scoped to a single `event_code`.
 *
 * Keeping the auth + lookup scaffolding in place means the follow-up
 * only has to add the data-bound component tree; the route shape,
 * title, and breadcrumb stay stable.
 */
interface Props {
  params: Promise<{ id: string; event_code: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientVenueReportPage({ params }: Props) {
  const { id, event_code: eventCodeRaw } = await params;
  const eventCode = decodeURIComponent(eventCodeRaw);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Minimal ownership + existence guard so the placeholder still
  // returns a proper 404 when someone pokes at /venues/<nonsense>
  // rather than a "coming soon" frame that implies the venue exists.
  // Using `maybeSingle` on a limit(1) select is cheaper than a count
  // and good enough for this lookup.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (clientErr || !client) notFound();

  const { data: evAny, error: evErr } = await supabase
    .from("events")
    .select("id, name")
    .eq("client_id", id)
    .eq("event_code", eventCode)
    .limit(1)
    .maybeSingle();
  if (evErr || !evAny) notFound();

  return (
    <div className="space-y-6 p-6">
      <Link
        href={`/clients/${id}/dashboard`}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {client.name} dashboard
      </Link>
      <PageHeader
        title={`${eventCode} · Full venue report`}
        description="Dedicated per-venue report view."
      />
      <section className="rounded-md border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
        <p className="font-heading text-base tracking-wide text-foreground">
          Coming soon
        </p>
        <p className="mt-2 max-w-2xl">
          This surface renders the full-width version of the venue
          card for <span className="font-mono text-foreground">{eventCode}</span> — same
          per-event table, daily trend, tracker, and active creatives
          with more breathing room and a shareable URL. The matching
          data-bound view is landing in a follow-up PR; in the
          meantime the venue&rsquo;s expanded card on the client
          dashboard already shows every metric.
        </p>
        <Link
          href={`/clients/${id}/dashboard#expanded=${encodeURIComponent(eventCode)}`}
          className="mt-4 inline-flex items-center rounded-md border border-border-strong bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
        >
          Open on the dashboard
        </Link>
      </section>
    </div>
  );
}
