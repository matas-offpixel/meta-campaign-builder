/**
 * lib/artist-library/library-drive.ts — the Drive library (AL1, AL4).
 *
 * Folders: 00 Artist Library / {artist} / Clips · Statics · Renders ·
 * Captions · Insights, recorded in artist_library_folders (migration 269).
 * Map first; a key the map doesn't have is looked up by exact name under its
 * parent before anything is made, so a rerun never makes a second folder.
 *
 * Renders: Drive shortcuts to the render's file in the event folder, never
 * copies. Nothing here deletes, and nothing shares: Share with promoter
 * refuses every folder this map holds (isLibraryFolder, lib/drive/share.ts).
 *
 * Before migration 269 is applied the map can't be read: every function
 * here then does nothing and says so (`off`).
 */
import { isArchivedClientStatus } from "../db/client-status.ts";
import { pageAll } from "../db/paged-read.ts";
import { APP_ID_KEY, APP_TAG_KEY, SHORTCUT_MIME, type DriveApi, type DriveFile } from "../drive/client.ts";
import type { DriveDb } from "../drive/db.ts";
import { findOrCreateFolder, type TreeLog } from "../drive/folders.ts";
import { isCancelled } from "../drive/tree.ts";
import { libraryDropRights } from "./rights.ts";
import {
  LIBRARY_ARTIST_KEY,
  LIBRARY_CHILDREN,
  LIBRARY_ROOT_KEY,
  artistFolderName,
  libraryRootName,
  planShortcuts,
  type ExistingShortcut,
  type LibraryChildKey,
  type LibraryKey,
  type RankedRender,
  type ShortcutPlan,
} from "./library-tree.ts";
import type { RankedStage } from "./words.ts";

/** appProperties on every shortcut the library makes: the pickup skips them (APP_TAG_KEY), and the stage tells two of one render apart. */
export const LIBRARY_SHORTCUT_TAG = "artist_library_render";
export const LIBRARY_STAGE_KEY = "offpixel_stage";

export type LibraryFolderRow = { artist_id: string | null; key: LibraryKey; name: string; drive_folder_id: string };

type Untyped = {
  select(columns: string): Untyped;
  eq(column: string, value: unknown): Untyped;
  is(column: string, value: null): Untyped;
  order(column: string, opts: { ascending: boolean }): Untyped;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: { message: string } | null }>;
};

/** Migration 269's tables aren't in the generated types yet. */
function table(db: DriveDb, name: "artist_library_folders" | "artist_assets"): Untyped {
  return (db as unknown as { from(t: string): Untyped }).from(name);
}

export function isMissingTable(message: string): boolean {
  return /does not exist|schema cache|Could not find the table/i.test(message);
}

/** Every row of the map, paged; `on: false` before migration 269 is applied. */
export async function loadLibraryMap(db: DriveDb): Promise<{ on: boolean; rows: LibraryFolderRow[] }> {
  try {
    const rows = await pageAll<LibraryFolderRow & { drive_folder_id: string }>(
      (from, to) => table(db, "artist_library_folders").select("artist_id, key, name, drive_folder_id").order("drive_folder_id", { ascending: true }).range(from, to),
      ["drive_folder_id"],
      "artist_library_folders",
    );
    return { on: true, rows };
  } catch (err) {
    if (isMissingTable(err instanceof Error ? err.message : String(err))) return { on: false, rows: [] };
    throw err;
  }
}

async function remember(db: DriveDb, row: LibraryFolderRow): Promise<void> {
  const res = await table(db, "artist_library_folders").upsert(row, { onConflict: "artist_id,key" });
  if (res.error) throw new Error(`artist_library_folders upsert: ${res.error.message}`);
}

export type LibraryFolders = { root: string; artist: string } & Record<LibraryChildKey, string>;

/**
 * The artist's library folders, made where missing. A renamed artist renames
 * their folder (the name is artists.name, verbatim). Returns null before
 * migration 269, or for an artist with no name.
 */
export async function ensureLibraryFolders(
  db: DriveDb,
  drive: DriveApi,
  artist: { id: string; name: string },
  log: TreeLog,
  loaded?: { on: boolean; rows: LibraryFolderRow[] },
): Promise<LibraryFolders | null> {
  if (!artist.name.trim()) return null;
  const map = loaded ?? (await loadLibraryMap(db));
  if (!map.on) return null;
  const known = (artistId: string | null, key: LibraryKey) => map.rows.find((r) => r.artist_id === artistId && r.key === key);
  const ensure = async (artistId: string | null, key: LibraryKey, name: string, parentId: string, label: string): Promise<string> => {
    const hit = known(artistId, key);
    if (hit) {
      if (hit.name !== name) {
        await drive.update(hit.drive_folder_id, { name });
        log.renamed.push(`${label} (was ${hit.name})`);
        const row = { ...hit, name };
        await remember(db, row);
        map.rows.splice(map.rows.indexOf(hit), 1, row);
      }
      return hit.drive_folder_id;
    }
    const id = await findOrCreateFolder(drive, parentId, name, log, label);
    const row: LibraryFolderRow = { artist_id: artistId, key, name, drive_folder_id: id };
    await remember(db, row);
    map.rows.push(row);
    return id;
  };
  const rootName = libraryRootName();
  const root = await ensure(null, LIBRARY_ROOT_KEY, rootName, drive.driveId, rootName);
  const folderName = artistFolderName(artist.name);
  const artistId = await ensure(artist.id, LIBRARY_ARTIST_KEY, folderName, root, `${rootName} / ${folderName}`);
  const out = { root, artist: artistId } as LibraryFolders;
  for (const child of LIBRARY_CHILDREN) out[child.key] = await ensure(artist.id, child.key, child.name, artistId, `${rootName} / ${folderName} / ${child.name}`);
  return out;
}

export type LibraryArtist = { id: string; name: string };

/**
 * Artists linked (event_artists) to an upcoming event: not past, not
 * cancelled, its client not archived (AL1: "for every artist linked to an
 * upcoming event").
 */
export function artistsDue(input: {
  today: string;
  events: readonly { id: string; client_id: string | null; event_date: string | null; status: string | null }[];
  clients: readonly { id: string; status: string | null }[];
  links: readonly { event_id: string; artist_id: string }[];
  artists: readonly { id: string; name: string }[];
}): LibraryArtist[] {
  const live = new Set(input.clients.filter((c) => !isArchivedClientStatus(c.status)).map((c) => c.id));
  const upcoming = new Set(
    input.events
      .filter((e) => e.client_id && live.has(e.client_id) && !isCancelled(e.status) && Boolean(e.event_date) && String(e.event_date).slice(0, 10) >= input.today)
      .map((e) => e.id),
  );
  const ids = new Set(input.links.filter((l) => upcoming.has(l.event_id)).map((l) => l.artist_id));
  return input.artists.filter((a) => ids.has(a.id) && a.name.trim()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Is this folder, or any folder above it, in the library? The map first,
 * then Drive's parents: a folder someone made by hand under 00 Artist
 * Library is in the library too.
 */
export async function isLibraryFolder(db: DriveDb, drive: DriveApi, folderId: string): Promise<boolean> {
  const map = await loadLibraryMap(db);
  const ids = new Set(map.rows.map((r) => r.drive_folder_id));
  const rootName = libraryRootName();
  let cursor: string | null = folderId;
  for (let depth = 0; cursor && depth < 12; depth += 1) {
    if (ids.has(cursor)) return true;
    const file: DriveFile | null = await drive.getFile(cursor).catch(() => null);
    if (!file) return false;
    const parent: string | null = file.parents?.[0] ?? null;
    if (file.name === rootName && parent === drive.driveId) return true;
    cursor = parent;
  }
  return false;
}

/**
 * Renders' shortcuts per AL4: made for a stage's top five shareable renders,
 * renamed when the rank or figure changed. Dropped ones are listed, not
 * removed (the export never deletes). A held render never gets one.
 */
export async function syncRenderShortcuts(
  drive: DriveApi,
  folders: Pick<LibraryFolders, "renders">,
  ranked: Readonly<Record<RankedStage, readonly RankedRender[]>>,
): Promise<ShortcutPlan> {
  const children = await drive.listChildren(folders.renders);
  const existing: ExistingShortcut[] = children
    .filter((f) => f.mimeType === SHORTCUT_MIME && f.appProperties?.[APP_TAG_KEY] === LIBRARY_SHORTCUT_TAG)
    .map((f) => ({ id: f.id, name: f.name, targetId: f.shortcutTargetId ?? f.appProperties?.[APP_ID_KEY] ?? null, stage: f.appProperties?.[LIBRARY_STAGE_KEY] ?? null }));
  const plan = planShortcuts(ranked, existing);
  for (const c of plan.create) {
    await drive.createShortcut({
      parentId: folders.renders,
      name: c.name,
      targetId: c.targetId,
      appProperties: { [APP_TAG_KEY]: LIBRARY_SHORTCUT_TAG, [APP_ID_KEY]: c.targetId, [LIBRARY_STAGE_KEY]: c.stage },
    });
  }
  for (const r of plan.rename) await drive.update(r.id, { name: r.to });
  return plan;
}

/** A file dropped into an artist's Clips or Statics becomes one shareable artist asset (AL1). Deduped on the Drive file id. */
export async function recordLibraryDrop(
  db: DriveDb,
  input: { artistId: string; kind: "clip" | "static"; fileId: string; name: string; now: Date },
): Promise<void> {
  const rights = libraryDropRights();
  const res = await table(db, "artist_assets").upsert(
    {
      artist_id: input.artistId,
      asset_key: `drive:${input.fileId}`,
      kind: input.kind,
      name: input.name,
      drive_file_id: input.fileId,
      owner_kind: rights.ownerKind,
      shareable: rights.shareable,
      held_reason: rights.heldReason,
      source_client_id: null,
      matched_by: "drive",
      updated_at: input.now.toISOString(),
    },
    { onConflict: "artist_id,asset_key" },
  );
  if (res.error) throw new Error(`artist_assets upsert: ${res.error.message}`);
}

/**
 * M4a: a montage file that is shareable (No text, artist material only) and
 * passed every check joins the library as an Off/Pixel render (AL1), keyed
 * m4_render:{render id}, which the backfill never removes.
 */
export async function recordLibraryRender(
  db: DriveDb,
  input: { artistId: string; renderId: string; name: string; driveFileId: string; storagePath: string; eventId: string; clientId: string; now: Date },
): Promise<void> {
  const res = await table(db, "artist_assets").upsert(
    {
      artist_id: input.artistId,
      asset_key: `m4_render:${input.renderId}`,
      kind: "render",
      name: input.name,
      drive_file_id: input.driveFileId,
      storage_path: input.storagePath,
      source_event_id: input.eventId,
      source_client_id: input.clientId,
      owner_kind: "offpixel",
      shareable: true,
      held_reason: null,
      lab_render_id: input.renderId,
      matched_by: "lab",
      material_at: input.now.toISOString(),
    },
    { onConflict: "artist_id,asset_key" },
  );
  if (res.error) throw new Error(`artist_assets upsert: ${res.error.message}`);
}
