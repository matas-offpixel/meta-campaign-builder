/**
 * lib/mcp/folder-in/place.ts — the two Drive writes upload_to_event_folder
 * makes (M3d-c), over a DriveApi. The route's seam (lib/mcp/folder-in-deps.ts)
 * builds the real one from the export Drive; tests build it from a spy.
 *
 * Exactly two writes, both a new file in one folder, both tagged as the
 * app's own (APP_TAG_KEY, as the export, the filing and the place-upload
 * tag theirs) so lib/drive/pickup.ts's skipReason reads them as "ours":
 *   - files.copy of a shared-drive file (copyFile): the original stays
 *     where it is, untouched;
 *   - an upload of bytes from Storage (uploadFile).
 * Nothing here creates a permission, shares, moves (no parents change),
 * renames, trashes or deletes, and no folder is made. Reads: the source
 * file's metadata, its parents (whose it is) and the target folder's
 * children (a retry finds the copy it already made).
 *
 * Relative imports only (node:test).
 */
import { createHash } from "node:crypto";
import { APP_ID_KEY, APP_TAG_KEY, type DriveApi, type DriveFile } from "../../drive/client.ts";

/** The tag value on every file the connector puts in a show's folders. */
export const FOLDER_IN_TAG = "mcp_upload";
/** Which source a placed file came from, so a retry finds it and doesn't place it twice. */
export const SOURCE_KEY = "offpixel_source";

/** appProperties values are short (key + value ≤ 124 bytes): a Storage path goes in hashed. */
export function sourceTag(source: { driveFileId: string } | { storagePath: string }): string {
  if ("driveFileId" in source) return `drive:${source.driveFileId}`;
  return `storage:${createHash("sha256").update(source.storagePath).digest("hex").slice(0, 40)}`;
}

export function placedProperties(eventId: string, source: string): Record<string, string> {
  return { [APP_TAG_KEY]: FOLDER_IN_TAG, [APP_ID_KEY]: eventId, [SOURCE_KEY]: source };
}

/** What the tool reaches: Drive reads, the two writes, and the Storage read. */
export interface McpFolderDeps {
  /** The export Drive's reads (driveId, one file, a folder's children), or null when Drive isn't set up. */
  readDrive(): Pick<DriveApi, "driveId" | "getFile" | "listChildren"> | null;
  /** files.copy into the folder, tagged. */
  copyInto(args: { fileId: string; parentId: string; name: string; appProperties: Record<string, string> }): Promise<DriveFile>;
  /** A new file from bytes, tagged. */
  uploadInto(args: { parentId: string; name: string; mimeType: string; bytes: Uint8Array; appProperties: Record<string, string> }): Promise<DriveFile>;
  /** A Storage object's bytes. */
  downloadStorage(bucket: string, path: string): Promise<Uint8Array>;
}

/** The deps over one DriveApi: only copyFile and uploadFile ever write. */
export function folderDepsFor(drive: DriveApi | null, downloadStorage: McpFolderDeps["downloadStorage"]): McpFolderDeps {
  return {
    readDrive: () => (drive ? { driveId: drive.driveId, getFile: (id) => drive.getFile(id), listChildren: (p, o) => drive.listChildren(p, o) } : null),
    async copyInto(args) {
      if (!drive?.copyFile) throw new Error("Drive copy isn't available");
      return drive.copyFile(args);
    },
    async uploadInto(args) {
      if (!drive) throw new Error("Drive isn't set up");
      return drive.uploadFile(args);
    },
    downloadStorage,
  };
}

export function driveLink(file: Pick<DriveFile, "id">): string {
  return `https://drive.google.com/file/d/${file.id}/view`;
}
