/**
 * An event-page upload lands in the folder the operator chose (S23) and,
 * for 01 Open files and Artist clips, follows that folder's import at once
 * (S22, HS15) instead of waiting for the changes feed.
 */

import { APP_ID_KEY, APP_TAG_KEY, type DriveApi } from "./client.ts";
import { rowById, rowsWhere, type DriveDb } from "./db.ts";
import {
  artistClipsKey,
  ensureArtistFolders,
  ensureEventKey,
  findOrCreateFolder,
  type ClientRow,
  type EventRow,
} from "./folders.ts";
import { loadLineupArtists } from "./lineup.ts";
import { labArtistForLibrary } from "../creative-lab/lineup.ts";
import { folderImport } from "./pickup.ts";
import { NO_FOLDER } from "./share.ts";
import { ARTIST_CLIPS_KEY, PRESS_KITS_KEY } from "./tree.ts";

export type PlaceChoice = {
  key: string;
  artistName: string | null;
};

export function appKeepsFile(key: string): boolean {
  return key === "01" || key.startsWith(`${ARTIST_CLIPS_KEY}/`) || key === ARTIST_CLIPS_KEY || key.startsWith(`${PRESS_KITS_KEY}/`) || key === PRESS_KITS_KEY;
}

async function parentFor(db: DriveDb, drive: DriveApi, event: EventRow, client: ClientRow, choice: PlaceChoice): Promise<{ parentId: string; artistLibraryId: string | null; missName: string | null }> {
  if (!event.drive_folder_id) throw new Error(NO_FOLDER);
  if (choice.key.startsWith(`${ARTIST_CLIPS_KEY}/`) || choice.key === ARTIST_CLIPS_KEY) {
    const lineup = await loadLineupArtists(db, event.id);
    const artist = choice.artistName ? lineup.find((row) => row.name === choice.artistName) ?? null : null;
    if (artist) {
      await ensureArtistFolders(db, drive, event, client, [artist]);
      const map = await rowsWhere(db, "drive_folders", "event_id", event.id);
      const hit = map.find((row) => row.key === artistClipsKey(artist.libraryArtistId));
      if (!hit) throw new Error(NO_FOLDER);
      return { parentId: hit.drive_folder_id, artistLibraryId: artist.libraryArtistId, missName: null };
    }
    const clips = await ensureEventKey(db, drive, event, client, ARTIST_CLIPS_KEY);
    const name = choice.artistName?.trim() || "Artist clips";
    const parentId = name === "Artist clips" ? clips : await findOrCreateFolder(drive, clips, name, { created: [], found: [], renamed: [] }, name);
    return { parentId, artistLibraryId: null, missName: choice.artistName };
  }
  if (choice.key.startsWith(`${PRESS_KITS_KEY}/`) || choice.key === PRESS_KITS_KEY) {
    const kits = await ensureEventKey(db, drive, event, client, PRESS_KITS_KEY);
    const name = choice.artistName?.trim();
    const parentId = name ? await findOrCreateFolder(drive, kits, name, { created: [], found: [], renamed: [] }, name) : kits;
    return { parentId, artistLibraryId: null, missName: null };
  }
  const parentId = await ensureEventKey(db, drive, event, client, choice.key);
  return { parentId, artistLibraryId: null, missName: null };
}

export async function placeUploadedFile(
  db: DriveDb,
  drive: DriveApi,
  args: {
    event: EventRow;
    client: ClientRow;
    userId: string;
    choice: PlaceChoice;
    name: string;
    mimeType: string;
    bytes: Uint8Array;
    now?: Date;
  },
): Promise<{ fileId: string }> {
  const now = args.now ?? new Date();
  const where = await parentFor(db, drive, args.event, args.client, args.choice);
  const file = await drive.uploadFile({
    parentId: where.parentId,
    name: args.name,
    mimeType: args.mimeType || "application/octet-stream",
    bytes: args.bytes,
    appProperties: { [APP_TAG_KEY]: "upload", [APP_ID_KEY]: args.event.id },
  });
  if (args.choice.key === "01") {
    const res = await db.from("drive_kit_audit_files").upsert(
      {
        client_id: args.client.id,
        event_id: args.event.id,
        drive_file_id: file.id,
        name: file.name,
        mime_type: file.mimeType || null,
        folder_key: "01",
        seen_at: now.toISOString(),
      },
      { onConflict: "drive_file_id", ignoreDuplicates: true },
    );
    if (res.error) throw new Error(`drive_kit_audit_files: ${res.error.message}`);
  }
  if (where.missName) {
    const res = await db.from("drive_artist_folder_misses").upsert(
      { event_id: args.event.id, drive_folder_id: where.parentId, folder_name: where.missName, seen_at: now.toISOString() },
      { onConflict: "event_id,drive_folder_id", ignoreDuplicates: true },
    );
    if (res.error) throw new Error(`drive_artist_folder_misses: ${res.error.message}`);
  }
  if (where.artistLibraryId && args.choice.artistName) {
    const event = await rowById(db, "events", args.event.id);
    const userId = event?.user_id || args.userId;
    const labArtistId = await labArtistForLibrary(db as never, {
      userId,
      clientId: args.client.id,
      libraryArtistId: where.artistLibraryId,
      name: args.choice.artistName,
    });
    await folderImport(db as never)({
      labArtistId,
      eventId: args.event.id,
      file,
      download: () => drive.download(file.id),
    });
  }
  return { fileId: file.id };
}
