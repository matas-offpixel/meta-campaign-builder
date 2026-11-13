/**
 * lib/event-config/read.ts
 *
 * The per-event config (D9) as HD3 reads it: capacity, sellable allocation,
 * the umbrella flag, the CIRQLIN page link, the reference set and the count
 * aliases. Nothing here is inferred from codes or slugs, and nothing has a
 * default: a missing value is null, and the surface says so in D9's words
 * (NO_CAPACITY, NO_CIRQLIN_PAGE).
 *
 * An umbrella has no trajectory, no tickets and no cost per ticket.
 * `isUmbrella` is the one place that is decided.
 *
 * Every read pages in unique-key order and dedupes (lib/db/paged-read.ts).
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged, type PagedQuery } from "../db/paged-read.ts";
import { sellableAllocation, type SellableAllocation, type TierAllocation } from "./allocation.ts";

type Db = Pick<SupabaseClient, "from">;

/** D9: the trajectory with no capacity and no paid tier allocation. */
export const NO_CAPACITY = "Set capacity on the event to see the sell-out line";
/** D9: Registrations with no page link. */
export const NO_CIRQLIN_PAGE = "No CIRQLIN page";

export interface EventConfig {
  eventId: string;
  clientId: string | null;
  capacity: number | null;
  sellable: SellableAllocation;
  isUmbrella: boolean;
  cirqlinPageId: string | null;
  /**
   * The linked page as CIRQLIN last described it (cached on the events row,
   * migration 235). Null when no page is linked. Reading this never calls
   * CIRQLIN; only the edit page refreshes it.
   */
  cirqlinPage: CachedCirqlinPage | null;
  /** The event's own reference set. Empty = the client's library (D10). */
  referenceEventIds: string[];
  countAliases: string[];
}

export interface CachedCirqlinPage {
  id: string;
  /** Null when the cache has not been filled (a link set before the cache columns). */
  title: string | null;
  slug: string | null;
  checkedAt: string | null;
}

interface EventRow {
  id: string;
  client_id: string | null;
  capacity: number | null;
  is_umbrella: boolean | null;
  cirqlin_page_id: string | null;
  cirqlin_page_title?: string | null;
  cirqlin_page_slug?: string | null;
  cirqlin_page_checked_at?: string | null;
}

const EVENT_COLUMNS = "id,client_id,capacity,is_umbrella,cirqlin_page_id,cirqlin_page_title,cirqlin_page_slug,cirqlin_page_checked_at";

function cachedPage(e: EventRow): CachedCirqlinPage | null {
  if (!e.cirqlin_page_id) return null;
  return {
    id: e.cirqlin_page_id,
    title: e.cirqlin_page_title ?? null,
    slug: e.cirqlin_page_slug ?? null,
    checkedAt: e.cirqlin_page_checked_at ?? null,
  };
}

const IN_CHUNK = 100;

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function inChunks<T extends object>(
  ids: readonly string[],
  read: (chunk: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunks(ids)) out.push(...(await read(chunk)));
  return out;
}

/** Group values by key, keeping order. */
function groupBy<T, V>(rows: readonly T[], key: (r: T) => string, value: (r: T) => V): Map<string, V[]> {
  const out = new Map<string, V[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(value(r));
    else out.set(k, [value(r)]);
  }
  return out;
}

/** Assemble configs from rows already read. Pure; exported for tests. */
export function buildEventConfigs(input: {
  events: readonly EventRow[];
  allocations: readonly (TierAllocation & { event_id: string })[];
  tiers: readonly { event_id: string; tier_name: string; price: number | null }[];
  references: readonly { event_id: string; reference_event_id: string }[];
  aliases: readonly { event_id: string; alias: string }[];
}): Map<string, EventConfig> {
  const allocations = groupBy(input.allocations, (r) => r.event_id, (r) => r);
  const prices = groupBy(input.tiers, (r) => r.event_id, (r) => [r.tier_name, r.price] as const);
  const references = groupBy(input.references, (r) => r.event_id, (r) => r.reference_event_id);
  const aliases = groupBy(input.aliases, (r) => r.event_id, (r) => r.alias);
  const out = new Map<string, EventConfig>();
  for (const e of input.events) {
    out.set(e.id, {
      eventId: e.id,
      clientId: e.client_id,
      capacity: e.capacity,
      sellable: sellableAllocation({
        capacity: e.capacity,
        allocations: allocations.get(e.id) ?? [],
        tierPrices: new Map(prices.get(e.id) ?? []),
      }),
      isUmbrella: e.is_umbrella === true,
      cirqlinPageId: e.cirqlin_page_id ?? null,
      cirqlinPage: cachedPage(e),
      referenceEventIds: references.get(e.id) ?? [],
      countAliases: aliases.get(e.id) ?? [],
    });
  }
  return out;
}

/** Config for each of `eventIds` the caller can read. Missing events are absent from the map. */
export async function loadEventConfigs(sb: Db, eventIds: readonly string[]): Promise<Map<string, EventConfig>> {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return new Map();
  const byEvent = (chunk: string[]) => (q: PagedQuery) => q.in("event_id", chunk);
  const [events, allocations, tiers, references, aliases] = await Promise.all([
    inChunks(ids, (chunk) =>
      loadAllPaged<EventRow>(sb, "events", EVENT_COLUMNS, ["id"], (q) => q.in("id", chunk)),
    ),
    inChunks(ids, (chunk) =>
      loadAllPaged<TierAllocation & { id: string; event_id: string }>(
        sb,
        "tier_channel_allocations",
        "id,event_id,tier_name,allocation_count",
        ["id"],
        byEvent(chunk),
      ),
    ),
    inChunks(ids, (chunk) =>
      loadAllPaged<{ id: string; event_id: string; tier_name: string; price: number | null }>(
        sb,
        "event_ticket_tiers",
        "id,event_id,tier_name,price",
        ["id"],
        byEvent(chunk),
      ),
    ),
    inChunks(ids, (chunk) =>
      loadAllPaged<{ event_id: string; reference_event_id: string }>(
        sb,
        "event_reference_shows",
        "event_id,reference_event_id",
        ["event_id", "reference_event_id"],
        byEvent(chunk),
      ),
    ),
    inChunks(ids, (chunk) =>
      loadAllPaged<{ event_id: string; alias: string }>(sb, "event_count_aliases", "event_id,alias", ["alias"], byEvent(chunk)),
    ),
  ]);
  return buildEventConfigs({ events, allocations, tiers, references, aliases });
}

export async function loadEventConfig(sb: Db, eventId: string): Promise<EventConfig | null> {
  return (await loadEventConfigs(sb, [eventId])).get(eventId) ?? null;
}

/** Umbrella event ids among `eventIds`: no trajectory, no tickets, no cost per ticket. */
export async function loadUmbrellaEventIds(sb: Db, eventIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(eventIds)];
  const rows = await inChunks(ids, (chunk) =>
    loadAllPaged<{ id: string; is_umbrella: boolean | null }>(sb, "events", "id,is_umbrella", ["id"], (q) =>
      q.in("id", chunk).eq("is_umbrella", true),
    ),
  );
  return new Set(rows.filter((r) => r.is_umbrella === true).map((r) => r.id));
}
