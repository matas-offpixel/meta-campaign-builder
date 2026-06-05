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
 * If a URL returns 403/404 we throw a DropboxFetchError with a code so
 * the caller can set a user-visible error message WITHOUT logging the URL.
 */

const MAX_SINGLE_FILE_BYTES = 100 * 1024 * 1024; // 100 MB per file
const MAX_FOLDER_BYTES      = 500 * 1024 * 1024; // 500 MB total for folders

/** Media extensions we will accept from folder listings */
const MEDIA_EXTENSIONS = new Set(["mp4", "mov", "webm", "jpg", "jpeg", "png", "gif", "webp"]);

export class DropboxFetchError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "too_large" | "folder_too_large" | "empty_folder" | "network",
    message: string,
  ) {
    super(message);
    this.name = "DropboxFetchError";
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
  /** Direct share link for the file (convertible via toDirectDownloadUrl) */
  url: string;
  /** File size in bytes as reported by Dropbox (0 if unknown) */
  size: number;
}

/**
 * Lists all files inside a Dropbox shared folder.
 *
 * Strategy:
 *   1. Try the official Dropbox API with Bearer token (DROPBOX_ACCESS_TOKEN).
 *      Required for production — Dropbox rejects unauthenticated API calls.
 *   2. If the token is absent (local dev) or the API returns a non-fatal error,
 *      fall back to HTML-scraping __INITIAL_PROPS__.
 *
 * Note: single-page only. Dropbox paginates via cursor when a folder has many
 * files. For Joe's folders (< 50 files) this is not an issue, but adding cursor
 * support is a known follow-up if needed.
 *
 * Env: DROPBOX_ACCESS_TOKEN — long-lived token from the Off Pixel DB Dropbox app.
 */
export async function listDropboxFolderFiles(shareUrl: string): Promise<DropboxFileEntry[]> {
  const apiResult = await tryDropboxApiList(shareUrl);
  if (apiResult !== null) return apiResult;
  return scrapeDropboxFolderPage(shareUrl);
}

async function tryDropboxApiList(shareUrl: string): Promise<DropboxFileEntry[] | null> {
  const token = process.env.DROPBOX_ACCESS_TOKEN;

  if (!token) {
    // No token in env — skip the API call and fall through to HTML scrape.
    // This keeps local dev working without credentials.
    console.error("[dropbox] DROPBOX_ACCESS_TOKEN not set — falling back to HTML scrape for folder listing");
    return null;
  }

  let res: Response;
  try {
    res = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_link_files", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: shareUrl }),
    });
  } catch {
    // Network failure — fall through to HTML scrape
    return null;
  }

  if (res.status === 401) {
    throw new DropboxFetchError(
      "forbidden",
      "Dropbox access token rejected — regenerate the token in the Off Pixel DB app console and update the DROPBOX_ACCESS_TOKEN env var",
    );
  }

  if (res.status === 404) {
    throw new DropboxFetchError(
      "not_found",
      "Folder not found or no longer shared — check the share URL is still active",
    );
  }

  if (res.status === 429) {
    throw new DropboxFetchError(
      "forbidden",
      "Dropbox rate limit hit — retry in a few minutes",
    );
  }

  if (!res.ok) {
    // Non-fatal — log status for debugging but fall through to HTML scrape
    let snippet = "";
    try { snippet = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    console.error("[dropbox] API returned unexpected status", { status: res.status, body: snippet });
    return null;
  }

  const data = (await res.json()) as { entries?: unknown[]; has_more?: boolean; cursor?: string };

  // Note: if data.has_more is true there are more pages behind data.cursor.
  // For now we return only the first page (sufficient for Joe's small folders).
  const raw = data.entries ?? [];

  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .filter((e) => e[".tag"] === "file")          // skip .tag === "folder" sub-folders
    .map((e) => ({
      name: String(e.name ?? ""),
      // "url" from the API is a share link → toDirectDownloadUrl adds ?dl=1
      url: String(e.url ?? ""),
      size: Number(e.size ?? 0),
    }));
}

async function scrapeDropboxFolderPage(shareUrl: string): Promise<DropboxFileEntry[]> {
  let res: Response;
  try {
    res = await fetch(shareUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
  } catch (err) {
    throw new DropboxFetchError(
      "network",
      `Network error fetching folder page: ${(err as Error).message}`,
    );
  }

  if (res.status === 403) throw new DropboxFetchError("forbidden", "Folder page returned 403 — link may be private");
  if (res.status === 404) throw new DropboxFetchError("not_found", "Folder page returned 404 — link not found");
  if (!res.ok) throw new DropboxFetchError("network", `Folder page returned HTTP ${res.status}`);

  const html = await res.text();

  // Extract window.__INITIAL_PROPS__ JSON from the HTML
  const props = extractInitialProps(html);
  if (!props) {
    throw new DropboxFetchError("network", "Could not find __INITIAL_PROPS__ in folder page — page may require sign-in");
  }

  const entries = findFileEntries(props);
  if (!entries || entries.length === 0) {
    throw new DropboxFetchError("empty_folder", "No files found in the shared Dropbox folder");
  }

  return entries;
}

/**
 * Extracts and parses `window.__INITIAL_PROPS__` from Dropbox folder HTML.
 * Uses brace-balancing rather than a regex to handle nested objects safely.
 */
function extractInitialProps(html: string): Record<string, unknown> | null {
  const marker = "window.__INITIAL_PROPS__";
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) return null;

  const jsonStart = html.indexOf("{", markerIdx);
  if (jsonStart === -1) return null;

  // Balance braces to find the end of the JSON object
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = jsonStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") { depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

/**
 * Searches the __INITIAL_PROPS__ tree for an array of file entry objects.
 * Tries known keys ("entries", "items", "files") then falls back to recursive search.
 */
function findFileEntries(
  obj: unknown,
  depth = 0,
): DropboxFileEntry[] | null {
  if (depth > 6 || !obj || typeof obj !== "object") return null;

  if (Array.isArray(obj)) {
    const withName = obj.filter(
      (e): e is Record<string, unknown> =>
        !!e && typeof e === "object" && typeof (e as Record<string, unknown>).name === "string",
    );
    if (withName.length > 0) {
      return withName.map((e) => ({
        name: String(e.name),
        url: String(e.url ?? e.link_url ?? e.path_lower ?? ""),
        size: Number(e.size ?? e.bytes ?? 0),
      }));
    }
    for (const item of obj) {
      const found = findFileEntries(item, depth + 1);
      if (found && found.length > 0) return found;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;
  for (const key of ["entries", "items", "files", "data", "fileList", "file_list"]) {
    if (Array.isArray(record[key])) {
      const found = findFileEntries(record[key], depth + 1);
      if (found && found.length > 0) return found;
    }
  }
  for (const val of Object.values(record)) {
    if (val && typeof val === "object") {
      const found = findFileEntries(val, depth + 1);
      if (found && found.length > 0) return found;
    }
  }

  return null;
}

// ─── Single-file download ─────────────────────────────────────────────────────

/**
 * Downloads a single Dropbox asset and returns Buffer + extension.
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
 * - Filters to known media extensions (mp4, mov, jpg, jpeg, png, etc.)
 * - Rejects empty folders (no media files found)
 * - Rejects folders whose total bytes exceed 500 MB
 * - Enforces 100 MB cap per individual file
 *
 * @throws {DropboxFetchError} on empty folder, total size cap, or download errors
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
    const ext = entry.name.split(".").pop()?.toLowerCase() ?? "bin";
    const { buffer, extension } = await downloadDropboxAsset(entry.url);
    results.push({ buffer, extension, name: entry.name });
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferExtension(response: Response, url: string): string {
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

  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    // ignore
  }

  return "bin";
}
