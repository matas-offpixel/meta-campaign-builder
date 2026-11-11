/** In-memory Shared Drive for the export tests. It has no delete: nothing in the export may delete. */

import { writeStreamToFile } from "../../creatives/stream-file.ts";
import { DriveApiError, FOLDER_MIME, SHORTCUT_MIME, type DriveApi, type DriveChange, type DriveFile } from "../client.ts";

export type FakeDrive = DriveApi & {
  files: Map<string, DriveFile & { bytes?: Uint8Array }>;
  calls: string[];
  failUploads: number;
  /** Every write lands in the changes feed, like Drive's own. */
  changeLog: DriveChange[];
  /** Changes per changes.list page. */
  pageSize: number;
  permissions: Map<string, { fileId: string; email: string }>;
  /** Next shareReader throws this. */
  refuseShare: DriveApiError | null;
  /** A file put in the drive by someone else (an operator dropping a clip). */
  drop(parentId: string, name: string, opts?: { mimeType?: string; appProperties?: Record<string, string>; bytes?: Uint8Array; size?: number }): DriveFile;
  /** Next fetchMedia throws this. */
  failMedia: Error | null;
  trash(fileId: string): void;
  pathOf(id: string): string;
  childrenNamed(path: string): string[];
};

export function fakeDrive(driveId = "ROOT"): FakeDrive {
  const files: FakeDrive["files"] = new Map();
  const calls: string[] = [];
  let next = 1;
  const changeLog: DriveChange[] = [];
  const add = (file: DriveFile & { bytes?: Uint8Array }) => {
    files.set(file.id, file);
    changeLog.push({ fileId: file.id, removed: false, file: { ...file } });
    return { ...file };
  };
  const self: FakeDrive = {
    driveId,
    files,
    calls,
    failUploads: 0,
    changeLog,
    pageSize: 100,
    permissions: new Map(),
    refuseShare: null,
    failMedia: null,
    drop(parentId, name, opts = {}) {
      return add({ id: `d${next++}`, name, mimeType: opts.mimeType ?? "video/mp4", parents: [parentId], appProperties: opts.appProperties, bytes: opts.bytes ?? new Uint8Array([9]), size: opts.size ?? 1 });
    },
    trash(fileId) {
      const file = files.get(fileId)!;
      file.trashed = true;
      changeLog.push({ fileId, removed: false, file: { ...file } });
    },
    async getFile(fileId) {
      calls.push(`get ${fileId}`);
      const file = files.get(fileId);
      return file ? { ...file } : null;
    },
    async download(fileId) {
      calls.push(`download ${fileId}`);
      const file = files.get(fileId);
      if (!file) throw new Error("Drive download failed: HTTP 404 notFound");
      return file.bytes ?? new Uint8Array();
    },
    async fetchMedia(fileId, opts = {}) {
      calls.push(`fetchMedia ${fileId}${opts.range ? ` ${opts.range}` : ""}`);
      if (self.failMedia) throw self.failMedia;
      const file = files.get(fileId);
      if (!file) throw new Error("Drive download failed: HTTP 404 notFound");
      const bytes = file.bytes ?? new Uint8Array();
      const m = opts.range ? /^bytes=(\d+)-(\d*)$/.exec(opts.range) : null;
      if (!m) return new Response(bytes.slice(), { status: 200, headers: { "content-length": String(bytes.byteLength), "accept-ranges": "bytes" } });
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : bytes.byteLength - 1, bytes.byteLength - 1);
      if (start >= bytes.byteLength) return new Response(null, { status: 416 });
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${bytes.byteLength}` },
      });
    },
    async downloadTo(fileId, filePath) {
      calls.push(`downloadTo ${fileId}`);
      const file = files.get(fileId);
      if (!file) throw new Error("Drive download failed: HTTP 404 notFound");
      const bytes = file.bytes ?? new Uint8Array();
      return writeStreamToFile((async function* () { yield bytes; })(), filePath);
    },
    async startPageToken() {
      calls.push("startPageToken");
      return String(changeLog.length);
    },
    async listChanges(pageToken) {
      calls.push(`changes ${pageToken}`);
      const from = Number(pageToken);
      const to = Math.min(from + self.pageSize, changeLog.length);
      const more = to < changeLog.length;
      return { changes: changeLog.slice(from, to), nextPageToken: more ? String(to) : null, newStartPageToken: more ? null : String(to) };
    },
    async shareReader(fileId, email) {
      calls.push(`share ${fileId} ${email}`);
      if (self.refuseShare) throw self.refuseShare;
      const id = `p${next++}`;
      self.permissions.set(id, { fileId, email });
      return id;
    },
    async removePermission(fileId, permissionId) {
      calls.push(`unshare ${fileId} ${permissionId}`);
      self.permissions.delete(permissionId);
    },
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
