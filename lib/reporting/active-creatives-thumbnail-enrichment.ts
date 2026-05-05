import type { ConceptGroupRow } from "./group-creatives";
import { withActPrefix } from "../meta/ad-account-id.ts";

type GraphGetter = (
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<unknown>;

interface ThumbnailPayload {
  kind: string;
  groups?: ConceptGroupRow[];
}

interface VideoThumbnailResponse {
  data?: Array<{
    uri?: string;
    width?: number;
    is_preferred?: boolean;
  }>;
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
  graphGet?: GraphGetter;
}

async function defaultGraphGet(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<unknown> {
  const { graphGetWithToken } = await import("../meta/client");
  return graphGetWithToken(path, params, token);
}

function pickVideoThumbnail(data: VideoThumbnailResponse["data"]): string | null {
  if (!data?.length) return null;
  const valid = data
    .map((row, index) => ({
      uri: row.uri?.trim() || null,
      width:
        typeof row.width === "number" && Number.isFinite(row.width)
          ? row.width
          : 0,
      isPreferred: row.is_preferred === true,
      index,
    }))
    .filter((row): row is {
      uri: string;
      width: number;
      isPreferred: boolean;
      index: number;
    } => Boolean(row.uri));
  if (valid.length === 0) return null;
  return (
    valid.find((row) => row.isPreferred) ??
    [...valid].sort((a, b) => b.width - a.width || a.index - b.index)[0]
  ).uri;
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
}): Promise<ConceptGroupRow> {
  const source = input.group.representative_thumbnail_source;
  const fallback = input.group.representative_thumbnail;
  let enriched: string | null = null;

  if (source.video_id) {
    const res = (await input.graphGet(
      `/${source.video_id}/thumbnails`,
      { fields: "uri,width,is_preferred" },
      input.token,
    )) as VideoThumbnailResponse;
    enriched = pickVideoThumbnail(res.data);
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
  const groups = await Promise.all(
    input.payload.groups.map(async (group) => {
      try {
        return await enrichGroupThumbnail({
          group,
          adAccountId: input.adAccountId,
          token: input.token,
          graphGet,
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
  pickVideoThumbnail,
  pickAdImageUrl,
};
