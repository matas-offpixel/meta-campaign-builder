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
 *   We poll GET /{videoId}?fields=picture twice (3 s apart) to get the
 *   auto-generated thumbnail URL.
 *
 * Returns the thumbnail URL string, or "" if unavailable after both attempts.
 *
 * `_pollDelayMs` is injectable for unit tests (defaults to 3000 in production).
 */

const META_API_BASE = `https://graph.facebook.com/v21.0`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchVideoThumbnailWithRetry(
  videoId: string,
  token: string,
  _pollDelayMs = 3000,
): Promise<string> {
  const url = `${META_API_BASE}/${videoId}?fields=picture&access_token=${encodeURIComponent(token)}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    await sleep(_pollDelayMs);
    try {
      const res = await fetch(url);
      const data = (await res.json()) as Record<string, unknown>;

      if (typeof data.picture === "string" && data.picture) {
        console.log(
          `[uploadVideoAsset] thumbnail fetched on attempt ${attempt} for videoId=${videoId}`,
        );
        return data.picture;
      }

      if (attempt < 2) {
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

  console.error(
    `[uploadVideoAsset] WARNING: thumbnail not yet available after 6s for videoId=${videoId}`,
  );
  return "";
}
