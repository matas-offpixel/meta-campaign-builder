/**
 * The Similar tier's genre page groups (page_groups, migration 275; staged:
 * scratch/retargeting-two-campaigns-2026-11-26.md item 2, pending design's
 * re-ruling of #1396).
 *
 * A group is one client's Facebook Pages and Instagram accounts in one genre
 * (events.genre_family's keys) that the client's business can build
 * engagement audiences from. The seed (scripts/page-groups-seed.mts) plans
 * them from the audience-source listing; a seeded group stays unconfirmed
 * and the build never uses it until Matas confirms it. A confirmed group is
 * never rewritten by the seed.
 *
 * Pure, except loadPageGroup (one read). Relative imports only (node:test).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { GENRE_FAMILIES } from "../learning/genre/families.ts";
import type { PageGroup } from "./funnel.ts";

/**
 * One page or Instagram account from the audience-source listing.
 * SWITCH(Job 2): the listing's own shape once PR B settles it.
 */
export type ListedSource = { clientId: string; pageId: string; igId: string | null; name: string; genreFamily: string | null; canBuild: boolean };

export type StoredGroup = { id: string; client_id: string; genre_family: string; page_ids: string[]; ig_ids: string[]; confirmed_at: string | null };

export type GroupPlan = { clientId: string; genreFamily: string; pageIds: string[]; igIds: string[]; action: "insert" | "update" | "same" | "confirmed_kept" };

const GENRES = new Set<string>(GENRE_FAMILIES.map((row) => row.key));

/** The groups the listing gives, against what's stored: new, changed, the same, or confirmed (never touched). */
export function planPageGroups(listing: readonly ListedSource[], stored: readonly StoredGroup[]): GroupPlan[] {
  const groups = new Map<string, { clientId: string; genreFamily: string; pages: Set<string>; igs: Set<string> }>();
  for (const row of listing) {
    if (!row.canBuild || !row.genreFamily || !GENRES.has(row.genreFamily)) continue;
    const key = `${row.clientId}|${row.genreFamily}`;
    const group = groups.get(key) ?? { clientId: row.clientId, genreFamily: row.genreFamily, pages: new Set(), igs: new Set() };
    group.pages.add(row.pageId);
    if (row.igId) group.igs.add(row.igId);
    groups.set(key, group);
  }
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  return [...groups.values()]
    .sort((a, b) => a.clientId.localeCompare(b.clientId) || a.genreFamily.localeCompare(b.genreFamily))
    .map((group) => {
      const pageIds = [...group.pages].sort();
      const igIds = [...group.igs].sort();
      const have = stored.find((row) => row.client_id === group.clientId && row.genre_family === group.genreFamily);
      const action: GroupPlan["action"] = !have ? "insert" : have.confirmed_at ? "confirmed_kept" : same(have.page_ids, pageIds) && same(have.ig_ids, igIds) ? "same" : "update";
      return { clientId: group.clientId, genreFamily: group.genreFamily, pageIds, igIds, action };
    });
}

/** The show's group: its client's, in its genre. Null with no genre; an unconfirmed group comes back with confirmed false (the build skips it). */
export async function loadPageGroup(db: Pick<SupabaseClient, "from">, clientId: string | null, genreFamily: string | null): Promise<PageGroup | null> {
  if (!clientId || !genreFamily) return null;
  const res = await db.from("page_groups").select("id, client_id, genre_family, page_ids, ig_ids, confirmed_at").eq("client_id", clientId).eq("genre_family", genreFamily).maybeSingle();
  if (res.error || !res.data) return null;
  const row = res.data as StoredGroup;
  return { id: row.id, genreFamily: row.genre_family, pageIds: row.page_ids ?? [], igIds: row.ig_ids ?? [], confirmed: Boolean(row.confirmed_at) };
}
