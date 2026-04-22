import { Suspense } from "react";
import { notFound } from "next/navigation";
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
import { listLinksForEvent } from "@/lib/db/ticketing";
import {
  computePresaleBucket,
  loadEventDailyTimeline,
  type TimelineRow,
} from "@/lib/db/event-daily-timeline";
import { EventDailyReportBlock } from "@/components/dashboard/events/event-daily-report-block";
import {
  readShareSnapshot,
  writeShareSnapshot,
  type ShareSnapshotPayload,
} from "@/lib/db/share-snapshots";
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
 *   - Cached for 5 minutes per token via `revalidate = 300`.
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

export const revalidate = 300;

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
}

export default async function PublicReportPage({ params, searchParams }: Props) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const datePreset = parseDatePreset(sp.tf);
  const customRange = parseCustomRange(
    datePreset,
    pickQueryParam(sp.from),
    pickQueryParam(sp.to),
  );
  // `?refresh=1` skips the Supabase snapshot read (NOT the write —
  // a fresh fetch still warms the cache for the next visitor). Use
  // for manual re-warming when an agency has just relaunched a
  // campaign and wants the new spend reflected before TTL elapses.
  // Any truthy string ("1" / "true") activates it; "" / missing
  // leaves the cache enabled.
  const forceRefresh = isTruthyParam(pickQueryParam(sp.refresh));

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
        "name, venue_name, venue_city, venue_country, event_date, event_start_at, event_code, budget_marketing, tickets_sold, meta_spend_cached, prereg_spend, general_sale_at, client:clients ( meta_ad_account_id )",
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
  };

  // Bump the view counter best-effort — non-blocking.
  // Wrapped in a fire-and-forget so a slow update doesn't add to LCP.
  bumpShareView(token, admin).catch(() => undefined);

  // Resolve the report payload through the Supabase snapshot cache.
  // The cache short-circuits both fetches on a hit; a miss returns
  // the headline immediately (so the rest of the report can paint)
  // and a *deferred* creatives promise for Suspense-streaming —
  // see `resolveReportData` for the contract.
  const {
    metaPayload,
    metaErrorReason,
    creativesResult,
    deferredCreatives,
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
  const [eventDailyData, eventLinks] = await Promise.all([
    loadEventDailyTimeline(admin, event_id).catch((err) => {
      console.warn(
        `[share/report] event-daily-timeline failed for token=${token}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { timeline: [] as TimelineRow[], rollups: [], manualCount: 0 };
    }),
    listLinksForEvent(admin, event_id).catch(() => []),
  ]);
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
      }}
      hasMetaScope={Boolean(event.eventCode && event.adAccountId)}
      hasEventbriteLink={eventLinks.length > 0}
      initialTimeline={eventDailyData.timeline}
      initialPresale={presale}
    />
  );

  // Render path:
  //   - Cache hit → render the resolved section synchronously.
  //   - Cache miss with a deferred promise → wrap the section in
  //     Suspense so the headline + campaign breakdown above it
  //     paint immediately while the per-event Meta fan-out
  //     (10-30s on cache miss) streams in behind a skeleton.
  //   - Soft-skip (no event_code / no ad account) → null.
  let creativesSlot: React.ReactNode = null;
  if (deferredCreatives) {
    creativesSlot = (
      <Suspense fallback={<ShareActiveCreativesSkeleton />}>
        <DeferredCreativesSlot promise={deferredCreatives} />
      </Suspense>
    );
  } else if (creativesResult) {
    creativesSlot = <ShareActiveCreativesSection result={creativesResult} />;
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
  /**
   * Resolved synchronously from the cache hit path or the
   * soft-skip path (no event_code / no ad account). Null on the
   * deferred-creatives path — the page wraps `deferredCreatives`
   * in Suspense instead.
   */
  creativesResult: ShareActiveCreativesResult | null;
  /**
   * Set on cache miss with a usable Meta config. The page wraps
   * this in `<Suspense>` so the headline + campaign breakdown
   * paint instantly while the per-event Meta fan-out (10-30s on
   * wide events) streams in behind a skeleton. Cache write
   * happens inside the deferred fetch once both halves resolve.
   */
  deferredCreatives: Promise<ShareActiveCreativesResult> | null;
}

/**
 * Read-through cache for the share page's Meta payload + active
 * creatives. On a fresh hit, returns the cached bundle and skips
 * Meta entirely. On a miss (or `?refresh=1`), the headline call
 * runs and resolves inline, while the (slow) per-event creatives
 * fan-out is returned as a deferred promise the page streams in
 * behind a Suspense skeleton — see PR #50 for the rationale.
 *
 * Cache write is gated:
 *   - `metaPayload != null` — the headline call succeeded. We
 *     deliberately do NOT cache failure states (rate-limit,
 *     data_too_large, owner-token-expired) because those are
 *     usually transient and the next visitor should retry fresh.
 *   - `creativesResult?.kind !== "error"` — same logic for the
 *     creative breakdown side. A `skip` (genuinely empty event)
 *     is fine to cache; an `error` (Meta failure) is not.
 *   - The Meta-less soft-skip path (no event_code or no ad
 *     account) never goes through the cache at all — there's no
 *     Meta call to skip, and re-running the lookup is essentially
 *     free.
 *
 * Headline + creatives still don't run in parallel within the
 * miss path: `fetchEventInsights` resolves first (so the page
 * body has data to render), then the deferred creatives fetch
 * fires from the Suspense child. This preserves the per-account
 * rate-budget headroom PR #42 cared about — the two top-level
 * Meta calls are still sequential in wall-clock time, just
 * separated by Suspense streaming on the response side.
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
      creativesResult: null,
      deferredCreatives: null,
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
        creativesResult: hit.payload.activeCreatives,
        deferredCreatives: null,
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
    });
    if (insights.ok) {
      metaPayload = insights.data;
    } else {
      metaErrorReason = insights.error.reason;
      console.warn(
        `[share/report] meta insights failed token=${shareToken} reason=${insights.error.reason} msg=${insights.error.message}`,
      );
    }
  }

  // Defer the per-event creatives fan-out. The page wraps the
  // returned promise in Suspense so the headline metrics +
  // campaign breakdown paint immediately; only the active-
  // creatives section stays in skeleton state until this
  // resolves. Cache write happens in the .then() once both
  // halves are known.
  //
  // Capture stable locals so the closure doesn't re-read mutable
  // state (metaPayload is reassigned below in the no-token branch
  // — wait, it isn't, but TS narrowing is happier with a const).
  const cachedHeadlineForWrite = metaPayload;
  const cachedHeadlineErrorForWrite = metaErrorReason;
  const eventCodeForFetch = event.eventCode;
  const adAccountIdForFetch = event.adAccountId;

  const deferredCreatives = fetchShareActiveCreatives({
    share,
    admin,
    eventCode: eventCodeForFetch,
    adAccountId: adAccountIdForFetch,
    // Forward the timeframe so per-ad insights are queried in
    // the same window the headline call uses. Without this the
    // creative metric strip silently shows last_30d (Meta's
    // nested-insights default) regardless of `?tf=`.
    datePreset,
    customRange,
  })
    .catch((err): ShareActiveCreativesResult => {
      console.warn(
        `[share/report] active-creatives fetch crashed for token=${shareToken}:`,
        err instanceof Error ? err.message : String(err),
      );
      return {
        kind: "error",
        reason: "meta_failed",
        message: "Unexpected error",
      };
    })
    .then(async (creativesResult) => {
      // Cache write is gated on BOTH halves being healthy:
      //   - headline call succeeded (`metaPayload != null`)
      //   - creatives didn't error (skip is fine)
      // Failure states are deliberately uncached so the next
      // visitor retries fresh — usually transient.
      const cacheable =
        cachedHeadlineForWrite != null && creativesResult.kind !== "error";
      if (cacheable) {
        const payload: ShareSnapshotPayload = {
          metaPayload: cachedHeadlineForWrite,
          metaErrorReason: cachedHeadlineErrorForWrite,
          activeCreatives: creativesResult,
        };
        try {
          await writeShareSnapshot(
            admin,
            { shareToken, datePreset, customRange },
            payload,
          );
        } catch (err) {
          // Best-effort: a cache write failure shouldn't blank
          // the user's render. Log and move on.
          console.warn(
            `[share/report] snapshot write failed token=${shareToken}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      return creativesResult;
    });

  return {
    metaPayload,
    metaErrorReason,
    creativesResult: null,
    deferredCreatives,
  };
}

/**
 * Suspense child for the deferred creatives fetch. Awaiting the
 * promise inside an async server component is what triggers the
 * outer `<Suspense>` fallback to render until it resolves.
 *
 * Kept dumb on purpose — all the orchestration (cache read,
 * headline fetch, cache write) lives in `resolveReportData`.
 */
async function DeferredCreativesSlot({
  promise,
}: {
  promise: Promise<ShareActiveCreativesResult>;
}) {
  const result = await promise;
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
