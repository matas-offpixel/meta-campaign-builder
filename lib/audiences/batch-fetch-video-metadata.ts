/**
 * Hydrate video metadata via Meta's batched `GET /?ids=...` endpoint.
 * Cuts N video-metadata round-trips down to ceil(N / VIDEO_BATCH_SIZE) calls.
 * Falls back gracefully on per-batch errors so one bad video ID does not kill
 * the whole request — the parent caller receives undefined for those IDs.
 *
 * Accepts an injected `fetcher` so the function can be unit-tested without
 * importing lib/meta/client.ts (which uses TS parameter properties incompatible
 * with Node's --experimental-strip-types test runner).
 */

export const VIDEO_BATCH_SIZE = 25;

export interface RawVideoMetadata {
  id: string;
  title?: string;
  picture?: string;
  length?: number;
  from?: { id?: string; name?: string };
}

export type VideoMetadataFetcher = (
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<Record<string, RawVideoMetadata>>;

export async function batchFetchVideoMetadata(
  videoIds: readonly string[],
  token: string,
  fetcher: VideoMetadataFetcher,
): Promise<Map<string, RawVideoMetadata>> {
  const result = new Map<string, RawVideoMetadata>();
  for (let i = 0; i < videoIds.length; i += VIDEO_BATCH_SIZE) {
    const chunk = videoIds.slice(i, i + VIDEO_BATCH_SIZE);
    try {
      const response = await fetcher(
        "",
        { ids: chunk.join(","), fields: "id,picture,title,length,from" },
        token,
      );
      for (const [vid, video] of Object.entries(response)) {
        result.set(vid, video);
      }
    } catch (err) {
      console.warn("[batchFetchVideoMetadata] batch failed", {
        batchSize: chunk.length,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
