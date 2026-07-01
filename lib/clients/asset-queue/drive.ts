/**
 * drive.ts
 *
 * Google Drive source provider for the asset queue — mirrors dropbox.ts shape
 * and error taxonomy exactly. All downloads are server-side only; Drive file
 * IDs / URLs are never exposed to the client.
 *
 * Two URL types (mirrors Dropbox's file vs folder split):
 *   /drive/folders/{folderId}  — shared folder → list contents, then download each
 *   /file/d/{fileId}/view      — single file share link → download by id
 *
 * Authentication: uses a service-account JWT-bearer flow (drive-auth.ts). A
 * fresh access token is obtained before each batch of API calls and cached
 * in-memory with a 5-minute safety margin. GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
 * holds the full service-account JSON (client_email, private_key, …).
 *
 * Recursive listing: the Drive v3 files.list endpoint is NOT natively recursive
 * for a folder tree, so subfolders are walked client-side — each folder is
 * listed with `q='{folderId}' in parents`, and any child whose mimeType is
 * application/vnd.google-apps.folder is recursed into. All files from all
 * subfolders are aggregated; no version-pick heuristics are applied. Depth is
 * capped at 5 levels to guard against pathological structures.
 *
 * If a request returns 403/404 we throw a DriveFetchError with a code so the
 * caller can set a user-visible error message WITHOUT logging the URL or id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadToStorageBucket } from "./storage-upload.ts";
import { getDriveAccessToken } from "./drive-auth.ts";

const MAX_SINGLE_FILE_BYTES = 200 * 1024 * 1024; // 200 MB per file (matches campaign-assets bucket cap)
const MAX_FOLDER_BYTES      = 2 * 1024 * 1024 * 1024; // 2 GB total for folders

/** Media extensions we will accept from folder listings (mirrors dropbox.ts). */
const MEDIA_EXTENSIONS = new Set(["mp4", "mov", "webm", "jpg", "jpeg", "png", "gif", "webp"]);

/** Google's folder mimeType — used to distinguish subfolders from files. */
const FOLDER_MIME = "application/vnd.google-apps.folder";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

/** Bucket that publicUrlFor(uploadToStorage) writes materialised assets into. */
export const DRIVE_STORAGE_BUCKET = "event-artwork";

const MAX_DEPTH = 5;

/**
 * Error taxonomy mirrors DropboxFetchError exactly so callers can share the
 * same code→message mapping regardless of source provider.
 */
export class DriveFetchError extends Error {
  readonly code:
    | "not_found"
    | "forbidden"
    | "too_large"
    | "folder_too_large"
    | "empty_folder"
    | "network"
    | "config_missing";
  constructor(
    code:
      | "not_found"
      | "forbidden"
      | "too_large"
      | "folder_too_large"
      | "empty_folder"
      | "network"
      | "config_missing",
    message: string,
  ) {
    super(message);
    this.name = "DriveFetchError";
    this.code = code;
  }
}

// ─── Auth re-export ────────────────────────────────────────────────────────────

/**
 * Returns a fresh (or cached) Google Drive access token.
 * Delegates to drive-auth.ts (JWT sign + jwt-bearer exchange + cache).
 */
export async function getAccessToken(): Promise<string> {
  return getDriveAccessToken();
}

// ─── URL detection + id parsing ─────────────────────────────────────────────────

/**
 * Returns true when the URL points to a Google Drive shared folder.
 * Folder links use /drive/folders/{id}; single files use /file/d/{id}/.
 */
export function isDriveFolderUrl(url: string): boolean {
  return /\/drive\/(?:u\/\d+\/)?folders\//.test(url);
}

/**
 * Returns true when the URL is any recognisable Google Drive URL (file or
 * folder). Used by the source dispatcher to route to the Drive provider.
 */
export function isDriveUrl(url: string): boolean {
  return /(?:drive|docs)\.google\.com/.test(url);
}

/**
 * Extracts the folderId from a Drive folder URL.
 *   https://drive.google.com/drive/folders/{folderId}?usp=sharing → {folderId}
 *   https://drive.google.com/drive/u/0/folders/{folderId}         → {folderId}
 *   https://drive.google.com/open?id={folderId}                   → {folderId}
 * Returns null when no id can be found.
 */
export function parseFolderId(url: string): string | null {
  const folders = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folders?.[1]) return folders[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam?.[1]) return idParam[1];
  return null;
}

/**
 * Extracts the fileId from a Drive file URL.
 *   https://drive.google.com/file/d/{fileId}/view?usp=sharing → {fileId}
 *   https://drive.google.com/uc?id={fileId}                   → {fileId}
 *   https://drive.google.com/open?id={fileId}                 → {fileId}
 * Returns null when no id can be found.
 */
export function parseFileId(url: string): string | null {
  const fileD = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileD?.[1]) return fileD[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam?.[1]) return idParam[1];
  return null;
}

// ─── Folder listing ─────────────────────────────────────────────────────────────

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
  /** File size in bytes as reported by Drive (0 if unknown — e.g. Google-native docs) */
  size: number;
  /** RFC-3339 last-modified timestamp from Drive (empty string if absent) */
  modifiedTime: string;
}

interface DriveListItem {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
}

/**
 * Async generator that walks a Drive folder tree recursively, yielding one
 * DriveFileEntry per non-folder file. Subfolders are walked depth-first;
 * pagination within each folder is followed via nextPageToken.
 *
 * Requires GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON — throws DriveFetchError
 * ("config_missing") when absent (surfaced by the auth layer). The folder must
 * be shared with the service-account email (see docs/D2C_DRIVE_INTEGRATION.md).
 *
 * @throws {DriveFetchError} on missing config, auth error, 404, or network failure
 */
export async function* listFolderRecursive(
  folderId: string,
  depth = 0,
): AsyncGenerator<DriveFileEntry> {
  if (depth > MAX_DEPTH) {
    throw new DriveFetchError(
      "network",
      `Drive folder nesting exceeds ${MAX_DEPTH} levels — restructure the folder or contact ops`,
    );
  }

  const token = await getAccessToken();
  const subfolderIds: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      pageSize: "1000",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      // Newest first is a reasonable default; callers apply no version heuristics.
      orderBy: "modifiedTime desc",
    });
    if (pageToken) params.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new DriveFetchError(
        "network",
        `Network error listing Drive folder: ${(err as Error).message}`,
      );
    }

    if (res.status === 401) {
      throw new DriveFetchError(
        "forbidden",
        "Google Drive access token rejected by files.list — the service account key may have " +
          "been revoked. Regenerate GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON in the Google Cloud console.",
      );
    }
    if (res.status === 403) {
      throw new DriveFetchError(
        "forbidden",
        "Google Drive returned 403 listing the folder — share the folder with the service-account " +
          "email (Viewer) or check the Drive API is enabled for the project.",
      );
    }
    if (res.status === 404) {
      throw new DriveFetchError(
        "not_found",
        "Google Drive folder not accessible — check the folder link is still active and shared",
      );
    }
    if (res.status === 429) {
      throw new DriveFetchError("forbidden", "Google Drive rate limit hit — retry in a few minutes");
    }
    if (!res.ok) {
      let snippet = "";
      try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.error("[drive] files.list returned unexpected status", {
        status: res.status,
        depth,
        body: snippet,
      });
      throw new DriveFetchError("network", `Google Drive files.list returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { files?: DriveListItem[]; nextPageToken?: string };
    for (const item of data.files ?? []) {
      if (!item.id) continue;
      if (item.mimeType === FOLDER_MIME) {
        subfolderIds.push(item.id);
        continue;
      }
      yield {
        id: item.id,
        name: item.name ?? item.id,
        mimeType: item.mimeType ?? "application/octet-stream",
        size: Number(item.size ?? 0),
        modifiedTime: item.modifiedTime ?? "",
      };
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  // ── Recurse into subfolders (sequential, no parallelism) ─────────────────
  for (const subId of subfolderIds) {
    yield* listFolderRecursive(subId, depth + 1);
  }
}

// ─── File metadata ───────────────────────────────────────────────────────────

/**
 * Fetches metadata for a single Drive file.
 *
 * @throws {DriveFetchError} on missing config, auth error, 404, or network failure
 */
export async function getFileMetadata(fileId: string): Promise<DriveFileEntry> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    fields: "id,name,mimeType,size,modifiedTime",
    supportsAllDrives: "true",
  });

  let res: Response;
  try {
    res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new DriveFetchError("network", `Network error reading Drive file metadata: ${(err as Error).message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new DriveFetchError(
      "forbidden",
      "Google Drive rejected the file metadata request — share the file with the service-account email.",
    );
  }
  if (res.status === 404) {
    throw new DriveFetchError("not_found", "Google Drive file not found — it may have been moved or deleted");
  }
  if (!res.ok) {
    throw new DriveFetchError("network", `Google Drive files.get returned HTTP ${res.status}`);
  }

  const item = (await res.json()) as DriveListItem;
  if (!item.id) {
    throw new DriveFetchError("network", "Google Drive files.get returned no id");
  }
  return {
    id: item.id,
    name: item.name ?? item.id,
    mimeType: item.mimeType ?? "application/octet-stream",
    size: Number(item.size ?? 0),
    modifiedTime: item.modifiedTime ?? "",
  };
}

// ─── Per-file download ─────────────────────────────────────────────────────────

/**
 * Downloads a single Drive file's raw bytes via the alt=media endpoint.
 *
 * @throws {DriveFetchError} on missing config, auth error, 404, size cap, or network failure
 */
export async function downloadFile(
  fileId: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const token = await getAccessToken();
  const params = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });

  let res: Response;
  try {
    res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new DriveFetchError("network", `Network error downloading Drive file: ${(err as Error).message}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new DriveFetchError(
      "forbidden",
      "Google Drive rejected the file download — share the file with the service-account email.",
    );
  }
  if (res.status === 404) {
    throw new DriveFetchError("not_found", "Google Drive file not found while downloading");
  }
  if (res.status === 429) {
    throw new DriveFetchError("forbidden", "Google Drive rate limit hit while downloading — retry later");
  }
  if (!res.ok) {
    throw new DriveFetchError("network", `Google Drive returned HTTP ${res.status} downloading file`);
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_SINGLE_FILE_BYTES) {
    throw new DriveFetchError("too_large", `Drive file exceeds the 200 MB per-file limit (content-length: ${contentLength})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new DriveFetchError("too_large", `Drive file exceeds the 200 MB per-file limit (actual: ${buffer.byteLength})`);
  }

  const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
  return { buffer, mimeType };
}

// ─── Public URL resolution ───────────────────────────────────────────────────────

export interface PublicUrlOptions {
  /**
   * When true, downloads the file then uploads it to the Supabase Storage
   * 'event-artwork' bucket (created public if missing) and returns the Supabase
   * public URL. When false/omitted, attempts Google's webContentLink (works for
   * publicly-shared files only) and falls back to a storage upload on failure.
   */
  uploadToStorage?: boolean;
}

/**
 * Resolves a durable, publicly-fetchable URL for a Drive file.
 *
 * - uploadToStorage:true → materialise into Supabase Storage and return the
 *   Supabase public URL (recommended for anything a downstream provider — Meta,
 *   Bird, Mailchimp — must fetch, since Drive links require auth headers).
 * - uploadToStorage:false → return Google's webContentLink when the file is
 *   publicly shared; otherwise fall back to a storage upload so the caller
 *   always gets a usable URL.
 *
 * @throws {DriveFetchError} on missing config, auth error, or upload failure
 */
export async function publicUrlFor(
  fileId: string,
  options?: PublicUrlOptions,
): Promise<string> {
  if (!options?.uploadToStorage) {
    const link = await tryWebContentLink(fileId);
    if (link) return link;
    // Fall through to storage upload when the file is not publicly shared.
  }
  return uploadFileToStorage(fileId);
}

/**
 * Attempts to read Google's webContentLink for a file. Returns null when the
 * file is not publicly shared (Drive omits the field) or on any error — the
 * caller then falls back to a storage upload.
 */
async function tryWebContentLink(fileId: string): Promise<string | null> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch {
    return null;
  }
  const params = new URLSearchParams({ fields: "webContentLink", supportsAllDrives: "true" });
  try {
    const res = await fetch(`${DRIVE_API_BASE}/files/${fileId}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { webContentLink?: string };
    return data.webContentLink ?? null;
  } catch {
    return null;
  }
}

/**
 * Downloads a Drive file and uploads it to the public 'event-artwork' bucket,
 * returning the Supabase public URL. Creates the bucket (public) if missing.
 */
async function uploadFileToStorage(fileId: string): Promise<string> {
  const meta = await getFileMetadata(fileId);
  const { buffer, mimeType } = await downloadFile(fileId);

  // Imported dynamically so this module stays importable in the type-strip test
  // runner (which does not resolve the "@/" path alias for value imports).
  const { createServiceRoleClient } = await import("@/lib/supabase/server");
  const service = createServiceRoleClient();
  await ensureArtworkBucket(service);

  const ext = mimeToExtension(mimeType, meta.name);
  const storagePath = `drive/${fileId}.${ext}`;

  const { error } = await uploadToStorageBucket(
    service,
    DRIVE_STORAGE_BUCKET,
    storagePath,
    buffer,
    mimeType,
  );
  if (error) {
    throw new DriveFetchError(
      "network",
      `Failed to upload Drive file to Supabase Storage: ${error.message}`,
    );
  }

  const { data } = service.storage.from(DRIVE_STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

let _bucketEnsured = false;

/** Creates the public 'event-artwork' bucket if it does not already exist. */
async function ensureArtworkBucket(service: SupabaseClient): Promise<void> {
  if (_bucketEnsured) return;
  const { error } = await service.storage.createBucket(DRIVE_STORAGE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_SINGLE_FILE_BYTES,
  });
  // "already exists" is the happy steady-state — treat as success.
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.error("[drive] failed to ensure event-artwork bucket", { error: error.message });
  }
  _bucketEnsured = true;
}

/** Reset the bucket-ensured flag. Exposed for testing only. */
export function _resetBucketEnsured(): void {
  _bucketEnsured = false;
}

// ─── Folder download (provider-facing convenience) ──────────────────────────────

export interface DriveFolderFile {
  buffer: Buffer;
  extension: string;
  /** Original filename from Drive */
  name: string;
}

/**
 * Lists and downloads all media files from a Drive shared folder.
 * Mirrors downloadDropboxFolderFiles: filters to media extensions, rejects
 * empty folders, enforces the 2 GB folder cap and 200 MB per-file cap.
 *
 * @throws {DriveFetchError} on empty folder, size cap, or download errors
 */
export async function downloadDriveFolderFiles(folderUrl: string): Promise<DriveFolderFile[]> {
  const folderId = parseFolderId(folderUrl);
  if (!folderId) {
    throw new DriveFetchError("not_found", "Could not parse a Google Drive folder id from the URL");
  }

  const mediaEntries: DriveFileEntry[] = [];
  for await (const entry of listFolderRecursive(folderId)) {
    const ext = extensionFor(entry);
    if (MEDIA_EXTENSIONS.has(ext)) mediaEntries.push(entry);
  }

  if (mediaEntries.length === 0) {
    throw new DriveFetchError(
      "empty_folder",
      "No media files found in the Google Drive folder (looking for mp4, mov, jpg, png, etc.)",
    );
  }

  const totalBytes = mediaEntries.reduce((sum, e) => sum + e.size, 0);
  if (totalBytes > MAX_FOLDER_BYTES) {
    throw new DriveFetchError(
      "folder_too_large",
      `Folder total size (${Math.round(totalBytes / 1024 / 1024)} MB) exceeds the 2 GB limit`,
    );
  }

  const results: DriveFolderFile[] = [];
  for (const entry of mediaEntries) {
    const { buffer, mimeType } = await downloadFile(entry.id);
    results.push({ buffer, extension: mimeToExtension(mimeType, entry.name), name: entry.name });
  }
  return results;
}

/**
 * Downloads a single Drive asset (single-file share link) and returns
 * Buffer + extension + name. Mirrors downloadDropboxAsset.
 *
 * @throws {DriveFetchError} on missing config, auth error, 404, size cap, or network error
 */
export async function downloadDriveAsset(
  fileUrl: string,
): Promise<{ buffer: Buffer; extension: string; name: string }> {
  const fileId = parseFileId(fileUrl);
  if (!fileId) {
    throw new DriveFetchError("not_found", "Could not parse a Google Drive file id from the URL");
  }
  const meta = await getFileMetadata(fileId);
  const { buffer, mimeType } = await downloadFile(fileId);
  return { buffer, extension: mimeToExtension(mimeType, meta.name), name: meta.name };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Determines a file extension from a Drive entry, preferring the filename. */
function extensionFor(entry: DriveFileEntry): string {
  const fromName = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return mimeToExtension(entry.mimeType, entry.name);
}

/** Maps a mimeType (with filename fallback) to a lowercase file extension. */
export function mimeToExtension(mimeType: string, filenameHint = ""): string {
  const typeMap: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (typeMap[normalized]) return typeMap[normalized];

  const fromName = filenameHint.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;

  return "bin";
}
