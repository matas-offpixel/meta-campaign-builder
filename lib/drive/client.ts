/**
 * The Drive calls the export makes, as one interface so tests can use an
 * in-memory drive. The real one is the Drive v3 REST API on the Shared Drive
 * GOOGLE_DRIVE_EXPORT_DRIVE_ID ("Off / Pixel"), as the service account in
 * GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON (offpixel-sheets-reader@…, a Content
 * manager there), scope https://www.googleapis.com/auth/drive — drive.file
 * cannot write into a folder an operator links that the app did not create.
 * supportsAllDrives is on every call.
 *
 * Content managers cannot delete permanently (canDelete false); nothing here
 * deletes. Errors carry the HTTP status and Drive's reason only — never a
 * URL, an id from the query string or key material.
 */

import { createSign } from "node:crypto";

import { parseServiceAccountJson, type ServiceAccount } from "../clients/asset-queue/drive-auth.ts";
import type { ContentIdentity } from "../creatives/asset-registry.ts";
import { writeStreamToFile } from "../creatives/stream-file.ts";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/** appProperties on every file the app files, so Drive → app never picks it up again (S22, HS14). */
export const APP_TAG_KEY = "offpixel_kind";
export const APP_ID_KEY = "offpixel_id";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  shortcutTargetId?: string | null;
  trashed?: boolean;
  size?: number | null;
};

/** A media file with Drive's own measurements (files.list thumbnailLink, video/imageMediaMetadata). */
export type DriveMediaFile = DriveFile & {
  thumbnailLink: string | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  durationMs: number | null;
};

/** One entry of the Shared Drive's changes feed (changes.list). */
export type DriveChange = { fileId: string; removed: boolean; file: DriveFile | null };

export type DriveChangePage = {
  changes: DriveChange[];
  /** More pages for this token: pass it back as the page token. */
  nextPageToken: string | null;
  /** The last page: store this and read from it next time. */
  newStartPageToken: string | null;
};

export interface DriveApi {
  readonly driveId: string;
  /** Children of a folder (not trashed). `name` filters to that exact name. */
  listChildren(parentId: string, opts?: { name?: string; foldersOnly?: boolean }): Promise<DriveFile[]>;
  createFolder(parentId: string, name: string): Promise<DriveFile>;
  uploadFile(args: { parentId: string; name: string; mimeType: string; bytes: Uint8Array; appProperties: Record<string, string> }): Promise<DriveFile>;
  createShortcut(args: { parentId: string; name: string; targetId: string; appProperties: Record<string, string> }): Promise<DriveFile>;
  update(fileId: string, patch: { name?: string; description?: string }): Promise<DriveFile>;
  /** One file's metadata, or null when it is gone or the account can't see it. */
  getFile(fileId: string): Promise<DriveFile | null>;
  download(fileId: string): Promise<Uint8Array>;
  /**
   * Streams the file to `filePath` and returns its sha256 and byte count,
   * never holding the whole file in memory (a 4K original is 400–450 MB).
   * Optional: without it the pickup reads the file with download().
   */
  downloadTo?(fileId: string, filePath: string, opts?: { onBytes?: (written: number) => void }): Promise<ContentIdentity>;
  /** A folder's media children (not trashed), with Drive's measurements. Optional: the launcher's From Drive picker. */
  listMedia?(parentId: string): Promise<DriveMediaFile[]>;
  /** One file with Drive's measurements, or null when it is gone. */
  getMediaFile?(fileId: string): Promise<DriveMediaFile | null>;
  /** A file's thumbnailLink, fetched as the export account (the link needs it). */
  fetchThumbnail?(thumbnailLink: string): Promise<Response>;
  /**
   * The file's bytes as a streaming Response: the whole file, or one HTTP
   * Range ("bytes=0-99" → 206). The credentials stay inside this call; the
   * Response carries none. Optional: the pickup reads an over-cap original
   * this way (ffmpeg through a loopback server) so it never touches disk.
   */
  fetchMedia?(fileId: string, opts?: { range?: string | null; signal?: AbortSignal }): Promise<Response>;
  /** changes.getStartPageToken for the drive. */
  startPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<DriveChangePage>;
  /** permissions.create role reader, type user. Returns the permission id. */
  shareReader(fileId: string, email: string): Promise<string>;
  /** permissions.delete. A permission already gone is not an error. */
  removePermission(fileId: string, permissionId: string): Promise<void>;
}

export class DriveApiError extends Error {
  readonly status: number;
  readonly reason: string;
  constructor(status: number, reason: string, message: string) {
    super(message);
    this.name = "DriveApiError";
    this.status = status;
    this.reason = reason;
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The service account from GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON. A value whose
 * quotes were stripped on paste ({type: service_account, …}) still gives its
 * client_email and private_key. Never echoes the value.
 */
export function loadExportServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw || !raw.trim()) throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not set.");
  try {
    const parsed = parseServiceAccountJson(raw);
    if (parsed.client_email && parsed.private_key) return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri };
  } catch {
    /* fall through to the unquoted form */
  }
  const key = /private_key:\s*(-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----(?:\\n)?)/.exec(raw)?.[1];
  const email = /client_email:\s*([^,\s}'"]+)/.exec(raw)?.[1];
  if (!key || !email) throw new Error("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON has no client_email or private_key.");
  return { client_email: email, private_key: key };
}

export function signDriveJwt(sa: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: sa.client_email, scope: DRIVE_SCOPE, aud: sa.token_uri || TOKEN_ENDPOINT, iat: nowSeconds, exp: nowSeconds + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  return `${header}.${claims}.${base64url(signer.sign(sa.private_key.replace(/\\n/g, "\n")))}`;
}

function tokenSource(sa: ServiceAccount, fetchImpl: typeof fetch): () => Promise<string> {
  let cached: { token: string; until: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.until) return cached.token;
    const res = await fetchImpl(sa.token_uri || TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signDriveJwt(sa) }).toString(),
    });
    if (!res.ok) throw new DriveApiError(res.status, "token", `Google rejected the export account's token request (HTTP ${res.status}).`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new DriveApiError(500, "token", "Google returned no access token.");
    cached = { token: body.access_token, until: Date.now() + ((body.expires_in ?? 3600) - 300) * 1000 };
    return cached.token;
  };
}

// ─── REST implementation ─────────────────────────────────────────────────────

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FILE_FIELDS = "id,name,mimeType,parents,appProperties,shortcutDetails(targetId),trashed,size";
const MEDIA_FIELDS = `${FILE_FIELDS},thumbnailLink,videoMediaMetadata(width,height,durationMillis),imageMediaMetadata(width,height,rotation)`;

/** Thumbnail links are Google-hosted; anything else is refused (no fetching arbitrary URLs as the account). */
export function isDriveThumbnailLink(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && (/\.googleusercontent\.com$/.test(url.hostname) || url.hostname === "drive.google.com" || url.hostname === "www.googleapis.com");
  } catch {
    return false;
  }
}

function num(value: unknown): number | null {
  const n = Number(value);
  return value == null || !Number.isFinite(n) ? null : n;
}

function toMediaFile(raw: Record<string, unknown>): DriveMediaFile {
  // Drive's VideoMediaMetadata has width, height and durationMillis only (asking for a rotation field fails the call).
  const video = raw.videoMediaMetadata as { width?: unknown; height?: unknown; durationMillis?: unknown; rotation?: unknown } | undefined;
  const image = raw.imageMediaMetadata as { width?: unknown; height?: unknown; rotation?: unknown } | undefined;
  const meta = video ?? image;
  return {
    ...toFile(raw),
    thumbnailLink: typeof raw.thumbnailLink === "string" ? raw.thumbnailLink : null,
    width: num(meta?.width),
    height: num(meta?.height),
    // imageMediaMetadata.rotation counts clockwise quarter turns; a video's comes back only if Drive ever sends one.
    rotation: image && !video ? (num(image.rotation) ?? 0) * 90 : num(video?.rotation),
    durationMs: num(video?.durationMillis),
  };
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toFile(raw: Record<string, unknown>): DriveFile {
  const shortcut = raw.shortcutDetails as { targetId?: string } | undefined;
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    mimeType: String(raw.mimeType ?? ""),
    parents: Array.isArray(raw.parents) ? (raw.parents as string[]) : undefined,
    appProperties: (raw.appProperties as Record<string, string> | undefined) ?? undefined,
    shortcutTargetId: shortcut?.targetId ?? null,
    trashed: raw.trashed === true,
    size: raw.size == null ? null : Number(raw.size),
  };
}

async function fail(res: Response, what: string): Promise<never> {
  let reason = "unknown";
  try {
    const body = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason;
  } catch {
    /* no body */
  }
  throw new DriveApiError(res.status, reason, `Drive ${what} failed: HTTP ${res.status} ${reason}`);
}

export function restDriveApi(opts: { driveId: string; serviceAccount: ServiceAccount; fetchImpl?: typeof fetch }): DriveApi {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = tokenSource(opts.serviceAccount, fetchImpl);
  const call = async (url: string, init: RequestInit, what: string) => {
    const res = await fetchImpl(url, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } });
    if (!res.ok) await fail(res, what);
    return res;
  };
  const json = { "Content-Type": "application/json; charset=UTF-8" };

  return {
    driveId: opts.driveId,

    async listChildren(parentId, listOpts = {}) {
      const clauses = [`'${escapeQuery(parentId)}' in parents`, "trashed = false"];
      if (listOpts.name != null) clauses.push(`name = '${escapeQuery(listOpts.name)}'`);
      if (listOpts.foldersOnly) clauses.push(`mimeType = '${FOLDER_MIME}'`);
      const out: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: clauses.join(" and "),
          corpora: "drive",
          driveId: opts.driveId,
          includeItemsFromAllDrives: "true",
          supportsAllDrives: "true",
          pageSize: "1000",
          fields: `nextPageToken,files(${FILE_FIELDS})`,
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await call(`${API}/files?${params}`, {}, "list");
        const body = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string };
        out.push(...(body.files ?? []).map(toFile));
        pageToken = body.nextPageToken;
      } while (pageToken);
      return out;
    },

    async createFolder(parentId, name) {
      const res = await call(
        `${API}/files?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
        { method: "POST", headers: json, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) },
        "create folder",
      );
      return toFile((await res.json()) as Record<string, unknown>);
    },

    async uploadFile(args) {
      // Resumable: one request for the metadata, one for the bytes. Works for any size.
      const init = await call(
        `${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
        {
          method: "POST",
          headers: { ...json, "X-Upload-Content-Type": args.mimeType, "X-Upload-Content-Length": String(args.bytes.byteLength) },
          body: JSON.stringify({ name: args.name, parents: [args.parentId], appProperties: args.appProperties }),
        },
        "upload start",
      );
      const session = init.headers.get("location");
      if (!session) throw new DriveApiError(500, "no_session", "Drive upload start returned no session.");
      const res = await fetchImpl(session, {
        method: "PUT",
        headers: { "Content-Type": args.mimeType, "Content-Length": String(args.bytes.byteLength) },
        body: args.bytes as unknown as BodyInit,
      });
      if (!res.ok) await fail(res, "upload");
      return toFile((await res.json()) as Record<string, unknown>);
    },

    async createShortcut(args) {
      const res = await call(
        `${API}/files?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
        {
          method: "POST",
          headers: json,
          body: JSON.stringify({
            name: args.name,
            mimeType: SHORTCUT_MIME,
            parents: [args.parentId],
            shortcutDetails: { targetId: args.targetId },
            appProperties: args.appProperties,
          }),
        },
        "create shortcut",
      );
      return toFile((await res.json()) as Record<string, unknown>);
    },

    async update(fileId, patch) {
      const res = await call(
        `${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
        { method: "PATCH", headers: json, body: JSON.stringify(patch) },
        "update",
      );
      return toFile((await res.json()) as Record<string, unknown>);
    },

    async getFile(fileId) {
      const res = await fetchImpl(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, "get");
      return toFile((await res.json()) as Record<string, unknown>);
    },

    async download(fileId) {
      const res = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}, "download");
      return new Uint8Array(await res.arrayBuffer());
    },

    async fetchMedia(fileId, mediaOpts = {}) {
      return call(
        `${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
        { headers: mediaOpts.range ? { Range: mediaOpts.range } : {}, signal: mediaOpts.signal },
        "download",
      );
    },

    async downloadTo(fileId, filePath, dlOpts = {}) {
      const res = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {}, "download");
      if (!res.body) throw new DriveApiError(500, "no_body", "Drive download returned no body.");
      return writeStreamToFile(res.body, filePath, dlOpts.onBytes);
    },

    async listMedia(parentId) {
      const clauses = [`'${escapeQuery(parentId)}' in parents`, "trashed = false", `mimeType != '${FOLDER_MIME}'`];
      const out: DriveMediaFile[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          q: clauses.join(" and "),
          corpora: "drive",
          driveId: opts.driveId,
          includeItemsFromAllDrives: "true",
          supportsAllDrives: "true",
          pageSize: "1000",
          orderBy: "name",
          fields: `nextPageToken,files(${MEDIA_FIELDS})`,
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await call(`${API}/files?${params}`, {}, "list");
        const body = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string };
        out.push(...(body.files ?? []).map(toMediaFile));
        pageToken = body.nextPageToken;
      } while (pageToken);
      return out;
    },

    async getMediaFile(fileId) {
      const res = await fetchImpl(`${API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(MEDIA_FIELDS)}`, {
        headers: { Authorization: `Bearer ${await token()}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, "get");
      return toMediaFile((await res.json()) as Record<string, unknown>);
    },

    async fetchThumbnail(thumbnailLink) {
      if (!isDriveThumbnailLink(thumbnailLink)) throw new DriveApiError(400, "bad_link", "Not a Drive thumbnail link.");
      return call(thumbnailLink, {}, "thumbnail");
    },

    async startPageToken() {
      const params = new URLSearchParams({ driveId: opts.driveId, supportsAllDrives: "true" });
      const res = await call(`${API}/changes/startPageToken?${params}`, {}, "start page token");
      const body = (await res.json()) as { startPageToken?: string };
      if (!body.startPageToken) throw new DriveApiError(500, "no_token", "Drive returned no start page token.");
      return body.startPageToken;
    },

    async listChanges(pageToken) {
      const params = new URLSearchParams({
        pageToken,
        driveId: opts.driveId,
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        includeRemoved: "true",
        pageSize: "1000",
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      });
      const res = await call(`${API}/changes?${params}`, {}, "list changes");
      const body = (await res.json()) as {
        changes?: { fileId?: string; removed?: boolean; file?: Record<string, unknown> }[];
        nextPageToken?: string;
        newStartPageToken?: string;
      };
      return {
        changes: (body.changes ?? []).map((change) => ({
          fileId: String(change.fileId ?? change.file?.id ?? ""),
          removed: change.removed === true,
          file: change.file ? toFile(change.file) : null,
        })),
        nextPageToken: body.nextPageToken ?? null,
        newStartPageToken: body.newStartPageToken ?? null,
      };
    },

    async shareReader(fileId, email) {
      const res = await call(
        `${API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&sendNotificationEmail=true&fields=id`,
        { method: "POST", headers: json, body: JSON.stringify({ role: "reader", type: "user", emailAddress: email }) },
        "share",
      );
      const body = (await res.json()) as { id?: string };
      if (!body.id) throw new DriveApiError(500, "no_permission", "Drive returned no permission id.");
      return body.id;
    },

    async removePermission(fileId, permissionId) {
      const res = await fetchImpl(
        `${API}/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`,
        { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } },
      );
      if (res.status === 404) return;
      if (!res.ok) await fail(res, "stop sharing");
    },
  };
}

/** The export drive from env, or null with the reason when it isn't configured. */
export function driveFromEnv(env: Record<string, string | undefined> = process.env): { drive: DriveApi | null; reason: string | null } {
  const driveId = env.GOOGLE_DRIVE_EXPORT_DRIVE_ID?.trim();
  if (!driveId) return { drive: null, reason: "GOOGLE_DRIVE_EXPORT_DRIVE_ID is not set" };
  try {
    return { drive: restDriveApi({ driveId, serviceAccount: loadExportServiceAccount(env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) }), reason: null };
  } catch (err) {
    return { drive: null, reason: err instanceof Error ? err.message : "service account unreadable" };
  }
}
