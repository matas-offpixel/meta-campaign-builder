import {
  fetchThumbnailUrl,
  type FetchThumbnailUrlArgs,
  type VideoThumbnailCacheClient,
} from "./video-thumbnail-cache.ts";

/**
 * Ad Creative read parameters. Documented on the Ad Creative node
 * (default 64): `thumbnail_width` and `thumbnail_height` render
 * `thumbnail_url` at the requested size.
 * https://developers.facebook.com/docs/marketing-api/reference/ad-creative/
 * The app reads Marketing API v21.0; the v21 changelog does not remove
 * these parameters, and the current Ad Creative reference still lists
 * them. They belong on `GET /{creative-id}`, not on the Ad node, so the
 * sized read is a second request and only runs when video_id and
 * image_url are both absent.
 */
export const CREATIVE_THUMBNAIL_EDGE = "600";

type GraphGet = (
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<unknown>;

interface CreativeFields {
  creative?: {
    id?: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
  };
}

export interface FetchThumbnailImageBytesDeps {
  graphGet: GraphGet;
  fetchVideoThumbnail?: (args: FetchThumbnailUrlArgs) => Promise<string | null>;
  fetchImage?: typeof fetch;
}

/**
 * Bytes for one ad card.
 *   video_id → the video-thumb cache (the only `/{video_id}/thumbnails` caller)
 *   else image_url
 *   else thumbnail_url rendered at 600px
 *   else the default 64px thumbnail_url
 */
export async function fetchThumbnailImageBytes(
  adId: string,
  fbToken: string,
  admin: VideoThumbnailCacheClient,
  deps: FetchThumbnailImageBytesDeps,
): Promise<{ buffer: Buffer; contentType: string }> {
  const row = (await deps.graphGet(
    `/${adId}`,
    { fields: "creative{id,thumbnail_url,image_url,video_id}" },
    fbToken,
  )) as CreativeFields;
  const creative = row.creative;
  const fetchVideo = deps.fetchVideoThumbnail ?? fetchThumbnailUrl;
  let url: string | null = null;

  if (creative?.video_id?.trim()) {
    try {
      url = await fetchVideo({
        videoId: creative.video_id,
        token: fbToken,
        admin,
      });
    } catch {
      url = null;
    }
  }

  if (!url && creative?.image_url?.trim()) {
    url = creative.image_url.trim();
  }

  if (!url && creative?.id?.trim()) {
    try {
      const sized = (await deps.graphGet(
        `/${creative.id.trim()}`,
        {
          fields: "thumbnail_url",
          thumbnail_width: CREATIVE_THUMBNAIL_EDGE,
          thumbnail_height: CREATIVE_THUMBNAIL_EDGE,
        },
        fbToken,
      )) as { thumbnail_url?: string };
      url = sized.thumbnail_url?.trim() || null;
    } catch {
      url = null;
    }
  }

  if (!url) url = creative?.thumbnail_url?.trim() || null;
  if (!url) throw new Error("No thumbnail URL on creative");

  const fetchImage = deps.fetchImage ?? fetch;
  const imgRes = await fetchImage(url, { cache: "no-store" });
  if (!imgRes.ok) {
    throw new Error(`Thumbnail fetch failed: HTTP ${imgRes.status}`);
  }
  const contentType =
    imgRes.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  return { buffer, contentType };
}
