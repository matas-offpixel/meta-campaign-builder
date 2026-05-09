import type { Metadata } from "next";

import { loadVenuePortalByToken } from "@/lib/db/client-portal-server";
import { listDraftsForEventIds } from "@/lib/db/venue-drafts";
import { VenueFullReport } from "@/components/share/venue-full-report";
import { VenueReportHeader, type VenueSubTab } from "@/components/share/venue-report-header";
import { ClientPortalUnavailable } from "@/components/share/client-portal-unavailable";
import { CreativePatternsPanel } from "@/components/dashboard/clients/creative-patterns-panel";
import { FunnelPacingSection } from "@/components/dashboard/clients/funnel-pacing-section";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";
import {
  parsePlatformParam,
  type PlatformId,
} from "@/lib/dashboard/platform-colors";
import { getSeriesDisplayLabel } from "@/lib/dashboard/series-display-labels";
import {
  parseCreativePatternPhase,
  parseCreativePatternFunnel,
} from "@/lib/dashboard/creative-patterns-funnel-view";

/**
 * app/share/venue/[token]/page.tsx
 *
 * Public venue full-report page. Mirrors the internal
 * `/clients/[id]/venues/[event_code]` route layout exactly — same
 * sticky header, same sub-tab bar (Performance / Creative Insights /
 * Funnel Pacing), same Performance content. Only differences:
 *   - Sync Now is no-op + router.refresh() (the public sync route is
 *     event-scoped, not venue-fan-out friendly).
 *   - Settings link on the Stats Grid empty-state cards renders
 *     disabled with a tooltip (share viewers can't reach Settings).
 *   - Insights + Pacing tabs render with `isShared=true` so the
 *     server-component data layer uses the service-role client and
 *     bypasses RLS for the read.
 *
 * Token contract (migration 052):
 *   - scope='venue', client_id NOT NULL, event_code NOT NULL
 *   - can_edit gates additional-spend CRUD on the public surface
 *
 * Failure modes (collapsed to the neutral unavailable page):
 *   - Unknown / disabled / expired / malformed token.
 *   - Token resolves to a non-venue scope (event/client).
 *   - Token resolves but no events match the pinned event_code
 *     (rename / delete after mint).
 *
 * `dynamic = 'force-dynamic'` because the payload must reflect the
 * latest snapshot the client just saved — caching would visibly lag
 * the "last synced" indicator.
 */

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Venue Report · Off Pixel",
    robots: { index: false, follow: false },
  };
}

export default async function VenueSharePage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const datePreset = parseDatePreset(sp.tf);
  const activeTab = parseVenueSubTab(pickQueryParam(sp.tab));
  const platform = parsePlatformParam(pickQueryParam(sp.platform));
  const patternsPhase = parseCreativePatternPhase(pickQueryParam(sp.phase));
  const patternsFunnel = parseCreativePatternFunnel(pickQueryParam(sp.funnel));
  const customRange = parseCustomRange(
    datePreset,
    pickQueryParam(sp.from),
    pickQueryParam(sp.to),
  );
  const result = await loadVenuePortalByToken(token, { bumpView: true });

  if (!result.ok) {
    return <ClientPortalUnavailable />;
  }
  const linkedDrafts = await listDraftsForEventIds(
    // The venue-portal loader returns the resolved client + admin
    // scope already; reuse the events list to query linked drafts via
    // the same admin client wrapper we'd use elsewhere.
    // `loadVenuePortalByToken` doesn't expose the admin client, so we
    // create one here — cheap and stateless.
    (await import("@/lib/supabase/server")).createServiceRoleClient(),
    result.events.map((event) => event.id),
  );

  const venueTitle =
    getSeriesDisplayLabel(result.event_code) ??
    result.events[0]?.venue_name ??
    result.event_code;
  const lastSyncedAt = computeLastSyncedAt(result.dailyRollups);
  const displayEventDate = displayVenueEventDate(result.events);
  const daysUntil = computeDaysUntil(displayEventDate);
  const subTabs = buildShareSubTabs(token, {
    phase: patternsPhase,
    funnel: patternsFunnel,
    platform,
    datePreset,
    customRange,
  });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-3">
          <p className="font-heading text-base tracking-[0.2em] text-foreground">
            OFF / PIXEL
          </p>
          <p className="max-w-[40ch] truncate text-xs text-muted-foreground">
            Venue Report
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-6 py-6">
        <VenueReportHeader
          title={venueTitle}
          subtitle={result.event_code}
          subTabs={subTabs}
          activeTab={activeTab}
          daysUntil={daysUntil}
          displayEventDate={displayEventDate}
          lastSyncedAt={lastSyncedAt}
          datePreset={datePreset}
          customRange={customRange}
          platform={platform}
          // Public sync route is event-scoped (per-token, single
          // event). Venue fan-out requires session auth that the
          // share viewer doesn't have. Sync Now collapses to a
          // `router.refresh()` for them.
          syncEventIds={[]}
        />
        {activeTab === "performance" ? (
          <VenueFullReport
            token={token}
            clientId={result.client_id}
            eventCode={result.event_code}
            events={result.events}
            dailyEntries={result.dailyEntries}
            dailyRollups={result.dailyRollups}
            additionalSpend={result.additionalSpend}
            weeklyTicketSnapshots={result.weeklyTicketSnapshots}
            trendTicketSnapshots={result.trendTicketSnapshots}
            trendDailyHistory={result.trendDailyHistory}
            londonOnsaleSpend={result.londonOnsaleSpend}
            londonPresaleSpend={result.londonPresaleSpend}
            canEdit={result.can_edit}
            datePreset={datePreset}
            customRange={customRange}
            platform={platform}
            settingsHref={null}
            linkedDrafts={linkedDrafts}
          />
        ) : activeTab === "insights" ? (
          <CreativePatternsPanel
            clientId={result.client_id}
            scopeLabel={venueTitle}
            regionFilter={{ type: "venue_code", value: result.event_code }}
            phase={patternsPhase}
            funnel={patternsFunnel}
            venueEventCode={result.event_code}
            isShared
          />
        ) : (
          <FunnelPacingSection
            clientId={result.client_id}
            regionFilter={{ type: "venue_code", value: result.event_code }}
            isShared
          />
        )}
      </div>
    </main>
  );
}

function parseDatePreset(value: string | string[] | undefined): DatePreset {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "custom") return "custom";
  if (raw && (DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw as DatePreset;
  }
  return "maximum";
}

function parseVenueSubTab(value: string | null): VenueSubTab {
  if (value === "insights" || value === "pacing") return value;
  return "performance";
}

function pickQueryParam(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseCustomRange(
  preset: DatePreset,
  from: string | null,
  to: string | null,
): CustomDateRange | undefined {
  if (preset !== "custom") return undefined;
  if (!from || !to) return undefined;
  return { since: from, until: to };
}

function buildShareSubTabs(
  token: string,
  ctx: {
    phase: string;
    funnel: string;
    platform: PlatformId;
    datePreset: DatePreset;
    customRange?: CustomDateRange;
  },
): { id: VenueSubTab; label: string; href: string }[] {
  const baseParams: Record<string, string> = {
    phase: ctx.phase,
    funnel: ctx.funnel,
  };
  if (ctx.platform !== "all") baseParams.platform = ctx.platform;
  if (ctx.datePreset !== "maximum") baseParams.tf = ctx.datePreset;
  if (ctx.datePreset === "custom" && ctx.customRange) {
    baseParams.from = ctx.customRange.since;
    baseParams.to = ctx.customRange.until;
  }
  const baseHref = `/share/venue/${encodeURIComponent(token)}`;
  return (
    [
      { id: "performance" as VenueSubTab, label: "Performance" },
      { id: "insights" as VenueSubTab, label: "Creative Insights" },
      { id: "pacing" as VenueSubTab, label: "Funnel Pacing" },
    ].map((tab) => {
      const sp = new URLSearchParams({ ...baseParams, tab: tab.id });
      return { ...tab, href: `${baseHref}?${sp.toString()}` };
    })
  );
}

function displayVenueEventDate(
  events: { event_date: string | null }[],
): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .map((event) => event.event_date)
    .filter((date): date is string => !!date && date >= today)
    .sort();
  if (upcoming.length > 0) return upcoming[0];
  return (
    events
      .map((event) => event.event_date)
      .filter((date): date is string => !!date)
      .sort()
      .at(-1) ?? null
  );
}

function computeDaysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00`);
  if (!Number.isFinite(target)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now.getTime()) / 86_400_000);
}

function computeLastSyncedAt(
  rollups: Array<{
    source_meta_at?: string | null;
    source_eventbrite_at?: string | null;
    source_tiktok_at?: string | null;
    source_google_ads_at?: string | null;
    updated_at?: string;
  }>,
): string | null {
  let latest: string | null = null;
  for (const row of rollups) {
    for (const ts of [
      row.source_meta_at,
      row.source_eventbrite_at,
      row.source_tiktok_at,
      row.source_google_ads_at,
      row.updated_at,
    ]) {
      if (!ts) continue;
      if (!latest || ts > latest) latest = ts;
    }
  }
  return latest;
}
