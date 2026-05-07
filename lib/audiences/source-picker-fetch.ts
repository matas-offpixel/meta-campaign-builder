const inflight = new Map<string, Promise<unknown>>();

export type AudienceSourceOk<T> = { ok: true; data: T };
export type AudienceSourceErr = {
  ok: false;
  error: string;
  rateLimited: boolean;
  retryAfterMinutes?: number;
};
export type AudienceSourceResult<T> = AudienceSourceOk<T> | AudienceSourceErr;

function parseErr(json: Record<string, unknown>): string {
  if (typeof json.error === "string") return json.error;
  if (typeof json.message === "string") return json.message;
  return "Failed to load source";
}

export async function fetchAudienceSourceList<T>(
  url: string,
  dataKey: string,
): Promise<AudienceSourceResult<T>> {
  const existing = inflight.get(url) as Promise<AudienceSourceResult<T>> | undefined;
  if (existing) return existing;

  const promise = (async (): Promise<AudienceSourceResult<T>> => {
    try {
      const res = await fetch(url);
      const json = (await res.json()) as Record<string, unknown>;
      if (res.status === 429 && json.error === "rate_limited") {
        return {
          ok: false,
          error:
            typeof json.message === "string"
              ? json.message
              : "Meta is rate-limiting this ad account. Try again in ~30 minutes.",
          rateLimited: true,
          retryAfterMinutes:
            typeof json.retryAfterMinutes === "number"
              ? json.retryAfterMinutes
              : 30,
        };
      }
      if (!res.ok) {
        return { ok: false, error: parseErr(json), rateLimited: false };
      }
      return { ok: true, data: json[dataKey] as T };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load source",
        rateLimited: false,
      };
    }
  })();

  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}

export interface CampaignVideosPayload {
  campaignName: string;
  videos: Array<{
    id: string;
    title?: string;
    thumbnailUrl?: string;
    length?: number;
  }>;
  /** FB page ID that owns the videos (resolved from ad creative page_id). */
  contextPageId?: string;
}

export async function fetchAudienceCampaignVideos(
  url: string,
): Promise<AudienceSourceResult<CampaignVideosPayload>> {
  const existing = inflight.get(url) as
    | Promise<AudienceSourceResult<CampaignVideosPayload>>
    | undefined;
  if (existing) return existing;

  const promise = (async (): Promise<
    AudienceSourceResult<CampaignVideosPayload>
  > => {
    try {
      const res = await fetch(url);
      const json = (await res.json()) as Record<string, unknown>;
      if (res.status === 429 && json.error === "rate_limited") {
        return {
          ok: false,
          error:
            typeof json.message === "string"
              ? json.message
              : "Meta is rate-limiting this ad account. Try again in ~30 minutes.",
          rateLimited: true,
          retryAfterMinutes:
            typeof json.retryAfterMinutes === "number"
              ? json.retryAfterMinutes
              : 30,
        };
      }
      if (!res.ok || json.ok !== true) {
        return {
          ok: false,
          error: parseErr(json),
          rateLimited: false,
        };
      }
      return {
        ok: true,
        data: {
          campaignName: String(json.campaignName ?? ""),
          videos: (json.videos ?? []) as CampaignVideosPayload["videos"],
          contextPageId: typeof json.contextPageId === "string" ? json.contextPageId : undefined,
        },
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load videos",
        rateLimited: false,
      };
    }
  })();

  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}
