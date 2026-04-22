"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  Pencil,
  Trash2,
  Megaphone,
  ExternalLink,
  CheckCircle2,
  Circle,
  BarChart3,
  Plus,
  Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabPanel } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import { KindBadge } from "@/components/dashboard/_shared/kind-badge";
import {
  EventDetailTabs,
  type EventTab,
} from "@/components/dashboard/events/event-detail-tabs";
import { EventPlanTab } from "@/components/dashboard/events/event-plan-tab";
import { EventVenuePanel } from "@/components/dashboard/events/event-venue-panel";
import { EventArtistRosterPanel } from "@/components/dashboard/events/event-artist-roster-panel";
import { GoogleDriveCard } from "@/components/dashboard/events/google-drive-card";
import { PlatformConfigCard } from "@/components/dashboard/events/platform-config-card";
import { EventReportingTabs } from "@/components/dashboard/events/event-reporting-tabs";
import { EventActivityPanel } from "@/components/dashboard/events/event-activity-panel";
import { EventActiveCreativesPanel } from "@/components/dashboard/events/event-active-creatives-panel";
import { LinkedCampaignsPerformance } from "@/components/dashboard/events/linked-campaigns-performance";
import {
  TicketPacingCard,
  type PacingSnapshot,
} from "@/components/dashboard/events/ticket-pacing-card";
import { EventbriteLiveBlock } from "@/components/dashboard/events/eventbrite-live-block";
import { EventbriteLinkPanel } from "@/components/dashboard/events/eventbrite-link-panel";
import { DailyTracker } from "@/components/dashboard/events/daily-tracker";
import type { EventTicketingSummary } from "@/lib/db/event-ticketing-summary";
import { ShareReportControls } from "@/app/(dashboard)/events/[id]/share-report-controls";
import { TicketsSoldPanel } from "@/app/(dashboard)/events/[id]/tickets-sold-panel";
import { InternalEventReport } from "@/components/report/internal-event-report";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { saveDraftToDb } from "@/lib/db/drafts";
import {
  deleteEventRow,
  linkDraftToEvent,
  toggleFavourite,
  type EventLinkedDraft,
  type EventWithClient,
} from "@/lib/db/events";
import type { AdPlan, AdPlanDay } from "@/lib/db/ad-plans";
import type { EventKeyMoment } from "@/lib/db/event-key-moments";
import type { InvoiceRow, QuoteRow } from "@/lib/types/invoicing";
import { EventInvoicingPanel } from "@/components/invoicing/event-invoicing-panel";
import {
  fmtDate,
  fmtDateTime,
  fmtDaysUntilEvent,
  fmtShort,
} from "@/lib/dashboard/format";

const BRAND_GBP_FMT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

interface Props {
  event: EventWithClient;
  drafts: EventLinkedDraft[];
  /** Authenticated user id, server-resolved. Needed for the new-draft handoff. */
  userId: string;
  /** Active tab, resolved from `?tab=` by the parent server component. */
  activeTab: EventTab;
  /** Marketing plan for this event, or null if none exists yet. */
  plan: AdPlan | null;
  /** Day rows for the plan; empty when plan is null. */
  planDays: AdPlanDay[];
  /**
   * Key moments overlay for the plan grid (countdown phases, lineup
   * drops, press hits). Server-prefetched so the grid paints with
   * labels on first nav. Empty when migration 008 hasn't been applied
   * yet — the grid degrades to a vanilla weekday display in that case.
   */
  keyMoments: EventKeyMoment[];
  /**
   * Pre-fetched report_shares row for this event, or null if no share
   * exists yet. Drives the share controls in the Reporting tab — null
   * is the expected state until the user toggles the link on.
   */
  initialShare: {
    token: string;
    // Nullable since migration 014 — scope='client' shares carry a
    // client_id instead. event_id is still always set for shares
    // returned by getShareForEvent (which filters by event_id), but
    // the row type from the regenerated database.types.ts allows null.
    event_id: string | null;
    enabled: boolean;
    expires_at: string | null;
    view_count: number;
    last_viewed_at: string | null;
    created_at: string;
  } | null;
  /**
   * Server-rendered current `events.tickets_sold` for the Reporting
   * tab's TicketsSoldPanel. Null = column unset (not yet recorded).
   */
  initialTicketsSold: number | null;
  /**
   * Latest non-null `ad_plan_days.tickets_sold_cumulative` for any of
   * this event's plans, fetched server-side. When present this becomes
   * the authoritative tickets-sold figure (preferred over the manual
   * override) and the panel renders read-only.
   */
  planTickets: { value: number; asOfDay: string } | null;
  /**
   * Quote that originally spawned this event (when converted from the
   * invoicing flow). Null = event was created directly. Drives the
   * "From quote" badge in the header and unlocks the Invoicing panel.
   */
  linkedQuote: QuoteRow | null;
  /**
   * All invoices linked to this event (regardless of which quote they
   * came from). Powers the Invoicing collapsible on the Overview tab.
   */
  linkedInvoices: InvoiceRow[];
  /**
   * Recent ticket-sales snapshots (ascending) used by the new pacing
   * chart that sits inside the Meta sub-panel of the Reporting tab.
   * Empty array = no snapshots yet (Eventbrite not connected, sync
   * hasn't run, or migration 029 not applied) — the card renders its
   * connect-ticketing empty state.
   */
  ticketSnapshots: PacingSnapshot[];
  /**
   * Pre-fetched Eventbrite link + connection + latest snapshot
   * summary for the live block at the top of the page. Server-built
   * via `getEventTicketingSummary`. Empty/null fields mean "render
   * the connect / link CTA instead of the live numbers".
   */
  ticketingSummary: EventTicketingSummary;
}

/**
 * Client-side event hub. The parent server component prefetches the event,
 * its linked drafts, and the current user, and resolves the active tab from
 * the URL. This component owns mutations (delete, draft handoff) and the
 * local state needed for them; tab state lives in the URL.
 */
export function EventDetail({
  event,
  drafts,
  userId,
  activeTab,
  plan,
  planDays,
  keyMoments,
  initialShare,
  initialTicketsSold,
  planTickets,
  linkedQuote,
  linkedInvoices,
  ticketSnapshots,
  ticketingSummary,
}: Props) {
  // Plan-side cumulative wins over the manual override on the report —
  // resolved here so the Tickets sold StatCard, the read-only panel
  // mode, and the InternalEventReport's `event.ticketsSold` all see the
  // same number on first paint. See lib/db/ad-plans-server.ts JSDoc.
  const resolvedTicketsSold =
    planTickets?.value ?? initialTicketsSold ?? null;
  const resolvedTicketsSource: "plan" | "manual" | null = planTickets
    ? "plan"
    : initialTicketsSold != null
      ? "manual"
      : null;
  const resolvedTicketsAsOf = planTickets?.asOfDay ?? null;
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Optimistic mirror of event.favourite. Toggled instantly on click;
  // reverts on persist error so the UI never lies for long.
  const [favourite, setFavouriteLocal] = useState(event.favourite);
  const [favWorking, setFavWorking] = useState(false);
  // Sample now once at mount via lazy initializer to keep the days-until
  // pill stable across re-renders + satisfy React 19 effect purity.
  const [now] = useState(() => new Date());
  const daysUntil = fmtDaysUntilEvent(event.event_date, now);

  /**
   * Engagement type discriminator (migration 027). Brand campaigns hide
   * the venue / presale / ticket panels and the Plan tab, and surface a
   * minimal objective + budget + window summary in their place.
   */
  const isBrand = event.kind === "brand_campaign";

  const handleToggleFavourite = async () => {
    if (favWorking) return;
    const next = !favourite;
    setFavouriteLocal(next);
    setFavWorking(true);
    try {
      await toggleFavourite(event.id, next);
      router.refresh();
    } catch (err) {
      setFavouriteLocal(!next);
      const msg =
        err instanceof Error ? err.message : "Failed to update favourite.";
      setError(msg);
    } finally {
      setFavWorking(false);
    }
  };

  const handleDelete = async () => {
    setWorking(true);
    setError(null);
    try {
      await deleteEventRow(event.id);
      router.push("/events");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete event.";
      setError(msg);
      setWorking(false);
      setConfirmDelete(false);
    }
  };

  /**
   * Event → Creator handoff.
   * Creates a fresh draft via the existing creator helpers (untouched), then
   * sets campaign_drafts.event_id via linkDraftToEvent so the row carries the
   * event context. Route includes ?eventId=... as a second carrier so the
   * wizard can pick it up in a future patch without changing it today.
   */
  const handleOpenCreator = async () => {
    setCreatingDraft(true);
    setError(null);
    try {
      const draft = createDefaultDraft();
      await saveDraftToDb(draft, userId);
      await linkDraftToEvent(draft.id, event.id);
      router.push(`/campaign/${draft.id}?eventId=${event.id}`);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to open creator.";
      setError(msg);
      setCreatingDraft(false);
    }
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={handleToggleFavourite}
              disabled={favWorking}
              aria-label={favourite ? "Unfavourite event" : "Favourite event"}
              aria-pressed={favourite}
              title={favourite ? "Unfavourite" : "Favourite"}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <Star
                className={`h-4 w-4 ${
                  favourite ? "fill-amber-400 text-amber-400" : ""
                }`}
              />
            </button>
            <span className="truncate">{event.name}</span>
            <KindBadge kind={event.kind} />
            {daysUntil && !isBrand && (
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-normal tracking-normal ${
                  daysUntil.isPast
                    ? "border-border text-muted-foreground"
                    : "border-border-strong text-foreground"
                }`}
              >
                {daysUntil.label}
              </span>
            )}
            {linkedQuote && (
              <Link
                href={`/invoicing/quotes/${linkedQuote.id}`}
                className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-normal tracking-normal text-muted-foreground hover:border-border-strong hover:text-foreground"
                title="View originating quote"
              >
                From quote {linkedQuote.quote_number}
              </Link>
            )}
          </span>
        }
        description={
          event.client?.name
            ? `${event.client.name} · ${event.status.replace("_", " ")}`
            : event.status.replace("_", " ")
        }
        actions={
          <>
            {event.client && (
              <Link href={`/clients/${event.client.id}`}>
                <Button variant="outline" size="sm">
                  <ExternalLink className="h-3.5 w-3.5" />
                  View client
                </Button>
              </Link>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/events/${event.id}/edit`)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            {confirmDelete ? (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={working}
                >
                  Confirm delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={working}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={working}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <Link
            href="/events"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            All events
          </Link>

          {error && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/*
            Eventbrite block sits above the tabs so it's visible
            regardless of which tab the user lands on. Brand
            campaigns hide it (no tickets concept). The live block
            handles its own empty / not-linked / linked states; the
            link panel is only shown when a connection exists but
            the event isn't bound yet (or the operator clicks
            "Change" on the linked-state summary).
          */}
          {!isBrand && event.client_id && (
            <div className="space-y-3">
              <EventbriteLiveBlock
                eventId={event.id}
                clientId={event.client_id}
                fallbackCapacity={event.capacity}
                initialLink={ticketingSummary.link}
                initialConnection={ticketingSummary.connection}
                initialLatestSnapshot={ticketingSummary.latestSnapshot}
              />
              <EventbriteLinkPanel
                eventId={event.id}
                clientId={event.client_id}
                availableConnections={
                  ticketingSummary.availableConnections
                }
                existingLink={ticketingSummary.link}
              />
            </div>
          )}

          <EventDetailTabs
            active={activeTab}
            campaignsCount={drafts.length}
            eventKind={event.kind}
          />

          {/* ───── Overview ───── */}
          <TabPanel active={activeTab === "overview"}>
            <div className="space-y-6">
              {!isBrand && event.client_id && (
                // DailyTracker sits at the top of Overview, directly
                // below the EventbriteLiveBlock above the tabs. It
                // handles its own empty state (no event_code AND no
                // Eventbrite link) so we only gate on isBrand here —
                // matches the same gating as the live block.
                <DailyTracker
                  eventId={event.id}
                  hasMetaScope={Boolean(
                    event.event_code &&
                      event.client?.meta_ad_account_id,
                  )}
                  hasEventbriteLink={Boolean(ticketingSummary.link)}
                />
              )}
              {isBrand ? (
                <BrandCampaignSummary event={event} />
              ) : (
                <MilestoneTimeline event={event} />
              )}
              <OverviewSection event={event} />
              {!isBrand && (
                <>
                  <VenueSection event={event} />
                  <EventVenuePanel
                    eventId={event.id}
                    initialVenueId={
                      (event as unknown as { venue_id: string | null })
                        .venue_id ?? null
                    }
                    fallbackName={event.venue_name ?? null}
                    fallbackCity={event.venue_city ?? null}
                  />
                  <EventArtistRosterPanel eventId={event.id} />
                  <DatesSection event={event} />
                </>
              )}
              <LinksSection event={event} />
              <GoogleDriveCard
                eventId={event.id}
                eventName={event.name}
                clientName={event.client?.name ?? null}
                folderId={event.google_drive_folder_id ?? null}
                folderUrl={event.google_drive_folder_url ?? null}
              />
              <PlatformConfigCard
                eventId={event.id}
                initialEventTikTokAccountId={event.tiktok_account_id ?? null}
                clientTikTokAccountId={
                  event.client?.tiktok_account_id ?? null
                }
                initialEventGoogleAdsAccountId={
                  event.google_ads_account_id ?? null
                }
                clientGoogleAdsAccountId={
                  event.client?.google_ads_account_id ?? null
                }
                metaAdAccount={{
                  // Events don't carry their own meta_ad_account_id
                  // override yet, so the resolved value is always the
                  // client-level one (inherited).
                  value: event.client?.meta_ad_account_id ?? null,
                  inherited: Boolean(event.client?.meta_ad_account_id),
                }}
                driveFolderUrl={event.google_drive_folder_url ?? null}
              />
              <EventInvoicingPanel
                quote={linkedQuote}
                invoices={linkedInvoices}
              />
              {event.notes && <NotesSection notes={event.notes} />}
            </div>
          </TabPanel>

          {/* ───── Plan ─────
              Brand campaigns don't have a presale grid — the tab is
              hidden by EventDetailTabs above. The panel still renders
              this guard in case the user lands on /events/[id]?tab=plan
              directly (deep link or stale bookmark). */}
          {!isBrand && (
            <TabPanel active={activeTab === "plan"}>
              <EventPlanTab
                event={event}
                plan={plan}
                initialDays={planDays}
                initialKeyMoments={keyMoments}
              />
            </TabPanel>
          )}

          {/* ───── Campaigns ───── */}
          <TabPanel active={activeTab === "campaigns"}>
            <div className="space-y-6">
              {/*
                Live performance for every Meta campaign whose name
                contains this event's event_code. Sits above the
                actions + draft list so the question "how is the
                campaign doing?" is answerable before "what drafts do
                I have?". The panel handles its own empty / no-code /
                no-account states inline so the parent doesn't need
                to gate it.
              */}
              <LinkedCampaignsPerformance
                eventId={event.id}
                hasEventCode={Boolean(event.event_code)}
              />

              <section className="rounded-md border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0">
                    <h2 className="font-heading text-base tracking-wide">
                      Campaign actions
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Start a new Meta campaign pre-linked to this event, or
                      jump back into the library to find an existing draft.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      onClick={handleOpenCreator}
                      disabled={creatingDraft}
                      size="sm"
                    >
                      {creatingDraft ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Megaphone className="h-3.5 w-3.5" />
                      )}
                      Open campaign creator
                    </Button>
                    <Link href="/">
                      <Button variant="outline" size="sm">
                        All campaigns
                      </Button>
                    </Link>
                  </div>
                </div>
              </section>

              <section className="rounded-md border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-heading text-base tracking-wide">
                    Linked campaigns
                    {drafts.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {drafts.length}
                      </span>
                    )}
                  </h2>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleOpenCreator}
                    disabled={creatingDraft}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </Button>
                </div>
                {drafts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No campaigns linked yet. Use &ldquo;Open campaign
                    creator&rdquo; above to start one.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {drafts.map((d) => (
                      <Link
                        key={d.id}
                        href={`/campaign/${d.id}`}
                        className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 transition-colors hover:border-border-strong"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {d.name ?? "Untitled campaign"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {d.objective ?? "—"} ·{" "}
                            {new Date(d.updated_at).toLocaleDateString(
                              "en-GB",
                              { day: "numeric", month: "short" },
                            )}
                          </p>
                        </div>
                        <StatusPill status={d.status} kind="draft" />
                      </Link>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </TabPanel>

          {/* ───── Reporting ───── */}
          <TabPanel active={activeTab === "reporting"}>
            <div className="space-y-6">
              {!isBrand && (
                <TicketsSoldPanel
                  eventId={event.id}
                  initialTicketsSold={initialTicketsSold}
                  planTickets={planTickets}
                />
              )}

              <ShareReportControls
                eventId={event.id}
                initialShare={initialShare}
              />

              {/*
                Per-channel reporting sub-tabs (Meta / TikTok / Google
                Ads). Meta is the existing live report; TikTok and
                Google Ads are scaffolds rendered by their own
                placeholder components until the OAuth + insights flows
                land. The Meta panel keeps its own card chrome so it
                nests cleanly inside the Reporting tab's space-y-6
                column without the report's max-w-6xl fighting the
                dashboard's chrome.
              */}
              <EventReportingTabs
                eventId={event.id}
                clientId={event.client_id}
                initialTikTokAccountId={event.tiktok_account_id ?? null}
                // Slice 4 doesn't yet prefetch the plan id server-side
                // (no lib/db helper landed in this scaffold) — pass null
                // so the Google Ads tab renders the "create plan" CTA.
                // Once Slice 5 wires the prefetch, swap to the resolved
                // google_ad_plans row id here.
                initialGoogleAdsPlanId={null}
                metaPanel={
                  <div className="space-y-6">
                    <section className="rounded-md border border-border bg-card p-5">
                      <div className="mb-4 flex items-start gap-3">
                        <BarChart3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        <div className="min-w-0">
                          <h2 className="font-heading text-base tracking-wide">
                            Live report
                          </h2>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Same view your client sees on the public share URL,
                            pulled fresh from Meta and cached for 5 minutes per
                            timeframe.
                          </p>
                        </div>
                      </div>
                      <InternalEventReport
                        eventId={event.id}
                        event={{
                          name: event.name,
                          venueName: event.venue_name,
                          venueCity: event.venue_city,
                          venueCountry: event.venue_country,
                          eventDate: event.event_date,
                          eventStartAt: event.event_start_at,
                          paidMediaBudget: event.budget_marketing,
                          ticketsSold: resolvedTicketsSold,
                          ticketsSoldSource: resolvedTicketsSource,
                          ticketsSoldAsOf: resolvedTicketsAsOf,
                        }}
                      />
                    </section>
                    {/*
                      Ticket pacing card — additive, never replaces
                      TicketsSoldPanel above. Renders the empty
                      state with a deep-link to the client's
                      ticketing settings when no snapshots exist.
                      Only shown for kind='event'; brand campaigns
                      have no capacity / pacing concept.
                    */}
                    {!isBrand && event.client_id && (
                      <TicketPacingCard
                        snapshots={ticketSnapshots}
                        capacity={event.capacity}
                        planLatest={planTickets?.value ?? null}
                        clientId={event.client_id}
                      />
                    )}
                  </div>
                }
              />

              <section className="rounded-md border border-border bg-card p-5">
                <h2 className="font-heading text-base tracking-wide mb-3">
                  Linked campaigns
                  {drafts.length > 0 && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {drafts.length}
                    </span>
                  )}
                </h2>
                {drafts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No linked campaigns to report on yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {drafts.map((d) => (
                      <li
                        key={d.id}
                        className="flex items-center justify-between gap-4 rounded-md px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {d.name ?? "Untitled campaign"}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {d.objective ?? "—"}
                          </p>
                        </div>
                        <StatusPill status={d.status} kind="draft" />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </TabPanel>

          {/* ───── Activity ─────
              News, Spotify releases, and weather forecast for this
              event. Each source is independently TTL-cached on the
              server (news 6h / releases 24h / weather 1h). The card
              gracefully degrades when artists / venue coords are
              missing — the whole panel never 500s on a single
              upstream failure. */}
          {/* ───── Active Creatives ─────
              Live (no cache) per-event view of every ACTIVE Meta
              ad, grouped by creative_id so one card represents one
              creative even when it's deployed across several ad
              sets / campaigns. Concurrency-capped fetch on the
              server side; sort + refresh on the client. */}
          <TabPanel active={activeTab === "active-creatives"}>
            <EventActiveCreativesPanel eventId={event.id} />
          </TabPanel>

          <TabPanel active={activeTab === "activity"}>
            <EventActivityPanel eventId={event.id} />
          </TabPanel>
        </div>
      </main>
    </>
  );
}

// ─── Section components ──────────────────────────────────────────────────────

/**
 * Brand-campaign-specific summary card. Shown in place of
 * `MilestoneTimeline` (which is presale-flavoured) for kind='brand_campaign'
 * rows. Surfaces the three things that actually matter for an awareness
 * push: the objective, the marketing budget, and the start–end window.
 */
function BrandCampaignSummary({ event }: { event: EventWithClient }) {
  const start = event.event_start_at;
  const end = event.campaign_end_at;
  const window =
    start && end
      ? `${fmtShort(start)} → ${fmtShort(end)}`
      : start
        ? `From ${fmtShort(start)}`
        : end
          ? `Until ${fmtShort(end)}`
          : "Not scheduled";

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-4">
        Brand campaign
      </h2>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-3">
        <DetailRow label="Objective" value={event.objective ?? "—"} />
        <DetailRow
          label="Budget"
          value={
            event.budget_marketing != null
              ? BRAND_GBP_FMT.format(event.budget_marketing)
              : "—"
          }
        />
        <DetailRow label="Window" value={window} />
      </dl>
    </section>
  );
}

function OverviewSection({ event }: { event: EventWithClient }) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-3">Overview</h2>
      <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <DetailRow
          label="Client"
          value={
            event.client ? (
              <Link
                href={`/clients/${event.client.id}`}
                className="underline-offset-2 hover:underline"
              >
                {event.client.name}
              </Link>
            ) : (
              "—"
            )
          }
        />
        <DetailRow label="Slug" value={event.slug} />
        <DetailRow label="Event code" value={event.event_code ?? "—"} />
        <DetailRow
          label="Capacity"
          value={
            event.capacity != null ? event.capacity.toLocaleString() : "—"
          }
        />
        <DetailRow
          label="Genres"
          value={event.genres.length > 0 ? event.genres.join(", ") : "—"}
        />
        <DetailRow
          label="Marketing budget"
          value={
            event.budget_marketing != null
              ? `£${event.budget_marketing.toLocaleString()}`
              : "—"
          }
        />
      </dl>
    </section>
  );
}

function VenueSection({ event }: { event: EventWithClient }) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-3">Venue</h2>
      <dl className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
        <DetailRow label="Venue" value={event.venue_name ?? "—"} />
        <DetailRow label="City" value={event.venue_city ?? "—"} />
        <DetailRow label="Country" value={event.venue_country ?? "—"} />
        <DetailRow label="Timezone" value={event.event_timezone ?? "—"} />
      </dl>
    </section>
  );
}

function DatesSection({ event }: { event: EventWithClient }) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-3">
        Dates &amp; milestones
      </h2>
      <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <DetailRow label="Event date" value={fmtDate(event.event_date)} />
        <DetailRow
          label="Doors / start"
          value={fmtDateTime(event.event_start_at)}
        />
        <DetailRow
          label="Announcement"
          value={fmtDateTime(event.announcement_at)}
        />
        <DetailRow label="Presale" value={fmtDateTime(event.presale_at)} />
        <DetailRow
          label="General sale"
          value={fmtDateTime(event.general_sale_at)}
        />
      </dl>
    </section>
  );
}

function LinksSection({ event }: { event: EventWithClient }) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-3">Links</h2>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <DetailRow
          label="Ticket URL"
          value={
            event.ticket_url ? (
              <a
                href={event.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline break-all"
              >
                {event.ticket_url}
              </a>
            ) : (
              "—"
            )
          }
        />
        <DetailRow
          label="Signup URL"
          value={
            event.signup_url ? (
              <a
                href={event.signup_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline break-all"
              >
                {event.signup_url}
              </a>
            ) : (
              "—"
            )
          }
        />
      </dl>
    </section>
  );
}

function NotesSection({ notes }: { notes: string }) {
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-3">Description</h2>
      <p className="text-sm whitespace-pre-wrap">{notes}</p>
    </section>
  );
}

// ─── Milestone timeline ──────────────────────────────────────────────────────

function MilestoneTimeline({ event }: { event: EventWithClient }) {
  // useState lazy initializer is the React-sanctioned escape hatch for
  // reading from Date on mount without breaking the purity rule.
  const [now] = useState(() => Date.now());

  // Common shape: announcement is the only "go live" date and there's
  // no separate presale/GA window. Show General sale at announcement_at
  // so the timeline reads end-to-end instead of leaving "Not set" gaps.
  // UI inference only — persisted general_sale_at stays null.
  const inferGeneralSaleFromAnnouncement =
    event.presale_at == null &&
    event.general_sale_at == null &&
    event.announcement_at != null;

  const items: Array<{
    label: string;
    iso: string | null;
    date: Date | null;
    sublabel?: string;
  }> = [
    {
      label: "Announcement",
      iso: event.announcement_at,
      date: event.announcement_at ? new Date(event.announcement_at) : null,
    },
    {
      label: "Presale",
      iso: event.presale_at,
      date: event.presale_at ? new Date(event.presale_at) : null,
    },
    inferGeneralSaleFromAnnouncement
      ? {
          label: "General sale",
          iso: event.announcement_at,
          date: new Date(event.announcement_at as string),
          sublabel: "(on announcement)",
        }
      : {
          label: "General sale",
          iso: event.general_sale_at,
          date: event.general_sale_at ? new Date(event.general_sale_at) : null,
        },
    {
      label: "Doors",
      iso: event.event_start_at ?? event.event_date,
      date: event.event_start_at
        ? new Date(event.event_start_at)
        : event.event_date
          ? new Date(event.event_date + "T00:00:00")
          : null,
    },
  ];

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-4">
        Milestone timeline
      </h2>
      <ol className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map((item) => {
          const isDone = item.date != null && item.date.getTime() <= now;
          const Icon = isDone ? CheckCircle2 : Circle;
          return (
            <li
              key={item.label}
              className="flex flex-col items-start gap-1.5 border-l-2 border-border pl-3"
            >
              <div className="flex items-center gap-1.5">
                <Icon
                  className={`h-3.5 w-3.5 ${
                    isDone ? "text-foreground" : "text-muted-foreground/60"
                  }`}
                />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {item.label}
                </span>
              </div>
              <p
                className={`text-sm ${
                  item.date ? "text-foreground" : "text-muted-foreground/60"
                }`}
              >
                {item.iso ? fmtShort(item.iso) : "Not set"}
              </p>
              {item.sublabel && (
                <p className="text-[10px] text-muted-foreground/80">
                  {item.sublabel}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─── Detail row helper ───────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words">{value}</dd>
    </div>
  );
}
