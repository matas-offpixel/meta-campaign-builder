/**
 * Link an existing folder or create the event tree (S24, HS16). Linking
 * sets drive_folder_id and drive_folder_linked, then adds only the tree
 * folders that are missing. Nothing already in the folder is moved or renamed.
 */

import { FOLDER_MIME, type DriveApi } from "./client.ts";
import type { DriveDb } from "./db.ts";
import { ensureEventTree, type ClientRow, type EventRow } from "./folders.ts";
import { CANT_OPEN_FOLDER, CANCELLED_TREE, NO_CLIENT_TREE, TREE_NOT_MADE, archivedClientTree } from "./panel.ts";

export function treeFailureSentence(skipped: string | null, clientName: string): string {
  if (skipped === "no_client") return NO_CLIENT_TREE;
  if (skipped === "archived_client") return archivedClientTree(clientName);
  if (skipped === "cancelled") return CANCELLED_TREE;
  return TREE_NOT_MADE;
}

export function parseDriveFolderId(link: string): string | null {
  const text = link.trim();
  const folders = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folders?.[1]) return folders[1];
  const query = text.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (query?.[1]) return query[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(text)) return text;
  return null;
}

export type ResolvedFolder = {
  id: string;
  name: string;
  fileCount: number;
  place: string;
};

export async function resolveDriveFolder(drive: DriveApi, folderId: string): Promise<{ ok: true } & ResolvedFolder | { ok: false; error: string }> {
  const file = await drive.getFile(folderId);
  if (!file || file.trashed || file.mimeType !== FOLDER_MIME) return { ok: false, error: CANT_OPEN_FOLDER };
  const children = await drive.listChildren(folderId);
  const fileCount = children.filter((child) => child.mimeType !== FOLDER_MIME).length;
  const names: string[] = [];
  let cursor = file.parents?.[0] ?? null;
  for (let depth = 0; cursor && cursor !== drive.driveId && depth < 8; depth += 1) {
    const parent = await drive.getFile(cursor);
    if (!parent) break;
    names.unshift(parent.name);
    cursor = parent.parents?.[0] ?? null;
  }
  const place = ["Off / Pixel", ...names].join(" › ");
  return { ok: true, id: file.id, name: file.name, fileCount, place };
}

/** Use the folder as it is and add the tree's missing folders inside it. */
export async function linkEventFolder(db: DriveDb, drive: DriveApi, event: EventRow, client: ClientRow, folderId: string): Promise<string> {
  const res = await db.from("events").update({ drive_folder_id: folderId, drive_folder_linked: true }).eq("id", event.id);
  if (res.error) throw new Error(`events update: ${res.error.message}`);
  event.drive_folder_id = folderId;
  event.drive_folder_linked = true;
  const made = await ensureEventTree(db, drive, event, client);
  if (!made.folderId) throw new Error(treeFailureSentence(made.skipped, client.name));
  return made.folderId;
}

/** The standard tree under the client folder (the client folder first, if it is missing). */
export async function createEventTree(db: DriveDb, drive: DriveApi, event: EventRow, client: ClientRow): Promise<string> {
  const made = await ensureEventTree(db, drive, event, client);
  if (!made.folderId) throw new Error(treeFailureSentence(made.skipped, client.name));
  return made.folderId;
}
