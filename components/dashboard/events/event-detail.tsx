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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TabPanel } from "@/components/ui/tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import {
  EventDetailTabs,
  type EventTab,
} from "@/components/dashboard/events/event-detail-tabs";
import { EventPlanTab } from "@/components/dashboard/events/event-plan-tab";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { saveDraftToDb } from "@/lib/db/drafts";
import {
  deleteEventRow,
  linkDraftToEvent,
  type EventLinkedDraft,
  type EventWithClient,
} from "@/lib/db/events";
import type { AdPlan, AdPlanDay } from "@/lib/db/ad-plans";
import { fmtDate, fmtDateTime, fmtShort } from "@/lib/dashboard/format";

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
}: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        title={event.name}
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

          <EventDetailTabs active={activeTab} campaignsCount={drafts.length} />

          {/* ───── Overview ───── */}
          <TabPanel active={activeTab === "overview"}>
            <div className="space-y-6">
              <MilestoneTimeline event={event} />
              <OverviewSection event={event} />
              <VenueSection event={event} />
              <DatesSection event={event} />
              <LinksSection event={event} />
              {event.notes && <NotesSection notes={event.notes} />}
            </div>
          </TabPanel>

          {/* ───── Plan ───── */}
          <TabPanel active={activeTab === "plan"}>
            <EventPlanTab event={event} plan={plan} initialDays={planDays} />
          </TabPanel>

          {/* ───── Campaigns ───── */}
          <TabPanel active={activeTab === "campaigns"}>
            <div className="space-y-6">
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

          {/* ───── Reporting (stub) ───── */}
          <TabPanel active={activeTab === "reporting"}>
            <div className="space-y-6">
              <section className="rounded-md border border-dashed border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <BarChart3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div className="min-w-0">
                    <h2 className="font-heading text-base tracking-wide">
                      Reporting coming soon
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Live spend, ticket sales, creative performance and D2C
                      signup data for this event will live here once
                      BigQuery and Meta Insights are wired up.
                    </p>
                  </div>
                </div>
              </section>

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
        </div>
      </main>
    </>
  );
}

// ─── Section components ──────────────────────────────────────────────────────

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
      <h2 className="font-heading text-base tracking-wide mb-3">Notes</h2>
      <p className="text-sm whitespace-pre-wrap">{notes}</p>
    </section>
  );
}

// ─── Milestone timeline ──────────────────────────────────────────────────────

function MilestoneTimeline({ event }: { event: EventWithClient }) {
  // useState lazy initializer is the React-sanctioned escape hatch for
  // reading from Date on mount without breaking the purity rule.
  const [now] = useState(() => Date.now());
  const items: Array<{ label: string; iso: string | null; date: Date | null }> =
    [
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
      {
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
