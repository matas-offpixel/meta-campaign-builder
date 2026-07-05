import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * lib/db/client-admin.ts
 *
 * Read helpers for the client admin dashboard (OP909). All queries run on
 * the SESSION-bound Supabase client — the client-member read policies
 * (migration 137) scope every row to the caller's own client, so there is
 * no service-role in this module at all. Callers must have already run
 * requireClientContext() (the client_id passed in comes from it, never
 * from user input).
 */

export interface ClientPageSummary {
  pageEventId: string;
  eventId: string;
  eventName: string;
  eventSlug: string;
  status: string;
  presaleAt: string | null;
  updatedAt: string | null;
  signupCount: number;
}

interface EventRowWithPage {
  id: string;
  name: string;
  slug: string;
  presale_at: string | null;
  page_events:
    | { id: string; status: string; updated_at: string | null }
    | Array<{ id: string; status: string; updated_at: string | null }>
    | null;
}

/** page_events embeds as object or 1-element array — normalise both. */
function embeddedPage(row: EventRowWithPage) {
  const pe = row.page_events;
  if (!pe) return null;
  return Array.isArray(pe) ? (pe[0] ?? null) : pe;
}

/**
 * Every landing page under this client (events that HAVE a page_events
 * row), newest presale first, with live signup counts.
 */
export async function listClientPages(
  clientId: string,
): Promise<ClientPageSummary[]> {
  const supabase = await createClient();

  const [{ data: events, error: eventsError }, signupCounts] =
    await Promise.all([
      supabase
        .from("events")
        .select("id, name, slug, presale_at, page_events (id, status, updated_at)")
        .eq("client_id", clientId),
      countSignupsByEvent(clientId),
    ]);
  if (eventsError) {
    throw new Error(`[client-admin] events lookup failed: ${eventsError.message}`);
  }

  const pages: ClientPageSummary[] = [];
  for (const row of (events ?? []) as unknown as EventRowWithPage[]) {
    const page = embeddedPage(row);
    if (!page) continue; // event without a landing page
    pages.push({
      pageEventId: page.id,
      eventId: row.id,
      eventName: row.name,
      eventSlug: row.slug,
      status: page.status,
      presaleAt: row.presale_at,
      updatedAt: page.updated_at,
      signupCount: signupCounts.get(row.id) ?? 0,
    });
  }
  pages.sort((a, b) => (b.presaleAt ?? "").localeCompare(a.presaleAt ?? ""));
  return pages;
}

/**
 * Per-event signup counts for the client (soft-deleted rows excluded).
 * Selects only event_id — no PII columns cross this boundary.
 */
async function countSignupsByEvent(
  clientId: string,
): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_signups")
    .select("event_id")
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(
      `[client-admin] signup count lookup failed: ${error.message}`,
    );
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as Array<{ event_id: string }>) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

/** Total (non-deleted) signups across the whole client. */
export async function countClientSignups(clientId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("event_signups")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(
      `[client-admin] signup total lookup failed: ${error.message}`,
    );
  }
  return count ?? 0;
}
