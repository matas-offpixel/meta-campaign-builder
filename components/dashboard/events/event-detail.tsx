"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  getEventById,
  deleteEventRow,
  type EventWithClient,
} from "@/lib/db/events";

interface Props {
  eventId: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function EventDetail({ eventId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState<EventWithClient | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const row = await getEventById(eventId);
      setEvent(row);
      setLoading(false);
    }
    load();
  }, [eventId]);

  const handleDelete = async () => {
    if (!event) return;
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

  if (loading) {
    return (
      <>
        <PageHeader title="Event" />
        <main className="flex-1 flex items-center justify-center py-20">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </main>
      </>
    );
  }

  if (!event) {
    return (
      <>
        <PageHeader title="Event not found" />
        <main className="flex-1 flex items-center justify-center py-20">
          <Link
            href="/events"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to events
          </Link>
        </main>
      </>
    );
  }

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
            <Button
              variant="outline"
              onClick={() => router.push(`/events/${event.id}/edit`)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
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

          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide mb-3">
              Overview
            </h2>
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
                value={event.capacity != null ? event.capacity.toLocaleString() : "—"}
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

          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide mb-3">
              Venue
            </h2>
            <dl className="grid grid-cols-1 md:grid-cols-4 gap-x-6 gap-y-3 text-sm">
              <DetailRow label="Venue" value={event.venue_name ?? "—"} />
              <DetailRow label="City" value={event.venue_city ?? "—"} />
              <DetailRow label="Country" value={event.venue_country ?? "—"} />
              <DetailRow label="Timezone" value={event.event_timezone ?? "—"} />
            </dl>
          </section>

          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide mb-3">
              Dates & milestones
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
              <DetailRow
                label="Presale"
                value={fmtDateTime(event.presale_at)}
              />
              <DetailRow
                label="General sale"
                value={fmtDateTime(event.general_sale_at)}
              />
            </dl>
          </section>

          <section className="rounded-md border border-border bg-card p-5">
            <h2 className="font-heading text-base tracking-wide mb-3">
              Links
            </h2>
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

          {event.notes && (
            <section className="rounded-md border border-border bg-card p-5">
              <h2 className="font-heading text-base tracking-wide mb-3">
                Notes
              </h2>
              <p className="text-sm whitespace-pre-wrap">{event.notes}</p>
            </section>
          )}
        </div>
      </main>
    </>
  );
}

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
