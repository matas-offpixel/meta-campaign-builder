import "server-only";

import { createClient } from "@/lib/supabase/server";
import {
  assembleEventLandingPageRecord,
  type EventLandingPageRecord,
} from "@/lib/landing-pages/event-lookup";

/**
 * lib/db/event-landing-page.ts
 *
 * Wizard-facing event ↔ LP lookup (by events.id). Public /l resolution
 * stays slug-chain (`getLandingPageContext`). Ownership is RLS on the
 * cookie-bound client — operators only see their own events.
 *
 * Create mirrors `createPageForExistingEvent`: insert
 * `{ event_id, provider: "internal", status: "draft" }`. Name / date /
 * artwork already live on the event; the renderer reads them from the
 * join. No redirect — the wizard fills the destination URL instead.
 */

function firstEmbed<T extends Record<string, unknown>>(
  value: unknown,
): T | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object"
      ? (first as T)
      : null;
  }
  if (typeof value === "object") return value as T;
  return null;
}

function recordFromEventRow(row: {
  id: string;
  slug: string | null;
  clients: unknown;
  page_events: unknown;
}): EventLandingPageRecord | null {
  const client = firstEmbed<{ slug?: string | null }>(row.clients);
  const page = firstEmbed<{ id?: string | null }>(row.page_events);
  return assembleEventLandingPageRecord({
    eventId: row.id,
    eventSlug: row.slug,
    clientSlug: client?.slug ?? null,
    pageEventId: page?.id ?? null,
    customHost: null,
  });
}

export async function lookupEventLandingPage(
  eventId: string,
): Promise<EventLandingPageRecord | null> {
  if (!eventId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, slug, clients ( slug ), page_events ( id )")
    .eq("id", eventId)
    .maybeSingle();
  if (error) {
    throw new Error(`[event-landing-page] lookup failed: ${error.message}`);
  }
  if (!data) return null;
  return recordFromEventRow(
    data as {
      id: string;
      slug: string | null;
      clients: unknown;
      page_events: unknown;
    },
  );
}

/**
 * Same insert as `createPageForExistingEvent` (lib/actions/update-page-event.ts).
 * Operator session + RLS (events.user_id), not requireClientContext.
 */
export async function createDraftPageForOwnedEvent(
  eventId: string,
): Promise<EventLandingPageRecord | { error: string }> {
  const existing = await lookupEventLandingPage(eventId);
  if (!existing) return { error: "Event not found." };
  if (existing.hasPage) return existing;

  const supabase = await createClient();
  const { error: insertError } = await supabase
    .from("page_events")
    .insert({ event_id: eventId, provider: "internal", status: "draft" })
    .select("id")
    .single();

  if (insertError) {
    const raced = await lookupEventLandingPage(eventId);
    if (raced?.hasPage) return raced;
    return { error: `Create failed: ${insertError.message}` };
  }

  const created = await lookupEventLandingPage(eventId);
  if (!created) return { error: "Create succeeded but lookup returned nothing." };
  return created;
}
