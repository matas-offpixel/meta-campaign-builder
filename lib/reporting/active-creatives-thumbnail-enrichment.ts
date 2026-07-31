import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConceptGroupRow } from "./group-creatives";
import { withActPrefix } from "../meta/ad-account-id.ts";
import type { VideoThumbnailCacheClient } from "../meta/video-thumbnail-cache.ts";

type GraphGetter = (
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<unknown>;

type VideoThumbnailUrlFetcher = (videoId: string) => Promise<string | null>;

interface ThumbnailPayload {
  kind: string;
  groups?: ConceptGroupRow[];
}

interface AdImagesResponse {
  data?: Array<{
    permalink_url?: string;
    url?: string;
  }>;
}

export interface ThumbnailEnrichmentInput {
  payload: ThumbnailPayload;
  adAccountId: string;
  token: string;
  /** Service-role client for the `fetchThumbnailUrl` Storage cache. */
  admin: SupabaseClient | VideoThumbnailCacheClient;
  graphGet?: GraphGetter;
  /** Injectable for tests; defaults to the real `fetchThumbnailUrl` helper. */
  fetchThumbnailUrl?: VideoThumbnailUrlFetcher;
}

async function defaultGraphGet(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<unknown> {
  const { graphGetWithToken } = await import("../meta/client");
  return graphGetWithToken(path, params, token);
}

function defaultFetchThumbnailUrlFactory(
  admin: SupabaseClient | VideoThumbnailCacheClient,
  token: string,
): VideoThumbnailUrlFetcher {
  return async (videoId) => {
    const { fetchThumbnailUrl } = await import("../meta/video-thumbnail-cache.ts");
    return fetchThumbnailUrl({ videoId, token, admin });
  };
}

function pickAdImageUrl(data: AdImagesResponse["data"]): string | null {
  if (!data?.length) return null;
  for (const row of data) {
    const url = row.permalink_url?.trim() || row.url?.trim() || null;
    if (url) return url;
  }
  return null;
}

async function enrichGroupThumbnail(input: {
  group: ConceptGroupRow;
  adAccountId: string;
  token: string;
  graphGet: GraphGetter;
  fetchThumbnailUrl: VideoThumbnailUrlFetcher;
}): Promise<ConceptGroupRow> {
  const source = input.group.representative_thumbnail_source;
  const fallback = input.group.representative_thumbnail;
  let enriched: string | null = null;

  if (source.video_id) {
    enriched = await input.fetchThumbnailUrl(source.video_id);
  } else if (source.image_hash) {
    const res = (await input.graphGet(
      `/${withActPrefix(input.adAccountId)}/adimages`,
      {
        hashes: JSON.stringify([source.image_hash]),
        fields: "permalink_url,url",
      },
      input.token,
    )) as AdImagesResponse;
    enriched = pickAdImageUrl(res.data);
  }

  const thumbnail = enriched ?? fallback;
  if (thumbnail === fallback) return input.group;
  return {
    ...input.group,
    representative_thumbnail: thumbnail,
  };
}

export async function enrichActiveCreativesSnapshotThumbnails<T extends ThumbnailPayload>(
  input: ThumbnailEnrichmentInput & { payload: T },
): Promise<T> {
  if (input.payload.kind !== "ok" || !input.payload.groups?.length) {
    return input.payload;
  }

  const graphGet = input.graphGet ?? defaultGraphGet;
  const fetchThumbnailUrl =
    input.fetchThumbnailUrl ??
    defaultFetchThumbnailUrlFactory(input.admin, input.token);
  const groups = await Promise.all(
    input.payload.groups.map(async (group) => {
      try {
        return await enrichGroupThumbnail({
          group,
          adAccountId: input.adAccountId,
          token: input.token,
          graphGet,
          fetchThumbnailUrl,
        });
      } catch (err) {
        console.warn(
          `[active-creatives-thumbnail-enrichment] group=${group.group_key} ad=${group.representative_thumbnail_ad_id ?? "n/a"} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return group;
      }
    }),
  );

  return {
    ...input.payload,
    groups,
  };
}

export const __activeCreativesThumbnailEnrichmentTest = {
  pickAdImageUrl,
};
