/**
 * lib/event-config/cirqlin-refresh.ts
 *
 * The edit page's one CIRQLIN call: re-read the linked page by ?id= so the
 * cached title and slug follow a rename. At most once per edit-page load,
 * for that one event, and not when the cache was confirmed in the last hour
 * (the endpoint's rate limit is shared with the signups read). A failed
 * refresh keeps and shows the cached title; nothing is written. A 404 (the
 * page isn't live any more) also keeps the stored id and cache, and marks
 * the page notLive for "{stored title} · not live now".
 *
 * Only app/(dashboard)/events/[id]/edit/page.tsx may import this (guard test).
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CirqlinPageLookup, CirqlinPageQuery } from "../cirqlin/page.ts";
import { cirqlinCacheIsFresh, cirqlinPageColumns } from "./cirqlin.ts";
import type { CachedCirqlinPage } from "./read.ts";

type Db = Pick<SupabaseClient, "from">;

export async function refreshCirqlinPageCache(
  sb: Db,
  eventId: string,
  page: CachedCirqlinPage | null,
  deps: { lookup: (q: CirqlinPageQuery) => Promise<CirqlinPageLookup>; now?: Date },
): Promise<CachedCirqlinPage | null> {
  const now = deps.now ?? new Date();
  if (!page || cirqlinCacheIsFresh(page, now)) return page;
  const found = await deps.lookup({ id: page.id });
  if (!found.ok) return found.reason === "no_page" ? { ...page, notLive: true } : page;
  if (found.page.id !== page.id) return page;
  const columns = cirqlinPageColumns(found.page, now);
  const { error } = await sb
    .from("events")
    .update({ cirqlin_page_title: columns.cirqlin_page_title, cirqlin_page_slug: columns.cirqlin_page_slug, cirqlin_page_checked_at: columns.cirqlin_page_checked_at })
    .eq("id", eventId)
    .eq("cirqlin_page_id", page.id);
  // A failed write still shows what CIRQLIN just said; the cache catches up on the next load.
  if (error) console.error("[event-config] CIRQLIN page cache write failed:", error.message);
  return { id: page.id, title: found.page.title, slug: found.page.slug, checkedAt: columns.cirqlin_page_checked_at };
}
