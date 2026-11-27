/**
 * Read-only finder for duplicate tree folders (27 Nov): a folder in an
 * event's tree that has the same name as a mapped sibling (a drive_folders
 * row under the same parent) but is not in drive_folders itself. That is
 * what two runs creating the same key at once leave behind. The event folder
 * is checked under the client folder the same way.
 *
 * Lists only (files.list): never moves, renames, trashes or deletes.
 */

import { APP_TAG_KEY, FOLDER_MIME, type DriveApi, type DriveFile } from "./client.ts";
import { rowsWhere, type DriveDb, type RowOf } from "./db.ts";
import { CLIENT_KEY, EVENT_KEY, type FolderKey } from "./tree.ts";

export type TreeDuplicate = {
  id: string;
  name: string;
  createdTime: string | null;
  /** Nothing inside it (files or folders, trashed ones aside). */
  empty: boolean;
  /** Inside it, at any depth: folders and files (not folders). A copy of the tree's own sub-folders has files 0. */
  folders: number;
  files: number;
  parentId: string;
  /** The mapped folder of the same name beside it. */
  mapped: { id: string; key: FolderKey; createdTime: string | null };
};

export type DuplicateScan = {
  foldersListed: number;
  /** The mapped event folder, for its created time. */
  eventFolder: { id: string; name: string; createdTime: string | null; tagged: boolean } | null;
  duplicates: TreeDuplicate[];
};

/** Folders and files under a folder, at any depth (lists only). */
async function countInside(drive: DriveApi, folderId: string, depth = 0): Promise<{ folders: number; files: number }> {
  const inside = await drive.listChildren(folderId);
  let folders = 0;
  let files = 0;
  for (const child of inside) {
    if (child.mimeType !== FOLDER_MIME) {
      files += 1;
      continue;
    }
    folders += 1;
    if (depth < 6) {
      const below = await countInside(drive, child.id, depth + 1);
      folders += below.folders;
      files += below.files;
    }
  }
  return { folders, files };
}

type EventLike = Pick<RowOf<"events">, "id" | "client_id" | "drive_folder_id">;

export async function findTreeDuplicates(db: DriveDb, drive: DriveApi, event: EventLike): Promise<DuplicateScan> {
  const rows = await rowsWhere(db, "drive_folders", "event_id", event.id);
  const keyById = new Map<string, FolderKey>(rows.map((row) => [row.drive_folder_id, row.key]));
  if (event.drive_folder_id && !keyById.has(event.drive_folder_id)) keyById.set(event.drive_folder_id, EVENT_KEY);
  const duplicates: TreeDuplicate[] = [];
  let foldersListed = 0;
  let eventFolderInfo: DuplicateScan["eventFolder"] = null;

  const scan = async (parentId: string, children: DriveFile[]) => {
    const mappedByName = new Map<string, DriveFile>();
    for (const child of children) if (keyById.has(child.id) && !mappedByName.has(child.name)) mappedByName.set(child.name, child);
    for (const child of children) {
      const mapped = mappedByName.get(child.name);
      if (!mapped || keyById.has(child.id)) continue;
      const inside = await countInside(drive, child.id);
      duplicates.push({
        id: child.id,
        name: child.name,
        createdTime: child.createdTime ?? null,
        empty: inside.folders + inside.files === 0,
        ...inside,
        parentId,
        mapped: { id: mapped.id, key: keyById.get(mapped.id)!, createdTime: mapped.createdTime ?? null },
      });
    }
  };

  // The event folder beside a same-name copy under the client folder.
  const eventFolderId = rows.find((row) => row.key === EVENT_KEY)?.drive_folder_id ?? event.drive_folder_id;
  if (eventFolderId && event.client_id) {
    const clientRows = (await rowsWhere(db, "drive_folders", "client_id", event.client_id)).filter((row) => row.event_id == null && row.key === CLIENT_KEY);
    const eventFolder = await drive.getFile(eventFolderId);
    if (eventFolder) {
      eventFolderInfo = { id: eventFolder.id, name: eventFolder.name, createdTime: eventFolder.createdTime ?? null, tagged: Boolean(eventFolder.appProperties?.[APP_TAG_KEY]) };
    }
    const clientFolderId = eventFolder?.parents?.[0] ?? clientRows[0]?.drive_folder_id;
    if (eventFolder && clientFolderId) {
      foldersListed += 1;
      await scan(clientFolderId, await drive.listChildren(clientFolderId, { name: eventFolder.name, foldersOnly: true }));
    }
  }

  // Every mapped folder's child folders.
  for (const parentId of keyById.keys()) {
    foldersListed += 1;
    const children = (await drive.listChildren(parentId, { foldersOnly: true })).filter((child) => child.mimeType === FOLDER_MIME);
    await scan(parentId, children);
  }
  return { foldersListed, eventFolder: eventFolderInfo, duplicates };
}

/** A DriveApi that only reads: any write throws before a request is made. */
export function readOnlyDrive(drive: DriveApi): DriveApi {
  const refuse = (what: string) => async (): Promise<never> => {
    throw new Error(`the duplicate finder never writes to Drive (${what})`);
  };
  return {
    ...drive,
    driveId: drive.driveId,
    listChildren: (parentId, opts) => drive.listChildren(parentId, opts),
    getFile: (fileId) => drive.getFile(fileId),
    createFolder: refuse("createFolder"),
    uploadFile: refuse("uploadFile"),
    createShortcut: refuse("createShortcut"),
    copyFile: refuse("copyFile"),
    update: refuse("update"),
    shareReader: refuse("shareReader"),
    removePermission: refuse("removePermission"),
  };
}
