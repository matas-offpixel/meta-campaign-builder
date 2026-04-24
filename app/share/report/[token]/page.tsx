import { Suspense } from "react";
import { notFound } from "next/navigation";
import { after } from "next/server";
import type { Metadata } from "next";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  bumpShareView,
  getOwnerFacebookToken,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import { getLatestTicketsSoldForEventAdmin } from "@/lib/db/ad-plans-server";
import { fetchEventInsights } from "@/lib/insights/meta";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
  type EventInsightsPayload,
  type InsightsErrorReason,
  type InsightsResult,
} from "@/lib/insights/types";
import type { TikTokManualReportSnapshot } from "@/lib/types/tiktok";
import { PublicReport } from "@/components/report/public-report";
import type { TikTokReportBlockData } from "@/components/report/tiktok-report-block";
import { ReportUnavailable } from "@/components/report/report-unavailable";
import {
  fetchShareActiveCreatives,
  type ShareActiveCreativesResult,
} from "@/lib/reporting/share-active-creatives";
import { ShareActiveCreativesSection } from "@/components/share/share-active-creatives-section";
import { ShareActiveCreativesSkeleton } from "@/components/share/share-active-creatives-skeleton";
import { ShareActiveCreativesWarming } from "@/components/share/share-active-creatives-warming";
import { ActiveCreativesStaleBanner } from "@/components/share/active-creatives-stale-banner";
import { listLinksForEvent } from "@/lib/db/ticketing";
import {
  computePresaleBucket,
  loadEventDailyTimeline,
  sumTicketsSoldInWindow,
  type TimelineRow,
} from "@/lib/db/event-daily-timeline";
import { EventDailyReportBlock } from "@/components/dashboard/events/event-daily-report-block";
import { listAdditionalSpendForEvent } from "@/lib/db/additional-spend";
import {
  readShareSnapshot,
  writeShareSnapshot,
  type ShareSnapshotPayload,
} from "@/lib/db/share-snapshots";
import {
  isSnapshotFresh,
  readActiveCreativesSnapshot,
  type ActiveCreativesSnapshotRecord,
} from "@/lib/db/active-creatives-snapshots";
import { refreshActiveCreativesForEvent } from "@/lib/reporting/active-creatives-refresh-runner";
import type { ResolvedShare } from "@/lib/db/report-shares";
import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Build the customRange when the URL carries `?tf=custom&from=…&to=…`.
 * Shape-only — `fetchEventInsights` validates the dates and returns a
 * typed `invalid_custom_range` error if they're off. Missing from/to
 * with `tf=custom` reaches Meta as a missing range and surfaces the
 * same error reason in the UI.
 */
function parseCustomRange(
  preset: DatePreset,
  from: string | null,
  to: string | null,
): CustomDateRange | undefined {
  if (preset !== "custom") return undefined;
  if (!from || !to) return undefined;
  return { since: from, until: to };
}

/**
 * Public client-facing event report.
 *
 *   - Always invokes the route handler (`dynamic = "force-dynamic"`).
 *     Caching is handled by the Supabase `share_insight_snapshots`
 *     table inside `resolveReportData` — keyed by `(token,
 *     date_preset, customRange)` with a 5-min TTL — which is the
 *     correct shape because Next's ISR can't key on query params
 *     and was serving the same prerendered HTML across every `?tf=`
 *     value, masking the underlying Lambda invocations entirely.
 *   - No authentication; the token IS the credential.
 *   - The only identifier exposed in the URL is the token. No internal
 *     event_id / client_id / user_id ever leaves this server component —
 *     the props passed to <PublicReport> deliberately exclude them.
 *
 * Failure modes:
 *   - Unknown / disabled / expired token → `notFound()` → 404 page.
 *   - Owner token expired or insights call failed → ReportUnavailable.
 */

interface Props {
  params: Promise<{ token: string }>;
  /**
   * `?tf=<DatePreset>` drives the timeframe selector. Reading it here in
   * the RSC means each preset gets its own 5-minute cache bucket — a
   * timeframe flick triggers one fresh Meta call, then the next four
   * minutes of visitors hit the same cached payload. Unknown / missing
   * values fall back to "maximum" via `parseDatePreset`.
   */
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  return {
    title: `Event Report · Off Pixel`,
    robots: { index: false, follow: false },
    // Each token gets its own metadata; we still don't leak event names
    // into the page <title> beyond a generic label so the link preview
    // doesn't accidentally reveal an unannounced event.
    openGraph: {
      title: "Event Report by Off Pixel",
      description: "Live performance for your event.",
      url: `/share/report/${token}`,
    },
  };
}

// `EventReportView` (rendered inside `<PublicReport>`) is a client
// component, so the timeframe selector handler lives there. The RSC's
// only job for the timeframe is to read `?tf=` and pass the narrowed
// preset down so insights are fetched against the correct window.
interface ResolvedEvent {
  name: string;
  venueName: string | null;
  venueCity: string | null;
  venueCountry: string | null;
  eventDate: string | null;
  eventStartAt: string | null;
  eventCode: string | null;
  paidMediaBudget: number | null;
  ticketsSold: number | null;
  ticketsSoldSource: "plan" | "manual" | null;
  ticketsSoldAsOf: string | null;
  adAccountId: string | null;
  /** Cached lifetime Meta spend — feeds the report block summary
   *  header so the "Meta Spend" cell is consistent with the rest of
   *  the dashboard even before the timeline fully covers the
   *  campaign window. */
  metaSpendCached: number | null;
  /** Lifetime spend on the pre-launch campaign (separate from the
   *  general-sale Meta spend tracked in the timeline). Surfaced as
   *  the "Pre-reg" column in the summary. */
  preregSpend: number | null;
  /** General-sale cutoff — drives the presale bucket on the daily
   *  table and the previous-week comparison on the summary header. */
  generalSaleAt: string | null;
  /** Default cadence for the embedded tracker (daily | weekly). Comes
   *  from `events.report_cadence` (migration 040). Falls back to
   *  'daily' for any event that pre-dates the column. */
  reportCadence: "daily" | "weekly";
  capacity: number | null;
}

export default async function PublicReportPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const datePreset = parseDatePreset(sp.tf);
  const customRange = parseCustomRange(
    datePreset,
    pickQueryParam(sp.from),
    pickQueryParam(sp.to),
  );
  // `?refresh=1` (or `?force=1` — alias added in PR #57 #3 to
  // mirror the internal route's bust signal) skips the Supabase
  // snapshot read (NOT the write — a fresh fetch still warms the
  // cache for the next visitor). Driven by the Refresh button on
  // the live report footer; ops can also paste the URL with the
  // param into Slack/dashboards. Any truthy string ("1" / "true")
  // activates it; "" / missing leaves the cache enabled.
  const forceRefresh =
    isTruthyParam(pickQueryParam(sp.refresh)) ||
    isTruthyParam(pickQueryParam(sp.force));

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok) {
    // Single 404 surface for missing / disabled / expired / malformed so
    // an attacker probing the token namespace can't distinguish.
    notFound();
  }

  // This page only renders event-scope tokens. Client-scope tokens belong
  // on the client portal (see `app/share/client/[token]`), so route them
  // to the same generic 404 surface as missing/disabled. The discriminated
  // union keeps `event_id` typed as `string` (non-null) inside this branch.
  if (resolved.share.scope !== "event") {
    notFound();
  }
  const { event_id, user_id } = resolved.share;

  // Fan-out: event lookup + owner token + plan-side tickets cumulative
  // + latest TikTok manual report in parallel. Plan-tickets reuses the
  // same admin client so no extra Supabase connection is opened. The
  // TikTok read returns null on any failure so a missing snapshot never
  // poisons the Meta path — TikTok is purely additive here.
  const [eventRow, providerToken, planTickets, tiktokRow] = await Promise.all([
    admin
      .from("events")
      .select(
        "name, venue_name, venue_city, venue_country, event_date, event_start_at, event_code, budget_marketing, capacity, tickets_sold, meta_spend_cached, prereg_spend, general_sale_at, report_cadence, client:clients ( meta_ad_account_id )",
      )
      .eq("id", event_id)
      .maybeSingle(),
    getOwnerFacebookToken(user_id, admin),
    getLatestTicketsSoldForEventAdmin(admin, event_id),
    fetchLatestTikTokSnapshot(admin, event_id, token).catch(() => null),
  ]);

  if (eventRow.error || !eventRow.data) {
    console.error(
      `[share/report] event lookup failed for token=${token}:`,
      eventRow.error?.message ?? "no row",
    );
    notFound();
  }

  const clientRel = eventRow.data.client as
    | { meta_ad_account_id: string | null }
    | { meta_ad_account_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);

  // Plan-side cumulative wins when present — see the JSDoc on
  // `getLatestTicketsSoldForEvent` for the rationale (dated history,
  // mirrors the Plan tab the client already sees). Manual override on
  // `events.tickets_sold` is the fallback for D2C shows with no plan.
  const manualTicketsSold =
    (eventRow.data.tickets_sold as number | null) ?? null;
  let resolvedTicketsSold: number | null;
  let ticketsSoldSource: "plan" | "manual" | null;
  let ticketsSoldAsOf: string | null;
  if (planTickets) {
    resolvedTicketsSold = planTickets.value;
    ticketsSoldSource = "plan";
    ticketsSoldAsOf = planTickets.asOfDay;
  } else if (manualTicketsSold != null) {
    resolvedTicketsSold = manualTicketsSold;
    ticketsSoldSource = "manual";
    ticketsSoldAsOf = null;
  } else {
    resolvedTicketsSold = null;
    ticketsSoldSource = null;
    ticketsSoldAsOf = null;
  }

  const event: ResolvedEvent = {
    name: eventRow.data.name as string,
    venueName: (eventRow.data.venue_name as string | null) ?? null,
    venueCity: (eventRow.data.venue_city as string | null) ?? null,
    venueCountry: (eventRow.data.venue_country as string | null) ?? null,
    eventDate: (eventRow.data.event_date as string | null) ?? null,
    eventStartAt: (eventRow.data.event_start_at as string | null) ?? null,
    eventCode: (eventRow.data.event_code as string | null) ?? null,
    paidMediaBudget:
      (eventRow.data.budget_marketing as number | null) ?? null,
    ticketsSold: resolvedTicketsSold,
    ticketsSoldSource,
    ticketsSoldAsOf,
    adAccountId,
    metaSpendCached:
      (eventRow.data.meta_spend_cached as number | null) ?? null,
    preregSpend: (eventRow.data.prereg_spend as number | null) ?? null,
    generalSaleAt: (eventRow.data.general_sale_at as string | null) ?? null,
    // Default cadence guards against rows ingested before migration 040
    // existed (Supabase serves null until the default backfills) and
    // against any future widening of the union — only the two known
    // values are honoured downstream; anything else collapses to
    // 'daily' to match the table default.
    reportCadence:
      (eventRow.data.report_cadence as string | null) === "weekly"
        ? "weekly"
        : "daily",
    capacity: (eventRow.data.capacity as number | null) ?? null,
  };

  // Bump the view counter best-effort — non-blocking.
  // Wrapped in a fire-and-forget so a slow update doesn't add to LCP.
  bumpShareView(token, admin).catch(() => undefined);

  // Resolve the report payload through the Supabase snapshot cache.
  //
  // Two-tier cache:
  //   - Headline metaPayload → `share_insight_snapshots` (5-min
  //     TTL, keyed on the share token). Cheap to compute, fine to
  //     refetch live on miss.
  //   - Active creatives → `active_creatives_snapshots` (cron-
  //     populated, 2-6h TTL, keyed on event_id + preset). NEVER
  //     refetched live on the share render path — that traffic
  //     shape was the one causing 80004 account-wide rate-limit
  //     lockouts. See `docs/META_INDEPENDENCE_RESEARCH.md`.
  //
  // `resolveReportData` continues to handle the headline tier
  // exactly as before (no cron involvement). The active-creatives
  // tier is resolved separately via `resolveActiveCreatives` so
  // the two cadences can diverge cleanly.
  const {
    metaPayload,
    metaErrorReason,
  } = await resolveReportData({
    admin,
    shareToken: token,
    datePreset,
    customRange,
    forceRefresh,
    share: resolved.share,
    event,
    providerToken,
  });

  const activeCreativesResolution = await resolveActiveCreatives({
    admin,
    eventId: event_id,
    userId: user_id,
    eventCode: event.eventCode,
    eventDate: event.eventDate,
    adAccountId: event.adAccountId,
    datePreset,
    customRange,
    share: resolved.share,
    forceRefresh,
  });
  const { creativesResult, deferredCreatives, snapshot } =
    activeCreativesResolution;

  // True when the creative breakdown actually has something to
  // render. `kind === "skip"` (no_event_code / no_ad_account /
  // no_linked_campaigns) and `kind === "error"` both count as
  // "nothing renderable" — they'd produce either a hidden section
  // or a tiny muted note, neither of which is enough on its own
  // to justify a partial render when headline insights also died.
  //
  // On the deferred path we don't yet know whether creatives will
  // resolve to "ok" — assume optimistically that they will, so the
  // Unavailable bail-out below doesn't fire prematurely. Worst
  // case: the deferred fetch returns "skip"/"error" and the user
  // sees an empty creatives slot under the headline (degraded but
  // not broken).
  const creativesHaveContent = deferredCreatives
    ? true
    : creativesResult?.kind === "ok" && creativesResult.groups.length > 0;

  // Final fatal branch: only when there is genuinely nothing to
  // render — no Meta payload, no TikTok snapshot, and no usable
  // creatives. ReportUnavailable's reason diagnostic uses the Meta
  // error if we have one; otherwise we fall back to `no_ad_account`
  // (the most common cause of a TikTok-only client also lacking a
  // TikTok import).
  if (!metaPayload && !tiktokRow && !creativesHaveContent) {
    return (
      <ReportUnavailable
        eventName={event.name}
        venueName={event.venueName}
        venueCity={event.venueCity}
        eventDate={event.eventDate}
        reason={metaErrorReason ?? "no_ad_account"}
      />
    );
  }

  // Partial-render flag: drop the headline metric grid but keep
  // the creatives + timeframe selector + muted banner. Only when
  // the headline call actually failed AND the creative breakdown
  // is renderable — otherwise there's nothing to keep above the
  // banner and we'd rather render the standard layout (which
  // gracefully drops the Meta block when `meta=null`).
  const headlineUnavailable = !metaPayload && creativesHaveContent;

  // Server-load the unified per-day timeline + Eventbrite link
  // presence in parallel — both feed the Event daily report block,
  // which renders below the headline metrics on the share page.
  // Defensive catches keep a missing migration / dropped row from
  // 500-ing the whole report; the block degrades gracefully when its
  // initial timeline is empty.
  const [eventDailyData, eventLinks, additionalSpendList] = await Promise.all([
    loadEventDailyTimeline(admin, event_id).catch((err) => {
      console.warn(
        `[share/report] event-daily-timeline failed for token=${token}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { timeline: [] as TimelineRow[], rollups: [], manualCount: 0 };
    }),
    listLinksForEvent(admin, event_id).catch(() => []),
    listAdditionalSpendForEvent(admin, event_id).catch(() => []),
  ]);
  const additionalSpendEntries = additionalSpendList.map((r) => ({
    date: r.date,
    amount: Number(r.amount),
  }));
  const presale = computePresaleBucket(
    eventDailyData.rollups,
    event.generalSaleAt,
  );
  const eventDailySlot = (
    <EventDailyReportBlock
      mode="share"
      event={{
        id: event_id,
        budget_marketing: event.paidMediaBudget,
        meta_spend_cached: event.metaSpendCached,
        prereg_spend: event.preregSpend,
        general_sale_at: event.generalSaleAt,
        report_cadence: event.reportCadence,
        capacity: event.capacity,
        event_date: event.eventDate,
      }}
      performanceSummary={{
        datePreset,
        customRange,
        metaSpend: metaPayload?.totals.spend ?? null,
        ticketsInWindow: metaPayload?.ticketsSoldInWindow ?? null,
      }}
      additionalSpendEntries={additionalSpendEntries}
      hasMetaScope={Boolean(event.eventCode && event.adAccountId)}
      hasEventbriteLink={eventLinks.length > 0}
      initialTimeline={eventDailyData.timeline}
      initialPresale={presale}
    />
  );

  // Render path:
  //   - Fresh snapshot hit → render the resolved section
  //     synchronously, no Suspense, no banner.
  //   - Stale snapshot hit → render the resolved section
  //     synchronously WITH a stale banner above it. The
  //     `resolveActiveCreatives` step has already kicked the
  //     fire-and-forget background refresh.
  //   - No snapshot ever (cold cache, brand-new event) →
  //     fall back to the legacy Suspense-streamed live fetch,
  //     capped at 20s before swapping to the "Numbers warming up"
  //     placeholder. This branch should be vanishingly rare once
  //     the cron has been running for ~6h after deploy.
  //   - Soft-skip (no event_code / no ad account) → null.
  const showStaleBanner = Boolean(
    snapshot && !isSnapshotFresh(snapshot),
  );
  const fetchedAtIso = snapshot?.fetchedAt.toISOString();

  let creativesSlot: React.ReactNode = null;
  if (deferredCreatives) {
    creativesSlot = (
      <>
        <Suspense fallback={<ShareActiveCreativesSkeleton />}>
          <DeferredCreativesSlot promise={deferredCreatives} />
        </Suspense>
      </>
    );
  } else if (creativesResult) {
    creativesSlot = (
      <>
        {showStaleBanner && fetchedAtIso ? (
          <ActiveCreativesStaleBanner
            fetchedAt={fetchedAtIso}
            eventId={event_id}
            preset={datePreset}
            customRange={customRange}
          />
        ) : null}
        <ShareActiveCreativesSection result={creativesResult} />
      </>
    );
  }

  return (
    <PublicReport
      event={{
        name: event.name,
        venueName: event.venueName,
        venueCity: event.venueCity,
        venueCountry: event.venueCountry,
        eventDate: event.eventDate,
        eventStartAt: event.eventStartAt,
        paidMediaBudget: event.paidMediaBudget,
        ticketsSold: event.ticketsSold,
        ticketsSoldSource: event.ticketsSoldSource,
        ticketsSoldAsOf: event.ticketsSoldAsOf,
        capacity: event.capacity,
      }}
      meta={metaPayload}
      tiktok={tiktokRow}
      shareToken={token}
      datePreset={datePreset}
      customRange={customRange}
      creativesSlot={creativesSlot}
      eventDailySlot={eventDailySlot}
      headlineUnavailable={headlineUnavailable}
    />
  );
}

/**
 * `?refresh=1` / `?refresh=true` toggles a cache-bypass on this
 * render. Anything else (missing, "0", "false") leaves the cache
 * enabled. Kept tolerant rather than strict-equals because the
 * agency pastes the URL into ops dashboards / Slack hand-rolling
 * the param, and nothing here is security-sensitive.
 */
function isTruthyParam(value: string | null): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

interface ResolveReportInput {
  admin: SupabaseClient;
  shareToken: string;
  datePreset: DatePreset;
  customRange: CustomDateRange | undefined;
  forceRefresh: boolean;
  share: ResolvedShare;
  event: ResolvedEvent;
  providerToken: string | null;
}

interface ResolvedReport {
  metaPayload: EventInsightsPayload | null;
  metaErrorReason: InsightsErrorReason | null;
}

/**
 * Read-through cache for the share page's HEADLINE Meta payload
 * (`share_insight_snapshots`, 5-min TTL, keyed on share token).
 *
 * Note on scope shrink (PR #82+ snapshot-first):
 *   This function used to also resolve the active-creatives
 *   payload through the same cache row. That's been moved to
 *   `resolveActiveCreatives` + `active_creatives_snapshots`
 *   because the two halves have wildly different refresh
 *   cadences (5 min vs 6h) and the active-creatives fan-out is
 *   what was triggering account-wide 80004 rate-limit lockouts
 *   when concurrent share viewers fanned it out live. The
 *   headline call is cheap (single account-scoped insights call)
 *   and stays on its existing 5-min TTL — no need to involve
 *   the cron for it. See `docs/META_INDEPENDENCE_RESEARCH.md`.
 *
 * Cache write is gated on `metaPayload != null` — failure
 * states (rate-limit, data_too_large, owner-token-expired) are
 * deliberately uncached because the next visitor should retry
 * fresh. The Meta-less soft-skip path (no event_code or no ad
 * account) bypasses the cache entirely — no Meta call to skip,
 * and re-running the lookup is essentially free.
 */
async function resolveReportData(
  input: ResolveReportInput,
): Promise<ResolvedReport> {
  const {
    admin,
    shareToken,
    datePreset,
    customRange,
    forceRefresh,
    share,
    event,
    providerToken,
  } = input;
  const tokenTag = shareToken.slice(0, 6);

  // Soft-skip: no Meta config means no Meta fetch and nothing
  // worth caching. Bail out early so the cache table only holds
  // rows that actually save a Meta round-trip.
  if (!event.adAccountId || !event.eventCode) {
    return {
      metaPayload: null,
      metaErrorReason: null,
    };
  }

  if (!forceRefresh) {
    const hit = await readShareSnapshot(admin, {
      shareToken,
      datePreset,
      customRange,
    });
    if (hit) {
      console.log("[share-snapshots] hit", {
        token: tokenTag,
        preset: datePreset,
        ageMs: hit.ageMs,
      });
      return {
        metaPayload: hit.payload.metaPayload,
        metaErrorReason: hit.payload.metaErrorReason,
      };
    }
  }
  console.log("[share-snapshots] miss", {
    token: tokenTag,
    preset: datePreset,
    forced: forceRefresh,
  });

  let metaPayload: EventInsightsPayload | null = null;
  let metaErrorReason: InsightsErrorReason | null = null;
  if (!providerToken) {
    metaErrorReason = "no_owner_token";
  } else {
    const insights: InsightsResult = await fetchEventInsights({
      eventCode: event.eventCode,
      adAccountId: event.adAccountId,
      token: providerToken,
      datePreset,
      customRange,
      // Wire the rollup-summed tickets-in-window into the
      // payload so `EventReportView` can derive a timeframe-
      // aware "Tickets sold" + "Cost per ticket" instead of
      // staring at the frozen mount-time `events.tickets_sold`
      // snapshot. See PR #56 #3 — `getTicketsSoldInWindow`
      // returns null on first sync / unlinked events, in which
      // case the consumer falls back to the legacy number.
      // `share.event_id` is `string | null` on the union type
       // (client-scope shares carry null), but the page-level
       // narrowing above guarantees we're on an event-scope
       // branch by the time `resolveReportData` runs. Skip the
       // resolver entirely on the impossible-but-typesafe null
       // case so EventReportView falls back to the legacy
       // mount-time tickets number.
      ticketsInWindowResolver: share.event_id
        ? (preset, range) =>
            sumTicketsSoldInWindow(admin, share.event_id!, preset, range)
        : undefined,
    });
    if (insights.ok) {
      metaPayload = insights.data;
    } else {
      metaErrorReason = insights.error.reason;
      console.error("[share/insights] fetch failed", {
        token: shareToken,
        reason: insights.error.reason,
        adAccountId: event.adAccountId,
        eventCode: event.eventCode,
        datePreset,
        customRange,
        error: { message: insights.error.message },
      });
    }
  }

  // Headline-only cache write. The active-creatives field is
  // explicitly unset (legacy field, will roll off on next deploy
  // — see `lib/db/share-snapshots.ts`).
  if (metaPayload != null) {
    const payload: ShareSnapshotPayload = {
      metaPayload,
      metaErrorReason,
    };
    try {
      await writeShareSnapshot(
        admin,
        { shareToken, datePreset, customRange },
        payload,
      );
    } catch (err) {
      console.warn(
        `[share/report] headline snapshot write failed token=${shareToken}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return {
    metaPayload,
    metaErrorReason,
  };
}

interface ResolveActiveCreativesInput {
  admin: SupabaseClient;
  eventId: string;
  userId: string;
  eventCode: string | null;
  adAccountId: string | null;
  eventDate: string | null;
  datePreset: DatePreset;
  customRange: CustomDateRange | undefined;
  share: ResolvedShare;
  forceRefresh: boolean;
}

interface ResolveActiveCreativesResult {
  /** Resolved synchronously when the snapshot table has a row
   *  (fresh OR stale) OR the event is meta-less. Null only on
   *  the cold-cache "no snapshot ever" branch — in which case
   *  `deferredCreatives` carries the live fetch promise. */
  creativesResult: ShareActiveCreativesResult | null;
  /** Set ONLY on the cold-cache branch. The page wraps this in
   *  Suspense + `withTimeout(20s)` and falls back to the
   *  warming placeholder if Meta hasn't responded. */
  deferredCreatives: Promise<ShareActiveCreativesResult> | null;
  /** The snapshot row that was read, if any. Drives the stale
   *  banner above the resolved section when `!isSnapshotFresh`. */
  snapshot: ActiveCreativesSnapshotRecord | null;
}

/**
 * Snapshot-first resolution for the active-creatives section.
 *
 * Fresh hit
 *   Snapshot row exists AND `isSnapshotFresh()`. Return the
 *   resolved payload synchronously, no Suspense, no banner.
 *
 * Stale hit
 *   Snapshot row exists but the TTL has expired OR `is_stale`
 *   is set. Return the (still useful) cached payload + the
 *   snapshot record so the page can render the stale banner.
 *   Fire a fire-and-forget background refresh via Next 16's
 *   stable `after()` hook so the next render hits a fresh row.
 *
 * Cold cache (no snapshot ever)
 *   Brand-new event the cron hasn't reached yet, OR the cron
 *   hasn't run since deploy. Fall back to the legacy live-fetch-
 *   with-Suspense path so the visitor still sees something this
 *   render. ALSO kick the same background refresh so the cron
 *   isn't the only thing populating the table — the next
 *   visitor lands on a snapshot hit. The Suspense child is
 *   capped at 20s by `withTimeout` and falls back to the
 *   warming placeholder past that.
 *
 * Soft-skip (no Meta config)
 *   No event_code or no ad account → no Meta call to make. Return
 *   null for both result + deferred so the section doesn't render.
 *
 * `forceRefresh` (the page-level `?refresh=1`) bypasses the read
 * — the snapshot is treated as missing for THIS render so the
 * cold-cache live-fetch path runs. The background kick still
 * fires so the next visitor's read benefits.
 */
async function resolveActiveCreatives(
  input: ResolveActiveCreativesInput,
): Promise<ResolveActiveCreativesResult> {
  const {
    admin,
    eventId,
    userId,
    eventCode,
    adAccountId,
    eventDate,
    datePreset,
    customRange,
    share,
    forceRefresh,
  } = input;

  // Soft-skip: same posture as `resolveReportData`. No Meta call,
  // no snapshot lookup, no banner.
  if (!adAccountId || !eventCode) {
    return {
      creativesResult: null,
      deferredCreatives: null,
      snapshot: null,
    };
  }

  const snapshotKey = { eventId, datePreset, customRange };

  const snapshot = forceRefresh
    ? null
    : await readActiveCreativesSnapshot(admin, snapshotKey);

  // Convenience for both stale + cold-cache paths — schedule a
  // background refresh that runs after the response has been
  // sent so the cache populates in time for the next render.
  // We invoke the runner directly (rather than POSTing the
  // internal HTTP route) because we're already on the server,
  // already hold the service-role client, and skipping the
  // HTTP hop removes a round-trip + a host-resolution problem
  // (the share page's hostname isn't trivially recoverable from
  // the RSC). The internal route is still the right surface for
  // the dashboard's "Refresh now" button (which is client-side).
  const scheduleBackgroundRefresh = () => {
    after(async () => {
      try {
        await refreshActiveCreativesForEvent({
          supabase: admin,
          eventId,
          userId,
          eventCode,
          adAccountId,
          eventDate: eventDate ? new Date(eventDate) : null,
          presets: [datePreset],
          customRange,
        });
      } catch (err) {
        console.warn(
          `[share/report] background refresh failed event=${eventId} preset=${datePreset}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    });
  };

  if (snapshot) {
    const fresh = isSnapshotFresh(snapshot);
    console.log("[active-creatives-snapshots] hit", {
      eventId,
      preset: datePreset,
      ageMs: snapshot.ageMs,
      fresh,
    });
    if (!fresh) {
      scheduleBackgroundRefresh();
    }
    return {
      creativesResult: snapshot.payload,
      deferredCreatives: null,
      snapshot,
    };
  }

  // Cold cache — no row at all. Fall back to the legacy live-
  // fetch path so the visitor still sees something. Cap the
  // Suspense child at 20s; past that it renders the warming
  // placeholder. The background refresh still fires so the
  // cron isn't the only thing filling the table.
  console.log("[active-creatives-snapshots] miss", {
    eventId,
    preset: datePreset,
    forced: forceRefresh,
  });
  scheduleBackgroundRefresh();

  const livePromise = fetchShareActiveCreatives({
    share,
    admin,
    eventCode,
    adAccountId,
    datePreset,
    customRange,
  }).catch((err): ShareActiveCreativesResult => {
    console.error("[share/report] active-creatives live fetch crashed", {
      eventId,
      adAccountId,
      eventCode,
      datePreset,
      customRange,
      error:
        err instanceof Error
          ? { message: err.message, stack: err.stack }
          : String(err),
    });
    return {
      kind: "error",
      reason: "meta_failed",
      message: "Unexpected error",
    };
  });

  return {
    creativesResult: null,
    deferredCreatives: withTimeout(livePromise, COLD_FETCH_TIMEOUT_MS),
    snapshot: null,
  };
}

/**
 * Cap the cold-cache live fetch at 20s. Past that, resolve to a
 * sentinel `kind="skip"` value so the Suspense child can swap to
 * the "Numbers warming up" placeholder instead of holding the
 * skeleton open indefinitely. The original promise keeps running
 * in the background — on the unlikely chance it succeeds it
 * still writes via the (already-scheduled) `after()` refresh.
 *
 * Sentinel uses `kind="skip"` rather than `kind="error"` because
 * `error` would render a "Creative breakdown unavailable" banner
 * (wrong message — the data IS coming, just not in time for THIS
 * render). The Suspense child checks for the sentinel `reason`
 * and renders the warming placeholder explicitly.
 */
const COLD_FETCH_TIMEOUT_MS = 20_000;
const TIMEOUT_SKIP_REASON = "warming_up_timeout" as const;

function withTimeout(
  promise: Promise<ShareActiveCreativesResult>,
  ms: number,
): Promise<ShareActiveCreativesResult> {
  const timeoutPromise = new Promise<ShareActiveCreativesResult>((resolve) => {
    setTimeout(() => {
      resolve({
        kind: "skip",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reason: TIMEOUT_SKIP_REASON as any,
      });
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Suspense child for the cold-cache live fetch. Awaiting the
 * promise inside an async server component is what triggers the
 * outer `<Suspense>` fallback to render until it resolves.
 *
 * Two terminal states:
 *
 *   - The live fetch resolved (with any kind — ok/skip/error)
 *     within the 20s timeout → render the resolved section.
 *   - The 20s timeout fired first → `withTimeout` resolved to
 *     the `warming_up_timeout` sentinel → render the warming
 *     placeholder so the visitor doesn't sit watching the
 *     skeleton spin past the half-minute mark.
 *
 * The background refresh kicked by `resolveActiveCreatives`
 * runs independently; the next visitor lands on a real snapshot
 * either way.
 */
async function DeferredCreativesSlot({
  promise,
}: {
  promise: Promise<ShareActiveCreativesResult>;
}) {
  const result = await promise;
  if (
    result.kind === "skip" &&
    (result as { reason: string }).reason === TIMEOUT_SKIP_REASON
  ) {
    return <ShareActiveCreativesWarming />;
  }
  return <ShareActiveCreativesSection result={result} />;
}

/**
 * Fetch the latest `tiktok_manual_reports` row for an event, mapped to
 * the shape consumed by `<TikTokReportBlock>`. Returns null on missing
 * row or any DB error — the share page treats TikTok purely as an
 * optional add-on, never a hard dependency.
 *
 * Uses the admin (service-role) client because the share token is the
 * only auth we have here; RLS would otherwise block the read entirely.
 * The fan-out caller wraps this in a try/catch one more time as
 * defense-in-depth.
 */
async function fetchLatestTikTokSnapshot(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventId: string,
  token: string,
): Promise<TikTokReportBlockData | null> {
  const { data, error } = await admin
    .from("tiktok_manual_reports")
    .select(
      "id, campaign_name, date_range_start, date_range_end, imported_at, snapshot_json",
    )
    .eq("event_id", eventId)
    .order("imported_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn(
      `[share/report] tiktok lookup failed for token=${token}: ${error.message}`,
    );
    return null;
  }
  if (!data) return null;

  return {
    id: data.id as string,
    campaign_name: data.campaign_name as string,
    date_range_start: data.date_range_start as string,
    date_range_end: data.date_range_end as string,
    imported_at: data.imported_at as string,
    snapshot: data.snapshot_json as unknown as TikTokManualReportSnapshot,
  };
}
