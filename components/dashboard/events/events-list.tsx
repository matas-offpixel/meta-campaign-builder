"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/dashboard/page-header";
import { createClient as createSupabase } from "@/lib/supabase/client";
import { listEvents, type EventWithClient } from "@/lib/db/events";

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "sold_out"
      ? "bg-success/20 text-foreground"
      : status === "cancelled"
        ? "bg-destructive/20 text-foreground"
        : status === "completed"
          ? "bg-muted text-muted-foreground"
          : status === "on_sale"
            ? "bg-primary-light text-foreground"
            : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "TBD";
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

export function EventsList() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<EventWithClient[]>([]);

  useEffect(() => {
    async function load() {
      const supabase = createSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const rows = await listEvents(user.id);
      setEvents(rows);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <>
      <PageHeader
        title="Events"
        description="All upcoming and historical shows across clients."
        actions={
          <Button onClick={() => router.push("/events/new")}>
            <Plus className="h-4 w-4" />
            New event
          </Button>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : events.length === 0 ? (
            <div className="py-16 text-center">
              <Ticket className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium">No events yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create an event to start planning campaigns and activity.
              </p>
              <div className="mt-4">
                <Button onClick={() => router.push("/events/new")}>
                  <Plus className="h-4 w-4" />
                  New event
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {events.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/events/${ev.id}`}
                  className="block rounded-md border border-border bg-card p-4 transition-colors
                    hover:border-border-strong"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {ev.name}
                        </p>
                        <StatusPill status={ev.status} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {ev.client?.name && (
                          <span className="font-medium">
                            {ev.client.name}
                          </span>
                        )}
                        {ev.venue_name && <span>{ev.venue_name}</span>}
                        {ev.venue_city && <span>{ev.venue_city}</span>}
                        {ev.capacity != null && (
                          <span>{ev.capacity.toLocaleString()} cap</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      {formatDate(ev.event_date)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
