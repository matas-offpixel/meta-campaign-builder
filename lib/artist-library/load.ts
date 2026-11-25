/**
 * lib/artist-library/load.ts — the reads behind get_artist (AL5).
 *
 * Service role, operators only (the MCP checks every call). Reads only:
 * artists, artist_assets and artist_library_folders (migration 269; empty
 * until applied), event_artists, events, clients and ad_daily_insights for
 * the artist's own ads. Every read pages with .range() (the 1,000-row cap).
 * Archived clients are left out (lib/db/client-status.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadArchivedClientIds } from "../db/client-status.ts";
import { loadAllPaged } from "../db/paged-read.ts";
import { LIBRARY_ARTIST_KEY } from "./library-tree.ts";
import { fold } from "./match.ts";
import type { AssetRow, ClientLite, EventLite, InsightRow } from "./view.ts";

type Db = Pick<SupabaseClient, "from">;

export const ASSET_COLUMNS =
  "id, asset_key, kind, name, drive_file_id, caption_text, source_event_id, source_client_id, owner_kind, shareable, held_reason, approved_by, approved_at, lab_clip_id, lab_render_id, meta_ad_id, material_at";
export const EVENT_LITE_COLUMNS = "id, name, event_code, client_id, event_date, venue_name, venue_city, announcement_at, presale_at, general_sale_at, status";
export const INSIGHT_COLUMNS = "id, meta_ad_id, date, spend, registrations, purchases, campaign_name, campaign_objective";

const CHUNK = 100;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const missing = (err: unknown) => /does not exist|schema cache|Could not find the table/i.test(err instanceof Error ? err.message : String(err));

/** Rows of a migration-269 table, or none before it is applied. */
async function optional<T extends object>(read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (err) {
    if (missing(err)) return [];
    throw err;
  }
}

/** Similarity for "Closest": shared words first, then a shared start. */
function closeness(a: string, b: string): number {
  const wa = new Set(fold(a).trim().split(" ").filter(Boolean));
  const wb = new Set(fold(b).trim().split(" ").filter(Boolean));
  let shared = 0;
  for (const w of wa) if (wb.has(w) || [...wb].some((x) => x.startsWith(w) || w.startsWith(x))) shared += 1;
  return shared / Math.max(1, Math.max(wa.size, wb.size));
}

/**
 * The artist by name: as written, then folded (case and accents). No match
 * gives up to three closest names.
 */
export async function findArtist(db: Db, name: string): Promise<{ artist: { id: string; name: string } | null; closest: string[] }> {
  const artists = await loadAllPaged<{ id: string; name: string }>(db, "artists", "id, name", ["id"]);
  const exact = artists.filter((a) => a.name === name);
  const folded = exact.length ? exact : artists.filter((a) => fold(a.name) === fold(name));
  if (folded.length) return { artist: [...folded].sort((a, b) => a.id.localeCompare(b.id))[0]!, closest: [] };
  const closest = artists
    .map((a) => ({ name: a.name, score: closeness(name, a.name) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((a) => a.name)
    .filter((n, i, all) => all.indexOf(n) === i)
    .slice(0, 3);
  return { artist: null, closest };
}

export interface ArtistData {
  assets: AssetRow[];
  insights: InsightRow[];
  events: EventLite[];
  clients: ClientLite[];
  linkedEventIds: string[];
  driveFolderId: string | null;
}

/** Everything get_artist reads for one artist, archived clients dropped. */
export async function loadArtistData(db: Db, artistId: string, extraEventIds: readonly string[] = []): Promise<ArtistData> {
  const archived = await loadArchivedClientIds(db as never);
  const [assetsAll, links, folders] = await Promise.all([
    optional(() => loadAllPaged<AssetRow & { id: string }>(db, "artist_assets", ASSET_COLUMNS, ["id"], (q) => q.eq("artist_id", artistId))),
    loadAllPaged<{ id: string; event_id: string }>(db, "event_artists", "id, event_id", ["id"], (q) => q.eq("artist_id", artistId)),
    optional(() => loadAllPaged<{ id: string; key: string; drive_folder_id: string }>(db, "artist_library_folders", "id, key, drive_folder_id", ["id"], (q) => q.eq("artist_id", artistId))),
  ]);
  const assets = assetsAll.filter((a) => !(a.source_client_id && archived.has(a.source_client_id)));
  const eventIds = [...new Set([...links.map((l) => l.event_id), ...assets.map((a) => a.source_event_id).filter((id): id is string => Boolean(id)), ...extraEventIds])];
  const events: EventLite[] = [];
  for (const ids of chunks(eventIds)) events.push(...(await loadAllPaged<EventLite>(db, "events", EVENT_LITE_COLUMNS, ["id"], (q) => q.in("id", ids))));
  const liveEvents = events.filter((e) => !(e.client_id && archived.has(e.client_id)));
  const liveIds = new Set(liveEvents.map((e) => e.id));
  const adIds = [...new Set(assets.map((a) => a.meta_ad_id).filter((id): id is string => Boolean(id)))];
  const insights: InsightRow[] = [];
  for (const ids of chunks(adIds)) {
    insights.push(...(await loadAllPaged<InsightRow & { id: string }>(db, "ad_daily_insights", INSIGHT_COLUMNS, ["id"], (q) => q.in("meta_ad_id", ids))));
  }
  const clientIds = [...new Set([...liveEvents.map((e) => e.client_id), ...assets.map((a) => a.source_client_id)].filter((id): id is string => Boolean(id)))];
  const clients: ClientLite[] = [];
  for (const ids of chunks(clientIds)) clients.push(...(await loadAllPaged<ClientLite>(db, "clients", "id, name", ["id"], (q) => q.in("id", ids))));
  return {
    assets,
    insights,
    events: liveEvents,
    clients: clients.filter((c) => !archived.has(c.id)),
    linkedEventIds: links.map((l) => l.event_id).filter((id) => liveIds.has(id)),
    driveFolderId: folders.find((f) => f.key === LIBRARY_ARTIST_KEY)?.drive_folder_id ?? null,
  };
}

/**
 * M4a's muted cards: an artist's statics in the library (press shots and
 * story artwork), each with its rights. Callers decide what an event may use
 * with usableOn, as get_artist does. Reads only.
 */
export async function artistStatics(db: Db, artistId: string): Promise<{ name: string; shareable: boolean; clientId: string | null }[]> {
  const res = await db.from("artist_assets").select("name, shareable, source_client_id").eq("artist_id", artistId).eq("kind", "static").range(0, 499);
  if (res.error) return [];
  return ((res.data ?? []) as { name: string | null; shareable: boolean | null; source_client_id: string | null }[])
    .filter((r) => r.name)
    .map((r) => ({ name: String(r.name), shareable: r.shareable === true, clientId: r.source_client_id ?? null }));
}

/**
 * M4a's voice check: is `text` one of the artist's approved captions, word
 * for word (case and outer spaces aside)? Reads only.
 */
export async function isApprovedCaption(db: Db, artistName: string, text: string): Promise<boolean> {
  const want = text.trim().toLowerCase();
  if (!want) return false;
  const a = await db.from("artists").select("id").ilike("name", artistName).limit(1);
  const id = (a.data?.[0] as { id?: string } | undefined)?.id;
  if (a.error || !id) return false;
  const res = await db.from("artist_assets").select("caption_text").eq("artist_id", id).eq("kind", "caption").not("approved_at", "is", null).range(0, 499);
  if (res.error) return false;
  return ((res.data ?? []) as { caption_text?: string | null }[]).some((r) => (r.caption_text ?? "").trim().toLowerCase() === want);
}
