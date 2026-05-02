import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, LinkIcon } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { ClientPortal } from "@/components/share/client-portal";
import { ClientRefreshDailyBudgetsButton } from "@/components/share/client-refresh-daily-budgets-button";
import { ClientSyncAllButton } from "@/components/share/client-sync-all-button";
import { createClient } from "@/lib/supabase/server";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import { SubTabBar } from "@/components/dashboard/clients/sub-tab-bar";
import { FunnelPacingSection } from "@/components/dashboard/clients/funnel-pacing-section";
import { CreativePatternsPanel } from "@/components/dashboard/clients/creative-patterns-panel";
import {
  CLIENT_REGION_LABELS,
  defaultClientRegion,
  groupEventsByClientRegion,
  parseClientRegionKey,
  visibleClientRegions,
  type ClientRegionKey,
} from "@/lib/dashboard/client-regions";

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
  searchParams: Promise<{ region?: string; tab?: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DashboardSubTab = "events" | "insights" | "pacing";

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

  const result = await loadClientPortalByClientId(id);
  if (!result.ok) notFound();

  const grouped = groupEventsByClientRegion(result.events);
  const visibleRegions = visibleClientRegions(grouped);
  const fallbackRegion = defaultClientRegion(grouped);
  const requestedRegion = parseClientRegionKey(sp.region);
  const activeRegion =
    requestedRegion && visibleRegions.includes(requestedRegion)
      ? requestedRegion
      : fallbackRegion;
  const activeTab = parseDashboardSubTab(sp.tab);
  const scopedEvents = activeRegion ? grouped.get(activeRegion) ?? [] : result.events;

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
          <div className="flex items-center gap-4">
            <ClientSyncAllButton eventIds={allEventIds} />
            <ClientRefreshDailyBudgetsButton
              clientId={id}
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
      <div className="mx-auto max-w-7xl space-y-4 px-6 pt-4">
        {visibleRegions.length > 1 && activeRegion ? (
          <nav
            aria-label="Region"
            className="flex flex-wrap gap-1 border-b border-border"
          >
            {visibleRegions.map((region) => {
              const isActive = region === activeRegion;
              const count = grouped.get(region)?.length ?? 0;
              return (
                <Link
                  key={region}
                  href={dashboardHref(id, region, activeTab)}
                  className={`relative -mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                    isActive
                      ? "border-b-2 border-foreground font-medium text-foreground"
                      : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {CLIENT_REGION_LABELS[region]}
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {count}
                  </span>
                </Link>
              );
            })}
          </nav>
        ) : null}
        {activeRegion ? (
          <SubTabBar
            activeTab={activeTab}
            tabs={[
              {
                id: "events",
                label: "Events",
                href: dashboardHref(id, activeRegion, "events"),
              },
              {
                id: "insights",
                label: "Creative Insights",
                href: dashboardHref(id, activeRegion, "insights"),
              },
              {
                id: "pacing",
                label: "Funnel Pacing",
                href: dashboardHref(id, activeRegion, "pacing"),
              },
            ]}
          />
        ) : null}
      </div>
      {activeTab === "events" ? (
        <ClientPortal
          token=""
          client={result.client}
          events={scopedEvents}
          londonOnsaleSpend={result.londonOnsaleSpend}
          londonPresaleSpend={result.londonPresaleSpend}
          dailyEntries={result.dailyEntries}
          dailyRollups={result.dailyRollups}
          additionalSpend={result.additionalSpend}
          weeklyTicketSnapshots={result.weeklyTicketSnapshots}
          isInternal
        />
      ) : (
        <main className="mx-auto max-w-7xl px-6 py-8">
          {activeTab === "insights" && activeRegion ? (
            <CreativePatternsPanel
              clientId={id}
              scopeLabel={CLIENT_REGION_LABELS[activeRegion]}
              regionFilter={{ type: "country", value: activeRegion }}
            />
          ) : (
            <FunnelPacingSection
              clientId={id}
              regionFilter={
                activeRegion ? { type: "country", value: activeRegion } : undefined
              }
            />
          )}
        </main>
      )}
    </>
  );
}

function parseDashboardSubTab(value: string | undefined): DashboardSubTab {
  if (value === "insights" || value === "pacing") return value;
  return "events";
}

function dashboardHref(
  clientId: string,
  region: ClientRegionKey,
  tab: DashboardSubTab,
): string {
  const sp = new URLSearchParams({ region, tab });
  return `/clients/${clientId}/dashboard?${sp.toString()}`;
}
