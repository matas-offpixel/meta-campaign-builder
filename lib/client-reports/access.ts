/**
 * Pure rules for client season reports.
 *
 * Vercel Functions cap the request body and the response body at 4.5 MB.
 * https://vercel.com/docs/functions/limitations (updated 24 Aug 2026):
 * "The maximum payload size for the request body or the response body of
 * a Vercel Function is 4.5 MB."
 * https://vercel.com/docs/errors/FUNCTION_RESPONSE_PAYLOAD_TOO_LARGE
 * (updated 9 Feb 2026) uses the same 4.5 MB figure for the response.
 * Neither page, nor https://vercel.com/docs/functions/streaming or
 * https://vercel.com/docs/functions/streaming-functions, gives a streamed
 * response a higher cap. Streaming changes when bytes leave the function,
 * not how many bytes the platform will send. Uploads above this limit
 * are rejected so a stored object can always be returned whole.
 *
 * 4.5 MiB = 4.5 × 1024 × 1024 = 4,718,592 bytes.
 */

export const SEASON_REPORT_MAX_BYTES = 4_718_592;

export const SEASON_REPORT_NOT_FOUND_BODY = "Not found";

/**
 * sandbox without allow-same-origin gives the document an opaque origin,
 * so its scripts cannot read app.offpixel cookies or call our APIs.
 * connect-src 'none' blocks CDN script loads; reports inline their libraries.
 */
export const SEASON_REPORT_CSP = [
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: https:",
  "font-src data:",
  "connect-src 'none'",
].join("; ");

const SEASON_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const STORAGE_PATH_PATTERN =
  /^[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}\/[0-9a-f-]{36}\.html$/i;

export type SeasonReportGate = {
  enabled: boolean;
  expires_at: string | null;
};

export type SeasonReportListItem = SeasonReportGate & {
  client_id: string;
  title: string;
  season: string;
  share_token: string;
};

/** Fields the operator card is allowed to hold. No storage path. */
export type ClientReportCard = {
  id: string;
  season: string;
  title: string;
  share_token: string;
  enabled: boolean;
  expires_at: string | null;
  created_at: string;
};

export function seasonReportIsServable(
  row: SeasonReportGate | null,
  now: Date,
): boolean {
  if (!row || !row.enabled) return false;
  if (row.expires_at == null) return true;
  const exp = Date.parse(row.expires_at);
  return Number.isFinite(exp) && exp > now.getTime();
}

/**
 * Unknown, disabled, expired, and a missing object all become this
 * response. The body does not say which.
 */
export function seasonReportNotFound(): Response {
  return new Response(SEASON_REPORT_NOT_FOUND_BODY, {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export function seasonReportDocument(body: BodyInit): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": SEASON_REPORT_CSP,
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    },
  });
}

export function buildSeasonReportResponse(
  row: SeasonReportGate | null,
  now: Date,
  body: BodyInit | null,
): Response {
  if (!seasonReportIsServable(row, now) || body == null) {
    return seasonReportNotFound();
  }
  return seasonReportDocument(body);
}

/**
 * The SELECT policy is `clients.user_id = auth.uid()` for the row's
 * client. Anon (no uid) and any other user see no row.
 */
export function clientReportVisibleToOwner(
  viewerUserId: string | null,
  clientOwnerUserId: string,
): boolean {
  return viewerUserId !== null && viewerUserId === clientOwnerUserId;
}

export function visibleSeasonReports<T extends SeasonReportListItem>(
  rows: readonly T[],
  clientId: string,
  now: Date,
): T[] {
  return rows.filter(
    (row) => row.client_id === clientId && seasonReportIsServable(row, now),
  );
}

export function seasonReportStoragePath(
  clientId: string,
  season: string,
  reportId: string,
): string {
  const safeSeason = season.trim();
  if (!SEASON_PATTERN.test(safeSeason)) {
    throw new Error("Season is not safe to use in a storage path.");
  }
  return `${clientId}/${safeSeason}/${reportId}.html`;
}

export function storagePathBelongsToClient(
  storagePath: string,
  clientId: string,
): boolean {
  if (!storagePath.startsWith(`${clientId}/`)) return false;
  if (storagePath.includes("..") || storagePath.includes("\\")) return false;
  return STORAGE_PATH_PATTERN.test(storagePath);
}

export function validateSeasonReportMeta(
  season: string,
  title: string,
): string | null {
  const safeSeason = season.trim();
  const safeTitle = title.trim();
  if (!SEASON_PATTERN.test(safeSeason)) {
    return 'Season can use letters, numbers, spaces, dots, hyphens and underscores, up to 64 characters (for example "Season 1").';
  }
  if (safeTitle.length < 1 || safeTitle.length > 120) {
    return "Title must be between 1 and 120 characters.";
  }
  return null;
}

export function validateSeasonReportUpload(input: {
  filename: string;
  byteLength: number;
  head?: string;
}): { ok: true } | { ok: false; status: 400 | 413; error: string } {
  if (!input.filename.toLowerCase().endsWith(".html")) {
    return { ok: false, status: 400, error: "Upload an .html file." };
  }
  if (!Number.isFinite(input.byteLength) || input.byteLength <= 0) {
    return { ok: false, status: 400, error: "The HTML file is empty." };
  }
  if (input.byteLength > SEASON_REPORT_MAX_BYTES) {
    return {
      ok: false,
      status: 413,
      error:
        `This report is ${input.byteLength} bytes. The limit is ${SEASON_REPORT_MAX_BYTES} bytes (4.5 MB). ` +
        "Vercel Functions cap the response at 4.5 MB, and streaming does not raise that cap, so the file was not saved.",
    };
  }
  const head = (input.head ?? "").replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (!head.startsWith("<!doctype html") && !head.startsWith("<html")) {
    return {
      ok: false,
      status: 400,
      error: "The file must be an HTML document (it should start with <!DOCTYPE html> or <html>).",
    };
  }
  return { ok: true };
}

export function parseSeasonReportExpiry(
  value: unknown,
): { ok: true; expiresAt: string | null } | { ok: false; error: string } {
  if (value === null || value === "") return { ok: true, expiresAt: null };
  if (typeof value !== "string") {
    return { ok: false, error: "Expiry must be a date or empty." };
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    return { ok: false, error: "Expiry is not a valid date." };
  }
  return { ok: true, expiresAt: new Date(ms).toISOString() };
}
