import Link from "next/link";
import { Suspense } from "react";

import { EnhancementFlagBanner } from "@/components/dashboard/EnhancementFlagBanner";
import { ClientPortal } from "@/components/share/client-portal";
import { SubTabBar } from "@/components/dashboard/clients/sub-tab-bar";
import { CreativePatternsPanel } from "@/components/dashboard/clients/creative-patterns-panel";
import { FunnelPacingSection } from "@/components/dashboard/clients/funnel-pacing-section";
import { InsightsPanelSkeleton } from "@/components/dashboard/skeletons/insights-panel-skeleton";
import { PacingSectionSkeleton } from "@/components/dashboard/skeletons/pacing-section-skeleton";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalClient,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import type { TierChannelDailyHistoryRow } from "@/lib/dashboard/venue-trend-points";
import {
  CLIENT_REGION_LABELS,
  defaultClientRegion,
  groupEventsByClientRegion,
  parseClientRegionKey,
  visibleClientRegions,
  type ClientRegionKey,
} from "@/lib/dashboard/client-regions";
import type { CreativePatternFunnel } from "@/lib/dashboard/creative-patterns-funnel-view";
import type { CreativePatternPhase } from "@/lib/reporting/creative-patterns-cross-event";

type DashboardTab = "events" | "insights" | "pacing";

interface Props {
  clientId: string;
  token?: string;
  client: PortalClient;
  events: PortalEvent[];
  londonOnsaleSpend: number | null;
  londonPresaleSpend: number | null;
  dailyEntries: DailyEntry[];
  dailyRollups: DailyRollupRow[];
  additionalSpend: AdditionalSpendRow[];
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  trendTicketSnapshots: WeeklyTicketSnapshotRow[];
  trendDailyHistory?: TierChannelDailyHistoryRow[];
  showCreativeInsights: boolean;
  showFunnelPacing: boolean;
  isShared: boolean;
  activeTab?: string;
  activeRegion?: string;
  patternsPhase?: CreativePatternPhase;
  patternsFunnel?: CreativePatternFunnel;
  /** Whether the Past Events accordion should render expanded on first paint. */
  initialPastExpanded?: boolean;
}

export function DashboardTabs({
  clientId,
  token = "",
  client,
  events,
  londonOnsaleSpend,
  londonPresaleSpend,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  weeklyTicketSnapshots,
  trendTicketSnapshots,
  trendDailyHistory,
  showCreativeInsights,
  showFunnelPacing,
  isShared,
  activeTab,
  activeRegion,
  patternsPhase,
  patternsFunnel,
  initialPastExpanded = false,
}: Props) {
  const grouped = groupEventsByClientRegion(events);
  const visibleRegions = visibleClientRegions(grouped);
  const fallbackRegion = defaultClientRegion(grouped);
  const requestedRegion = parseClientRegionKey(activeRegion);
  const selectedRegion =
    requestedRegion && visibleRegions.includes(requestedRegion)
      ? requestedRegion
      : fallbackRegion;
  const selectedTab = parseDashboardTab(activeTab, {
    showCreativeInsights,
    showFunnelPacing,
  });
  const phase = patternsPhase ?? "ticket_sale";
  const funnel = patternsFunnel ?? "bottom";
  const scopedEvents = selectedRegion ? grouped.get(selectedRegion) ?? [] : events;
  const scopeLabel = selectedRegion
    ? CLIENT_REGION_LABELS[selectedRegion]
    : client.name;
  const tabs = [
    {
      id: "events",
      label: "Events",
      href: dashboardHref({
        clientId,
        token,
        isShared,
        region: selectedRegion,
        tab: "events",
        phase,
        funnel,
      }),
    },
    ...(showCreativeInsights
      ? [
          {
            id: "insights",
            label: "Creative Insights",
            href: dashboardHref({
              clientId,
              token,
              isShared,
              region: selectedRegion,
              tab: "insights",
              phase,
              funnel,
            }),
          },
        ]
      : []),
    ...(showFunnelPacing
      ? [
          {
            id: "pacing",
            label: "Funnel Pacing",
            href: dashboardHref({
              clientId,
              token,
              isShared,
              region: selectedRegion,
              tab: "pacing",
              phase,
              funnel,
            }),
          },
        ]
      : []),
  ];

  const content = (
    <>
      {!isShared ? (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <EnhancementFlagBanner clientId={clientId} />
        </div>
      ) : null}
      <div className="mx-auto max-w-7xl space-y-4 px-6 pt-4">
        {visibleRegions.length > 1 && selectedRegion ? (
          <nav
            aria-label="Region"
            className="flex flex-wrap gap-1 border-b border-border"
          >
            {visibleRegions.map((region) => {
              const isActive = region === selectedRegion;
              const count = grouped.get(region)?.length ?? 0;
              return (
                <Link
                  key={region}
                  href={dashboardHref({
                    clientId,
                    token,
                    isShared,
                    region,
                    tab: selectedTab,
                    phase,
                    funnel,
                  })}
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
        {selectedRegion ? (
          <SubTabBar activeTab={selectedTab} tabs={tabs} />
        ) : null}
      </div>

      {selectedTab === "events" ? (
        <ClientPortal
          token={token}
          client={client}
          events={scopedEvents}
          londonOnsaleSpend={londonOnsaleSpend}
          londonPresaleSpend={londonPresaleSpend}
          dailyEntries={dailyEntries}
          dailyRollups={dailyRollups}
          additionalSpend={additionalSpend}
          weeklyTicketSnapshots={weeklyTicketSnapshots}
          trendTicketSnapshots={trendTicketSnapshots}
          trendDailyHistory={trendDailyHistory}
          isInternal={!isShared}
          hideChrome={isShared}
          showRefreshDailyBudgets={false}
          initialPastExpanded={initialPastExpanded}
        />
      ) : (
        <main className="mx-auto max-w-7xl px-6 py-8">
          {selectedTab === "insights" && selectedRegion ? (
            // CreativePatternsPanel is an async server component
            // (cross-event pattern aggregates). Suspense streams the
            // tab strip + region nav first, then swaps the panel in
            // once the pattern data resolves.
            <Suspense fallback={<InsightsPanelSkeleton />}>
              <CreativePatternsPanel
                clientId={clientId}
                scopeLabel={scopeLabel}
                regionFilter={{ type: "country", value: selectedRegion }}
                phase={phase}
                funnel={funnel}
                dashboardInsights={{
                  region: selectedRegion,
                  token,
                  isShared,
                }}
                isShared={isShared}
              />
            </Suspense>
          ) : (
            // FunnelPacingSection is also async; same streaming win.
            <Suspense fallback={<PacingSectionSkeleton />}>
              <FunnelPacingSection
                clientId={clientId}
                regionFilter={
                  selectedRegion
                    ? { type: "country", value: selectedRegion }
                    : undefined
                }
                isShared={isShared}
              />
            </Suspense>
          )}
        </main>
      )}
    </>
  );

  if (!isShared) return content;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
          <p className="font-heading text-base tracking-[0.2em] text-foreground">
            OFF / PIXEL
          </p>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              View only
            </span>
            <p className="max-w-[40ch] truncate text-xs text-muted-foreground">
              {client.name}
            </p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 pt-8">
        <h1 className="font-heading text-2xl tracking-wide text-foreground">
          Campaign performance
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Events, creative patterns, and funnel pacing for {client.name}.
        </p>
      </div>
      {content}
      <footer className="mt-12 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-4 text-[11px] text-muted-foreground">
          Off Pixel · campaign analytics for {client.name}
        </div>
      </footer>
    </main>
  );
}

function parseDashboardTab(
  value: string | undefined,
  flags: { showCreativeInsights: boolean; showFunnelPacing: boolean },
): DashboardTab {
  if (value === "insights" && flags.showCreativeInsights) return "insights";
  if (value === "pacing" && flags.showFunnelPacing) return "pacing";
  return "events";
}

function dashboardHref(args: {
  clientId: string;
  token: string;
  isShared: boolean;
  region: ClientRegionKey | null;
  tab: DashboardTab;
  phase: CreativePatternPhase;
  funnel: CreativePatternFunnel;
}): string {
  const sp = new URLSearchParams({ tab: args.tab });
  if (args.region) sp.set("region", args.region);
  sp.set("phase", args.phase);
  sp.set("funnel", args.funnel);
  return args.isShared
    ? `/share/client/${encodeURIComponent(args.token)}?${sp.toString()}`
    : `/clients/${args.clientId}/dashboard?${sp.toString()}`;
}
