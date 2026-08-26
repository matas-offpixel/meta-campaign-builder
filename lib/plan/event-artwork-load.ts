/**
 * Batch-load event artwork from tables that already store it.
 * No Meta calls. A missing relation degrades to initials.
 */

import { isRelationMissing } from "./schema-probe.ts";
import { eventInitials, resolveEventArtwork } from "../viz/event-artwork.ts";

export interface EventThumbSource {
  eventId: string;
  name: string;
  url: string | null;
  initials: string;
}

export async function loadEventThumbSources(
  supabase: unknown,
  eventIds: string[],
  eventNames: Map<string, string>,
): Promise<Map<string, EventThumbSource>> {
  const client = supabase as {
    from: (table: string) => {
      select: (cols: string) => {
        in: (
          col: string,
          ids: string[],
        ) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
      };
    };
  };
  const result = new Map<string, EventThumbSource>();
  for (const id of eventIds) {
    const name = eventNames.get(id) ?? "";
    result.set(id, {
      eventId: id,
      name,
      url: null,
      initials: eventInitials(name),
    });
  }
  if (eventIds.length === 0) return result;

  const [pages, copies] = await Promise.all([
    client
      .from("page_events")
      .select("event_id, content, hero_images")
      .in("event_id", eventIds),
    client
      .from("d2c_event_copy")
      .select("event_id, artwork_url")
      .in("event_id", eventIds),
  ]);

  const pageByEvent = new Map<string, { content?: Record<string, unknown> | null; hero_images?: unknown }>();
  if (!isRelationMissing(pages.error)) {
    for (const row of (pages.data ?? []) as Array<{
      event_id: string;
      content?: Record<string, unknown> | null;
      hero_images?: unknown;
    }>) {
      if (!pageByEvent.has(row.event_id)) pageByEvent.set(row.event_id, row);
    }
  }

  const d2cByEvent = new Map<string, string | null>();
  if (!isRelationMissing(copies.error)) {
    for (const row of (copies.data ?? []) as Array<{ event_id: string; artwork_url?: string | null }>) {
      if (!d2cByEvent.has(row.event_id)) d2cByEvent.set(row.event_id, row.artwork_url ?? null);
    }
  }

  for (const id of eventIds) {
    const page = pageByEvent.get(id);
    const url = resolveEventArtwork({
      heroImages: page?.hero_images,
      pageContent: page?.content ?? null,
      d2cArtworkUrl: d2cByEvent.get(id) ?? null,
    });
    const current = result.get(id);
    if (current) result.set(id, { ...current, url });
  }
  return result;
}
