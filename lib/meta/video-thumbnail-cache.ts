/**
 * lib/meta/video-thumbnail-cache.ts
 *
 * Central, cross-feature cache for Meta's `/{video_id}/thumbnails` Graph
 * edge. That endpoint was the #1 hit on the app's Meta rate-limit budget
 * (1343 calls/24h) — every video-creative preview path (active-creatives
 * cron + on-demand warm, the ad_id thumbnail proxy's video fallback, and
 * the audience-builder video source picker) independently re-resolved the
 * same handful of `video_id`s on every run.
 *
 * `fetchThumbnailUrl` is the ONE place that may call the Graph
 * `/{video_id}/thumbnails` edge. It:
 *   1. Checks the `creative-thumbnails` Storage bucket (migration 068e —
 *      same public-read bucket the ad_id-keyed thumbnail proxy and the
 *      autotag byte cache already use) for a `video-thumb/{video_id}.*`
 *      object. Returns its public URL immediately on a hit — no Meta call.
 *   2. On a miss, fetches `/{video_id}/thumbnails`, picks the best
 *      resolution via `pickBestVideoThumbnail`, downloads the bytes, and
 *      uploads them to Storage under that same key. Returns the new public
 *      URL.
 *   3. Never calls Meta twice for the same `video_id` — cross-run via the
 *      Storage check, same-run (e.g. many concept groups or audience
 *      videos sharing one `video_id`) via an in-process in-flight map.
 *
 * Gated by `ENABLE_META_THUMBNAIL_FETCH` (default "1"). Set to "0" to stop
 * burning Meta quota entirely: cache hits still serve, but a miss returns
 * `null` instead of fetching — callers already treat a null/undefined
 * thumbnail as "fall back to whatever placeholder they had".
 *
 * Every failure (Storage down, Meta error, bad image response) is
 * swallowed and logged — a thumbnail cache outage must never fail the
 * caller's larger operation (a cron run, an audience fetch, a share page).
 */

import { pickBestVideoThumbnail } from "./video-thumbnails.ts";
import {
  CREATIVE_THUMBNAIL_BUCKET,
  CREATIVE_THUMB_CACHE_SEC,
  extFromContentType,
} from "./creative-thumbnail-pure.ts";

type GraphGetter = <T>(
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<T>;

/**
 * Lazily imported — `./client.ts` pulls in the full Meta client surface
 * (campaign/adset/creative builders, app-usage tracking, etc). Deferring
 * the import until a real (non-injected) call happens keeps this module
 * cheap to import from tests that always inject `graphGet`, mirroring the
 * same lazy-default pattern `active-creatives-thumbnail-enrichment.ts`
 * already uses for the same reason.
 */
async function defaultGraphGet<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const { graphGetWithToken } = await import("./client.ts");
  return graphGetWithToken<T>(path, params, token);
}

const VIDEO_THUMB_PREFIX = "video-thumb";
const VIDEO_THUMBNAIL_FIELDS = "uri,width,height,scale,is_preferred";

interface VideoThumbnailStorageBucket {
  list(
    path: string,
    options?: { limit?: number; search?: string },
  ): Promise<{
    data: Array<{ name: string }> | null;
    error: { message: string } | null;
  }>;
  upload(
    path: string,
    body: Buffer,
    options?: {
      contentType?: string;
      upsert?: boolean;
      cacheControl?: string;
    },
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}

/**
 * Narrow surface this module needs — a real `SupabaseClient<Database>` (or
 * `SupabaseClient`) satisfies this structurally, and unit tests can pass a
 * plain in-memory fake without a real Supabase client.
 */
export interface VideoThumbnailCacheClient {
  storage: {
    from(bucket: string): VideoThumbnailStorageBucket;
  };
}

export interface FetchThumbnailUrlArgs {
  videoId: string;
  token: string;
  admin: VideoThumbnailCacheClient;
  /** Injectable for tests; defaults to the real Graph client (lazily imported). */
  graphGet?: GraphGetter;
  /** Injectable for tests; defaults to global `fetch`. */
  fetchImage?: typeof fetch;
}

function isMetaThumbnailFetchEnabled(): boolean {
  return process.env.ENABLE_META_THUMBNAIL_FETCH !== "0";
}

function sanitizeVideoId(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > 64 || !/^[0-9]+$/.test(t)) return null;
  return t;
}

function storagePathForVideo(videoId: string, contentType: string): string {
  return `${VIDEO_THUMB_PREFIX}/${videoId}.${extFromContentType(contentType)}`;
}

async function findCachedVideoThumbnailPath(
  bucket: VideoThumbnailStorageBucket,
  videoId: string,
): Promise<string | null> {
  const { data, error } = await bucket.list(VIDEO_THUMB_PREFIX, {
    limit: 10,
    search: videoId,
  });
  if (error || !data) return null;
  const match = data.find((f) => f.name.startsWith(`${videoId}.`));
  return match ? `${VIDEO_THUMB_PREFIX}/${match.name}` : null;
}

async function resolveThumbnailUrlUncached(
  args: FetchThumbnailUrlArgs,
  videoId: string,
): Promise<string | null> {
  const bucket = args.admin.storage.from(CREATIVE_THUMBNAIL_BUCKET);

  try {
    const cachedPath = await findCachedVideoThumbnailPath(bucket, videoId);
    if (cachedPath) {
      return bucket.getPublicUrl(cachedPath).data.publicUrl;
    }
  } catch (err) {
    console.warn(
      `[video-thumbnail-cache] cache lookup failed video_id=${videoId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // Fall through — a Storage read failure shouldn't block the Meta fetch.
  }

  if (!isMetaThumbnailFetchEnabled()) {
    console.info(
      `[video-thumbnail-cache] skip_disabled video_id=${videoId} (ENABLE_META_THUMBNAIL_FETCH=0)`,
    );
    return null;
  }

  const graphGet = args.graphGet ?? defaultGraphGet;
  const fetchImage = args.fetchImage ?? fetch;

  try {
    const res = await graphGet<{ data?: unknown[] }>(
      `/${videoId}/thumbnails`,
      { fields: VIDEO_THUMBNAIL_FIELDS },
      args.token,
    );
    const best = pickBestVideoThumbnail(res.data ?? []);
    if (!best) return null;

    const imgRes = await fetchImage(best.uri, { cache: "no-store" });
    if (!imgRes.ok) {
      throw new Error(`Thumbnail image fetch failed: HTTP ${imgRes.status}`);
    }
    const contentType =
      imgRes.headers.get("content-type")?.split(";")[0]?.trim() ||
      "image/jpeg";
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const path = storagePathForVideo(videoId, contentType);

    const { error: uploadErr } = await bucket.upload(path, buffer, {
      contentType,
      upsert: true,
      cacheControl: `${CREATIVE_THUMB_CACHE_SEC}`,
    });
    if (uploadErr) throw new Error(uploadErr.message);

    return bucket.getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.warn(
      `[video-thumbnail-cache] fetch failed video_id=${videoId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

const inFlightByVideoId = new Map<string, Promise<string | null>>();

/**
 * Resolve a public, cacheable URL for `videoId`'s best-resolution poster
 * frame. Storage-cache-first; falls back to Meta on a miss (see module
 * docstring). Returns `null` on any unrecoverable failure — never throws.
 */
export async function fetchThumbnailUrl(
  args: FetchThumbnailUrlArgs,
): Promise<string | null> {
  const videoId = sanitizeVideoId(args.videoId);
  if (!videoId) return null;

  const inFlight = inFlightByVideoId.get(videoId);
  if (inFlight) return inFlight;

  const promise = resolveThumbnailUrlUncached(args, videoId).finally(() => {
    inFlightByVideoId.delete(videoId);
  });
  inFlightByVideoId.set(videoId, promise);
  return promise;
}

/**
 * Resolve URLs for many `video_id`s at once. Each id still only ever hits
 * Meta once (bounded by the same cache + in-flight map as the single-id
 * path) — this is a convenience wrapper for callers that previously used
 * Meta's `?ids=` batched multi-get, not a separate Graph call shape.
 */
export async function fetchThumbnailUrlsBatch(
  videoIds: readonly string[],
  args: Omit<FetchThumbnailUrlArgs, "videoId">,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(videoIds)];
  const results = await Promise.all(
    unique.map(async (videoId) => {
      const url = await fetchThumbnailUrl({ ...args, videoId });
      return [videoId, url] as const;
    }),
  );
  for (const [videoId, url] of results) {
    if (url) out.set(videoId, url);
  }
  return out;
}

export const __videoThumbnailCacheTest = {
  sanitizeVideoId,
  storagePathForVideo,
  isMetaThumbnailFetchEnabled,
};
