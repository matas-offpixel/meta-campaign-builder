/**
 * Drive → app (S22, HS14). Reads the Shared Drive's changes feed from the
 * stored page token (drive_change_cursors, migration 219) and, for each new
 * file:
 *
 *   An original over the campaign-assets cap (200 MB) isn't stored: only its
 *   1080 render copy is, and the original is recorded with its Drive file id
 *   (migration 228) — Drive keeps the master.
 *
 *   - under an event's 02 Source / Artist clips / {artist} → the existing
 *     folder import (importArtistClips: dedupe by Drive file id and sha256,
 *     the 30 s trim; nothing about it changes) as that artist's clip on that
 *     event. {artist} must match a lineup name exactly — no trim, no
 *     case-fold. A folder that matches no one imports nothing and is recorded
 *     once in drive_artist_folder_misses for the event page's sentence.
 *   - under an event's 01 Open files or a client's _Brand kit → one
 *     drive_kit_audit_files row for the kit audit (H8). Nothing runs the
 *     audit yet.
 *
 * Skipped: removed and trashed files, folders, shortcuts, and every file the
 * export filed itself (appProperties tag) — our own renders never come back.
 * Archived clients and cancelled events import nothing.
 *
 * The first run stores the drive's start token and imports nothing older.
 * The token only moves past a page once that page is processed; a thrown
 * error leaves it where it was, so the page is read again (the import and
 * the audit rows dedupe). A file the import reports as failed is not retried
 * unless it changes again.
 *
 * A run that is killed (out of memory, out of time) throws nothing and saves
 * nothing, so on its own the next run would read the same page and die on
 * the same file every 15 minutes (11 Nov 2026: B3B12.mp4 and SWEELY 1.mp4).
 * Drive's page tokens can't mark a place inside a page, so before each clip
 * import the run writes that file's id on the cursor row (migration 230,
 * inflight_file_id / inflight_attempts) and clears it after. A run that
 * finds the marker still set knows the last run died on that file. After
 * PICKUP_MAX_ATTEMPTS deaths the file is recorded as failed and skipped, and
 * the page can finish. Moving the file again puts it back in the feed and
 * clears the count. Until migration 230 is applied the marker can't be
 * written and the run works as before.
 *
 * Clips are streamed from Drive to the function's temp disk (DriveApi
 * downloadTo), never read into memory whole.
 */

import { isArchivedClientStatus } from "../db/client-status.ts";
import { importArtistClips, type ClipFolderListing, type ClipImportResult } from "../creative-lab/clip-intake.ts";
import { labArtistForLibrary } from "../creative-lab/lineup.ts";
import type { ContentIdentity } from "../creatives/asset-registry.ts";
import type { ServiceRoleDb } from "../creative-lab/load.ts";
import { APP_TAG_KEY, FOLDER_MIME, SHORTCUT_MIME, type DriveApi, type DriveChange, type DriveFile } from "./client.ts";
import { allRows, rowById, rowsWhere, type DriveDb, type RowOf } from "./db.ts";
import { loadLineupArtists, type LineupArtist } from "./lineup.ts";
import { ARTIST_CLIPS_KEY, BRAND_KIT_KEY, isCancelled } from "./tree.ts";

/** Folder depth walked up from a file to find a folder the map knows. */
const MAX_DEPTH = 6;
export const PICKUP_MAX_PAGES = 20;
/** Runs a file may kill before the pickup records it as failed and moves past it. */
export const PICKUP_MAX_ATTEMPTS = 2;
export const KILLED_RUN_LINE = `Stopped the import ${PICKUP_MAX_ATTEMPTS} times without finishing (out of memory or time), so it was skipped — move it out of the folder and back to try again`;

export type PickupSkip = "removed" | "trashed" | "folder" | "shortcut" | "ours" | "elsewhere" | "archived_client" | "cancelled";

export type ClipImport = {
  fileId: string;
  name: string;
  eventId: string;
  artist: string;
  outcome: "imported" | "skipped" | "failed";
  reason: string | null;
};

export type PickupResult = {
  ok: true;
  firstRun: boolean;
  pages: number;
  changes: number;
  clips: ClipImport[];
  kitFiles: number;
  misses: string[];
  skipped: Partial<Record<PickupSkip, number>>;
  errors: string[];
};

export type ImportClip = (args: {
  labArtistId: string;
  eventId: string;
  file: DriveFile;
  download: () => Promise<Uint8Array>;
  /** Streams the file to disk (DriveApi downloadTo). When given, the import never holds the file in memory. */
  downloadTo?: (filePath: string) => Promise<ContentIdentity>;
}) => Promise<ClipImportResult>;

type MapRow = RowOf<"drive_folders">;

type Located =
  | { kind: "kit"; row: MapRow }
  | { kind: "artist"; row: MapRow; libraryArtistId: string }
  | { kind: "artist_folder"; row: MapRow; folderId: string; folderName: string }
  | { kind: "venue"; row: MapRow }
  | { kind: "elsewhere" };

/** A one-file listing of a Drive file: streamed to disk when `downloadTo` is given. */
export function oneFileListing(file: DriveFile, download: () => Promise<Uint8Array>, downloadTo?: (filePath: string) => Promise<ContentIdentity>): ClipFolderListing {
  return {
    list: async () => [{ sourceFileId: file.id, name: file.name, size: file.size ?? 0 }],
    download: async () => Buffer.from(await download()),
    ...(downloadTo ? { downloadToFile: async (_url: string, _file: unknown, filePath: string) => downloadTo(filePath) } : {}),
  };
}

type ImportDeps = Pick<Parameters<typeof importArtistClips>[1], "upload" | "probe" | "now" | "uploadFile" | "probeFile" | "renderProxyFile" | "maxStoredBytes">;

/** The default import: the existing folder import over a one-file listing of this Drive file. */
export function folderImport(db: ServiceRoleDb, deps: ImportDeps = {}): ImportClip {
  return ({ labArtistId, eventId, file, download, downloadTo }) =>
    importArtistClips(db, {
      ...deps,
      artistId: labArtistId,
      eventId,
      maxNew: 1,
      folderUrl: `drive-export:${file.id}`,
      listing: oneFileListing(file, download, downloadTo),
      // Migration 228: an original over the storage cap stays in Drive; only its 1080 render copy is stored.
      driveMaster: () => file.id,
    });
}

/** The import for a Venue & crowd file: the folder import as the event's promoter clip. */
export type ImportVenueClip = (args: {
  event: RowOf<"events">;
  file: DriveFile;
  download: () => Promise<Uint8Array>;
  downloadTo?: (filePath: string) => Promise<ContentIdentity>;
}) => Promise<ClipImportResult>;

export function venueImport(db: ServiceRoleDb, deps: ImportDeps = {}): ImportVenueClip {
  return ({ event, file, download, downloadTo }) =>
    importArtistClips(db, {
      ...deps,
      asPromoter: { userId: event.user_id, rightsRef: "Venue & crowd" },
      eventId: event.id,
      maxNew: 1,
      source: "file",
      folderUrl: `drive-export:${file.id}`,
      listing: oneFileListing(file, download, downloadTo),
      // Migration 228: an original over the storage cap stays in Drive; only its 1080 render copy is stored.
      driveMaster: () => file.id,
    });
}

async function readCursor(db: DriveDb, driveId: string): Promise<string | null> {
  const res = await db.from("drive_change_cursors").select("page_token").eq("drive_id", driveId).maybeSingle();
  if (res.error) throw new Error(`drive_change_cursors: ${res.error.message}`);
  return res.data?.page_token ?? null;
}

async function writeCursor(db: DriveDb, driveId: string, pageToken: string, now: Date): Promise<void> {
  const res = await db
    .from("drive_change_cursors")
    .upsert({ drive_id: driveId, page_token: pageToken, updated_at: now.toISOString() }, { onConflict: "drive_id" });
  if (res.error) throw new Error(`drive_change_cursors upsert: ${res.error.message}`);
}

type Inflight = { fileId: string; attempts: number };

/**
 * The cursor row's in-flight columns (migration 230). Not in the generated
 * types yet, so read and written untyped. Any error (the migration not
 * applied, most likely) turns the marker off for this run: the run then
 * works as it did before.
 */
type InflightTable = {
  select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  update(patch: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }> };
};

function inflightTable(db: DriveDb): InflightTable {
  return db.from("drive_change_cursors") as unknown as InflightTable;
}

async function readInflight(db: DriveDb, driveId: string): Promise<{ on: boolean; inflight: Inflight | null }> {
  const res = await inflightTable(db).select("inflight_file_id, inflight_attempts").eq("drive_id", driveId).maybeSingle();
  if (res.error) {
    console.warn(JSON.stringify({ step: "drive_pickup_inflight", off: true, error: res.error.message.slice(0, 160) }));
    return { on: false, inflight: null };
  }
  const row = (res.data ?? {}) as { inflight_file_id?: string | null; inflight_attempts?: number | null };
  return { on: true, inflight: row.inflight_file_id ? { fileId: row.inflight_file_id, attempts: Number(row.inflight_attempts) || 0 } : null };
}

async function writeInflight(db: DriveDb, driveId: string, inflight: Inflight | null, now: Date): Promise<boolean> {
  const res = await inflightTable(db)
    .update({
      inflight_file_id: inflight?.fileId ?? null,
      inflight_attempts: inflight?.attempts ?? 0,
      inflight_started_at: inflight ? now.toISOString() : null,
    })
    .eq("drive_id", driveId);
  if (res.error) {
    console.warn(JSON.stringify({ step: "drive_pickup_inflight", off: true, error: res.error.message.slice(0, 160) }));
    return false;
  }
  return true;
}

export function skipReason(change: DriveChange): PickupSkip | null {
  if (change.removed || !change.file) return "removed";
  if (change.file.trashed) return "trashed";
  if (change.file.mimeType === FOLDER_MIME) return "folder";
  if (change.file.mimeType === SHORTCUT_MIME) return "shortcut";
  if (change.file.appProperties?.[APP_TAG_KEY]) return "ours";
  return null;
}

/** Walk up from the file to the nearest folder the map knows, and say what that makes it. */
async function locate(file: DriveFile, index: ReadonlyMap<string, MapRow>, getFile: (id: string) => Promise<DriveFile | null>): Promise<Located> {
  let below: DriveFile | null = null;
  let cursor = file.parents?.[0] ?? null;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
    const row = index.get(cursor);
    if (row) {
      if (row.key === "01" || row.key === BRAND_KIT_KEY) return { kind: "kit", row };
      if (row.key === "02/venue-crowd") return { kind: "venue", row };
      if (row.key.startsWith(`${ARTIST_CLIPS_KEY}/`)) return { kind: "artist", row, libraryArtistId: row.key.slice(ARTIST_CLIPS_KEY.length + 1) };
      if (row.key === ARTIST_CLIPS_KEY && below) return { kind: "artist_folder", row, folderId: below.id, folderName: below.name };
      return { kind: "elsewhere" };
    }
    const folder = await getFile(cursor);
    if (!folder) return { kind: "elsewhere" };
    below = folder;
    cursor = folder.parents?.[0] ?? null;
  }
  return { kind: "elsewhere" };
}

export async function runDrivePickup(
  db: DriveDb,
  drive: DriveApi,
  opts: { now?: Date; maxPages?: number; importClip?: ImportClip; importVenueClip?: ImportVenueClip } = {},
): Promise<PickupResult> {
  const now = opts.now ?? new Date();
  const result: PickupResult = { ok: true, firstRun: false, pages: 0, changes: 0, clips: [], kitFiles: 0, misses: [], skipped: {}, errors: [] };
  const stored = await readCursor(db, drive.driveId);
  if (!stored) {
    await writeCursor(db, drive.driveId, await drive.startPageToken(), now);
    result.firstRun = true;
    return result;
  }

  const index = new Map((await allRows(db, "drive_folders")).map((row) => [row.drive_folder_id, row]));
  const folders = new Map<string, DriveFile | null>();
  const getFile = async (id: string) => {
    if (!folders.has(id)) folders.set(id, await drive.getFile(id));
    return folders.get(id)!;
  };
  const events = new Map<string, RowOf<"events"> | null>();
  const clients = new Map<string, RowOf<"clients"> | null>();
  const lineups = new Map<string, LineupArtist[]>();
  const eventOf = async (id: string) => {
    if (!events.has(id)) events.set(id, await rowById(db, "events", id));
    return events.get(id)!;
  };
  const clientOf = async (id: string) => {
    if (!clients.has(id)) clients.set(id, await rowById(db, "clients", id));
    return clients.get(id)!;
  };
  const lineupOf = async (eventId: string) => {
    if (!lineups.has(eventId)) lineups.set(eventId, await loadLineupArtists(db, eventId));
    return lineups.get(eventId)!;
  };
  const skip = (reason: PickupSkip) => {
    result.skipped[reason] = (result.skipped[reason] ?? 0) + 1;
  };
  const importClip = opts.importClip ?? folderImport(db as unknown as ServiceRoleDb);
  const importVenueClip = opts.importVenueClip ?? venueImport(db as unknown as ServiceRoleDb);
  const maxPages = opts.maxPages ?? PICKUP_MAX_PAGES;
  const marker = await readInflight(db, drive.driveId);
  let inflight = marker.inflight;
  const downloadOf = (file: DriveFile) => ({
    download: () => drive.download(file.id),
    ...(drive.downloadTo ? { downloadTo: (filePath: string) => drive.downloadTo!(file.id, filePath) } : {}),
  });

  /**
   * Runs one clip import with the file's id on the cursor row, or, when the
   * last PICKUP_MAX_ATTEMPTS runs died on this file, records it as failed
   * and moves on. Returns null when the file was skipped.
   */
  async function guarded(file: DriveFile, eventId: string, artist: string, run: () => Promise<ClipImportResult>): Promise<ClipImportResult | null> {
    if (!marker.on) return run();
    const again = inflight?.fileId === file.id ? inflight.attempts : 0;
    if (again >= PICKUP_MAX_ATTEMPTS) {
      console.warn(JSON.stringify({ step: "drive_pickup_killed_file", eventId, name: file.name, attempts: again }));
      result.clips.push({ fileId: file.id, name: file.name, eventId, artist, outcome: "failed", reason: KILLED_RUN_LINE });
      if (await writeInflight(db, drive.driveId, null, now)) inflight = null;
      return null;
    }
    const next = { fileId: file.id, attempts: again + 1 };
    if (await writeInflight(db, drive.driveId, next, now)) inflight = next;
    // Cleared whether the import returns or throws: only a killed run leaves it set.
    try {
      return await run();
    } finally {
      if (await writeInflight(db, drive.driveId, null, now)) inflight = null;
    }
  }

  let token = stored;
  try {
    while (result.pages < maxPages) {
      const page = await drive.listChanges(token);
      result.pages += 1;
      for (const change of page.changes) {
        result.changes += 1;
        const reason = skipReason(change);
        if (reason) {
          skip(reason);
          continue;
        }
        await handle(change.file!);
      }
      if (page.newStartPageToken) {
        token = page.newStartPageToken;
        break;
      }
      if (!page.nextPageToken) break;
      token = page.nextPageToken;
    }
  } catch (err) {
    result.errors.push((err instanceof Error ? err.message : String(err)).replace(/https?:\/\/\S+/g, "").slice(0, 300));
  }
  // A marker left by a run that died on a file this run didn't meet again (moved away since): this run lived, so clear it.
  if (marker.on && inflight) await writeInflight(db, drive.driveId, null, now);
  // Moves only past pages that finished: a page that threw is read again next run.
  if (token !== stored) await writeCursor(db, drive.driveId, token, now);
  return result;

  async function handle(file: DriveFile): Promise<void> {
    const where = await locate(file, index, getFile);
    if (where.kind === "elsewhere") return skip("elsewhere");
    const client = await clientOf(where.row.client_id);
    if (!client || isArchivedClientStatus(client.status)) return skip("archived_client");
    const event = where.row.event_id ? await eventOf(where.row.event_id) : null;
    if (event && isCancelled(event.status)) return skip("cancelled");

    if (where.kind === "kit") {
      const res = await db.from("drive_kit_audit_files").upsert(
        {
          client_id: client.id,
          event_id: where.row.event_id,
          drive_file_id: file.id,
          name: file.name,
          mime_type: file.mimeType || null,
          folder_key: where.row.key,
          seen_at: now.toISOString(),
        },
        { onConflict: "drive_file_id", ignoreDuplicates: true },
      );
      if (res.error) throw new Error(`drive_kit_audit_files: ${res.error.message}`);
      result.kitFiles += 1;
      return;
    }

    if (!event) return skip("elsewhere");
    if (where.kind === "venue") {
      const imported = await guarded(file, event.id, "promoter", () => importVenueClip({ event, file, ...downloadOf(file) }));
      if (!imported) return;
      for (const row of imported.files) {
        result.clips.push({ fileId: file.id, name: row.name, eventId: event.id, artist: "promoter", outcome: row.outcome, reason: row.reason });
      }
      return;
    }
    const lineup = await lineupOf(event.id);
    let artist: LineupArtist | undefined;
    if (where.kind === "artist") {
      artist = lineup.find((row) => row.libraryArtistId === where.libraryArtistId);
    } else {
      // Exact: no trim, no case-fold, no normalising (S22).
      artist = lineup.find((row) => row.name === where.folderName);
      if (!artist) {
        const res = await db
          .from("drive_artist_folder_misses")
          .upsert(
            { event_id: event.id, drive_folder_id: where.folderId, folder_name: where.folderName, seen_at: now.toISOString() },
            { onConflict: "event_id,drive_folder_id", ignoreDuplicates: true },
          );
        if (res.error) throw new Error(`drive_artist_folder_misses: ${res.error.message}`);
        if (!result.misses.includes(where.folderName)) result.misses.push(where.folderName);
        return;
      }
    }
    if (!artist) return skip("elsewhere");
    const labArtistId = await labArtistFor(db, event, client, artist);
    const imported = await guarded(file, event.id, artist.name, () => importClip({ labArtistId, eventId: event.id, file, ...downloadOf(file) }));
    if (!imported) return;
    for (const row of imported.files) {
      result.clips.push({ fileId: file.id, name: row.name, eventId: event.id, artist: artist.name, outcome: row.outcome, reason: row.reason });
    }
    if (imported.folderError) {
      result.clips.push({ fileId: file.id, name: file.name, eventId: event.id, artist: artist.name, outcome: "failed", reason: imported.folderError });
    }
  }
}

/** The client's Lab row for a lineup artist: linked by library id, else the exact name, else made the way the Lab makes one. */
async function labArtistFor(db: DriveDb, event: RowOf<"events">, client: RowOf<"clients">, artist: LineupArtist): Promise<string> {
  const rows = await rowsWhere(db, "creative_lab_artists", "client_id", client.id);
  const linked = rows.find((row) => row.artist_id === artist.libraryArtistId) ?? rows.find((row) => row.name === artist.name);
  if (linked) return linked.id;
  return labArtistForLibrary(db as unknown as ServiceRoleDb, {
    userId: event.user_id,
    clientId: client.id,
    libraryArtistId: artist.libraryArtistId,
    name: artist.name,
  });
}

/** A cron_runs row only when something came in or failed. */
export function pickupShouldRecord(result: Pick<PickupResult, "clips" | "kitFiles" | "misses" | "errors" | "firstRun">): boolean {
  return result.firstRun || result.clips.length + result.kitFiles + result.misses.length + result.errors.length > 0;
}
