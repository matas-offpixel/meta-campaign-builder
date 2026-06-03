"use client";

import { useMemo, useState, type ReactNode } from "react";

import { sumAdditionalSpendAmounts } from "@/lib/db/additional-spend-sum";
import {
  fmtCurrency,
  fmtCurrencyCompact,
  fmtDate,
} from "@/lib/dashboard/format";
import { computeCrossPlatformRateMetrics } from "@/lib/dashboard/brand-campaign-cross-platform-stats";
import {
  fullDaysUntilEventUtc,
  type SellOutPacingResult,
} from "@/lib/dashboard/report-pacing";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import {
  type CustomDateRange,
  type DatePreset,
  type EventInsightsPayload,
} from "@/lib/insights/types";

import { CreativePerformanceLazy } from "./creative-performance-lazy";
import {
  MetaCampaignBreakdownSection,
  MetaDemographicsSection,
  MetaCampaignStatsSection,
  TikTokCampaignStatsSection,
  type TikTokRollupTotals,
  Section,
  Metric,
  fmtInt,
} from "./meta-insights-sections";
import { RefreshReportButton } from "./refresh-report-button";
import { CustomRangePicker, TimeframeSelector } from "./timeframe-controls";
import {
  TikTokReportBlock,
  type TikTokReportBlockData,
} from "./tiktok-report-block";
import {
  GoogleAdsReportBlock,
  type GoogleAdsReportBlockData,
} from "./google-ads-report-block";
import { RegistrationsCard } from "./RegistrationsCard";
import type { MailchimpRegistrationsData } from "@/lib/mailchimp/registrations-loader";
/**
 * components/report/event-report-view.tsx
 *
 * Shared report layout used by BOTH the public share page
 * (`app/share/report/[token]/page.tsx`) and the internal Reporting tab
 * mirror (`components/report/internal-event-report.tsx`). Single source
 * of truth so the two views never drift visually.
 *
 * Client component because the timeframe selector is interactive.
 * The two callsites differ only in HOW the timeframe change is plumbed:
 *
 *   - Public  → URL state (`router.push("?tf=…")` → RSC re-renders).
 *   - Internal → local state (`setDatePreset` → re-fetch via /api/insights).
 *
 * `creativesSource` is a discriminated union so the lazy creative panel
 * can hit the right route (share or internal) without this layout
 * needing to know which surface it's rendering on.
 */

// ─── TikTok snapshot types ────────────────────────────────────────────────
// Serialised from tiktok_breakdown_snapshots / tiktok_active_creatives_snapshots
// and passed as a plain prop so platform-filter state in EventReportView can
// gate visibility without a separate fetch round-trip.

export interface TikTokSnapshotBreakdown {
  dimension: string;
  dimension_value: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
}

export interface TikTokSnapshotCreative {
  ad_id: string;
  ad_name: string | null;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  video_views_2s: number | null;
  video_views_100p: number | null;
  thumbnail_url: string | null;
  deeplink_url: string | null;
}

export interface TikTokSnapshotData {
  breakdowns: TikTokSnapshotBreakdown[];
  creatives: TikTokSnapshotCreative[];
}

export interface EventReportViewEvent {
  name: string;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  eventDate: string | null;
  eventStartAt: string | null;
  kind?: string | null;
  paidMediaBudget: number | null;
  ticketsSold: number | null;
  /**
   * Where `ticketsSold` came from:
   *   - "plan"    → latest ad_plan_days.tickets_sold_cumulative
   *   - "manual"  → events.tickets_sold (override input)
   *   - null      → no figure recorded yet
   * Drives the StatCard sub-line + the read-only / editable mode of
   * the TicketsSoldPanel on the internal Reporting tab.
   */
  ticketsSoldSource?: "plan" | "manual" | null;
  /**
   * Plan-day date that supplied `ticketsSold` when `ticketsSoldSource ===
   * "plan"`. Surfaced in the StatCard sub-line as "From campaign plan ·
   * {date}". Null for manual / not-yet-recorded.
   */
  ticketsSoldAsOf?: string | null;
  /** Venue capacity — same field as Performance summary pacing row. */
  capacity?: number | null;
  /** Lifetime pre-reg spend — feeds sell-out pacing CPT (internal + share). */
  preregSpend?: number | null;
  /** Cached Meta lifetime spend — pacing when timeline has no ad_spend rows. */
  metaSpendCached?: number | null;
}

export type CreativesSource =
  | { kind: "share"; token: string }
  | { kind: "internal"; eventId: string };

const NO_ADDITIONAL_SPEND: readonly { date: string; amount: number }[] = [];

interface Props {
  event: EventReportViewEvent;
  /**
   * Meta insights payload. Optional — when null/undefined the entire Meta
   * section (timeframe selector, campaign performance, per-campaign
   * breakdown, creative performance) is omitted. The TikTok-only share
   * path (no Meta ad account on the client) lands here with `meta=null`
   * and a non-null `tiktok` prop.
   */
  meta?: EventInsightsPayload | null;
  /**
   * Latest manual TikTok report snapshot. Optional — when present, a
   * read-only TikTokReportBlock renders below the Meta section. At least
   * one of `meta` / `tiktok` is guaranteed non-null by the caller; if
   * both are null this view collapses to event header + budget tile only,
   * which is intentional for the (currently unused) "no data either side"
   * fallback.
   */
  tiktok?: TikTokReportBlockData | null;
  googleAds?: GoogleAdsReportBlockData | null;
  datePreset: DatePreset;
  /**
   * Active custom range when `datePreset === "custom"`. Drives the
   * highlighted "{from} → {to}" label in the dedicated picker row.
   * Required for the picker row to seed its inputs on first paint;
   * undefined for any preset.
   */
  customRange?: CustomDateRange;
  creativesSource: CreativesSource;
  /**
   * Called when the visitor picks a new timeframe.
   *   - Public  → router.push with ?tf=<preset> on the same pathname,
   *     plus from/to when preset === "custom".
   *   - Internal → setDatePreset state + refetch the insights route.
   * The `customRange` argument is required when `preset === "custom"`,
   * absent for all preset values.
   */
  onTimeframeChange: (
    preset: DatePreset,
    customRange?: CustomDateRange,
  ) => void;
  /**
   * True while a parent is re-fetching insights for a new preset. Greys
   * out the timeframe buttons + dims the metric grid so the visitor
   * gets feedback that the click landed. Optional — defaults to false.
   */
  isRefreshing?: boolean;
  /**
   * Layout mode.
   *   - "standalone" (default): full-page chrome — wrapping `<main>`
   *     with min-h-screen, big report header, "Powered by Off Pixel"
   *     footer. Used by the public share page.
   *   - "embedded": no `<main>`, no header, no footer — just the
   *     report body. Used inside the internal Reporting tab where
   *     the dashboard already provides chrome + page header.
   */
  variant?: "standalone" | "embedded";
  /**
   * Optional server-rendered replacement for the "Creative
   * performance" section. When provided, the default lazy
   * `<CreativePerformanceLazy>` section is hidden and the slot
   * contents render in its place.
   *
   * Used by the public share page to swap in a server-rendered
   * "Active creatives" section
   * (`<ShareActiveCreativesSection>`) — the share page has the
   * service-role token to fetch upfront, so there's no point
   * shipping the lazy-load button to the client. The internal
   * Reporting tab leaves this undefined and keeps the existing
   * lazy section.
   *
   * Type is ReactNode (not a render fn) so a server component can
   * be passed straight through this client component via the
   * standard "RSC slot in a client parent" composition.
   */
  creativesSlot?: React.ReactNode;
  /**
   * Optional pre-rendered slot for the per-event daily report block
   * (summary header + trend chart + tracker table). When provided,
   * renders below the Meta + TikTok blocks. The share RSC builds it
   * server-side from the unified timeline (live + manual entries) so
   * the block can render on the public share page without an extra
   * authenticated round-trip.
   *
   * Internal Reporting tab leaves this undefined — the dashboard's
   * Overview tab already renders the same block directly.
   */
  eventDailySlot?: React.ReactNode;
  /**
   * Partial-render flag. Set by the share page when the headline
   * insights call (event-wide aggregate) failed but the per-ad
   * "Active creatives" call succeeded — typically a Meta-side
   * rate-limit on a 7-day query that hits the heavier insights
   * endpoint harder than the per-ad fan-out.
   *
   * When true:
   *   - `meta` is expected to be null. The headline metric grid
   *     (Campaign performance, Meta campaign stats, breakdown
   *     table) is suppressed entirely.
   *   - A muted banner explains that summary numbers are
   *     temporarily unavailable.
   *   - The timeframe selector still renders so the visitor can
   *     try a different preset (each preset is a separate cache
   *     bucket, so a re-pick may hit a healthy upstream).
   *   - `creativesSlot` (if provided) renders below — the live
   *     bit the visitor came for.
   */
  headlineUnavailable?: boolean;
  /**
   * Manual refresh callback (PR #57 #3). Called when the user
   * clicks the Refresh button in the live report footer. Should
   * bypass the server-side 5-minute cache for the current
   * (event, timeframe) bucket and resolve once the parent has
   * rendered the fresh payload. Reject the promise on error so
   * the button can surface an inline "Refresh failed: <message>"
   * line. Optional — when omitted (e.g. on a TikTok-only render
   * with no Meta payload) the button is hidden.
   */
  onManualRefresh?: () => Promise<void>;
  /**
   * Off-Meta additional spend rows — summed into Campaign performance
   * "Spent" for the active timeframe (same window as Meta insights).
   * Optional; omit or pass [] when unavailable (share RSC / internal
   * fetch supplies this for the Meta + other split line).
   */
  additionalSpendEntries?: ReadonlyArray<{ date: string; amount: number }>;
  /**
   * Sell-out pacing (tickets/day · spend/day) — computed from lifetime
   * rollups + running CPT. Optional; when omitted the Tickets card omits
   * the pacing line.
   */
  sellOutPacing?: SellOutPacingResult | null;
  /**
   * Optional slot below TikTok / above the event daily block — used on the
   * public share page for token-scoped additional spend CRUD.
   */
  additionalSpendSlot?: ReactNode;
  /**
   * Optional server-rendered slot for the Mailchimp registrations card.
   * Renders on brand-awareness event share pages when the event has a
   * resolved Mailchimp audience and at least one snapshot row.
   * Positioned below the event daily block.
   */
  mailchimpSlot?: ReactNode;
  /**
   * Mailchimp registration metrics — drives the REGISTRATIONS card in
   * the Campaign Performance header strip for `brand_campaign` events.
   * When null/undefined the card renders an empty state ("Mailchimp not
   * linked") so the column is never silently dropped.
   */
  registrationsData?: MailchimpRegistrationsData | null;
  /**
   * When provided, a Refresh button is shown on the REGISTRATIONS card
   * (internal dashboard only). Calls the parent's refresh handler which
   * should POST to /api/events/:id/mailchimp/refresh and re-load data.
   */
  onRefreshRegistrations?: () => Promise<void>;
  /**
   * Pre-computed per-platform spend totals from `event_daily_rollups`
   * (server-side, brand_campaign only). When present these values
   * override the API-derived `meta.totals.spend` / `tiktok.snapshot.*`
   * for the PAID MEDIA card, % used, daily budget, and platform pills —
   * so all sections of the page read from the same canonical source.
   *
   * Omit for regular `event`-kind events: they continue to use the
   * Meta API window-scoped payload.
   */
  brandRollupSpend?: { meta: number; tiktok: number; google: number } | null;
  /**
   * TikTok per-platform rollup totals (impressions, clicks, video views,
   * conversions) computed server-side from event_daily_rollups.
   * When provided, enables the TIKTOK CAMPAIGN STATS block for
   * brand_campaign events. Omit for regular events.
   */
  tiktokRollupTotals?: TikTokRollupTotals | null;
  /**
   * Pre-loaded rows from `tiktok_breakdown_snapshots` +
   * `tiktok_active_creatives_snapshots` for this event.
   * When provided, replaces the "coming soon" / "syncing" placeholder
   * copy inside the TikTok Audience and Active Creatives sections.
   * Optional — brand_campaign share page only; internal report + regular
   * event share pages leave this undefined and keep the existing copy.
   */
  tiktokSnapshots?: TikTokSnapshotData | null;
}

export function EventReportView({
  event,
  meta = null,
  tiktok = null,
  googleAds = null,
  datePreset,
  customRange,
  creativesSource,
  onTimeframeChange,
  isRefreshing = false,
  variant = "standalone",
  creativesSlot,
  eventDailySlot,
  headlineUnavailable = false,
  onManualRefresh,
  additionalSpendEntries = NO_ADDITIONAL_SPEND,
  sellOutPacing = null,
  additionalSpendSlot,
  mailchimpSlot,
  registrationsData,
  onRefreshRegistrations,
  brandRollupSpend,
  tiktokRollupTotals,
  tiktokSnapshots,
}: Props) {
  const venue = [event.venueName, event.venueCity, event.venueCountry]
    .filter(Boolean)
    .join(", ");

  const eventDateLabel = event.eventDate ? fmtDate(event.eventDate) : "—";
  const isBrandCampaign = event.kind === "brand_campaign";
  const hasTikTokSignal = Boolean(
    tiktok?.snapshot.campaign &&
      ((tiktok.snapshot.campaign.cost ?? 0) > 0 ||
        (tiktok.snapshot.campaign.impressions ?? 0) > 0),
  );

  const daysUntil = computeDaysUntil(event.eventDate);
  const paidMediaCap = event.paidMediaBudget ?? 0;
  const windowDays = resolvePresetToDays(datePreset, customRange);
  const windowDaySet = windowDays === null ? null : new Set(windowDays);
  const otherSpendWindow = sumAdditionalSpendAmounts(
    additionalSpendEntries,
    windowDaySet,
  );
  const metaSpend = brandRollupSpend?.meta ?? (meta?.totals.spend ?? 0);
  const googleAdsSpend = brandRollupSpend?.google ?? (googleAds?.totals.spend ?? 0);
  const tiktokSpend = brandRollupSpend?.tiktok ?? (tiktok?.snapshot.campaign?.cost ?? 0);
  const platformSpend = metaSpend + googleAdsSpend + tiktokSpend;
  const spentTotalAll =
    meta != null ? platformSpend + otherSpendWindow : platformSpend;
  /** Burn against paid media budget across every surfaced paid platform. */
  const paidMediaSpent = platformSpend;

  // ─── Global platform filter (brand_campaign only) ───────────────────────
  type PlatformFilter = "all" | "meta" | "google" | "tiktok";
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");

  // Determine which platforms have any signal so we only show populated pills.
  const platformsWithSignal: PlatformFilter[] = ["all"];
  if (metaSpend > 0) platformsWithSignal.push("meta");
  if (googleAdsSpend > 0) platformsWithSignal.push("google");
  if (tiktokSpend > 0) platformsWithSignal.push("tiktok");

  const remainingPaidMedia = Math.max(0, paidMediaCap - paidMediaSpent);
  const paidMediaBudgetUsedPct =
    paidMediaCap > 0 && meta
      ? Math.min(100, (paidMediaSpent / paidMediaCap) * 100)
      : null;

  const otherSpendLifetime = sumAdditionalSpendAmounts(
    additionalSpendEntries,
    null,
  );
  const totalMarketingAllocated = paidMediaCap + otherSpendLifetime;

  // Tickets sold + cost per ticket. Three-way resolution:
  //
  //   1. `meta.ticketsSoldInWindow` (PR #56 #3) — the rollup-summed
  //      tickets for the selected timeframe. Wins whenever it's a
  //      number (including `0`, which is a legitimate "no tickets
  //      sold this window" reading on a tight Past 3 days view).
  //   2. `event.ticketsSold` — legacy mount-time snapshot from
  //      `events.tickets_sold` / the latest plan row. Fallback for
  //      events that haven't been linked to Eventbrite yet, or
  //      haven't run their first rollup sync.
  //   3. `null` → em-dash. Avoids misleading the visitor with a
  //      £Infinity / £NaN cost-per-ticket when the denominator
  //      is missing.
  //
  // CPT uses the same windowed denominator so it actually moves
  // with the timeframe — the 1,091 / £1.42 / £0.85 / £0.43 lie in
  // the original report came from freezing this denominator at
  // the all-time number.
  const windowedTickets = meta?.ticketsSoldInWindow;
  const ticketsSold =
    windowedTickets != null ? windowedTickets : event.ticketsSold;
  const costPerTicket =
    meta &&
    ticketsSold != null &&
    ticketsSold > 0 &&
    spentTotalAll > 0
      ? spentTotalAll / ticketsSold
      : null;

  // Capacity + sell-through — same rule as EventSummaryHeader.computeMetrics:
  // tickets numerator follows the timeframe pill via ticketsSold
  // (meta.ticketsSoldInWindow when present).
  const capacity =
    event.capacity != null && event.capacity > 0 ? event.capacity : null;
  const sellThroughPct =
    capacity != null && ticketsSold != null && ticketsSold >= 0
      ? (ticketsSold / capacity) * 100
      : null;

  const channelMultiActive = meta ? isMultiChannelActive(meta) : false;
  // "Last updated" footer prefers whichever data source was refreshed
  // most recently. When both are present (a client running Meta + manual
  // TikTok side-by-side) we surface the newer of the two so the visitor
  // doesn't see a stale Meta timestamp on a freshly-imported TikTok
  // snapshot, or vice versa.
  const lastUpdatedIso = pickLastUpdated(meta, tiktok);

  // Embedded mode skips the standalone chrome (the dashboard's
  // PageHeader already shows event name + venue + date) and renders the
  // report body inline so the Reporting tab doesn't end up with two
  // headers stacked.
  const Outer = variant === "standalone" ? "main" : "div";
  const outerClass =
    variant === "standalone"
      ? "min-h-screen bg-background text-foreground"
      : "";
  const bodyClass =
    variant === "standalone"
      ? "mx-auto max-w-6xl space-y-8 px-6 py-10"
      : "space-y-8";

  return (
    <Outer className={outerClass}>
      {variant === "standalone" ? (
        <ReportHeader
          eventName={event.name}
          venue={venue}
          eventDateLabel={eventDateLabel}
        />
      ) : null}

      <div className={`${bodyClass} relative`}>
        {/* Sticky pending bar — surfaces useTransition's pending flag
            from PublicReport so a timeframe switch always shows
            visible motion, even on cache hits where there's no
            Suspense fallback to fall back to. The shimmer keyframe
            lives in globals.css alongside the same effect on the
            active-creatives skeleton, so the two surfaces stay
            visually consistent. The standalone wrapper has px-6;
            the negative margin + extra width pulls the bar out so
            it spans the full visual edge rather than stopping at
            the padded inner column. Embedded mode skips the negative
            offset because the dashboard chrome sits right against
            the bar — extending would clip the sidebar. */}
        {isRefreshing ? (
          <div
            className={`sticky top-0 z-10 h-0.5 overflow-hidden bg-muted ${
              variant === "standalone"
                ? "-mx-6 w-[calc(100%+3rem)]"
                : "w-full"
            }`}
            aria-hidden
          >
            <div className="h-full w-1/3 bg-primary animate-[shimmer_1.2s_ease-in-out_infinite]" />
          </div>
        ) : null}

        {/* Top row — event-level facts */}
        <section
          className={`grid grid-cols-1 gap-3 ${!meta ? "sm:grid-cols-3" : ""}`}
        >
          <StatCard
            label="Days until event"
            value={daysUntil != null ? daysUntilLabel(daysUntil) : "—"}
            sub={event.eventDate ? fmtDate(event.eventDate) : null}
          />
          {!meta ? (
            <StatCard
              label="Total marketing budget"
              value={
                totalMarketingAllocated > 0
                  ? fmtCurrency(totalMarketingAllocated)
                  : "—"
              }
              sub={
                paidMediaCap > 0 || otherSpendLifetime > 0
                  ? `${fmtCurrency(paidMediaCap)} Paid media + ${fmtCurrency(otherSpendLifetime)} Additional`
                  : null
              }
            />
          ) : null}
          {!meta ? (
            <StatCard
              label="Paid media budget"
              value={paidMediaCap > 0 ? fmtCurrency(paidMediaCap) : "—"}
              sub={null}
            />
          ) : null}
        </section>

        {/* Platform filter pills — brand_campaign only; shown when multiple
            platforms have data. Above the timeframe pills so they communicate
            "this selector gates what the report below shows". */}
        {isBrandCampaign && platformsWithSignal.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {platformsWithSignal.map((p) => {
              const PLATFORM_LABELS: Record<PlatformFilter, string> = {
                all: "All",
                meta: "Meta",
                google: "Google Ads",
                tiktok: "TikTok",
              };
              const PLATFORM_COLOURS: Record<Exclude<PlatformFilter, "all">, string> = {
                meta: "#2563eb",
                google: "#ea4335",
                tiktok: "#111827",
              };
              const isActive = platformFilter === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatformFilter(p)}
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:border-foreground/40"
                  }`}
                >
                  {p !== "all" && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: PLATFORM_COLOURS[p] }}
                      aria-hidden="true"
                    />
                  )}
                  {PLATFORM_LABELS[p]}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Timeframe selector — Meta-only (drives Meta insights window).
            Hidden on TikTok-only renders since the manual TikTok snapshot
            already carries its own date range and re-imports replace it.
            Also rendered on the partial-render branch (headlineUnavailable)
            so the visitor can try a different preset — each preset is its
            own cache bucket, a re-pick may hit a healthy upstream. */}
        {meta || headlineUnavailable ? (
          <div className="space-y-2">
            <TimeframeSelector
              active={datePreset}
              disabled={isRefreshing}
              onChange={(preset) => onTimeframeChange(preset)}
            />
            <CustomRangePicker
              active={datePreset === "custom"}
              disabled={isRefreshing}
              initialRange={customRange ?? null}
              onApply={(range) => onTimeframeChange("custom", range)}
            />
          </div>
        ) : null}

        {/* Partial-render banner — appears when the headline insights
            call failed but the active-creatives call succeeded, so the
            page can still render the creative breakdown below. */}
        {!meta && headlineUnavailable ? <HeadlineUnavailableBanner /> : null}

        {!meta && additionalSpendSlot ? (
          <div className="mt-6 space-y-4">{additionalSpendSlot}</div>
        ) : null}

        {/* ─── Meta block ───────────────────────────────────────── */}
        {meta ? (
          <MetaReportBlock
            meta={meta}
            event={event}
            paidMediaCap={paidMediaCap}
            metaSpend={metaSpend}
            paidMediaSpent={paidMediaSpent}
            remainingPaidMedia={remainingPaidMedia}
            paidMediaBudgetUsedPct={paidMediaBudgetUsedPct}
            totalMarketingAllocated={totalMarketingAllocated}
            otherSpendLifetime={otherSpendLifetime}
            ticketsSold={ticketsSold}
            capacity={capacity}
            sellThroughPct={sellThroughPct}
            costPerTicket={costPerTicket}
            isBrandCampaign={isBrandCampaign}
            sellOutPacing={sellOutPacing}
            channelMultiActive={channelMultiActive}
            isRefreshing={isRefreshing}
            datePreset={datePreset}
            customRange={customRange}
            creativesSource={creativesSource}
            creativesSlot={creativesSlot}
            lastUpdatedIso={lastUpdatedIso}
            onManualRefresh={onManualRefresh}
            additionalSpendSlot={additionalSpendSlot}
            registrationsData={registrationsData}
            onRefreshRegistrations={onRefreshRegistrations}
            platformFilter={isBrandCampaign ? platformFilter : "all"}
            totalCrossPlatformSpent={paidMediaSpent}
            brandRollupSpend={brandRollupSpend}
            tiktokStats={tiktokRollupTotals}
            showCrossPlatformCaption={isBrandCampaign && !!brandRollupSpend}
            tiktokSnapshots={tiktokSnapshots}
          />
        ) : creativesSlot ? (
          // Headline-failed partial-render path. `meta` is null but the
          // upstream share RSC still resolved a creative breakdown — so
          // render the slot directly here, outside `MetaReportBlock`,
          // since the block requires a non-null `meta`. The standard
          // "Section" wrapper is omitted because `creativesSlot` already
          // provides its own `<section>` heading.
          creativesSlot
        ) : null}

        {/* ─── TikTok block ─────────────────────────────────────── */}
        {hasTikTokSignal && tiktok ? <TikTokReportBlock data={tiktok} /> : null}

        {/* ─── Google Ads block ─────────────────────────────────── */}
        {googleAds ? <GoogleAdsReportBlock data={googleAds} /> : null}

        {/* ─── Event daily report block ─────────────────────────── */
         /* Server-rendered from the unified timeline (live rollups +
            manual daily entries) so it renders on the public share
            page with no extra client fetch. The slot owns its own
            section heading + summary/chart/table. */}
        {eventDailySlot ?? null}

        {/* ─── Mailchimp registrations card ─────────────────────── */
         /* Server-rendered. Only present on brand-awareness share
            pages with a resolved Mailchimp audience and ≥1 snapshot
            row. Slot is composed by the share RSC. */}
        {mailchimpSlot ?? null}
      </div>

      {/* PR #63 — the "Last updated …" + manual Refresh button now
          render at the bottom of the Meta block (see MetaReportBlock).
          That keeps them next to the data they describe. The
          standalone footer below is branding-only ("Powered by Off
          Pixel"); the embedded variant has no footer at all because
          the dashboard already provides chrome. */}
      {variant === "standalone" ? <ReportFooter /> : null}
    </Outer>
  );
}

// ─── Meta report block ─────────────────────────────────────────────────────

function formatSellOutPacingLine(p: SellOutPacingResult | null): string {
  if (!p) return "—";
  const { ticketsNeededPerDay, spendNeededPerDay } = p;
  if (ticketsNeededPerDay == null && spendNeededPerDay == null) return "—";
  const tPart =
    ticketsNeededPerDay != null
      ? `${fmtInt(ticketsNeededPerDay)} tickets/day`
      : "—";
  const sPart =
    spendNeededPerDay != null
      ? `${fmtCurrencyCompact(spendNeededPerDay)}/day to sell out`
      : "—";
  return `${tPart} · ${sPart}`;
}

interface MetaReportBlockProps {
  meta: EventInsightsPayload;
  event: EventReportViewEvent;
  paidMediaCap: number;
  metaSpend: number;
  paidMediaSpent: number;
  remainingPaidMedia: number;
  paidMediaBudgetUsedPct: number | null;
  /** Paid media budget + lifetime sum of additional spend entry amounts (not stored). */
  totalMarketingAllocated: number;
  otherSpendLifetime: number;
  ticketsSold: number | null;
  capacity: number | null;
  sellThroughPct: number | null;
  costPerTicket: number | null;
  isBrandCampaign: boolean;
  sellOutPacing: SellOutPacingResult | null;
  channelMultiActive: boolean;
  isRefreshing: boolean;
  datePreset: DatePreset;
  customRange?: CustomDateRange;
  creativesSource: CreativesSource;
  /** When provided, replaces the default `<CreativePerformanceLazy>` section. */
  creativesSlot?: React.ReactNode;
  /**
   * "Last updated …" + manual Refresh button render at the bottom of
   * the Meta block (PR #63 — moved up from the page-level footer so
   * the share page's button isn't 800px below the block it actually
   * refreshes). `lastUpdatedIso` falls back to "now" upstream when no
   * fetch timestamp is available.
   *
   * `onManualRefresh` is optional — when omitted (e.g. a
   * TikTok-only render where Meta payload is null and the block
   * doesn't render at all), the Refresh button is hidden.
   */
  lastUpdatedIso: string;
  onManualRefresh?: () => Promise<void>;
  /** Below campaign performance cards, above Meta campaign stats. */
  additionalSpendSlot?: React.ReactNode;
  /** Mailchimp registration metrics — rendered as the REGISTRATIONS card for brand_campaign events. */
  registrationsData?: MailchimpRegistrationsData | null;
  /**
   * When provided, a Refresh button is shown on the REGISTRATIONS card
   * (internal dashboard only). Calls POST /api/events/:id/mailchimp/refresh
   * and reloads the registrations data.
   */
  onRefreshRegistrations?: () => Promise<void>;
  /**
   * Active platform filter for brand_campaign performance summary.
   * When not "all", the spend number shown is for that platform only
   * and the Registrations card shows an "All sources" footnote since
   * registration attribution per-platform is out of scope for this PR.
   */
  platformFilter?: "all" | "meta" | "google" | "tiktok";
  /**
   * Cross-platform total spend (all platforms, unfiltered). Always
   * £Meta + £TikTok + £Google regardless of the active pill. Used for
   * the REGISTRATIONS card CPR so toggling a platform pill doesn't
   * re-denominate registrations to one platform's spend (registrations
   * aren't attributable per-platform yet).
   */
  totalCrossPlatformSpent?: number;
  /** Per-platform spend from event_daily_rollups (brand_campaign). */
  brandRollupSpend?: { meta: number; tiktok: number; google: number } | null;
  /**
   * TikTok rollup totals for the TIKTOK CAMPAIGN STATS block.
   * When provided and the active pill is "tiktok" (or "all"), renders
   * the TikTok stats alongside / instead of the Meta stats block.
   * Sourced from event_daily_rollups.tiktok_* columns on the share page;
   * null for regular event-kind events and when no TikTok data exists.
   */
  tiktokStats?: TikTokRollupTotals | null;
  /**
   * When true, the PAID MEDIA spend caption reads "Cross-platform spend"
   * instead of "Meta spend (this window)". Set for brand_campaign events
   * when brandRollupSpend is provided.
   */
  showCrossPlatformCaption?: boolean;
  /** Pre-loaded snapshot rows for the TikTok Audience + Active Creatives sections. */
  tiktokSnapshots?: TikTokSnapshotData | null;
}

function MetaReportBlock({
  meta,
  event,
  paidMediaCap,
  metaSpend,
  paidMediaSpent,
  remainingPaidMedia,
  paidMediaBudgetUsedPct,
  totalMarketingAllocated,
  otherSpendLifetime,
  ticketsSold,
  capacity,
  sellThroughPct,
  costPerTicket,
  isBrandCampaign,
  sellOutPacing,
  channelMultiActive,
  isRefreshing,
  datePreset,
  customRange,
  creativesSource,
  creativesSlot,
  lastUpdatedIso,
  onManualRefresh,
  additionalSpendSlot,
  registrationsData,
  onRefreshRegistrations,
  platformFilter = "all",
  totalCrossPlatformSpent = 0,
  brandRollupSpend = null,
  tiktokStats,
  showCrossPlatformCaption = false,
  tiktokSnapshots = null,
}: MetaReportBlockProps) {
  const dailyBudget = meta.dailyBudgetSet;
  const ticketsSub = resolveTicketsSoldSub(event);
  const daysUntilEventUtc = fullDaysUntilEventUtc(event.eventDate);
  const avgBudgetRemainingPerDay =
    daysUntilEventUtc != null && daysUntilEventUtc > 0
      ? Math.round(remainingPaidMedia / daysUntilEventUtc)
      : null;

  const paidSpentDisplay = paidMediaSpent;

  const displayMeta = useMemo(() => {
    if (
      !isBrandCampaign ||
      platformFilter !== "all" ||
      !brandRollupSpend ||
      !tiktokStats
    ) {
      return meta;
    }
    const combined = computeCrossPlatformRateMetrics(
      {
        metaSpend: brandRollupSpend.meta,
        tiktokSpend: brandRollupSpend.tiktok,
        googleSpend: brandRollupSpend.google,
      },
      {
        metaImpressions: meta.totals.impressions,
        tiktokImpressions: tiktokStats.impressions,
        googleImpressions: 0,
        metaClicks: meta.totals.clicks,
        tiktokClicks: tiktokStats.clicks,
        googleClicks: 0,
      },
    );
    return {
      ...meta,
      totals: {
        ...meta.totals,
        spend: combined.spend,
        impressions: combined.impressions,
        clicks: combined.clicks,
        cpm: combined.cpm ?? meta.totals.cpm,
      },
    };
  }, [meta, isBrandCampaign, platformFilter, brandRollupSpend, tiktokStats]);

  return (
    <>
      <Section title="Campaign performance">
        <div
          className={`grid grid-cols-1 gap-3 lg:grid-cols-3 ${
            isRefreshing ? "opacity-60 transition-opacity" : ""
          }`}
        >
          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Total marketing
            </p>
            <div className="mt-3 space-y-2 text-foreground">
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {paidMediaCap > 0 || otherSpendLifetime > 0 ? (
                  <>
                    {fmtCurrencyCompact(totalMarketingAllocated)}
                    <span className="text-sm font-normal text-muted-foreground">
                      {" "}
                      · {fmtCurrencyCompact(paidMediaCap)} Paid media +{" "}
                      {fmtCurrencyCompact(otherSpendLifetime)} Additional
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Paid media
            </p>
            <div className="mt-3 space-y-2 text-foreground">
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {paidMediaCap > 0 ? (
                  <>
                    {fmtCurrencyCompact(paidMediaCap)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      Allocated (paid media only)
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {paidSpentDisplay > 0 || paidMediaCap > 0 ? (
                  <>
                    {fmtCurrencyCompact(paidSpentDisplay)}{" "}
                    <span className="text-sm font-normal text-muted-foreground">
                      Spent
                    </span>
                    {paidMediaCap > 0 ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        {" "}
                        ({fmtCurrencyCompact(remainingPaidMedia)} remaining)
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              {showCrossPlatformCaption && paidSpentDisplay > 0 ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Cross-platform spend
                </p>
              ) : metaSpend > 0 ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Meta spend (this window)
                </p>
              ) : null}
              <p className="font-heading text-xl tracking-wide tabular-nums">
                {paidMediaBudgetUsedPct != null ? (
                  <>{paidMediaBudgetUsedPct.toFixed(0)}% used</>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </p>
              <div className="space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-heading text-xl tracking-wide tabular-nums">
                  <span className="text-sm font-normal text-muted-foreground">
                    Daily budget:
                  </span>
                  {dailyBudget != null && dailyBudget > 0 ? (
                    <>
                      <span>{fmtCurrencyCompact(dailyBudget)}</span>
                      <span className="text-[11px] font-normal text-muted-foreground sm:whitespace-nowrap">
                        {avgBudgetRemainingPerDay != null ? (
                          <>
                            (avg {fmtCurrencyCompact(avgBudgetRemainingPerDay)}
                            /day remaining)
                          </>
                        ) : (
                          <> (avg —/day remaining)</>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {isBrandCampaign ? (
            <RegistrationsCard
              {...(registrationsData ?? {
                newSinceBaseline: null,
                totalSubscribers: null,
                baselineSubscribers: null,
                lastSyncedAt: null,
                hasAudience: false,
                mailchimpAccountConnected: false,
              })}
              paidMediaSpent={totalCrossPlatformSpent}
              allSourcesCaption={platformFilter !== "all"}
              onRefreshRegistrations={onRefreshRegistrations}
            />
          ) : (
            <div className="rounded-md border border-border bg-card p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Tickets
              </p>
              <div className="mt-3 space-y-2 text-foreground">
                <p className="font-heading text-xl tracking-wide tabular-nums">
                  {ticketsSold != null ? (
                    capacity != null ? (
                      <>
                        {fmtInt(ticketsSold)} / {fmtInt(capacity)} sold
                        {sellThroughPct != null ? (
                          <span className="text-sm font-normal text-muted-foreground">
                            {" "}
                            ({sellThroughPct.toFixed(1)}%)
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>{fmtInt(ticketsSold)} sold</>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </p>
                {ticketsSub ? (
                  <p className="text-[11px] text-muted-foreground">
                    {ticketsSub}
                  </p>
                ) : null}
                <p className="font-heading text-xl tracking-wide tabular-nums">
                  {costPerTicket != null ? (
                    <>
                      {fmtCurrencyCompact(costPerTicket)}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        cost per ticket
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </p>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  <span className="font-medium text-foreground">Pacing:</span>{" "}
                  {formatSellOutPacingLine(sellOutPacing)}
                </p>
              </div>
            </div>
          )}
        </div>
        {channelMultiActive ? (
          <ChannelBreakdownStrip
            meta={meta.channelBreakdown.meta}
            tiktok={meta.channelBreakdown.tiktok}
            google={meta.channelBreakdown.google}
          />
        ) : null}
        {additionalSpendSlot ? (
          <div className="mt-6 space-y-4">{additionalSpendSlot}</div>
        ) : null}
      </Section>

      {/* Platform-responsive stats blocks for brand_campaign.
          Meta pill: show only Meta.  TikTok pill: show only TikTok.
          All (or regular event): show Meta (+ TikTok when data exists). */}
      {(!isBrandCampaign || platformFilter !== "tiktok") ? (
        <>
          <MetaCampaignStatsSection
            meta={displayMeta}
            isRefreshing={isRefreshing}
            kind={isBrandCampaign ? "brand_campaign" : "event"}
          />
          <MetaCampaignBreakdownSection
            meta={meta}
            kind={isBrandCampaign ? "brand_campaign" : "event"}
          />
          <MetaDemographicsSection meta={meta} />
        </>
      ) : null}
      {isBrandCampaign && (platformFilter === "tiktok" || platformFilter === "all") && tiktokStats ? (
        <TikTokCampaignStatsSection totals={tiktokStats} />
      ) : isBrandCampaign && platformFilter === "tiktok" ? (
        <Section title="TikTok campaign stats">
          <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
            TikTok rollup data not yet available for this event.
          </p>
        </Section>
      ) : null}

      {/* Creative section.
          - TikTok pill + brand_campaign: show TikTok creatives (or placeholder if no snapshot).
          - All pill + brand_campaign: show Meta creatives + TikTok creatives below.
          - All other cases: Meta creative performance. */}
      {isBrandCampaign && platformFilter === "tiktok" ? (
        <Section title="Active creatives">
          {tiktokSnapshots && tiktokSnapshots.creatives.length > 0 ? (
            <TikTokCreativesGrid creatives={tiktokSnapshots.creatives} />
          ) : (
            <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
              TikTok creative + demographic breakdowns coming soon.
            </p>
          )}
        </Section>
      ) : (
        <>
          {creativesSlot ?? (
            <Section title="Creative performance">
              <CreativePerformanceLazy
                source={creativesSource}
                datePreset={datePreset}
                customRange={customRange}
              />
            </Section>
          )}
          {isBrandCampaign && platformFilter === "all" ? (
            <Section title="TikTok active creatives">
              {tiktokSnapshots && tiktokSnapshots.creatives.length > 0 ? (
                <TikTokCreativesGrid creatives={tiktokSnapshots.creatives} />
              ) : (
                <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
                  TikTok creative + demographic breakdowns coming soon.
                </p>
              )}
            </Section>
          ) : null}
        </>
      )}

      {/* TikTok audience — visible on All and TikTok pills for brand_campaign. */}
      {isBrandCampaign && (platformFilter === "tiktok" || platformFilter === "all") ? (
        <Section title="TikTok audience">
          {tiktokSnapshots && tiktokSnapshots.breakdowns.length > 0 ? (
            <TikTokAudienceSection breakdowns={tiktokSnapshots.breakdowns} />
          ) : (
            <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
              TikTok audience breakdown syncing — check back in 24h.
            </p>
          )}
        </Section>
      ) : null}

      {/* "Last updated …" + manual Refresh button (PR #63 — moved up
          from the page-level footer so the share page's button sits
          immediately below the block it actually refreshes; pre-fix
          it was at the very bottom of `<ReportFooter>` after
          TikTok + Event Reporting blocks, ~800px below the Meta
          numbers a client looking for "this is stale" feedback would
          scan). Same position on both internal Reporting tab and
          public share — single source so the two surfaces don't
          drift. */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {/* Copy reflects ACTUAL behaviour: the 5-minute window is the
              server-side cache TTL, not a client-side poll. The page
              never auto-refreshes — so labelling it "refreshes every 5
              minutes" set up clients to expect updates that never come.
              Refresh is on-demand only via the button beside this. */}
          Last updated {fmtRelativeShort(lastUpdatedIso)} · click refresh
          for latest
        </p>
        {onManualRefresh ? (
          <RefreshReportButton onRefresh={onManualRefresh} />
        ) : null}
      </div>
    </>
  );
}

// ─── Partial-render banner ─────────────────────────────────────────────────

/**
 * Muted banner that sits above the creative breakdown when the
 * share page's headline insights call failed but active-creatives
 * succeeded. Tells the visitor exactly what they're seeing — and
 * what they're not — without pretending the report is fully live.
 */
function HeadlineUnavailableBanner() {
  return (
    <div className="rounded-md border border-dashed border-border bg-card/60 px-4 py-3">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          Summary metrics are temporarily unavailable
        </span>{" "}
        — refreshing in the background. Creative breakdown below is live.
      </p>
    </div>
  );
}

// ─── Last-updated picker ───────────────────────────────────────────────────

/**
 * Pick the more recent of `meta.fetchedAt` and `tiktok.importedAt` for the
 * footer's "Last updated" timestamp. Falls back to "now" only when both
 * sources are missing — that branch is unreachable in practice because
 * the share page never renders this view without at least one source.
 */
function pickLastUpdated(
  meta: EventInsightsPayload | null,
  tiktok: TikTokReportBlockData | null,
): string {
  const candidates = [meta?.fetchedAt, tiktok?.imported_at].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  if (candidates.length === 0) return new Date().toISOString();
  return candidates.sort().at(-1)!;
}

// ─── Tickets sold sub-line ─────────────────────────────────────────────────

function resolveTicketsSoldSub(event: EventReportViewEvent): string | null {
  if (event.ticketsSold == null) return "Not yet recorded";
  if (event.ticketsSoldSource === "plan" && event.ticketsSoldAsOf) {
    return `From campaign plan · ${fmtDate(event.ticketsSoldAsOf)}`;
  }
  if (event.ticketsSold === 0) return "0 to date";
  return null;
}

// ─── Header / footer ───────────────────────────────────────────────────────

function ReportHeader({
  eventName,
  venue,
  eventDateLabel,
}: {
  eventName: string;
  venue: string;
  eventDateLabel: string;
}) {
  return (
    <header className="border-b border-border bg-background px-6 py-10">
      <div className="mx-auto max-w-6xl space-y-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Event Report by Off Pixel
        </p>
        <h1 className="font-heading text-3xl tracking-wide text-foreground">
          {eventName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {[venue || null, eventDateLabel || null]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
      </div>
    </header>
  );
}

/**
 * Page-level footer for the standalone share view.
 *
 * Branding-only since PR #63 — the "Last updated …" timestamp +
 * manual Refresh button moved up to the bottom of the Meta Live
 * Report block so they sit next to the data they describe (the
 * old position was ~800px down the page after TikTok + Event
 * Reporting blocks, where clients consistently missed it).
 */
function ReportFooter() {
  return (
    <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
      <p>Powered by Off Pixel</p>
    </footer>
  );
}

// ─── Layout primitives ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-heading text-xl tracking-wide text-foreground">
        {value}
      </p>
      {sub ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function ChannelBreakdownStrip({
  meta,
  tiktok,
  google,
}: {
  meta: number;
  tiktok: number | null;
  google: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Metric label="Meta" value={fmtCurrency(meta)} />
      {tiktok != null ? (
        <Metric label="TikTok" value={fmtCurrency(tiktok)} />
      ) : null}
      {google != null ? (
        <Metric label="Google" value={fmtCurrency(google)} />
      ) : null}
    </div>
  );
}

// ─── TikTok snapshot rendering ───────────────────────────────────────────
// These components render data from tiktok_active_creatives_snapshots and
// tiktok_breakdown_snapshots. They live here (client component) so the
// platform-filter state in MetaReportBlock can gate visibility without an
// extra data-loading round-trip.

function TikTokCreativesGrid({
  creatives,
}: {
  creatives: TikTokSnapshotCreative[];
}) {
  const sorted = [...creatives]
    .filter((c) => (c.spend ?? 0) > 0 || (c.impressions ?? 0) > 0)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  if (sorted.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {sorted.map((c) => (
        <TikTokCreativeCard key={c.ad_id} creative={c} />
      ))}
    </div>
  );
}

function TikTokCreativeCard({
  creative: c,
}: {
  creative: TikTokSnapshotCreative;
}) {
  const rawName = c.ad_name?.trim() || `Ad ${c.ad_id.slice(-6)}`;
  const card = (
    <div className="rounded-md border border-border bg-card overflow-hidden">
      <div className="aspect-[9/16] w-full overflow-hidden bg-muted">
        {c.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={c.thumbnail_url}
            alt={rawName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-[10px] text-muted-foreground">No preview</span>
          </div>
        )}
      </div>
      <div className="p-2 space-y-1.5">
        <p className="text-[11px] font-medium text-foreground leading-snug line-clamp-3">
          {rawName}
        </p>
        <div className="grid grid-cols-2 gap-x-2 text-[10px]">
          <span className="text-muted-foreground">Spend</span>
          <span className="text-right tabular-nums text-foreground">
            {fmtCurrency(c.spend ?? 0)}
          </span>
          <span className="text-muted-foreground">Impr.</span>
          <span className="text-right tabular-nums text-foreground">
            {snapFmtInt(c.impressions)}
          </span>
          <span className="text-muted-foreground">Clicks</span>
          <span className="text-right tabular-nums text-foreground">
            {snapFmtInt(c.clicks)}
          </span>
          <span className="text-muted-foreground">CTR</span>
          <span className="text-right tabular-nums text-foreground">
            {c.ctr != null ? `${c.ctr.toFixed(2)}%` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
  if (c.deeplink_url) {
    return (
      <a
        href={c.deeplink_url}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:opacity-90 transition-opacity"
      >
        {card}
      </a>
    );
  }
  return card;
}

function TikTokAudienceSection({
  breakdowns,
}: {
  breakdowns: TikTokSnapshotBreakdown[];
}) {
  const geoRows = [...breakdowns]
    .filter((r) => r.dimension === "country" || r.dimension === "region")
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 10);
  const ageRows = [...breakdowns]
    .filter((r) => r.dimension === "age" && r.dimension_value !== "NONE")
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const genderRows = [...breakdowns]
    .filter((r) => r.dimension === "gender" && r.dimension_value !== "NONE")
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0));
  const interestRows = [...breakdowns]
    .filter((r) => r.dimension === "interest_category")
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    .slice(0, 15);

  return (
    <div className="space-y-6">
      {geoRows.length > 0 && (
        <TikTokBreakdownSubSection title="Top Regions">
          <SnapBreakdownTable
            headers={["Region", "Type", "Spend", "Impr.", "Clicks", "CTR"]}
            rows={geoRows.map((r) => [
              fmtDimensionValue(r.dimension, r.dimension_value),
              r.dimension === "country" ? "Country" : "Region",
              fmtCurrency(r.spend ?? 0),
              snapFmtInt(r.impressions),
              snapFmtInt(r.clicks),
              r.ctr != null ? `${r.ctr.toFixed(2)}%` : "—",
            ])}
          />
        </TikTokBreakdownSubSection>
      )}
      {ageRows.length > 0 && (
        <TikTokBreakdownSubSection title="Demographics by Age">
          <SnapBreakdownTable
            headers={["Age", "Spend", "Impr.", "Clicks", "CTR"]}
            rows={ageRows.map((r) => [
              fmtDimensionValue(r.dimension, r.dimension_value),
              fmtCurrency(r.spend ?? 0),
              snapFmtInt(r.impressions),
              snapFmtInt(r.clicks),
              r.ctr != null ? `${r.ctr.toFixed(2)}%` : "—",
            ])}
          />
        </TikTokBreakdownSubSection>
      )}
      {genderRows.length > 0 && (
        <TikTokBreakdownSubSection title="Demographics by Gender">
          <SnapBreakdownTable
            headers={["Gender", "Spend", "Impr.", "Clicks", "CTR"]}
            rows={genderRows.map((r) => [
              fmtDimensionValue(r.dimension, r.dimension_value),
              fmtCurrency(r.spend ?? 0),
              snapFmtInt(r.impressions),
              snapFmtInt(r.clicks),
              r.ctr != null ? `${r.ctr.toFixed(2)}%` : "—",
            ])}
          />
        </TikTokBreakdownSubSection>
      )}
      {interestRows.length > 0 && (
        <TikTokBreakdownSubSection title="Cross Contextual Interests">
          <p className="mb-2 text-[11px] text-muted-foreground">
            TikTok interest segments your audience engages with. Ranked by
            spend.
          </p>
          <SnapBreakdownTable
            headers={["Segment", "Spend", "Impr.", "Clicks", "CTR"]}
            rows={interestRows.map((r) => [
              fmtDimensionValue(r.dimension, r.dimension_value),
              fmtCurrency(r.spend ?? 0),
              snapFmtInt(r.impressions),
              snapFmtInt(r.clicks),
              r.ctr != null ? `${r.ctr.toFixed(2)}%` : "—",
            ])}
          />
        </TikTokBreakdownSubSection>
      )}
    </div>
  );
}

function TikTokBreakdownSubSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SnapBreakdownTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: string[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            {headers.map((h, i) => (
              <th key={h} className={`pb-2 ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-t border-border/40 text-foreground">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 tabular-nums ${ci === 0 ? "" : "text-right"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Snapshot format helpers ──────────────────────────────────────────────

function snapFmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function fmtDimensionValue(dimension: string, value: string): string {
  if (dimension === "age") {
    const match = /^AGE_(\d+)_(\d+)$/.exec(value);
    if (match) {
      const [, lo, hi] = match;
      return Number(hi) >= 100 ? `${lo}+` : `${lo}–${hi}`;
    }
    return value;
  }
  if (dimension === "gender") {
    if (value === "MALE") return "Male";
    if (value === "FEMALE") return "Female";
    return value;
  }
  if (dimension === "interest_category") {
    return `Segment #${value}`;
  }
  return value;
}

// ─── Formatters ────────────────────────────────────────────────────────────

function fmtRelativeShort(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "just now";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`;
  return `${Math.round(diff / 86_400_000)} d ago`;
}

function computeDaysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = Date.parse(`${iso}T00:00:00`);
  if (!Number.isFinite(target)) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now.getTime()) / 86_400_000);
}

function daysUntilLabel(d: number): string {
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d > 1) return `${d} days`;
  if (d === -1) return "Yesterday";
  return `${Math.abs(d)} days ago`;
}

function isMultiChannelActive(p: EventInsightsPayload): boolean {
  return (
    p.channelBreakdown.tiktok != null || p.channelBreakdown.google != null
  );
}
