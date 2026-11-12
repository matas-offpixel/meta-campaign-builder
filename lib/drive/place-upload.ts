/**
 * An event-page upload lands in the folder the operator chose (S23) and,
 * for 01 Open files and Artist clips, follows that folder's import at once
 * (S22, HS15) instead of waiting for the changes feed.
 *
 * The creatives row (2026-11-11-creative-lab-upload-owner, HU1, HU4) posts a
 * D5 key, {stage}/owner/{artist:id|library:id|promoter}/{videos|statics}: the
 * owner folder, then the type folder, are made at Upload and recorded in the
 * map, and a second upload reuses them. A stage folder never takes the file
 * itself, and neither do 03 Creatives or its stage parents (1 Signup, 2
 * Presale, 3 On sale). HU5: a key with no folder in the map and no spec — a stale client's
 * retired …/content — is refused; nothing named Content is ever made.
 */

import { APP_ID_KEY, APP_TAG_KEY, type DriveApi } from "./client.ts";
import { rowById, rowsWhere, type DriveDb } from "./db.ts";
import {
  artistClipsKey,
  ensureArtistFolders,
  ensureEventKey,
  ensureRouteFolder,
  findOrCreateFolder,
  type ClientRow,
  type EventRow,
} from "./folders.ts";
import { loadLineupArtists } from "./lineup.ts";
import { labArtistFolderName } from "./owner.ts";
import { FOLDER_NOT_IN_TREE, STAGE_PARENT_KEYS, TREE_NOT_MADE } from "./panel.ts";
import { labArtistForLibrary } from "../creative-lab/lineup.ts";
import { importArtistClips } from "../creative-lab/clip-intake.ts";
import { folderImport } from "./pickup.ts";
import { NO_FOLDER } from "./share.ts";
import { ARTIST_CLIPS_KEY, PRESS_KITS_KEY, isFilingStage, ownerSpec, promoterOwner, specFor, typeSpec, type DriveOwner } from "./tree.ts";

const CREATIVES_KEY = /^(.+)\/owner\/(artist|library|promoter)(?::([^/]+))?\/(videos|statics)$/;

/** The parts of a creatives-row key, or null for any other key. */
export function parseCreativesKey(key: string): { stageKey: string; owner: "artist" | "library" | "promoter"; id: string | null; kind: "video" | "static" } | null {
  const match = CREATIVES_KEY.exec(key);
  if (!match || !isFilingStage(match[1]!)) return null;
  const owner = match[2] as "artist" | "library" | "promoter";
  if ((owner === "promoter") !== (match[3] == null)) return null;
  return { stageKey: match[1]!, owner, id: match[3] ?? null, kind: match[4] === "videos" ? "video" : "static" };
}

/** The owner a creatives-row key names, resolved on the server (names are never taken from the client). */
async function creativesOwner(
  db: DriveDb,
  event: EventRow,
  client: ClientRow,
  userId: string,
  parsed: NonNullable<ReturnType<typeof parseCreativesKey>>,
): Promise<DriveOwner> {
  const lineup = await loadLineupArtists(db, event.id);
  if (parsed.owner === "promoter") return promoterOwner(client.name, lineup.map((artist) => artist.name));
  if (parsed.owner === "artist") {
    const lab = await rowById(db, "creative_lab_artists", parsed.id);
    if (!lab || lab.client_id !== client.id) throw new Error(FOLDER_NOT_IN_TREE);
    return { kind: "artist", artistId: lab.id, name: await labArtistFolderName(db, lab) };
  }
  const artist = lineup.find((row) => row.libraryArtistId === parsed.id);
  if (!artist) throw new Error(FOLDER_NOT_IN_TREE);
  const event2 = await rowById(db, "events", event.id);
  const labArtistId = await labArtistForLibrary(db as never, { userId: event2?.user_id || userId, clientId: client.id, libraryArtistId: artist.libraryArtistId, name: artist.name });
  return { kind: "artist", artistId: labArtistId, name: artist.name };
}

export type PlaceChoice = {
  key: string;
  artistName: string | null;
};

export function appKeepsFile(key: string): boolean {
  return key === "01" || key.startsWith(`${ARTIST_CLIPS_KEY}/`) || key === ARTIST_CLIPS_KEY || key.startsWith(`${PRESS_KITS_KEY}/`) || key === PRESS_KITS_KEY;
}

async function parentFor(db: DriveDb, drive: DriveApi, event: EventRow, client: ClientRow, choice: PlaceChoice, userId: string): Promise<{ parentId: string; artistLibraryId: string | null; missName: string | null }> {
  if (!event.drive_folder_id) throw new Error(NO_FOLDER);
  const creatives = parseCreativesKey(choice.key);
  if (creatives) {
    const owner = await creativesOwner(db, event, client, userId, creatives);
    const o = ownerSpec(creatives.stageKey, owner);
    let parentId: string;
    try {
      parentId = await ensureRouteFolder(db, drive, event, client, { stageKey: creatives.stageKey, owner: o, type: typeSpec(o.key, creatives.kind) });
    } catch (err) {
      if (err instanceof Error && err.message === FOLDER_NOT_IN_TREE) throw err;
      throw new Error(TREE_NOT_MADE);
    }
    return { parentId, artistLibraryId: null, missName: null };
  }
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
  // A stage that takes creatives never takes the file itself (U1, U2), and a key
  // the tree can't resolve — the retired …/content of a new cycle — is refused (HU5).
  if (isFilingStage(choice.key) || STAGE_PARENT_KEYS.includes(choice.key)) throw new Error(FOLDER_NOT_IN_TREE);
  const map = await rowsWhere(db, "drive_folders", "event_id", event.id);
  if (!map.some((row) => row.key === choice.key) && !specFor(choice.key)) throw new Error(FOLDER_NOT_IN_TREE);
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
  const where = await parentFor(db, drive, args.event, args.client, args.choice, args.userId);
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
  if (args.choice.key === "02/venue-crowd") {
    const event = await rowById(db, "events", args.event.id);
    await importArtistClips(db as never, {
      asPromoter: { userId: event?.user_id || args.userId, rightsRef: "Venue & crowd" },
      eventId: args.event.id,
      maxNew: 1,
      source: "file",
      folderUrl: `drive-export:${file.id}`,
      listing: {
        list: async () => [{ sourceFileId: file.id, name: file.name, size: args.bytes.byteLength }],
        download: async () => Buffer.from(args.bytes),
      },
    });
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
