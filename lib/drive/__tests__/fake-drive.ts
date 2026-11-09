/** In-memory Shared Drive for the export tests. It has no delete: nothing in the export may delete. */

import { FOLDER_MIME, SHORTCUT_MIME, type DriveApi, type DriveFile } from "../client.ts";

export type FakeDrive = DriveApi & {
  files: Map<string, DriveFile & { bytes?: Uint8Array }>;
  calls: string[];
  failUploads: number;
  pathOf(id: string): string;
  childrenNamed(path: string): string[];
};

export function fakeDrive(driveId = "ROOT"): FakeDrive {
  const files: FakeDrive["files"] = new Map();
  const calls: string[] = [];
  let next = 1;
  const add = (file: DriveFile & { bytes?: Uint8Array }) => {
    files.set(file.id, file);
    return { ...file };
  };
  const self: FakeDrive = {
    driveId,
    files,
    calls,
    failUploads: 0,
    async listChildren(parentId, opts = {}) {
      calls.push(`list ${parentId}`);
      return [...files.values()]
        .filter((file) => file.parents?.includes(parentId))
        .filter((file) => opts.name == null || file.name === opts.name)
        .filter((file) => !opts.foldersOnly || file.mimeType === FOLDER_MIME)
        .map((file) => ({ ...file }));
    },
    async createFolder(parentId, name) {
      calls.push(`createFolder ${name}`);
      return add({ id: `f${next++}`, name, mimeType: FOLDER_MIME, parents: [parentId] });
    },
    async uploadFile(args) {
      calls.push(`upload ${args.name}`);
      if (self.failUploads > 0) {
        self.failUploads -= 1;
        throw new Error("Drive upload failed: HTTP 503 backendError");
      }
      return add({ id: `u${next++}`, name: args.name, mimeType: args.mimeType, parents: [args.parentId], appProperties: args.appProperties, bytes: args.bytes });
    },
    async createShortcut(args) {
      calls.push(`shortcut ${args.name}`);
      return add({ id: `s${next++}`, name: args.name, mimeType: SHORTCUT_MIME, parents: [args.parentId], shortcutTargetId: args.targetId, appProperties: args.appProperties });
    },
    async update(fileId, patch) {
      calls.push(`update ${fileId} ${patch.name ?? ""}`);
      const file = files.get(fileId);
      if (!file) throw new Error("Drive update failed: HTTP 404 notFound");
      if (patch.name != null) file.name = patch.name;
      return { ...file };
    },
    pathOf(id) {
      const parts: string[] = [];
      for (let cursor = files.get(id); cursor; cursor = cursor.parents?.[0] ? files.get(cursor.parents[0]) : undefined) parts.unshift(cursor.name);
      return parts.join(" / ");
    },
    childrenNamed(path) {
      const target = [...files.values()].find((file) => self.pathOf(file.id) === path);
      if (!target) return [];
      return [...files.values()].filter((file) => file.parents?.includes(target.id)).map((file) => file.name).sort();
    },
  };
  return self;
}
