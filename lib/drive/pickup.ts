/**
 * Drive → app (S22, HS14). Reads the Shared Drive's changes feed from the
 * stored page token (drive_change_cursors, migration 219) and, for each new
 * file:
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
 */

import { isArchivedClientStatus } from "../db/client-status.ts";
import { importArtistClips, type ClipImportResult } from "../creative-lab/clip-intake.ts";
import { labArtistForLibrary } from "../creative-lab/lineup.ts";
import type { ServiceRoleDb } from "../creative-lab/load.ts";
import { APP_TAG_KEY, FOLDER_MIME, SHORTCUT_MIME, type DriveApi, type DriveChange, type DriveFile } from "./client.ts";
import { allRows, rowById, rowsWhere, type DriveDb, type RowOf } from "./db.ts";
import { loadLineupArtists, type LineupArtist } from "./lineup.ts";
import { ARTIST_CLIPS_KEY, BRAND_KIT_KEY, isCancelled } from "./tree.ts";

/** Folder depth walked up from a file to find a folder the map knows. */
const MAX_DEPTH = 6;
export const PICKUP_MAX_PAGES = 20;

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
}) => Promise<ClipImportResult>;

type MapRow = RowOf<"drive_folders">;

type Located =
  | { kind: "kit"; row: MapRow }
  | { kind: "artist"; row: MapRow; libraryArtistId: string }
  | { kind: "artist_folder"; row: MapRow; folderId: string; folderName: string }
  | { kind: "venue"; row: MapRow }
  | { kind: "elsewhere" };

/** The default import: the existing folder import over a one-file listing of this Drive file. */
export function folderImport(db: ServiceRoleDb, deps: Pick<Parameters<typeof importArtistClips>[1], "upload" | "probe" | "now"> = {}): ImportClip {
  return ({ labArtistId, eventId, file, download }) =>
    importArtistClips(db, {
      ...deps,
      artistId: labArtistId,
      eventId,
      maxNew: 1,
      folderUrl: `drive-export:${file.id}`,
      listing: {
        list: async () => [{ sourceFileId: file.id, name: file.name, size: file.size ?? 0 }],
        download: async () => Buffer.from(await download()),
      },
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
  opts: { now?: Date; maxPages?: number; importClip?: ImportClip } = {},
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
  const maxPages = opts.maxPages ?? PICKUP_MAX_PAGES;

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
      const imported = await importArtistClips(db as unknown as ServiceRoleDb, {
        asPromoter: { userId: event.user_id, rightsRef: "Venue & crowd" },
        eventId: event.id,
        maxNew: 1,
        source: "file",
        folderUrl: `drive-export:${file.id}`,
        listing: {
          list: async () => [{ sourceFileId: file.id, name: file.name, size: file.size ?? 0 }],
          download: async () => Buffer.from(await drive.download(file.id)),
        },
      });
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
    const imported = await importClip({ labArtistId, eventId: event.id, file, download: () => drive.download(file.id) });
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
