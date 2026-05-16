"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Archive,
  Trash2,
  Rocket,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KindBadge } from "@/components/dashboard/_shared/kind-badge";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  setClientStatus,
  deleteClientRow,
  type ClientRow,
} from "@/lib/db/clients";
import { type EventWithClient } from "@/lib/db/events";
import { VerifyMetaConnection } from "./verify-meta-connection";
import { PlatformAccountsCard } from "./platform-accounts-card";
import { BillingSection } from "./billing-section";
import { ClientShareLinkCard } from "./client-share-link-card";
import { RefreshAllSpendButton } from "./refresh-all-spend-button";
import { NewEventKindModal } from "./new-event-kind-modal";
import { ClientInvoiceTab } from "@/components/invoicing/client-invoice-tab";
import { TicketingConnectionsPanel } from "@/components/dashboard/clients/ticketing-connections-panel";
import { D2CConnectionsPanel } from "@/components/dashboard/clients/d2c-connections-panel";
import { D2CTemplateEditor } from "@/components/dashboard/clients/d2c-template-editor";
import { ClientPortal } from "@/components/share/client-portal";
import type {
  AdditionalSpendRow,
  DailyEntry,
  DailyRollupRow,
  PortalClient,
  PortalEvent,
  WeeklyTicketSnapshotRow,
} from "@/lib/db/client-portal-server";
import {
  CreativeTemplatesPanel,
  type ProviderStatus,
} from "@/components/dashboard/clients/creative-templates-panel";
import {
  ConnectedIntegrationsPill,
  type IntegrationStatus,
} from "@/components/dashboard/clients/connected-integrations-pill";
import type {
  BillingMode,
  InvoiceWithRefs,
  QuoteRow,
} from "@/lib/types/invoicing";
import type { SettlementTiming } from "@/lib/pricing/calculator";
import type { LatestSnapshot } from "@/lib/db/client-snapshots-server";
import type { TicketingConnection } from "@/lib/ticketing/types";
import type { D2CConnection, D2CTemplate } from "@/lib/d2c/types";
import type { CreativeTemplate } from "@/lib/creatives/types";

type ClientTab =
  | "overview"
  | "events"
  | "ticketing"
  | "d2c"
  | "creatives"
  | "invoicing";

/**
 * Connection rows arrive from the server with credentials redacted.
 * Mirror the per-panel `ConnectionRow` shape locally so we can pass
 * them straight through without touching the panel components (which
 * already enforce `credentials: null` on their own props).
 */
type SafeTicketingConnection = Omit<TicketingConnection, "credentials"> & {
  credentials: null;
};
type SafeD2CConnection = Omit<D2CConnection, "credentials"> & {
  credentials: null;
};

interface TicketingLinkDiscoveryStats {
  totalEvents: number;
  linkedEvents: number;
  unlinkedEvents: number;
}

interface Props {
  client: ClientRow;
  events: EventWithClient[];
  clientInvoices: InvoiceWithRefs[];
  clientQuotes: QuoteRow[];
  defaults: {
    upfront_pct: number;
    settlement_timing: SettlementTiming;
  };
  /**
   * Pre-fetched client-scoped share row (token + enabled flag) so the
   * "Share ticket input link" card lands with correct state on first
   * paint, no client round-trip.
   */
  initialShare: { token: string; enabled: boolean } | null;
  /**
   * Latest weekly snapshot per event_id (RLS-scoped to the current
   * user). Used by the topline stats panel + per-event metrics table
   * to surface client-reported tickets_sold and revenue without a
   * client-side fetch.
   */
  latestSnapshots: Record<string, LatestSnapshot>;
  /**
   * Pre-fetched ticketing connections for this client (credentials
   * redacted server-side). Drives the Ticketing tab and the
   * Eventbrite slot of the integrations pill on the Overview tab.
   */
  ticketingConnections: SafeTicketingConnection[];
  ticketingLinkDiscoveryStats: TicketingLinkDiscoveryStats;
  /**
   * Subset of event_ticketing_links that have a non-null external_api_base
   * (migration 083). Surfaced in the Ticketing tab so the operator can see
   * which events are hitting a non-default 4TheFans booking site.
   */
  ticketingCustomApiBaseLinks?: Array<{
    eventName: string;
    externalEventId: string;
    apiBase: string;
  }>;
  /**
   * Pre-fetched D2C connections for this client (credentials
   * redacted). Drives the D2C tab and Mailchimp/Klaviyo/Bird/Firetext
   * slots of the integrations pill.
   */
  d2cConnections: SafeD2CConnection[];
  /**
   * D2C message templates scoped to this client (email / SMS / WA).
   */
  d2cTemplates: D2CTemplate[];
  /**
   * All creative templates owned by the user. Templates are not yet
   * client-scoped (migration 031 doesn't carry a client_id column),
   * so the list is rendered verbatim per the standalone /creatives
   * /templates page. The Creatives Templates tab still acts as a
   * shortcut from the client view.
   */
  creativeTemplates: CreativeTemplate[];
  /**
   * Per-provider enable flags for the creatives tab. Read on the
   * server (`isCanvaEnabled()` etc.) so the client component stays
   * env-free.
   */
  creativeProviderStatus: ProviderStatus[];
  /**
   * `FEATURE_BANNERBEAR` plus `clients.bannerbear_enabled` for this client.
   */
  canRenderBannerbear: boolean;
  /**
   * Initial active tab from the URL `?tab=` param. Defaults to
   * "overview" when absent or unknown so deep links from the sidebar
   * (no query) still land sensibly.
   */
  initialTab?: ClientTab;
  /**
   * Client-portal payload — drives the Events tab's venue-grouped
   * rendering via `<ClientPortal isInternal />`. Null when the
   * server loader failed (no events, or transient Supabase error);
   * the Events tab falls back to the legacy flat table in that
   * case so admins always have a path to the New event button.
   */
  portal:
    | {
        client: PortalClient;
        events: PortalEvent[];
        londonOnsaleSpend: number | null;
        londonPresaleSpend: number | null;
        dailyEntries: DailyEntry[];
        dailyRollups: DailyRollupRow[];
        additionalSpend: AdditionalSpendRow[];
        weeklyTicketSnapshots: WeeklyTicketSnapshotRow[];
        trendTicketSnapshots: WeeklyTicketSnapshotRow[];
      }
    | null;
  hasTaggedEvents?: boolean;
}

/**
 * Client-side detail view. Initial row + events are server-fetched by the
 * parent route and passed in as props. This component owns mutations
 * (archive / unarchive / delete) and the local state needed to reflect
 * status changes without a full page refetch.
 */
export function ClientDetail({
  client: initial,
  events,
  clientInvoices,
  clientQuotes,
  defaults,
  initialShare,
  latestSnapshots,
  ticketingConnections,
  ticketingLinkDiscoveryStats,
  ticketingCustomApiBaseLinks,
  d2cConnections,
  d2cTemplates,
  creativeTemplates,
  creativeProviderStatus,
  canRenderBannerbear,
  initialTab = "overview",
  portal,
  hasTaggedEvents = false,
}: Props) {
  const router = useRouter();
  const [client, setClient] = useState<ClientRow>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ClientTab>(initialTab);
  const [pickerOpen, setPickerOpen] = useState(false);

  const invoiceCount = clientInvoices.length;
  const ticketingCount = ticketingConnections.length;
  const d2cCount = d2cConnections.length;
  const creativeCount = creativeTemplates.length;

  // Surface a one-line "Connected: Eventbrite ✓ / Mailchimp — / …"
  // pill on the Overview tab. Each slot maps to one provider name we
  // care about; the connected flag is true when at least one row of
  // that provider exists. Unsupported providers in the regex below
  // (e.g. fourthefans, bird) still display via the connections list
  // for completeness without polluting the at-a-glance pill.
  const integrations: IntegrationStatus[] = [
    {
      label: "Eventbrite",
      connected: ticketingConnections.some(
        (c) => c.provider === "eventbrite",
      ),
    },
    {
      label: "Mailchimp",
      connected: d2cConnections.some((c) => c.provider === "mailchimp"),
    },
    {
      label: "Klaviyo",
      connected: d2cConnections.some((c) => c.provider === "klaviyo"),
    },
    {
      label: "Canva",
      connected: creativeTemplates.some((t) => t.provider === "canva"),
      hint: "Canva templates registered for this user.",
    },
  ];

  const handleArchive = async () => {
    setWorking(true);
    try {
      await setClientStatus(client.id, "archived");
      setClient({ ...client, status: "archived" });
    } finally {
      setWorking(false);
    }
  };

  const handleUnarchive = async () => {
    setWorking(true);
    try {
      await setClientStatus(client.id, "active");
      setClient({ ...client, status: "active" });
    } finally {
      setWorking(false);
    }
  };

  const handleDelete = async () => {
    setWorking(true);
    setError(null);
    try {
      await deleteClientRow(client.id);
      router.push("/clients");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete client.";
      setError(msg);
      setWorking(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <PageHeader
        title={client.name}
        description={`${client.primary_type}${
          client.types.length > 1
            ? " · " + client.types.filter((t) => t !== client.primary_type).join(", ")
            : ""
        }`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => router.push(`/clients/${client.id}/dashboard`)}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Dashboard
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push(`/clients/${client.id}/rollout`)}
            >
              <Rocket className="h-3.5 w-3.5" />
              Rollout
            </Button>
            {hasTaggedEvents && (
              <Button
                variant="outline"
                onClick={() =>
                  router.push(`/clients/${client.id}/dashboard?tab=insights`)
                }
              >
                <Sparkles className="h-3.5 w-3.5" />
                Creative Patterns
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => router.push(`/clients/${client.id}/edit`)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            {client.status === "archived" ? (
              <Button variant="ghost" onClick={handleUnarchive} disabled={working}>
                Unarchive
              </Button>
            ) : (
              <Button variant="ghost" onClick={handleArchive} disabled={working}>
                <Archive className="h-3.5 w-3.5" />
                Archive
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={working}
                >
                  Confirm delete
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmDelete(false)}
                  disabled={working}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
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
            href="/clients"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            All clients
          </Link>

          {error && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <Tabs
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "events", label: "Events", count: events.length },
              {
                id: "ticketing",
                label: "Ticketing",
                count: ticketingCount,
              },
              { id: "d2c", label: "D2C", count: d2cCount },
              {
                id: "creatives",
                label: "Creatives Templates",
                count: creativeCount,
              },
              { id: "invoicing", label: "Invoicing", count: invoiceCount },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as ClientTab)}
          />

          <TabPanel active={activeTab === "overview"}>
          <div className="space-y-6">
          <ConnectedIntegrationsPill items={integrations} />
          {client.tiktok_account_id && (
            <section className="rounded-md border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-heading text-base tracking-wide">
                    TikTok campaigns
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Start TikTok drafts for this client in the separate TikTok
                    campaign library.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/tiktok?client=${encodeURIComponent(client.id)}`}>
                    <Button variant="outline" size="sm">
                      View TikTok campaigns
                    </Button>
                  </Link>
                  <Link href={`/tiktok/new?client=${encodeURIComponent(client.id)}`}>
                    <Button size="sm">New TikTok campaign</Button>
                  </Link>
                </div>
              </div>
            </section>
          )}
          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide mb-3">
              Details
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Slug" value={client.slug} />
              <DetailRow label="Status" value={client.status} />
              <DetailRow label="Primary type" value={client.primary_type} />
              <DetailRow
                label="All types"
                value={client.types.length > 0 ? client.types.join(", ") : "—"}
              />
              <DetailRow
                label="Instagram"
                value={
                  client.instagram_handle
                    ? `@${client.instagram_handle}`
                    : "—"
                }
              />
              <DetailRow
                label="TikTok"
                value={
                  client.tiktok_handle ? `@${client.tiktok_handle}` : "—"
                }
              />
              <DetailRow
                label="Facebook page"
                value={client.facebook_page_handle ?? "—"}
              />
              <DetailRow
                label="TikTok ad account"
                value={client.tiktok_ad_account_id ?? "—"}
              />
              <DetailRow
                label="Google Ads customer"
                value={client.google_ads_customer_id ?? "—"}
              />
              <DetailRow
                label="Drive folder"
                value={client.google_drive_folder_url ?? "—"}
              />
            </dl>
            {client.notes && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Notes
                </p>
                <p className="text-sm whitespace-pre-wrap">{client.notes}</p>
              </div>
            )}
          </section>

          <section className="rounded-md border border-border bg-card p-5 space-y-4">
            <h2 className="font-heading text-base tracking-wide">
              Meta Business assets
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
              <DetailRow
                label="Business ID"
                value={client.meta_business_id ?? "—"}
              />
              <DetailRow
                label="Ad Account ID"
                value={client.meta_ad_account_id ?? "—"}
              />
              <DetailRow
                label="Pixel ID"
                value={client.meta_pixel_id ?? "—"}
              />
            </dl>
            <div className="pt-4 border-t border-border">
              <VerifyMetaConnection
                clientId={client.id}
                hasAnyMetaId={Boolean(
                  client.meta_business_id ??
                    client.meta_ad_account_id ??
                    client.meta_pixel_id,
                )}
              />
            </div>
          </section>

          <PlatformAccountsCard
            clientId={client.id}
            initialTikTokAccountId={client.tiktok_account_id ?? null}
            initialGoogleAdsAccountId={client.google_ads_account_id ?? null}
            metaBusinessId={client.meta_business_id ?? null}
            metaAdAccountId={client.meta_ad_account_id ?? null}
            metaPixelId={client.meta_pixel_id ?? null}
          />

          <BillingSection
            clientId={client.id}
            initial={{
              billing_model:
                client.billing_model === "retainer"
                  ? "retainer"
                  : ("per_event" as BillingMode),
              custom_rate_per_ticket: client.custom_rate_per_ticket ?? null,
              custom_minimum_fee: client.custom_minimum_fee ?? null,
              retainer_monthly_fee: client.retainer_monthly_fee ?? null,
              retainer_started_at: client.retainer_started_at ?? null,
            }}
          />

          <ClientShareLinkCard
            clientId={client.id}
            initialShare={initialShare}
          />

          <ClientStatsPanel
            events={events}
            latestSnapshots={latestSnapshots}
          />
          </div>
          </TabPanel>

          <TabPanel active={activeTab === "events"}>
            {/* Events tab renders the same venue-grouped layout as
                `/clients/[id]/dashboard` (via `<ClientPortal isInternal />`)
                so operators see one source of truth for per-event
                performance rather than two diverging tables. Top
                controls (Refresh all spend, New event, View dashboard)
                stay above the venue cards. Falls back to the legacy
                flat `ClientEventsTable` when the portal loader failed
                or the client has zero events. */}
            <section className="rounded-md border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <h2 className="font-heading text-base tracking-wide">
                  Events ({events.length})
                </h2>
                <div className="flex flex-wrap items-start gap-2">
                  <Link
                    href={`/clients/${client.id}/dashboard`}
                    className="inline-flex items-center gap-1 rounded border border-border-strong bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:bg-foreground/90"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
                    View dashboard
                  </Link>
                  {hasTaggedEvents && (
                    <Link
                      href={`/clients/${client.id}/dashboard?tab=insights`}
                      className="inline-flex items-center gap-1 rounded border border-border-strong px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      Creative Patterns
                    </Link>
                  )}
                  <RefreshAllSpendButton
                    events={events.map((e) => ({
                      id: e.id,
                      event_code: e.event_code,
                    }))}
                    adAccountId={client.meta_ad_account_id ?? null}
                  />
                  {client.tiktok_account_id && (
                    <Link href={`/tiktok/new?client=${encodeURIComponent(client.id)}`}>
                      <Button size="sm" variant="outline">
                        New TikTok campaign
                      </Button>
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPickerOpen(true)}
                  >
                    New
                  </Button>
                </div>
              </div>
              {events.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No events yet for this client.
                </p>
              ) : portal ? (
                <ClientPortal
                  token=""
                  client={portal.client}
                  events={portal.events}
                  londonOnsaleSpend={portal.londonOnsaleSpend}
                  londonPresaleSpend={portal.londonPresaleSpend}
                  dailyEntries={portal.dailyEntries}
                  dailyRollups={portal.dailyRollups}
                  additionalSpend={portal.additionalSpend}
                  weeklyTicketSnapshots={portal.weeklyTicketSnapshots}
                  trendTicketSnapshots={portal.trendTicketSnapshots}
                  isInternal
                />
              ) : (
                // Portal loader failed — fall back to the legacy flat
                // table so the Events tab never renders blank.
                <ClientEventsTable
                  events={events}
                  latestSnapshots={latestSnapshots}
                />
              )}
            </section>
          </TabPanel>

          <TabPanel active={activeTab === "ticketing"}>
            <TicketingConnectionsPanel
              clientId={client.id}
              initial={ticketingConnections}
              linkDiscoveryStats={ticketingLinkDiscoveryStats}
              customApiBaseLinks={ticketingCustomApiBaseLinks}
            />
          </TabPanel>

          <TabPanel active={activeTab === "d2c"}>
            <div className="space-y-6">
              <D2CTemplateEditor
                clientId={client.id}
                initialTemplates={d2cTemplates}
                events={events.map((e) => ({ id: e.id, name: e.name }))}
              />
              <D2CConnectionsPanel
                clientId={client.id}
                initial={d2cConnections}
              />
            </div>
          </TabPanel>

          <TabPanel active={activeTab === "creatives"}>
            <CreativeTemplatesPanel
              templates={creativeTemplates}
              providerStatus={creativeProviderStatus}
              clientId={client.id}
              eventOptions={events.map((e) => ({ id: e.id, name: e.name }))}
              canRenderBannerbear={canRenderBannerbear}
            />
          </TabPanel>

          <TabPanel active={activeTab === "invoicing"}>
            <ClientInvoiceTab
              clientId={client.id}
              clientName={client.name}
              events={events.map((e) => ({
                id: e.id,
                name: e.name,
                event_date: e.event_date,
                status: e.status,
              }))}
              invoices={clientInvoices}
              quotes={clientQuotes}
              defaults={defaults}
            />
          </TabPanel>
        </div>
      </main>
      <NewEventKindModal
        open={pickerOpen}
        clientId={client.id}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words">{value}</dd>
    </div>
  );
}

// ─── Stats panel + per-event metrics table ──────────────────────────────────
//
// Both are scoped to this file because they only read the
// EventWithClient + LatestSnapshot data that already flows through
// ClientDetail's props. No new fetches, no shared state — extracting
// to their own files would just move the imports around.
//
// Spend distribution rule (matches the client portal exactly):
//   `meta_spend_cached` is a venue-level value cached by
//   /api/meta/campaign-spend onto every event row sharing the same
//   event_code. Summing it across events would N-times-count a single
//   campaign's spend. The fix is to group by event_code, take the
//   first non-null cached value per group as the campaign total, then
//   either (a) sum across groups for venue rollups or (b) divide by
//   group event_count for a per-event split.

const GBP0 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

function fmtGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP0).format(n);
}
function fmtNum(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return NUM.format(n);
}
function fmtRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}
function roasClass(n: number | null): string {
  if (n === null) return "text-muted-foreground";
  if (n >= 3) return "text-emerald-600 font-semibold";
  if (n < 1) return "text-destructive font-semibold";
  return "";
}

interface CampaignGroup {
  /** First non-null meta_spend_cached in the group (or null). */
  campaignSpend: number | null;
  /** Number of events sharing this code (>= 1). */
  eventCount: number;
}

/**
 * Build a map of (event_code → CampaignGroup). Events with a null/empty
 * event_code are placed in single-event "synthetic" groups keyed by
 * event_id, so each contributes its own (un-shared) cached spend.
 */
function buildCampaignGroups(
  events: EventWithClient[],
): Record<string, CampaignGroup> {
  const groups: Record<string, CampaignGroup> = {};
  for (const e of events) {
    const key = e.event_code?.trim() ? e.event_code.trim() : `__solo:${e.id}`;
    const existing = groups[key];
    if (!existing) {
      groups[key] = {
        campaignSpend: e.meta_spend_cached ?? null,
        eventCount: 1,
      };
    } else {
      existing.eventCount += 1;
      if (existing.campaignSpend === null && e.meta_spend_cached !== null) {
        existing.campaignSpend = e.meta_spend_cached;
      }
    }
  }
  return groups;
}

function groupKey(e: EventWithClient): string {
  return e.event_code?.trim() ? e.event_code.trim() : `__solo:${e.id}`;
}

/**
 * Resolve the tickets-sold value for an event with the same precedence
 * the portal uses: snapshot first (the client-reported figure), then
 * the manual override on the event row.
 */
function eventTickets(
  e: EventWithClient,
  snap: LatestSnapshot | undefined,
): number | null {
  return snap?.tickets_sold ?? e.tickets_sold ?? null;
}

function ClientStatsPanel({
  events,
  latestSnapshots,
}: {
  events: EventWithClient[];
  latestSnapshots: Record<string, LatestSnapshot>;
}) {
  const groups = buildCampaignGroups(events);

  let capacityTotal = 0;
  let capacityHasAny = false;
  let ticketsTotal = 0;
  let ticketsHasAny = false;
  let revenueTotal = 0;
  let revenueHasAny = false;

  for (const e of events) {
    if (e.capacity !== null) {
      capacityTotal += e.capacity;
      capacityHasAny = true;
    }
    const t = eventTickets(e, latestSnapshots[e.id]);
    if (t !== null) {
      ticketsTotal += t;
      ticketsHasAny = true;
    }
    const r = latestSnapshots[e.id]?.revenue;
    if (r !== null && r !== undefined) {
      revenueTotal += r;
      revenueHasAny = true;
    }
  }

  // Sum campaign-level spend once per group — see header rule.
  let spendTotal = 0;
  let spendHasAny = false;
  for (const g of Object.values(groups)) {
    if (g.campaignSpend !== null) {
      spendTotal += g.campaignSpend;
      spendHasAny = true;
    }
  }

  const cpt =
    spendHasAny && ticketsHasAny && ticketsTotal > 0
      ? spendTotal / ticketsTotal
      : null;
  const roas =
    spendHasAny && revenueHasAny && spendTotal > 0
      ? revenueTotal / spendTotal
      : null;

  const stats: Array<{
    label: string;
    value: string;
    valueClass?: string;
  }> = [
    {
      label: "Total Capacity",
      value: capacityHasAny ? fmtNum(capacityTotal) : "—",
    },
    {
      label: "Tickets Sold",
      value: ticketsHasAny ? fmtNum(ticketsTotal) : "—",
    },
    {
      label: "Total Revenue",
      value: revenueHasAny ? fmtGBP(revenueTotal) : "—",
    },
    {
      label: "Total Spend",
      value: spendHasAny ? fmtGBP(spendTotal) : "—",
    },
    {
      label: "Overall CPT",
      value: fmtGBP(cpt, 2),
    },
    {
      label: "Overall ROAS",
      value: fmtRoas(roas),
      valueClass: roasClass(roas),
    },
  ];

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <h2 className="font-heading text-base tracking-wide mb-3">
        Performance summary
      </h2>
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-3">
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {s.label}
            </dt>
            <dd
              className={`mt-1 font-heading text-lg tracking-wide tabular-nums ${
                s.valueClass ?? ""
              }`}
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ClientEventsTable({
  events,
  latestSnapshots,
}: {
  events: EventWithClient[];
  latestSnapshots: Record<string, LatestSnapshot>;
}) {
  const groups = buildCampaignGroups(events);

  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-2">Event</th>
            <th className="px-2 py-2 text-right">Tickets</th>
            <th className="px-2 py-2 text-right">Revenue</th>
            <th className="px-2 py-2 text-right">Total Spend</th>
            <th className="px-2 py-2 text-right">CPT</th>
            <th className="px-2 py-2 text-right">ROAS</th>
            <th className="px-2 py-2 text-right">Date</th>
            <th className="px-2 py-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => {
            const snap = latestSnapshots[ev.id];
            const group = groups[groupKey(ev)];
            const perEventSpend =
              group && group.campaignSpend !== null && group.eventCount > 0
                ? group.campaignSpend / group.eventCount
                : null;
            const tickets = eventTickets(ev, snap);
            const revenue = snap?.revenue ?? null;
            const cpt =
              perEventSpend !== null &&
              perEventSpend > 0 &&
              tickets !== null &&
              tickets > 0
                ? perEventSpend / tickets
                : null;
            const roas =
              perEventSpend !== null &&
              perEventSpend > 0 &&
              revenue !== null
                ? revenue / perEventSpend
                : null;
            return (
              <tr
                key={ev.id}
                className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
              >
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/events/${ev.id}`}
                      className="block min-w-0 flex-1 truncate hover:underline"
                    >
                      {ev.name}
                    </Link>
                    <KindBadge kind={ev.kind} />
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtNum(tickets)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtGBP(revenue)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtGBP(perEventSpend)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtGBP(cpt, 2)}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${roasClass(roas)}`}
                >
                  {fmtRoas(roas)}
                </td>
                <td className="px-2 py-2 text-right text-xs text-muted-foreground tabular-nums">
                  {ev.event_date ?? "TBD"}
                </td>
                <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                  {ev.status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
