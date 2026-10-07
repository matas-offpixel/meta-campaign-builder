/**
 * The one place that knows what an archived client is.
 *
 * `clients.status = 'archived'` hides the client from default dashboard
 * views and from every cron, so its events, drafts and plans stop costing
 * page weight and Meta calls. Events, drafts and plans are archived by
 * their client (`events.client_id`, `campaign_drafts.client_id` falling
 * back to the draft's event, `campaign_plans → events.client_id`). A row
 * with no client stays visible. `paused` is active everywhere.
 *
 * Share links and the client portal never consult this module — an
 * archived client's shares and portal keep rendering.
 *
 * No server-only imports: client components read ARCHIVED too.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const ARCHIVED = "archived" as const;

/** Clients-list filter value that includes archived clients. */
export const ALL_CLIENT_STATUSES = "all" as const;

type Reader = Pick<SupabaseClient, "from">;

/** `.neq('status', 'archived')` on a `clients` query. */
export function activeClientFilter<Q extends { neq(column: string, value: string): Q }>(query: Q): Q {
  return query.neq("status", ARCHIVED);
}

export function isArchivedClientStatus(status: string | null | undefined): boolean {
  return status === ARCHIVED;
}

/** One read per Supabase client instance per minute — routes and crons build a client per request. */
export const ARCHIVED_CLIENT_CACHE_MS = 60_000;

type Cached<T> = { at: number; value: Promise<T> };
const idsCache = new WeakMap<object, Cached<Set<string>>>();
const scopeCache = new WeakMap<object, Cached<ArchivedClientScope>>();

function cached<T>(cache: WeakMap<object, Cached<T>>, key: object, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ARCHIVED_CLIENT_CACHE_MS) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Ids of archived clients visible to this Supabase client (RLS applies).
 * A failed read is an empty set: hiding nothing beats hiding everything.
 */
export function loadArchivedClientIds(supabase: Reader): Promise<Set<string>> {
  return cached(idsCache, supabase, async () => {
    try {
      const { data, error } = await supabase.from("clients").select("id").eq("status", ARCHIVED);
      if (error) throw new Error(error.message);
      return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
    } catch (err) {
      console.warn("[client-status] archived clients read failed:", err instanceof Error ? err.message : err);
      return new Set<string>();
    }
  });
}

export type ArchivedClientScope = {
  clientIds: ReadonlySet<string>;
  /** Events whose client is archived. */
  eventIds: ReadonlySet<string>;
};

/** Archived clients plus their events, for rows that only carry an event id. */
export function loadArchivedClientScope(supabase: Reader): Promise<ArchivedClientScope> {
  return cached(scopeCache, supabase, async () => {
    const clientIds = await loadArchivedClientIds(supabase);
    const eventIds = new Set<string>();
    if (clientIds.size === 0) return { clientIds, eventIds };
    try {
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("events")
          .select("id")
          .in("client_id", [...clientIds])
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as { id: string }[];
        for (const row of rows) eventIds.add(row.id);
        if (rows.length < 1000) break;
      }
    } catch (err) {
      console.warn("[client-status] archived client events read failed:", err instanceof Error ? err.message : err);
    }
    return { clientIds, eventIds };
  });
}

/** Drop rows whose client is archived. Rows with no client are kept. */
export function dropArchivedClientRows<T>(
  rows: readonly T[],
  archivedClientIds: ReadonlySet<string>,
  clientIdOf: (row: T) => string | null | undefined = (row) =>
    (row as { client_id?: string | null }).client_id,
): T[] {
  if (archivedClientIds.size === 0) return [...rows];
  return rows.filter((row) => {
    const id = clientIdOf(row);
    return !id || !archivedClientIds.has(id);
  });
}

/** Drop rows whose event belongs to an archived client. Rows with no event are kept. */
export function dropArchivedEventRows<T>(
  rows: readonly T[],
  scope: ArchivedClientScope,
  eventIdOf: (row: T) => string | null | undefined = (row) =>
    (row as { event_id?: string | null }).event_id,
): T[] {
  if (scope.eventIds.size === 0) return [...rows];
  return rows.filter((row) => {
    const id = eventIdOf(row);
    return !id || !scope.eventIds.has(id);
  });
}

/**
 * A draft is its client's: `campaign_drafts.client_id`, else any event it
 * carries (column or draft_json). No client and no event → not archived.
 */
export function isArchivedClientDraft(
  draft: { clientId?: string | null; eventIds?: readonly (string | null | undefined)[] },
  scope: ArchivedClientScope,
): boolean {
  if (draft.clientId) return scope.clientIds.has(draft.clientId);
  return (draft.eventIds ?? []).some((id) => Boolean(id) && scope.eventIds.has(id as string));
}

export function logSkippedArchivedClients(tag: string, count: number, extra = ""): void {
  console.log(`[${tag}] skipped_archived_clients=${count}${extra ? ` ${extra}` : ""}`);
}
