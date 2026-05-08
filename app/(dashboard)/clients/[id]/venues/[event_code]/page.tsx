import { notFound, redirect } from "next/navigation";

import { EnhancementFlagBanner } from "@/components/dashboard/EnhancementFlagBanner";
import { createClient } from "@/lib/supabase/server";
import { loadClientPortalByClientId } from "@/lib/db/client-portal-server";
import { VenueFullReport } from "@/components/share/venue-full-report";
import { VenueReportHeader, type VenueSubTab } from "@/components/share/venue-report-header";
import { getShareForVenue } from "@/lib/db/report-shares";
import { listDraftsForEventIds } from "@/lib/db/venue-drafts";
import { VenueShareControls } from "@/components/dashboard/clients/venue-share-controls";
import { FunnelPacingSection } from "@/components/dashboard/clients/funnel-pacing-section";
import { CreativePatternsPanel } from "@/components/dashboard/clients/creative-patterns-panel";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";
import {
  parseCreativePatternPhase,
  parseCreativePatternFunnel,
} from "@/lib/dashboard/creative-patterns-funnel-view";
import {
  parsePlatformParam,
  type PlatformId,
} from "@/lib/dashboard/platform-colors";
import { getSeriesDisplayLabel } from "@/lib/dashboard/series-display-labels";

/**
 * /clients/[id]/venues/[event_code]
 *
 * Internal venue full-report page. Restructure (PR feat/venue-report-
 * layout-restructure) replaced the page-level `PageHeader` + `SubTabBar`
 * with the sticky `<VenueReportHeader>` so the title, Live indicator,
 * Sync now button, sub-tabs, and the global Timeframe + Platform
 * selectors stay visible as the operator scrolls deep into the
 * Performance tab.
 *
 * Render parity (internal vs share):
 *   The share route at `/share/venue/[token]` renders the same header
 *   + tab structure with `syncEventIds={[]}` (the public sync route
 *   isn't venue-scoped) and a null `settingsHref` (the share viewer
 *   can't reach Settings for the connect-CTA cards on Stats Grid).
 *   Aside from those two affordances the layout is identical.
 *
 * Data flow:
 *   - `loadClientPortalByClientId` fetches the whole client payload.
 *   - The page filters to `event_code` at render time; per-venue
 *     loaders weren't worth the duplication for the 4theFans roster.
 *   - Performance tab ⇒ `<VenueFullReport>` (windowed + platform-
 *     filtered children inside).
 *   - Insights tab ⇒ `<CreativePatternsPanel>` scoped to the venue.
 *   - Pacing tab ⇒ `<FunnelPacingSection>` scoped to the venue.
 *
 * 404 semantics: 404 when the event_code doesn't exist under the
 * client OR is owned by a different user. Matches the placeholder's
 * ownership guard so probing `/venues/<random>` stays
 * indistinguishable from a revoked share.
 */
interface Props {
  params: Promise<{ id: string; event_code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientVenueReportPage({
  params,
  searchParams,
}: Props) {
  const [{ id, event_code: eventCodeRaw }, sp] = await Promise.all([
    params,
    searchParams,
  ]);
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
  const eventCode = decodeURIComponent(eventCodeRaw);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, user_id")
    .eq("id", id)
    .maybeSingle();
  if (clientErr || !client) notFound();
  if (client.user_id !== user.id) notFound();

  // Existence guard — make sure this event_code actually belongs to
  // the client before we load the full portal payload. Cheaper than
  // loading first and then filtering to zero rows.
  const { data: anyEvent } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", id)
    .eq("event_code", eventCode)
    .limit(1)
    .maybeSingle();
  if (!anyEvent) notFound();

  const [portal, existingShare] = await Promise.all([
    loadClientPortalByClientId(id),
    getShareForVenue(id, eventCode),
  ]);
  if (!portal.ok) notFound();

  // Filter the payload to the chosen venue. `event_code` is the
  // canonical pivot across the whole data layer — events, rollups,
  // snapshots, additional spend all FK to event_id so a set-of-ids
  // derived from the filtered events is the cheapest way to narrow
  // the rest.
  const venueEvents = portal.events.filter(
    (e) => e.event_code === eventCode,
  );
  const eventIdSet = new Set(venueEvents.map((e) => e.id));
  const venueDailyEntries = portal.dailyEntries.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueDailyRollups = portal.dailyRollups.filter((r) =>
    eventIdSet.has(r.event_id),
  );
  const venueAdditionalSpend = portal.additionalSpend.filter((r) =>
    r.scope === "venue" ? r.venue_event_code === eventCode : eventIdSet.has(r.event_id),
  );
  const venueWeeklyTicketSnapshots = portal.weeklyTicketSnapshots.filter(
    (r) => eventIdSet.has(r.event_id),
  );
  const linkedDrafts = await listDraftsForEventIds(supabase, [
    ...eventIdSet,
  ]);

  // Title: prefer the curated series label (e.g. "Arsenal Champions
  // League Final – London") over the raw venue_name fallback so the
  // sticky header reads like the marketing copy rather than the
  // logistics venue. Falls back to venue_name → event_code.
  const venueTitle =
    getSeriesDisplayLabel(eventCode) ??
    venueEvents[0]?.venue_name ??
    eventCode;
  const lastSyncedAt = computeLastSyncedAt(venueDailyRollups);
  const displayEventDate = displayVenueEventDate(venueEvents);
  const daysUntil = computeDaysUntil(displayEventDate);

  const subTabs = buildSubTabs(id, eventCode, {
    phase: patternsPhase,
    funnel: patternsFunnel,
    platform,
    datePreset,
    customRange,
  });

  return (
    <div className="space-y-6 p-6">
      <VenueReportHeader
        title={venueTitle}
        subtitle={eventCode}
        subTabs={subTabs}
        activeTab={activeTab}
        daysUntil={daysUntil}
        displayEventDate={displayEventDate}
        lastSyncedAt={lastSyncedAt}
        datePreset={datePreset}
        customRange={customRange}
        platform={platform}
        syncEventIds={venueEvents.map((e) => e.id)}
        shareClientId={id}
        showClientShareButton
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <VenueShareControls
          clientId={id}
          eventCode={eventCode}
          initialShareToken={existingShare?.token ?? null}
          initialCanEdit={existingShare?.can_edit ?? null}
          initialEnabled={existingShare?.enabled ?? null}
        />
      </div>
      <EnhancementFlagBanner
        clientId={id}
        eventIds={venueEvents.map((e) => e.id)}
      />
      {activeTab === "performance" ? (
        <VenueFullReport
          clientId={id}
          eventCode={eventCode}
          events={venueEvents}
          dailyEntries={venueDailyEntries}
          dailyRollups={venueDailyRollups}
          additionalSpend={venueAdditionalSpend}
          weeklyTicketSnapshots={venueWeeklyTicketSnapshots}
          londonOnsaleSpend={portal.londonOnsaleSpend}
          londonPresaleSpend={portal.londonPresaleSpend}
          datePreset={datePreset}
          customRange={customRange}
          linkedDrafts={linkedDrafts}
          platform={platform}
          settingsHref={`/clients/${id}/settings`}
          isInternal
        />
      ) : activeTab === "insights" ? (
        <CreativePatternsPanel
          clientId={id}
          scopeLabel={venueTitle}
          regionFilter={{ type: "venue_code", value: eventCode }}
          phase={patternsPhase}
          funnel={patternsFunnel}
          venueEventCode={eventCode}
        />
      ) : (
        <FunnelPacingSection
          clientId={id}
          regionFilter={{ type: "venue_code", value: eventCode }}
        />
      )}
    </div>
  );
}

function parseVenueSubTab(value: string | null): VenueSubTab {
  if (value === "insights" || value === "pacing") return value;
  return "performance";
}

function buildSubTabs(
  clientId: string,
  eventCode: string,
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
  const baseHref = `/clients/${clientId}/venues/${encodeURIComponent(eventCode)}`;
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

function parseDatePreset(value: string | string[] | undefined): DatePreset {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "custom") return "custom";
  if (raw && (DATE_PRESETS as readonly string[]).includes(raw)) {
    return raw as DatePreset;
  }
  return "maximum";
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
