import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, LinkIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ClientRefreshDailyBudgetsButton } from "@/components/share/client-refresh-daily-budgets-button";
import { ClientShareButton } from "@/components/share/client-share-button";
import { ClientSyncAllButton } from "@/components/share/client-sync-all-button";
import { createClient } from "@/lib/supabase/server";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import { getClientScopeShare } from "@/lib/db/report-shares";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import {
  parseCreativePatternPhase,
  parseCreativePatternFunnel,
} from "@/lib/dashboard/creative-patterns-funnel-view";

/**
 * /clients/[id]/dashboard — internal counterpart to the public
 * `/share/client/[token]` portal. Renders the same `ClientPortal`
 * component tree, but:
 *
 *   - no token required (page is auth-gated like the rest of the
 *     dashboard routes; loader asserts ownership via RLS).
 *   - `isInternal={true}` surfaces per-row admin links (open in
 *     `/events/[id]?tab=reporting` for deep-dive).
 *   - dashboard chrome (PageHeader + breadcrumb) replaces the
 *     public-surface OFF/PIXEL banner.
 *
 * Uses a synthetic empty token (the portal's NumericCell save path
 * is disabled under internal use — admins edit numbers on the
 * per-event page, not this overview).
 */
interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ region?: string; tab?: string; phase?: string; funnel?: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientDashboardPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS-scoped ownership check: if the caller doesn't own the
  // client row, the loader returns `ok: false` rather than leaking
  // the dashboard.
  const scope = await supabase
    .from("clients")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!scope.data) notFound();

  const [result, scopeShare] = await Promise.all([
    loadClientPortalByClientId(id),
    getClientScopeShare(id),
  ]);
  if (!result.ok) notFound();

  const allEventIds = result.events.map((e) => e.id);
  const venueEventCodes = Array.from(
    new Set(
      result.events
        .map((e) => e.event_code)
        .filter((code): code is string => Boolean(code)),
    ),
  );

  return (
    <>
      <PageHeader
        title={`${result.client.name} · Client dashboard`}
        description="Cross-event performance rollup for every venue under this client."
        actions={
          <div className="flex flex-wrap items-center gap-4">
            <ClientShareButton
              clientId={id}
              initialShare={
                scopeShare
                  ? { token: scopeShare.token, enabled: scopeShare.enabled }
                  : null
              }
            />
            <ClientSyncAllButton eventIds={allEventIds} />
            <ClientRefreshDailyBudgetsButton
              clientId={id}
              eventIds={allEventIds}
              eventCodes={venueEventCodes}
            />
            <Link
              href={`/clients/${id}/ticketing-link-discovery`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title="Sweep for events missing an Eventbrite link"
            >
              <LinkIcon className="h-3 w-3" />
              Link discovery
            </Link>
            <Link
              href={`/clients/${id}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to client
            </Link>
          </div>
        }
      />
      <nav
        aria-label="Breadcrumb"
        className="mx-auto max-w-7xl px-6 pt-4 text-xs text-muted-foreground"
      >
        <Link href="/clients" className="hover:text-foreground">
          Clients
        </Link>
        <span className="mx-1">›</span>
        <Link href={`/clients/${id}`} className="hover:text-foreground">
          {result.client.name}
        </Link>
        <span className="mx-1">›</span>
        <span className="text-foreground">Dashboard</span>
      </nav>
      <DashboardTabs
        clientId={id}
        client={result.client}
        events={result.events}
        londonOnsaleSpend={result.londonOnsaleSpend}
        londonPresaleSpend={result.londonPresaleSpend}
        dailyEntries={result.dailyEntries}
        dailyRollups={result.dailyRollups}
        additionalSpend={result.additionalSpend}
        weeklyTicketSnapshots={result.weeklyTicketSnapshots}
        showCreativeInsights={true}
        showFunnelPacing={true}
        isShared={false}
        activeTab={sp.tab}
        activeRegion={sp.region}
        patternsPhase={parseCreativePatternPhase(sp.phase)}
        patternsFunnel={parseCreativePatternFunnel(sp.funnel)}
      />
    </>
  );
}
