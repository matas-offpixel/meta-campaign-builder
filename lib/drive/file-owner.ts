/**
 * lib/drive/file-owner.ts — whose footage a Drive file is (M3a).
 *
 * attach_drive_creatives takes files from anywhere in the Off/Pixel shared
 * drive, and the prod transcript's runner checks its file the same way, so
 * both use this one resolution:
 *   1. walk the file's parents up to the shared drive's root;
 *   2. every folder on that path the app has mapped (drive_folders, any
 *      level: a client's folder, an event folder, a stage) gives its
 *      client_id, and its event_id when it has one (a client folder's is
 *      null, never passed on);
 *   3. when no mapped folder names a client, a "[CODE]" in a folder's name
 *      gives the event, and the event its client;
 *   4. a path under "00 Artist Library" (artist_library_folders, else the
 *      library's root folder by name under the drive's root) is artist
 *      material, shareable across clients (record 2026-11-25-artist-library).
 *
 * Reads only: Drive metadata and three database reads. Relative imports only.
 */
import type { DriveApi } from "./client.ts";

type LooseDb = { from(table: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const MAX_DEPTH = 20;
export const ARTIST_LIBRARY_ROOT = "00 Artist Library";

export interface DriveFileOwner {
  /** The path reaches the shared drive's root. */
  inSharedDrive: boolean;
  /** Folder names, top-down. */
  path: string[];
  /** The clients whose folders hold it (normally one). */
  clientIds: string[];
  /** The events whose trees hold it. */
  eventIds: string[];
  /** Under the artist library. */
  artistLibrary: boolean;
}

const CODE = /\[([A-Z0-9][A-Z0-9_-]{2,40})\]/;

/** Whose a folder's contents are, starting from `folderId` (a file's parent). */
export async function resolveDriveOwner(db: LooseDb, drive: Pick<DriveApi, "getFile" | "driveId">, folderId: string): Promise<DriveFileOwner> {
  const chain: Array<{ id: string; name: string }> = [];
  let cursor: string | null = folderId;
  let inSharedDrive = false;
  for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
    if (cursor === drive.driveId) {
      inSharedDrive = true;
      break;
    }
    const folder = await drive.getFile(cursor);
    if (!folder || folder.trashed) break;
    chain.push({ id: folder.id, name: folder.name });
    cursor = folder.parents?.[0] ?? null;
  }
  const ids = chain.map((c) => c.id);
  const path = chain.map((c) => c.name).reverse();
  const out: DriveFileOwner = { inSharedDrive, path, clientIds: [], eventIds: [], artistLibrary: false };
  if (!inSharedDrive || ids.length === 0) return out;

  const mapped = await db.from("drive_folders").select("event_id, client_id").in("drive_folder_id", ids);
  const rows = (mapped.error ? [] : (mapped.data ?? [])) as Array<{ event_id: string | null; client_id: string | null }>;
  const clients = new Set(rows.map((r) => r.client_id).filter((v): v is string => Boolean(v)));
  const events = new Set(rows.map((r) => r.event_id).filter((v): v is string => Boolean(v)));

  if (clients.size === 0) {
    const codes = [...new Set(chain.map((c) => CODE.exec(c.name)?.[1]).filter((v): v is string => Boolean(v)))];
    if (codes.length > 0) {
      const byCode = await db.from("events").select("id, client_id").in("event_code", codes);
      for (const e of (byCode.error ? [] : (byCode.data ?? [])) as Array<{ id: string; client_id: string | null }>) {
        events.add(e.id);
        if (e.client_id) clients.add(e.client_id);
      }
    }
  }

  const lib = await db.from("artist_library_folders").select("drive_folder_id").in("drive_folder_id", ids);
  const inLibraryTable = !lib.error && ((lib.data ?? []) as unknown[]).length > 0;
  // The library's root sits directly under the drive's root: the last folder on the walk.
  const top = chain[chain.length - 1];
  out.artistLibrary = inLibraryTable || top?.name === ARTIST_LIBRARY_ROOT;
  out.clientIds = [...clients];
  out.eventIds = [...events];
  return out;
}

/** Whether a file may go on a show's draft: the show's client's own, or artist material. */
export function mayUseFor(owner: DriveFileOwner, clientId: string | null): "own" | "artist_library" | "other_client" | "unknown" {
  if (clientId && owner.clientIds.includes(clientId)) return "own";
  if (owner.artistLibrary) return "artist_library";
  return owner.clientIds.length > 0 ? "other_client" : "unknown";
}
