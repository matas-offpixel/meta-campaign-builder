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
 *        {@link resolveVideoThumbnailHash} in `lib/meta/creative.ts` already
 *        omits both `image_hash`/`image_url` in that case and lets Meta
 *        auto-generate a thumbnail at ad-creation time, rather than ever
 *        shipping the spinner.
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
