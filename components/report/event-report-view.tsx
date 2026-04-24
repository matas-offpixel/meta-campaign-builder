"use client";

import { useState, type ReactNode } from "react";

import { sumAdditionalSpendAmounts } from "@/lib/db/additional-spend-sum";
import {
  fmtCurrency,
  fmtCurrencyCompact,
  fmtDate,
} from "@/lib/dashboard/format";
import {
  fullDaysUntilEventUtc,
  type SellOutPacingResult,
} from "@/lib/dashboard/report-pacing";
import { resolvePresetToDays } from "@/lib/insights/date-chunks";
import {
  DATE_PRESETS,
  DATE_PRESET_LABELS,
  type CustomDateRange,
  type DatePreset,
  type EventInsightsPayload,
} from "@/lib/insights/types";

import { CreativePerformanceLazy } from "./creative-performance-lazy";
import { RefreshReportButton } from "./refresh-report-button";
import {
  TikTokReportBlock,
  type TikTokReportBlockData,
} from "./tiktok-report-block";
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

export interface EventReportViewEvent {
  name: string;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  eventDate: string | null;
  eventStartAt: string | null;
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
}

export function EventReportView({
  event,
  meta = null,
  tiktok = null,
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
}: Props) {
  const venue = [event.venueName, event.venueCity, event.venueCountry]
    .filter(Boolean)
    .join(", ");

  const eventDateLabel = event.eventDate ? fmtDate(event.eventDate) : "—";

  const daysUntil = computeDaysUntil(event.eventDate);
  const paidMediaCap = event.paidMediaBudget ?? 0;
  const windowDays = resolvePresetToDays(datePreset, customRange);
  const windowDaySet = windowDays === null ? null : new Set(windowDays);
  const otherSpendWindow = sumAdditionalSpendAmounts(
    additionalSpendEntries,
    windowDaySet,
  );
  const metaSpend = meta?.totals.spend ?? 0;
  const spentTotalAll =
    meta != null ? metaSpend + otherSpendWindow : metaSpend;
  /** Burn against paid media budget only (Meta in-window). */
  const paidMediaSpent = metaSpend;
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
        {tiktok ? <TikTokReportBlock data={tiktok} /> : null}

        {/* ─── Event daily report block ─────────────────────────── */
         /* Server-rendered from the unified timeline (live rollups +
            manual daily entries) so it renders on the public share
            page with no extra client fetch. The slot owns its own
            section heading + summary/chart/table. */}
        {eventDailySlot ?? null}
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
}: MetaReportBlockProps) {
  const dailyBudget = meta.dailyBudgetSet;
  const ticketsSub = resolveTicketsSoldSub(event);
  const daysUntilEventUtc = fullDaysUntilEventUtc(event.eventDate);
  const avgBudgetRemainingPerDay =
    daysUntilEventUtc != null && daysUntilEventUtc > 0
      ? Math.round(remainingPaidMedia / daysUntilEventUtc)
      : null;

  const paidSpentDisplay = paidMediaSpent;

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
              {metaSpend > 0 ? (
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
                <p className="text-[11px] text-muted-foreground">{ticketsSub}</p>
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

      {/* Meta campaign stats — flat metric grid */}
      <Section title="Meta campaign stats">
        <div
          className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${
            isRefreshing ? "opacity-60 transition-opacity" : ""
          }`}
        >
          <Metric label="Spend" value={fmtCurrency(meta.totals.spend)} />
          <Metric
            label="Impressions"
            value={fmtInt(meta.totals.impressions)}
          />
          {/*
            "Reach (sum)" — explicitly labelled so a client can't read
            this as deduped unique reach across the event. The aside
            below the grid spells out the caveat.
          */}
          <Metric
            label="Reach (sum)"
            value={fmtInt(meta.totals.reachSum)}
          />
          <Metric
            label="Landing page views"
            value={fmtInt(meta.totals.landingPageViews)}
            sub={formatCostPerSub(
              meta.totalSpend,
              meta.totals.landingPageViews,
              "LPV",
            )}
          />
          <Metric
            label="Clicks"
            value={fmtInt(meta.totals.clicks)}
            sub={formatCostPerSub(
              meta.totalSpend,
              meta.totals.clicks,
              "click",
            )}
          />
          <Metric
            label="Registrations"
            value={fmtInt(meta.totals.registrations)}
          />
          <Metric
            label="Purchases"
            value={fmtInt(meta.totals.purchases)}
          />
          <Metric label="ROAS" value={fmtRoas(meta.totals.roas)} />
          <Metric
            label="Purchase value"
            value={fmtCurrency(meta.totals.purchaseValue)}
          />
          <Metric label="CPM" value={fmtCurrency(meta.totals.cpm)} />
          <Metric
            label="Frequency"
            value={fmtDecimal(meta.totals.frequency)}
          />
          <Metric label="CPR" value={fmtCurrency(meta.totals.cpr)} />
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Reach (sum)</span> is
          summed across campaigns — not deduplicated unique reach across the
          event. A user reached by more than one campaign is counted once
          per campaign. Frequency is derived from the same sum and is
          therefore a conservative under-estimate. Per-campaign rows below
          show each campaign&rsquo;s deduplicated reach.
        </p>
      </Section>

      {/* Per-campaign breakdown table */}
      <Section title="Meta campaign breakdown">
        {meta.campaigns.length === 0 ? (
          <EmptyHint>No matched Meta campaigns yet.</EmptyHint>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[780px] border-collapse text-xs">
              <thead className="bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <Th align="left">Campaign</Th>
                  <Th>Status</Th>
                  <Th align="right">Spend</Th>
                  <Th align="right">Regs</Th>
                  <Th align="right">LPV</Th>
                  <Th align="right">Purch</Th>
                  <Th align="right">Reach</Th>
                  <Th align="right">Impr</Th>
                  <Th align="right">CPR</Th>
                  <Th align="right">CPA</Th>
                  <Th align="right">CPLPV</Th>
                  <Th align="right">ROAS</Th>
                </tr>
              </thead>
              <tbody>
                {meta.campaigns.map((c) => (
                  <tr
                    key={c.id}
                    className="border-t border-border odd:bg-background even:bg-card/40"
                  >
                    {/*
                      Campaign name can leak the bracket-wrapped event_code
                      (e.g. "[UTB0042-New] Awareness"). That's fine — the
                      code is intentionally human-readable and the client
                      already knows their event. Numeric internal IDs
                      (campaign.id) are NOT rendered.
                    */}
                    <Td align="left">
                      <span className="block max-w-[260px] truncate">
                        {c.name}
                      </span>
                    </Td>
                    <Td>
                      <StatusChip status={c.status} />
                    </Td>
                    <Td align="right">{fmtCurrency(c.spend)}</Td>
                    <Td align="right">{fmtInt(c.registrations)}</Td>
                    <Td align="right">{fmtInt(c.landingPageViews)}</Td>
                    <Td align="right">{fmtInt(c.purchases)}</Td>
                    <Td align="right">{fmtInt(c.reach)}</Td>
                    <Td align="right">{fmtInt(c.impressions)}</Td>
                    <Td align="right">
                      {c.cpr > 0 ? fmtCurrency(c.cpr) : "—"}
                    </Td>
                    <Td align="right">
                      {c.purchases > 0 ? fmtCurrency(c.cpp) : "—"}
                    </Td>
                    <Td align="right">
                      {c.cplpv > 0 ? fmtCurrency(c.cplpv) : "—"}
                    </Td>
                    <Td align="right">{fmtRoas(c.roas)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Creative section. The share page swaps in a server-rendered
          "Active creatives" component via `creativesSlot` so the
          client-facing report doesn't need a "Load creative previews"
          click. The internal Reporting tab leaves the slot undefined
          and keeps the existing lazy section, which still serves the
          deeper per-creative_id breakdown for power-user inspection. */}
      {creativesSlot ?? (
        <Section title="Creative performance">
          <CreativePerformanceLazy
            source={creativesSource}
            datePreset={datePreset}
            customRange={customRange}
          />
        </Section>
      )}

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

// ─── Timeframe selector ────────────────────────────────────────────────────

function TimeframeSelector({
  active,
  disabled,
  onChange,
}: {
  active: DatePreset;
  disabled: boolean;
  onChange: (preset: DatePreset) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Timeframe
      </p>
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => {
          // "custom" lives in its own picker row below — DATE_PRESETS
          // omits it deliberately, so active==="custom" naturally
          // leaves every preset button un-highlighted.
          const isActive = p === active;
          return (
            <button
              key={p}
              type="button"
              disabled={disabled}
              onClick={() => onChange(p)}
              className={`rounded-md border px-2.5 py-1 text-[11px] tracking-wide transition disabled:cursor-not-allowed disabled:opacity-50 ${
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-border-strong hover:text-foreground"
              }`}
            >
              {DATE_PRESET_LABELS[p]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Custom range picker ──────────────────────────────────────────────────

/**
 * From / To date inputs that own their own "draft" state until the user
 * hits Apply. Decoupling the inputs from the active range avoids firing
 * a Meta call on each keystroke and lets the user freely flip between
 * "since" and "until" without intermediate fetches.
 *
 * `min` is today - 37 months (Meta's retention cap); `max` is today UTC
 * (no future windows). Both bounds match the server-side validator in
 * `lib/insights/meta.ts#resolveCustomRange` so a successful client-side
 * Apply never fails server-side validation.
 */
function CustomRangePicker({
  active,
  disabled,
  initialRange,
  onApply,
}: {
  active: boolean;
  disabled: boolean;
  initialRange: CustomDateRange | null;
  onApply: (range: CustomDateRange) => void;
}) {
  const todayIso = todayIsoUtc();
  const minIso = minSinceIsoUtc();

  const [from, setFrom] = useState<string>(initialRange?.since ?? "");
  const [to, setTo] = useState<string>(initialRange?.until ?? "");

  // Re-seed the draft inputs when the parent's `initialRange` shifts —
  // e.g. navigating between two share URLs that differ only in
  // ?from / ?to. React 19's `react-hooks/set-state-in-effect` rules out
  // the obvious `useEffect(() => setFrom(...))` shape, so we use the
  // "adjust state in render" pattern: track the parent range as a
  // string and trigger the re-seed synchronously when it differs.
  // No extra render commit, no stale-data window.
  const initialKey = `${initialRange?.since ?? ""}|${initialRange?.until ?? ""}`;
  const [trackedKey, setTrackedKey] = useState<string>(initialKey);
  if (trackedKey !== initialKey) {
    setTrackedKey(initialKey);
    setFrom(initialRange?.since ?? "");
    setTo(initialRange?.until ?? "");
  }

  const isValid =
    from !== "" &&
    to !== "" &&
    from >= minIso &&
    to <= todayIso &&
    from <= to;

  const handleApply = () => {
    if (!isValid) return;
    onApply({ since: from, until: to });
  };

  const activeLabel =
    active && initialRange
      ? `${fmtDate(initialRange.since)} → ${fmtDate(initialRange.until)}`
      : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex flex-wrap items-end gap-2 rounded-md border px-2.5 py-2 transition ${
          active
            ? "border-primary bg-primary/5"
            : "border-border bg-background"
        }`}
      >
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            From
          </span>
          <input
            type="date"
            min={minIso}
            max={todayIso}
            value={from}
            disabled={disabled}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            To
          </span>
          <input
            type="date"
            min={minIso}
            max={todayIso}
            value={to}
            disabled={disabled}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-border-strong bg-background px-2 py-1 text-[12px] text-foreground disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          disabled={disabled || !isValid}
          onClick={handleApply}
          className="rounded-md border border-primary bg-primary px-2.5 py-1 text-[11px] font-medium tracking-wide text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
        {activeLabel ? (
          <span className="text-[11px] font-medium tracking-wide text-primary">
            {activeLabel}
          </span>
        ) : (
          <span className="text-[11px] tracking-wide text-muted-foreground">
            Custom range
          </span>
        )}
      </div>
      {from !== "" && to !== "" && from > to ? (
        <p className="text-[10px] text-destructive">
          From date must be on or before To date.
        </p>
      ) : null}
    </div>
  );
}

function todayIsoUtc(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function minSinceIsoUtc(): string {
  const d = new Date();
  // Meta retention is 37 months; using setUTCMonth handles month-length
  // wrap-around correctly.
  d.setUTCMonth(d.getUTCMonth() - 37);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-base tracking-wide text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

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

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  /**
   * Optional muted line below the value. Used for derived figures
   * (e.g. cost-per) that always belong with the headline number — same
   * pattern as `StatCard.sub`. Null/undefined renders nothing.
   */
  sub?: string | null;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm text-foreground">{value}</p>
      {sub ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

/**
 * Format `spend / count` as a "£X.XX per <unit>" sub-line for a Metric
 * card (LPV, Clicks). Returns null when the denominator is missing or
 * zero so the caller can render an em-dash / nothing instead of
 * "£NaN per click". Currency-formatted via en-GB locale to keep two
 * decimals.
 */
function formatCostPerSub(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  unit: string,
): string | null {
  if (numerator == null || denominator == null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  if (!Number.isFinite(value)) return null;
  const formatted = value.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} per ${unit}`;
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : status.includes("PAUSED")
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {status.toLowerCase().replaceAll("_", " ")}
    </span>
  );
}

function Th({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const alignClass =
    align === "left"
      ? "text-left"
      : align === "right"
        ? "text-right"
        : "text-center";
  return (
    <th className={`px-3 py-2 ${alignClass} font-medium`}>{children}</th>
  );
}

function Td({
  children,
  align = "center",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  const alignClass =
    align === "left"
      ? "text-left"
      : align === "right"
        ? "text-right"
        : "text-center";
  return (
    <td className={`px-3 py-2 ${alignClass}`}>{children}</td>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-card p-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
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

// ─── Formatters ────────────────────────────────────────────────────────────

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

function fmtDecimal(n: number): string {
  return n > 0 ? n.toFixed(2) : "—";
}

function fmtRoas(n: number): string {
  return n > 0 ? `${n.toFixed(2)}×` : "—";
}

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
