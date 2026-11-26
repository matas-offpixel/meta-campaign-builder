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
 * One Page or Instagram account the client's business can build engagement
 * audiences from: PR B's ClientBuildableSource (#1400,
 * lib/mcp/audiences/client-sources.ts loadClientBuildableSources), as it
 * returns it. SWITCH(Job 2): import the type from there once #1400 merges.
 */
export type ClientBuildableSource = { client_id: string; kind: "facebook_page" | "instagram_account"; id: string; name: string | null; genre_family: string | null; reach: "owned" | "client_shared" };

export type StoredGroup = { id: string; client_id: string; genre_family: string; page_ids: string[]; ig_ids: string[]; confirmed_at: string | null };

export type GroupPlan = { clientId: string; genreFamily: string; pageIds: string[]; igIds: string[]; action: "insert" | "update" | "same" | "confirmed_kept" };

/** Per client: how many sources it listed and how many had no known genre (the seed says so, never guesses one). */
export type SeedCounts = { clientId: string; sources: number; noGenre: number; groups: number };

const GENRES = new Set<string>(GENRE_FAMILIES.map((row) => row.key));

/** The groups the listing gives, against what's stored: new, changed, the same, or confirmed (never touched). Owned and client-shared both count. */
export function planPageGroups(listing: readonly ClientBuildableSource[], stored: readonly StoredGroup[]): { plan: GroupPlan[]; counts: SeedCounts[] } {
  const groups = new Map<string, { clientId: string; genreFamily: string; pages: Set<string>; igs: Set<string> }>();
  const counts = new Map<string, SeedCounts>();
  for (const row of listing) {
    const count = counts.get(row.client_id) ?? { clientId: row.client_id, sources: 0, noGenre: 0, groups: 0 };
    count.sources += 1;
    counts.set(row.client_id, count);
    if (!row.genre_family || !GENRES.has(row.genre_family)) {
      count.noGenre += 1;
      continue;
    }
    const key = `${row.client_id}|${row.genre_family}`;
    const group = groups.get(key) ?? { clientId: row.client_id, genreFamily: row.genre_family, pages: new Set(), igs: new Set() };
    (row.kind === "facebook_page" ? group.pages : group.igs).add(row.id);
    groups.set(key, group);
  }
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);
  const plan = [...groups.values()]
    .sort((a, b) => a.clientId.localeCompare(b.clientId) || a.genreFamily.localeCompare(b.genreFamily))
    .map((group) => {
      const pageIds = [...group.pages].sort();
      const igIds = [...group.igs].sort();
      const have = stored.find((row) => row.client_id === group.clientId && row.genre_family === group.genreFamily);
      const action: GroupPlan["action"] = !have ? "insert" : have.confirmed_at ? "confirmed_kept" : same(have.page_ids, pageIds) && same(have.ig_ids, igIds) ? "same" : "update";
      counts.get(group.clientId)!.groups += 1;
      return { clientId: group.clientId, genreFamily: group.genreFamily, pageIds, igIds, action };
    });
  return { plan, counts: [...counts.values()].sort((a, b) => a.clientId.localeCompare(b.clientId)) };
}

/** PENDING DESIGN (a script line, ops-facing): a client none of whose sources has a known genre. */
export function noGenreLine(count: SeedCounts): string {
  return `client=${count.clientId}: ${count.noGenre} of ${count.sources} pages and Instagram accounts have no genre yet, so ${count.groups === 0 ? "no group is made" : `${count.noGenre} are left out`}. Set the genres first.`;
}

/** The show's group: its client's, in its genre. Null with no genre; an unconfirmed group comes back with confirmed false (the build skips it). */
export async function loadPageGroup(db: Pick<SupabaseClient, "from">, clientId: string | null, genreFamily: string | null): Promise<PageGroup | null> {
  if (!clientId || !genreFamily) return null;
  const res = await db.from("page_groups").select("id, client_id, genre_family, page_ids, ig_ids, confirmed_at").eq("client_id", clientId).eq("genre_family", genreFamily).maybeSingle();
  if (res.error || !res.data) return null;
  const row = res.data as StoredGroup;
  return { id: row.id, genreFamily: row.genre_family, pageIds: row.page_ids ?? [], igIds: row.ig_ids ?? [], confirmed: Boolean(row.confirmed_at) };
}
