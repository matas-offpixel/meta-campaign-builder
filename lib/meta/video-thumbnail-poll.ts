/**
 * lib/meta/video-thumbnail-poll.ts
 *
 * Post-upload thumbnail polling for Meta video assets.
 *
 * Extracted from client.ts so it can be imported by unit tests without
 * pulling in MetaApiError (which uses TypeScript parameter properties that
 * node --experimental-strip-types cannot handle).
 *
 * Context:
 *   Meta's POST /{adAccountId}/advideos response does NOT include `picture`
 *   or `preview_image_url` — the video is still ENCODING at upload time.
 *   We poll GET /{videoId}?fields=picture on a bounded backoff schedule to
 *   get the auto-generated thumbnail URL.
 *
 * Returns the thumbnail URL string, or "" if unavailable after every attempt.
 *
 * `_pollDelaysMs` is injectable for unit tests (defaults to
 * {@link DEFAULT_POLL_DELAYS_MS} in production — pass an array of zeros to
 * skip real sleeps in tests).
 *
 * task #128 — root cause + fix for motion ads shipping Meta's loading-spinner
 * GIF as their still frame:
 *
 *   While a video is still encoding, GET /{videoId}?fields=picture doesn't
 *   omit `picture` or return null — it returns a URL to Facebook's INTERNAL
 *   "still processing" spinner GIF, served from `static.xx.fbcdn.net/rsrc.php/`
 *   (the UI resource CDN, never user content — user-uploaded media is always
 *   on `scontent*.xx.fbcdn.net`). The original `if (typeof data.picture ===
 *   "string" && data.picture)` check happily accepted that as a valid
 *   thumbnail because it IS a non-empty string — it just isn't a real frame
 *   of the video. That spinner URL then got stored as `Asset.thumbnailUrl`
 *   and PR #748 started uploading it via /adimages as `video_data.image_hash`
 *   for every video ad, so every motion ad since has shipped with the
 *   spinner as its Feed/Stories still frame whenever encoding hadn't
 *   finished within the original 6 s budget (which, per Meta's docs, video
 *   encoding's 95th percentile is ~45 s for HD and ~90 s for 4K — so this hit
 *   the vast majority of uploads, not an edge case).
 *
 *   Fixed two ways, together:
 *     1. {@link isMetaPlaceholderThumbnailUrl} detects the spinner (and any
 *        other `rsrc.php` UI-CDN URL) and the caller treats it exactly like
 *        "picture not ready yet" — keep polling instead of accepting it.
 *     2. The polling budget grew from 2 attempts / 6 s total to
 *        {@link DEFAULT_POLL_DELAYS_MS} — 5 attempts / 48 s total — to catch
 *        the ~90% of encodes that finish inside Meta's documented 45 s p95
 *        for HD. The remaining tail still returns "" (unchanged contract);
 *        `buildVideoCreative` then falls back to `Asset.thumbnailUrl` or
 *        omits `image_url` (with a loud warning) rather than ever shipping
 *        the spinner.
 *
 * task #128 continued — a SECOND, distinct detection gap surfaced once
 * `scripts/repair-video-thumbnails.mjs` (PR #763/#764) started running
 * against live campaigns: {@link isMetaPlaceholderThumbnailUrl} never fired
 * on any already-repaired-or-broken creative it scanned, even ones
 * demonstrably shipping the spinner (e.g. draft `faf11b6f` / creative
 * `6e168e8b`, "IPC Motion 1"). Root cause: PR #748 uploads the spinner GIF
 * via `POST /{adAccountId}/adimages` to mint an `image_hash`, and that hash
 * points to an image in the AD ACCOUNT's own image library from then on.
 * `GET /{adAccountId}/adimages?hashes=[h]&fields=url` therefore resolves to
 * an ad-account-scoped `scontent*.fbcdn.net` URL — NOT the original
 * `static.xx.fbcdn.net/rsrc.php/AAqMW82PqGg.gif` URL the spinner came from.
 * `isMetaPlaceholderThumbnailUrl`'s CDN-host/filename check is correct for
 * its actual job (rejecting Meta's LIVE `/{videoId}?fields=picture` response
 * during upload, which is still the pre-upload spinner URL at that point)
 * but structurally cannot catch the placeholder once it's been re-hosted as
 * an ad image.
 *
 * Fix: {@link isMetaPlaceholderThumbnailImage} classifies the RESOLVED IMAGE
 * ITSELF (post-upload metadata from `/adimages`), using the fingerprint that
 * survives the upload → hash → resolve roundtrip even though the URL
 * doesn't: the spinner is a tiny (~1 KB) 16×16 GIF, whereas a real video
 * thumbnail is a 15–50 KB JPG at a video aspect ratio (e.g. 720×1280,
 * 1080×1080). See `lib/meta/video-thumbnail-repair-scan.ts` for the caller
 * that resolves this metadata (`resolveImageHashMetadata` +
 * `fetchContentLength`).
 */

const META_API_BASE = `https://graph.facebook.com/v21.0`;

/**
 * Bounded exponential backoff schedule: [3s, 5s, 8s, 12s, 20s] = 5 attempts,
 * 48s total. See the module doc comment (task #128) for why 48s and not the
 * original 6s.
 */
export const DEFAULT_POLL_DELAYS_MS: readonly number[] = [3000, 5000, 8000, 12000, 20000];

/**
 * Facebook's static UI-resource CDN — used for chrome like the video
 * "still encoding" spinner GIF, NEVER for user-uploaded content (which is
 * always served from `scontent*.xx.fbcdn.net`). Any `picture` value Meta
 * returns from this host/path is a placeholder, not a real video frame.
 */
const PLACEHOLDER_CDN_PATTERN = /^https?:\/\/(static|www)\.[a-z0-9.-]*fbcdn\.net\/rsrc\.php\//i;

/**
 * Filename fragment of the specific "still processing" spinner GIF observed
 * in the wild (task #128 reproducer). Matched independently of
 * {@link PLACEHOLDER_CDN_PATTERN} in case Meta ever serves it from a
 * different path but keeps the same asset id.
 */
const KNOWN_SPINNER_FILENAME_FRAGMENT = "AAqMW82PqGg";

/**
 * Returns true if `url` is one of Meta's internal placeholder/spinner
 * images rather than a real thumbnail of the uploaded video content.
 */
export function isMetaPlaceholderThumbnailUrl(url: string): boolean {
  if (!url) return false;
  if (PLACEHOLDER_CDN_PATTERN.test(url)) return true;
  if (url.includes(KNOWN_SPINNER_FILENAME_FRAGMENT)) return true;
  return false;
}

// ─── Post-upload image fingerprinting (task #128 continued) ─────────────────
//
// Once the spinner has been uploaded as an ad image, its URL/host no longer
// carries any placeholder signal (see the module doc comment above) — but
// its file-level fingerprint does. A real video thumbnail from Meta's
// auto-generation is a 15–50 KB JPG at a video aspect ratio; the spinner is
// a ~1 KB 16×16 GIF. Any one of these signals alone is enough to flag it;
// they're deliberately redundant (belt-and-braces) because different Meta
// API responses populate different subsets of these fields.

/** Ad images with both dimensions at or below this are almost certainly a UI icon/spinner, never a video frame. */
export const SPINNER_MAX_DIMENSION_PX = 32;

/** Ad images smaller than this on disk are almost certainly a UI icon/spinner — real thumbnails run 15–50 KB. */
export const SPINNER_MAX_CONTENT_LENGTH_BYTES = 5000;

/**
 * Metadata about an already-uploaded ad image, as resolved via
 * `GET /{adAccountId}/adimages?hashes=[...]&fields=hash,url,width,height,name`
 * (optionally enriched with a HEAD-derived `contentLengthBytes`). All fields
 * are optional because different Meta responses/repair-script code paths
 * populate different subsets.
 */
export interface MetaAdImageFingerprint {
  url?: string;
  width?: number;
  height?: number;
  name?: string;
  contentLengthBytes?: number;
}

/**
 * Classifies an already-uploaded ad image (post `/adimages` roundtrip) as
 * Meta's placeholder/spinner rather than a real video thumbnail. Unlike
 * {@link isMetaPlaceholderThumbnailUrl} (which inspects the URL's CDN
 * host/path — only valid for the LIVE pre-upload `/{videoId}?fields=picture`
 * response), this inspects the image's own dimensions/format/size, which
 * survive the upload → hash → resolve roundtrip.
 */
export function isMetaPlaceholderThumbnailImage(image: MetaAdImageFingerprint): boolean {
  if (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.width <= SPINNER_MAX_DIMENSION_PX &&
    image.height <= SPINNER_MAX_DIMENSION_PX
  ) {
    return true;
  }

  const name = image.name ?? "";
  const url = image.url ?? "";

  if (/\.gif(\?|$)/i.test(name) || /\.gif(\?|$)/i.test(url)) return true;
  if (name.includes(KNOWN_SPINNER_FILENAME_FRAGMENT) || url.includes(KNOWN_SPINNER_FILENAME_FRAGMENT)) return true;
  if (name.toLowerCase().includes("rsrc")) return true;

  if (typeof image.contentLengthBytes === "number" && image.contentLengthBytes < SPINNER_MAX_CONTENT_LENGTH_BYTES) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchVideoThumbnailWithRetry(
  videoId: string,
  token: string,
  _pollDelaysMs: readonly number[] = DEFAULT_POLL_DELAYS_MS,
): Promise<string> {
  const url = `${META_API_BASE}/${videoId}?fields=picture&access_token=${encodeURIComponent(token)}`;
  const totalAttempts = _pollDelaysMs.length;

  for (let i = 0; i < totalAttempts; i++) {
    const attempt = i + 1;
    await sleep(_pollDelaysMs[i]);
    try {
      const res = await fetch(url);
      const data = (await res.json()) as Record<string, unknown>;

      if (typeof data.picture === "string" && data.picture) {
        if (isMetaPlaceholderThumbnailUrl(data.picture)) {
          console.log(
            `[uploadVideoAsset] placeholder/spinner thumbnail returned on attempt ${attempt} for ` +
              `videoId=${videoId} (${data.picture}) — video still encoding, will retry`,
          );
        } else {
          console.log(
            `[uploadVideoAsset] thumbnail fetched on attempt ${attempt} for videoId=${videoId}`,
          );
          return data.picture;
        }
      } else if (attempt < totalAttempts) {
        console.log(
          `[uploadVideoAsset] picture not yet available on attempt ${attempt} for videoId=${videoId} — will retry`,
        );
      }
    } catch (err) {
      console.error(
        `[uploadVideoAsset] thumbnail fetch error on attempt ${attempt} for videoId=${videoId}:`,
        err instanceof Error ? err.message : err,
      );
      // Don't throw — fall through to next attempt or empty return
    }
  }

  const totalWaitMs = _pollDelaysMs.reduce((sum, ms) => sum + ms, 0);
  console.error(
    `[uploadVideoAsset] WARNING: thumbnail not yet available after ${Math.round(totalWaitMs / 1000)}s ` +
      `(${totalAttempts} attempts) for videoId=${videoId} — every response was either absent or a placeholder`,
  );
  return "";
}
