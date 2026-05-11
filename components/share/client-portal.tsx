"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalClient,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import type { TierChannelDailyHistoryRow } from "@/lib/dashboard/venue-trend-points";
import { aggregateClientWideTotals } from "@/lib/db/client-dashboard-aggregations";
import {
  CLIENT_REGION_LABELS,
  defaultClientRegion,
  groupEventsByClientRegion,
  visibleClientRegions,
  type ClientRegionKey,
} from "@/lib/dashboard/client-regions";
import { resolveDisplayTicketCount } from "@/lib/dashboard/tier-channel-rollups";
import { ClientRefreshDailyBudgetsButton } from "./client-refresh-daily-budgets-button";
import { ClientPortalVenueTable } from "./client-portal-venue-table";
import { ClientWideTopline } from "./client-wide-topline";

interface Props {
  token: string;
  client: PortalClient;
  events: PortalEvent[];
  /**
   * Cached lifetime spend for the WC26-LONDON-ONSALE shared campaign.
   * Distributed by the venue table across the four London venues.
   * `null` until the admin runs Refresh All Spend.
   */
  londonOnsaleSpend: number | null;
  /**
   * Cached lifetime spend for the WC26-LONDON-PRESALE shared campaign.
   * Display-only on the Overall London aggregate; no per-event impact
   * because prereg_spend is already split correctly per event.
   */
  londonPresaleSpend: number | null;
  /**
   * All daily tracker rows across every event under this client.
   * Pre-sorted by (event_id, date ASC) by the data layer; the venue
   * table filters them per-venue at render time.
   */
  dailyEntries: DailyEntry[];
  /**
   * Event daily rollup rows — drives the client-wide topline block
   * (sum of ad_spend across all events). Per-venue cards continue
   * to use meta_spend_cached so the intra-card math is unchanged.
   */
  dailyRollups: DailyRollupRow[];
  /**
   * Additional (off-Meta) spend entries across every event under
   * the client. Summed into the topline "Total spend" stat.
   */
  additionalSpend: AdditionalSpendRow[];
  /**
   * Dominant-source snapshots (WoW comparability). One row per
   * (event, week) filtered to the event's dominant source.
   */
  weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
  /** Source-stitched snapshots for trend chart / tracker continuity. */
  trendTicketSnapshots: WeeklyTicketSnapshotRow[];
  /** Per-day tier_channel_sales history (migration 089). Optional until fully deployed. */
  trendDailyHistory?: TierChannelDailyHistoryRow[];
  /**
   * True when rendered inside `/clients/[id]/dashboard` (the
   * internal admin counterpart). Unlocks per-row admin actions on
   * the venue cards. External `/share/client/[token]` usage passes
   * the default (false) and gets the read-only surface.
   */
  isInternal?: boolean;
  hideChrome?: boolean;
  showRefreshDailyBudgets?: boolean;
  /**
   * Server-side hint: whether the Past Events accordion should start
   * expanded. Read from `?past=1` in the page's `searchParams` so a
   * shared URL opens in the same state the sender had. Defaults to
   * false; the client-side URL listener will sync afterwards.
   */
  initialPastExpanded?: boolean;
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

/**
 * Public client reporting dashboard — clean public surface, no dashboard nav.
 *
 * Replaces the legacy Google Sheets layout 4theFans (and similar clients)
 * used to maintain manually: regional tabs roll capacity up to a summary
 * bar, then a venue-grouped table breaks every event down by Pre-reg / Ad
 * Spend / Tickets / CPT / Revenue / ROAS. Ticket input lives inline in
 * the table cells, so the page is both report and capture surface.
 */
export function ClientPortal({
  token,
  client,
  events: initial,
  londonOnsaleSpend,
  londonPresaleSpend,
  dailyEntries,
  dailyRollups,
  additionalSpend,
  weeklyTicketSnapshots,
  trendTicketSnapshots,
  trendDailyHistory,
  isInternal = false,
  hideChrome = false,
  showRefreshDailyBudgets = true,
  initialPastExpanded = false,
}: Props) {
  // Local state owns every per-event row. Optimistic updates from the
  // event-card component flow back here via `onSnapshotSaved`.
  const [events, setEvents] = useState<PortalEvent[]>(initial);

  useEffect(() => {
    setEvents(initial);
  }, [initial]);

  // ── Past section accordion state ─────────────────────────────────
  // Start from the server-rendered hint (derived from ?past=1 in
  // searchParams). After hydration, sync from the actual URL so
  // refreshes and direct link visits work even if the server hint
  // wasn't threaded through.
  const [pastExpanded, setPastExpanded] = useState<boolean>(initialPastExpanded);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncFromUrl = () => {
      const sp = new URLSearchParams(window.location.search);
      setPastExpanded(sp.get("past") === "1");
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  const handlePastToggle = useCallback(() => {
    setPastExpanded((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (next) {
          url.searchParams.set("past", "1");
        } else {
          url.searchParams.delete("past");
        }
        window.history.replaceState(null, "", url.toString());
      }
      return next;
    });
  }, []);

  // Client-wide totals — always lifetime, regardless of the per-card
  // timeframe pills. Folds the WC26 on-sale shared-campaign spend
  // (when present) into the topline's adSpend / totalSpend so the
  // topline reconciles with the venue table's Overall London row.
  //
  // recencyFilter='active': exclude entirely-past venue groups from
  // headline cards (Total Marketing, Paid Media, Tickets). Multi-
  // fixture groups like Arsenal Title Run In still contribute all
  // their events' data (including past fixtures) because the GROUP is
  // active — that matches the spec and the venue table's own totals.
  const clientWideTotals = useMemo(
    () =>
      aggregateClientWideTotals(
        events,
        dailyRollups,
        additionalSpend,
        londonOnsaleSpend ?? 0,
        "active",
      ),
    [events, dailyRollups, additionalSpend, londonOnsaleSpend],
  );

  const grouped = useMemo(() => {
    return groupEventsByClientRegion(events);
  }, [events]);
  const venueEventCodes = useMemo(
    () =>
      Array.from(
        new Set(
          events
            .map((e) => e.event_code)
            .filter((code): code is string => Boolean(code)),
        ),
      ),
    [events],
  );

  const visibleTabs = visibleClientRegions(grouped);

  // Default tab = the one with the most events. Ties keep the
  // canonical region-order preference.
  const defaultTab = useMemo(() => {
    return defaultClientRegion(grouped);
  }, [grouped]);

  const [activeTab, setActiveTab] = useState<ClientRegionKey | null>(defaultTab);
  const tabKey = activeTab && visibleTabs.includes(activeTab) ? activeTab : defaultTab;

  const tabEvents = useMemo(
    () => (tabKey ? grouped.get(tabKey) ?? [] : []),
    [grouped, tabKey],
  );

  // Summary bar rolls up the resolved display tickets: snapshot vs
  // tier-channel union, whichever is higher.
  const summary = useMemo(() => {
    let sold = 0;
    let cap = 0;
    let venues = 0;
    for (const ev of tabEvents) {
      const resolvedSold =
        ev.ticket_tiers.length > 0
          ? resolveDisplayTicketCount({
              ticket_tiers: ev.ticket_tiers,
              latest_snapshot_tickets: ev.latest_snapshot?.tickets_sold ?? null,
              fallback_tickets: ev.tickets_sold ?? null,
              tier_channel_sales_sum: ev.tier_channel_sales_tickets ?? null,
            })
          : ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
      sold += resolvedSold;
      cap += ev.capacity ?? 0;
      venues += 1;
    }
    const pct = cap > 0 ? Math.round((sold / cap) * 100) : 0;
    return { sold, cap, venues, pct };
  }, [tabEvents]);

  const handleSnapshot = (
    eventId: string,
    snapshot: {
      tickets_sold: number;
      revenue: number | null;
      captured_at: string;
      week_start: string;
    },
  ) => {
    setEvents((prev) =>
      prev.map((ev) => {
        if (ev.id !== eventId) return ev;
        const newHistory = [
          { ...snapshot },
          // Drop any pre-existing same-week row so the history list
          // doesn't show two entries for one Mon-Sun period.
          ...ev.history.filter((h) => h.week_start !== snapshot.week_start),
        ].slice(0, 5);
        return {
          ...ev,
          latest_snapshot: { ...snapshot },
          history: newHistory,
        };
      }),
    );
  };

  // When rendered inside the authenticated dashboard layout, swap
  // the public `<main>` chrome for a simple wrapper so the page
  // inherits the dashboard nav + background. The external share
  // surface keeps the branded chrome below.
  const showPublicChrome = !isInternal && !hideChrome;
  const Wrapper = showPublicChrome ? "main" : "div";
  const wrapperClass = showPublicChrome
    ? "min-h-screen bg-background text-foreground"
    : isInternal
    ? "bg-background text-foreground"
    : "";

  return (
    <Wrapper className={wrapperClass}>
      {/* Header — only on the public share surface. The internal
          dashboard route owns its own PageHeader. */}
      {showPublicChrome && (
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
            <p className="font-heading text-base tracking-[0.2em] text-foreground">
              OFF / PIXEL
            </p>
            <p className="text-xs text-muted-foreground truncate max-w-[40ch]">
              {client.name}
            </p>
          </div>
        </header>
      )}

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl tracking-wide text-foreground">
              Campaign performance
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tickets sold and ad spend breakdown by venue. Click any tickets
              figure to update it.
            </p>
          </div>
          {!isInternal && showRefreshDailyBudgets ? (
            <ClientRefreshDailyBudgetsButton
              clientId={client.id}
              eventCodes={venueEventCodes}
              shareToken={token}
            />
          ) : null}
        </div>

        {/* Client-wide topline — only shown when the client spans
            2+ venue groups. A single-group client already has its
            numbers on the one card below; the topline would be a
            duplicate that adds noise. Computed in the loader once and
            passed down so SSR + CSR draw the same numbers. */}
        {clientWideTotals.venueGroups >= 2 && (
          <ClientWideTopline
            clientName={client.name}
            totals={clientWideTotals}
          />
        )}

        {visibleTabs.length === 0 ? (
          <div className="rounded-md border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No events linked to this client yet. Get in touch if you
              were expecting to see shows here.
            </p>
          </div>
        ) : (
          <>
            {/* Tabs — only render when more than one bucket is non-empty */}
            {visibleTabs.length > 1 && (
              <div
                role="tablist"
                aria-label="Region"
                className="flex flex-wrap gap-1 border-b border-border"
              >
                {visibleTabs.map((t) => {
                  const isActive = t === tabKey;
                  const count = grouped.get(t)?.length ?? 0;
                  return (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(t)}
                      className={`relative -mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? "border-b-2 border-foreground font-medium text-foreground"
                          : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {CLIENT_REGION_LABELS[t]}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Summary bar */}
            <div className="rounded-md border border-border bg-card px-4 py-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold text-foreground">
                  {formatNumber(summary.sold)}
                </span>{" "}
                /{" "}
                <span className="font-semibold text-foreground">
                  {formatNumber(summary.cap)}
                </span>{" "}
                sold across {summary.venues} venue
                {summary.venues === 1 ? "" : "s"}
                {summary.cap > 0 && (
                  <>
                    {" "}— <span className="font-semibold">{summary.pct}%</span>
                  </>
                )}
              </p>
              {summary.cap > 0 && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{
                      width: `${Math.min(100, Math.max(0, summary.pct))}%`,
                    }}
                  />
                </div>
              )}
            </div>

            {/* Venue-grouped reporting table */}
            <ClientPortalVenueTable
              token={token}
              clientId={client.id}
              events={tabEvents}
              londonOnsaleSpend={londonOnsaleSpend}
              londonPresaleSpend={londonPresaleSpend}
              dailyEntries={dailyEntries}
              dailyRollups={dailyRollups}
              additionalSpend={additionalSpend}
              weeklyTicketSnapshots={weeklyTicketSnapshots}
              trendTicketSnapshots={trendTicketSnapshots}
              trendDailyHistory={trendDailyHistory}
              isInternal={isInternal}
              onSnapshotSaved={handleSnapshot}
              pastExpanded={pastExpanded}
              onPastToggle={handlePastToggle}
            />
          </>
        )}
      </div>

      {showPublicChrome && (
        <footer className="border-t border-border mt-12">
          <div className="mx-auto max-w-7xl px-6 py-4 text-[11px] text-muted-foreground">
            Off Pixel · campaign analytics for {client.name}
          </div>
        </footer>
      )}
    </Wrapper>
  );
}
