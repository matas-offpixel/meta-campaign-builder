/**
 * lib/event-config/aliases.ts
 *
 * Count aliases (D8, D9): a show name exactly as Internal Counts writes it,
 * stored on the event in event_count_aliases (migration 235). Unique on
 * alias, so one sheet name maps to one event. Names match exactly: case and
 * inner spacing are kept ("Folamour" and "FOLAMOUR" are two aliases). Only
 * the edges of a typed line are trimmed, because a stray space in a text
 * box isn't the sheet's.
 *
 * getEventIdForCountAlias replaces HD1's temporary map
 * (lib/internal-counts/aliases.ts on #1217). Whichever of the two PRs
 * merges second switches HD1 to it.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import { pageAll } from "../db/paged-read.ts";

type Db = { from(table: string): unknown };

export interface CountAliasRow {
  alias: string;
  event_id: string;
}

/** One alias per line; line edges trimmed, blanks dropped, exact repeats removed. */
export function parseAliasLines(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const alias = line.trim();
    if (!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
  }
  return out;
}

export interface AliasPlan {
  add: string[];
  remove: string[];
  /** Aliases already stored on another event. Nothing is written while any remain. */
  conflicts: CountAliasRow[];
}

/**
 * What saving `next` on `eventId` changes. `stored` holds every stored row
 * for this event plus any row (on any event) whose alias is in `next`.
 */
export function planAliasChange(stored: readonly CountAliasRow[], eventId: string, next: readonly string[]): AliasPlan {
  const mine = new Set(stored.filter((r) => r.event_id === eventId).map((r) => r.alias));
  const wanted = new Set(next);
  const conflicts = stored.filter((r) => r.event_id !== eventId && wanted.has(r.alias));
  const taken = new Set(conflicts.map((r) => r.alias));
  return {
    add: next.filter((a) => !mine.has(a) && !taken.has(a)),
    remove: [...mine].filter((a) => !wanted.has(a)),
    conflicts,
  };
}

/** Every stored alias → its event id, paged in alias order (alias is unique). */
export async function loadCountAliasMap(sb: Db): Promise<Map<string, string>> {
  const rows = await pageAll<CountAliasRow>(
    (from, to) =>
      (sb.from("event_count_aliases") as AliasQuery).select("alias,event_id").order("alias", { ascending: true }).range(from, to),
    ["alias"],
    "event_count_aliases",
  );
  return new Map(rows.map((r) => [r.alias, r.event_id]));
}

/** The event a sheet name is an alias of, or null. Exact match. */
export async function getEventIdForCountAlias(sb: Db, alias: string): Promise<string | null> {
  const { data, error } = await (sb.from("event_count_aliases") as AliasQuery)
    .select("alias,event_id")
    .eq("alias", alias)
    .maybeSingle();
  if (error) throw new Error(`event_count_aliases: ${error.message}`);
  return (data as CountAliasRow | null)?.event_id ?? null;
}

type Result = { data: unknown; error: { message: string } | null };
interface AliasQuery {
  select(columns: string): AliasQuery;
  eq(column: string, value: unknown): AliasQuery;
  order(column: string, options: { ascending: boolean }): AliasQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  maybeSingle(): PromiseLike<Result>;
}
