/**
 * lib/mcp/audiences/client-sources.ts — every Facebook Page and Instagram
 * account a client's Business Manager can build engagement audiences from
 * (Matas, 26 Nov: "for the page-group seed in Job 4"), with its genre where
 * known. Exported for Job 4's page_groups seed.
 *
 * The Pages and Instagram accounts are the business's own and those shared
 * into it (owned_pages / client_pages, owned_instagram_assets /
 * client_instagram_assets, the edges lib/bm/asset-kinds.ts verified), read as
 * Matas through McpAudienceDeps.businessAssets.
 *
 * genre_family is known for an act's Page or account: the act is the artist
 * whose Page (artists.meta_page_id, creative_lab_artists.meta_page_id) or
 * Instagram (creative_lab_artists.instagram_actor_id / ig_username,
 * artists.instagram_handle) it is, and the genre is the most common
 * events.genre_family (migration 253) across that act's shows, ties to the
 * first in name order. Anything else is null: a promoter's own Page has no
 * genre of its own.
 *
 * Relative imports only (node:test).
 */
import type { Db } from "../tool-types.ts";
import type { BusinessAsset, McpAudienceDeps } from "./types.ts";

export interface ClientBuildableSource {
  client_id: string;
  kind: "facebook_page" | "instagram_account";
  /** The Page id, or the Instagram account's user id (the id an ig_business audience rule takes). */
  id: string;
  name: string | null;
  genre_family: string | null;
  /** owned: the business owns it; client_shared: shared into it by someone else. */
  reach: "owned" | "client_shared";
}

const handle = (v: string | null | undefined) => (v ? v.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").toLowerCase() || null : null);

/** Pure: the business's assets as rows, each with its genre when the lookups know it. Owned wins over shared; one row per id. */
export function clientBuildableSources(clientId: string, assets: { pages: readonly BusinessAsset[]; instagram: readonly BusinessAsset[] }, genre: { byPage: ReadonlyMap<string, string>; byIg: ReadonlyMap<string, string>; byHandle: ReadonlyMap<string, string> }): ClientBuildableSource[] {
  const out = new Map<string, ClientBuildableSource>();
  const add = (row: ClientBuildableSource) => {
    const key = `${row.kind}:${row.id}`;
    const have = out.get(key);
    if (!have || (have.reach === "client_shared" && row.reach === "owned")) out.set(key, row);
  };
  for (const p of assets.pages) add({ client_id: clientId, kind: "facebook_page", id: p.id, name: p.name, genre_family: genre.byPage.get(p.id) ?? null, reach: p.reach });
  for (const i of assets.instagram) {
    const h = handle(i.name);
    add({ client_id: clientId, kind: "instagram_account", id: i.id, name: i.name, genre_family: genre.byIg.get(i.id) ?? (h ? genre.byHandle.get(h) : undefined) ?? null, reach: i.reach });
  }
  return [...out.values()].sort((a, b) => a.kind.localeCompare(b.kind) || (a.name ?? "").localeCompare(b.name ?? "") || a.id.localeCompare(b.id));
}

/** The most common value, ties to the first in name order. */
function majority(values: readonly string[]): string | null {
  const n = new Map<string, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

/** Database reads: each act's genre, keyed by its Page id, Instagram id and handle. */
export async function genreLookups(db: Db, pageIds: readonly string[], igIds: readonly string[], handles: readonly string[]) {
  const byPage = new Map<string, string>();
  const byIg = new Map<string, string>();
  const byHandle = new Map<string, string>();
  const artistOf = new Map<string, { pages: Set<string>; igs: Set<string>; handles: Set<string> }>();
  const note = (artistId: string, k: "pages" | "igs" | "handles", v: string | null) => {
    if (!v) return;
    const a = artistOf.get(artistId) ?? { pages: new Set(), igs: new Set(), handles: new Set() };
    a[k].add(v);
    artistOf.set(artistId, a);
  };
  const rows = <T>(r: { data: unknown; error: unknown }) => ((r.error ? [] : r.data ?? []) as T[]);
  if (pageIds.length) {
    for (const a of rows<{ id: string; meta_page_id: string | null }>(await db.from("artists").select("id, meta_page_id").in("meta_page_id", [...pageIds]))) note(a.id, "pages", a.meta_page_id);
    for (const a of rows<{ artist_id: string | null; meta_page_id: string | null }>(await db.from("creative_lab_artists").select("artist_id, meta_page_id").in("meta_page_id", [...pageIds]))) if (a.artist_id) note(a.artist_id, "pages", a.meta_page_id);
  }
  if (igIds.length) for (const a of rows<{ artist_id: string | null; instagram_actor_id: string | null }>(await db.from("creative_lab_artists").select("artist_id, instagram_actor_id").in("instagram_actor_id", [...igIds]))) if (a.artist_id) note(a.artist_id, "igs", a.instagram_actor_id);
  if (handles.length) {
    for (const a of rows<{ artist_id: string | null; ig_username: string | null }>(await db.from("creative_lab_artists").select("artist_id, ig_username").in("ig_username", [...handles]))) if (a.artist_id) note(a.artist_id, "handles", handle(a.ig_username));
    const variants = [...new Set(handles.flatMap((h) => [h, `@${h}`]))];
    for (const a of rows<{ id: string; instagram_handle: string | null }>(await db.from("artists").select("id, instagram_handle").in("instagram_handle", variants))) note(a.id, "handles", handle(a.instagram_handle));
  }
  if (artistOf.size === 0) return { byPage, byIg, byHandle };
  const links = rows<{ artist_id: string; event_id: string }>(await db.from("event_artists").select("artist_id, event_id").in("artist_id", [...artistOf.keys()]));
  const events = links.length ? rows<{ id: string; genre_family: string | null }>(await db.from("events").select("id, genre_family").in("id", [...new Set(links.map((l) => l.event_id))])) : [];
  const genreOfEvent = new Map(events.filter((e) => e.genre_family).map((e) => [e.id, e.genre_family as string]));
  for (const [artistId, keys] of artistOf) {
    const g = majority(links.filter((l) => l.artist_id === artistId).map((l) => genreOfEvent.get(l.event_id)).filter((v): v is string => Boolean(v)));
    if (!g) continue;
    for (const p of keys.pages) if (!byPage.has(p)) byPage.set(p, g);
    for (const i of keys.igs) if (!byIg.has(i)) byIg.set(i, g);
    for (const h of keys.handles) if (!byHandle.has(h)) byHandle.set(h, g);
  }
  return { byPage, byIg, byHandle };
}

/** The client's buildable Pages and Instagram accounts, from its linked Business Manager. */
export async function loadClientBuildableSources(db: Db, deps: Pick<McpAudienceDeps, "businessAssets">, userId: string, clientId: string, businessId: string): Promise<ClientBuildableSource[]> {
  const assets = await deps.businessAssets(userId, businessId);
  const genre = await genreLookups(
    db,
    assets.pages.map((p) => p.id),
    assets.instagram.map((i) => i.id),
    assets.instagram.map((i) => handle(i.name)).filter((v): v is string => Boolean(v)),
  );
  return clientBuildableSources(clientId, assets, genre);
}
