/**
 * dropbox.ts
 *
 * Converts public Dropbox share URLs to direct-download form and streams
 * files to Buffers. All downloads are server-side only — never expose
 * Dropbox URLs to the client.
 *
 * Two URL types:
 *   /scl/fi/  — single file share link → download with ?dl=1
 *   /scl/fo/  — shared folder link → list contents first, then download each file
 *
 * Folder listing uses POST /2/files/list_folder with { path: "", shared_link: { url } }.
 * Per-file download uses POST /2/sharing/get_shared_link_file with path_lower relative
 * to the folder root. These are the live endpoints as of 2026-06 — the previously-used
 * POST /2/sharing/list_shared_link_files was retired by Dropbox and returns an HTML 404.
 *
 * Authentication: uses a refresh-token-based OAuth flow (dropbox-auth.ts). A fresh
 * access token is obtained before each batch of API calls. DROPBOX_ACCESS_TOKEN has
 * been removed — the integration now uses DROPBOX_REFRESH_TOKEN + app credentials.
 *
 * If a URL returns 403/404 we throw a DropboxFetchError with a code so
 * the caller can set a user-visible error message WITHOUT logging the URL.
 */

const MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_FOLDER_BYTES      = 500 * 1024 * 1024; // 500 MB total for folders

/** Media extensions we will accept from folder listings */
const MEDIA_EXTENSIONS = new Set(["mp4", "mov", "webm", "jpg", "jpeg", "png", "gif", "webp"]);

import { getDropboxAccessToken } from "./dropbox-auth.ts";

export class DropboxFetchError extends Error {
  readonly code: "not_found" | "forbidden" | "too_large" | "folder_too_large" | "empty_folder" | "network" | "config_missing";
  constructor(
    code: "not_found" | "forbidden" | "too_large" | "folder_too_large" | "empty_folder" | "network" | "config_missing",
    message: string,
  ) {
    super(message);
    this.name = "DropboxFetchError";
    this.code = code;
  }
}

// ─── URL detection ────────────────────────────────────────────────────────────

/**
 * Returns true when the URL points to a Dropbox shared folder (/scl/fo/).
 * Single file links use /scl/fi/ or the legacy /s/ path.
 */
export function isDropboxFolderUrl(url: string): boolean {
  return url.includes("/scl/fo/");
}

/**
 * Converts a Dropbox share link to its direct-download equivalent.
 * Only meaningful for single-file links — folder URLs don't support ?dl=1.
 */
export function toDirectDownloadUrl(url: string): string {
  if (url.includes("dl.dropboxusercontent.com")) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("dl", "1");
    return u.toString();
  } catch {
    return url;
  }
}

// ─── Folder listing ───────────────────────────────────────────────────────────

export interface DropboxFileEntry {
  name: string;
  /** path_lower relative to the shared folder root — used with get_shared_link_file */
  path_lower: string;
  /** File size in bytes as reported by Dropbox (0 if unknown) */
  size: number;
}

/**
 * Lists all files inside a Dropbox shared folder via the live
 * POST /2/files/list_folder endpoint with a shared_link argument.
 *
 * Requires DROPBOX_REFRESH_TOKEN + app credentials (via dropbox-auth.ts).
 * Throws DropboxFetchError("config_missing") when credentials are absent.
 *
 * Handles pagination via /2/files/list_folder/continue when has_more is true.
 */
export async function listDropboxFolderFiles(shareUrl: string): Promise<DropboxFileEntry[]> {
  const token = await getDropboxAccessToken();

  const allEntries: DropboxFileEntry[] = [];
  let cursor: string | undefined;

  // First page
  {
    let res: Response;
    try {
      res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ path: "", shared_link: { url: shareUrl } }),
      });
    } catch (err) {
      throw new DropboxFetchError("network", `Network error listing folder: ${(err as Error).message}`);
    }

    if (res.status === 401) {
      throw new DropboxFetchError(
        "forbidden",
        "Dropbox access token rejected by list_folder — refresh token may have been revoked. " +
          "Regenerate DROPBOX_REFRESH_TOKEN via OAuth offline flow.",
      );
    }
    if (res.status === 404) {
      throw new DropboxFetchError(
        "not_found",
        "Dropbox folder not accessible — check the share link is still active in Joe's sheet",
      );
    }
    if (res.status === 429) {
      throw new DropboxFetchError("forbidden", "Dropbox rate limit hit — retry in a few minutes");
    }
    if (!res.ok) {
      let snippet = "";
      try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.error("[dropbox] list_folder returned unexpected status", { status: res.status, body: snippet });
      throw new DropboxFetchError("network", `Dropbox list_folder returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as { entries?: unknown[]; has_more?: boolean; cursor?: string };
    appendFileEntries(data.entries ?? [], allEntries);
    if (data.has_more && data.cursor) {
      cursor = data.cursor;
    }
  }

  // Subsequent pages (pagination)
  while (cursor) {
    let res: Response;
    try {
      res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cursor }),
      });
    } catch (err) {
      throw new DropboxFetchError("network", `Network error listing folder (continue): ${(err as Error).message}`);
    }
    if (!res.ok) {
      let snippet = "";
      try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.error("[dropbox] list_folder/continue returned unexpected status", { status: res.status, body: snippet });
      throw new DropboxFetchError("network", `Dropbox list_folder/continue returned HTTP ${res.status}`);
    }
    const data = (await res.json()) as { entries?: unknown[]; has_more?: boolean; cursor?: string };
    appendFileEntries(data.entries ?? [], allEntries);
    cursor = data.has_more && data.cursor ? data.cursor : undefined;
  }

  return allEntries;
}

function appendFileEntries(raw: unknown[], out: DropboxFileEntry[]): void {
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const entry = e as Record<string, unknown>;
    if (entry[".tag"] !== "file") continue; // skip sub-folders
    out.push({
      name: String(entry.name ?? ""),
      path_lower: String(entry.path_lower ?? ""),
      size: Number(entry.size ?? 0),
    });
  }
}

// ─── Per-file download from a folder share link ───────────────────────────────

/**
 * Downloads a single file from a Dropbox shared folder via
 * POST /2/sharing/get_shared_link_file.
 *
 * The path_lower is relative to the shared folder root (e.g. "/video.mp4").
 * The API streams raw file bytes in the response body.
 *
 * @throws {DropboxFetchError} on missing credentials, auth error, 404, size cap, or network failure
 */
export async function fetchDropboxFileContent(
  folderShareUrl: string,
  entry: Pick<DropboxFileEntry, "name" | "path_lower">,
): Promise<{ buffer: Buffer; extension: string }> {
  const token = await getDropboxAccessToken();

  const apiArg = JSON.stringify({ url: folderShareUrl, path: entry.path_lower });

  let response: Response;
  try {
    response = await fetch("https://content.dropboxapi.com/2/sharing/get_shared_link_file", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Dropbox-API-Arg": apiArg,
      },
    });
  } catch (err) {
    throw new DropboxFetchError("network", `Network error downloading "${entry.name}": ${(err as Error).message}`);
  }

  if (response.status === 401) {
    throw new DropboxFetchError(
      "forbidden",
      "Dropbox access token rejected by get_shared_link_file — refresh token may have been revoked. " +
        "Regenerate DROPBOX_REFRESH_TOKEN via OAuth offline flow.",
    );
  }
  if (response.status === 404) {
    throw new DropboxFetchError("not_found", `File "${entry.name}" not found in Dropbox folder`);
  }
  if (response.status === 429) {
    throw new DropboxFetchError("forbidden", `Dropbox rate limit hit downloading "${entry.name}" — retry later`);
  }
  if (!response.ok) {
    throw new DropboxFetchError("network", `Dropbox returned HTTP ${response.status} downloading "${entry.name}"`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_SINGLE_FILE_BYTES) {
    throw new DropboxFetchError("too_large", `"${entry.name}" exceeds the 100 MB per-file limit`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new DropboxFetchError("too_large", `"${entry.name}" exceeds the 100 MB per-file limit (actual: ${buffer.byteLength})`);
  }

  const extension = inferExtension(response, entry.name);
  return { buffer, extension };
}

// ─── Single-file download ─────────────────────────────────────────────────────

/**
 * Downloads a single Dropbox asset (single-file share link, /scl/fi/) and
 * returns Buffer + extension. Uses the ?dl=1 direct-download URL.
 *
 * This path is unchanged — single-file links work via direct download
 * and do not require the Bearer token.
 *
 * @throws {DropboxFetchError} on 403, 404, size cap, or network error
 */
export async function downloadDropboxAsset(
  shareUrl: string,
): Promise<{ buffer: Buffer; extension: string }> {
  const directUrl = toDirectDownloadUrl(shareUrl);

  let response: Response;
  try {
    response = await fetch(directUrl, {
      headers: { "User-Agent": "4thefans-asset-queue/1.0" },
      redirect: "follow",
    });
  } catch (err) {
    throw new DropboxFetchError("network", `Network error downloading asset: ${(err as Error).message}`);
  }

  if (response.status === 403) {
    throw new DropboxFetchError("forbidden", "Dropbox link returned 403 — the link may be private or expired");
  }
  if (response.status === 404) {
    throw new DropboxFetchError("not_found", "Dropbox link returned 404 — the file may have been moved or deleted");
  }
  if (!response.ok) {
    throw new DropboxFetchError("network", `Dropbox returned HTTP ${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_SINGLE_FILE_BYTES) {
    throw new DropboxFetchError("too_large", `Asset exceeds the 100 MB limit (content-length: ${contentLength})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SINGLE_FILE_BYTES) {
    throw new DropboxFetchError("too_large", `Asset exceeds the 100 MB limit (actual: ${buffer.byteLength})`);
  }

  const extension = inferExtension(response, directUrl);
  return { buffer, extension };
}

// ─── Folder download ──────────────────────────────────────────────────────────

export interface DropboxFolderFile {
  buffer: Buffer;
  extension: string;
  /** Original filename from Dropbox */
  name: string;
}

/**
 * Lists and downloads all media files from a Dropbox shared folder.
 *
 * - Uses listDropboxFolderFiles (live /2/files/list_folder endpoint)
 * - Downloads each file via fetchDropboxFileContent (live /2/sharing/get_shared_link_file)
 * - Filters to known media extensions (mp4, mov, jpg, jpeg, png, etc.)
 * - Rejects empty folders (no media files found)
 * - Rejects folders whose total bytes exceed 500 MB
 * - Enforces 100 MB cap per individual file
 * - Sequential downloads — no parallelism
 *
 * @throws {DropboxFetchError} on missing token, empty folder, total size cap, or download errors
 */
export async function downloadDropboxFolderFiles(shareUrl: string): Promise<DropboxFolderFile[]> {
  const allEntries = await listDropboxFolderFiles(shareUrl);

  const mediaEntries = allEntries.filter((e) => {
    const ext = e.name.split(".").pop()?.toLowerCase() ?? "";
    return MEDIA_EXTENSIONS.has(ext);
  });

  if (mediaEntries.length === 0) {
    throw new DropboxFetchError("empty_folder", "No media files found in the Dropbox folder (looking for mp4, mov, jpg, png, etc.)");
  }

  const totalBytes = mediaEntries.reduce((sum, e) => sum + e.size, 0);
  if (totalBytes > MAX_FOLDER_BYTES) {
    throw new DropboxFetchError(
      "folder_too_large",
      `Folder total size (${Math.round(totalBytes / 1024 / 1024)} MB) exceeds the 500 MB limit`,
    );
  }

  const results: DropboxFolderFile[] = [];
  for (const entry of mediaEntries) {
    const { buffer, extension } = await fetchDropboxFileContent(shareUrl, entry);
    results.push({ buffer, extension, name: entry.name });
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferExtension(response: Response, filenameHint: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i);
  if (filenameMatch) {
    const ext = filenameMatch[1].split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const typeMap: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  for (const [mime, ext] of Object.entries(typeMap)) {
    if (contentType.includes(mime)) return ext;
  }

  // Try filenameHint as a URL first, then as a plain filename
  try {
    const pathname = new URL(filenameHint).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    const ext = filenameHint.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  }

  return "bin";
}
