/**
 * dropbox.ts
 *
 * Converts public Dropbox share URLs to direct-download form and streams
 * the file to a Buffer. All downloads are server-side only — never expose
 * Dropbox URLs to the client.
 *
 * If the URL returns 403/404 we throw a DropboxFetchError with a code so
 * the caller can set a user-visible error message WITHOUT logging the URL.
 */

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB hard cap

export class DropboxFetchError extends Error {
  constructor(
    public readonly code: "not_found" | "forbidden" | "too_large" | "network",
    message: string,
  ) {
    super(message);
    this.name = "DropboxFetchError";
  }
}

/**
 * Converts a Dropbox share link to its direct-download equivalent.
 *
 * Handles:
 *   - https://www.dropbox.com/s/...?dl=0   → …?dl=1
 *   - https://www.dropbox.com/scl/fi/...    → appends ?dl=1
 *   - https://dl.dropboxusercontent.com/... → unchanged (already direct)
 */
export function toDirectDownloadUrl(url: string): string {
  // Already a direct CDN URL
  if (url.includes("dl.dropboxusercontent.com")) return url;

  try {
    const u = new URL(url);
    u.searchParams.set("dl", "1");
    return u.toString();
  } catch {
    // URL is malformed — return as-is so the fetch fails naturally
    return url;
  }
}

/**
 * Downloads the asset at the given Dropbox URL and returns the raw Buffer
 * plus the inferred file extension.
 *
 * @throws {DropboxFetchError} on 403, 404, size cap exceeded, or network error
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

  // Enforce size cap before reading body
  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BYTES) {
    throw new DropboxFetchError("too_large", `Asset exceeds the 200 MB limit (content-length: ${contentLength})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new DropboxFetchError("too_large", `Asset exceeds the 200 MB limit (actual: ${buffer.byteLength})`);
  }

  // Derive extension from Content-Disposition or Content-Type
  const extension = inferExtension(response, directUrl);

  return { buffer, extension };
}

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

  // Fall back to URL path extension
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    // ignore
  }

  return "bin";
}
