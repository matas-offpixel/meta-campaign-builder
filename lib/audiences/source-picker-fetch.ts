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
      // Defensive JSON parse — see fetchAudienceCampaignVideos for rationale.
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        const looksLikeTimeout =
          res.status === 504 ||
          text.toLowerCase().includes("timeout") ||
          text.toLowerCase().includes("an error occurred");
        return {
          ok: false,
          error: looksLikeTimeout
            ? `Source fetch timed out (HTTP ${res.status}). Try again — Meta may be rate-limiting this ad account.`
            : `Server returned non-JSON response (HTTP ${res.status})`,
          rateLimited: res.status === 429,
        };
      }
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
  /** Number of videos dropped because they have no FB Page association. */
  skippedCount?: number;
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
      // Read body as text first — Vercel/CDN can return plain-text error pages
      // (504 timeouts, 502 bad gateways, "An error occurred...") that JSON.parse
      // chokes on. Without this guard the user sees raw JSON parse errors.
      const text = await res.text();
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Body wasn't JSON — likely a Vercel error page or upstream timeout.
        const looksLikeTimeout =
          res.status === 504 ||
          text.toLowerCase().includes("timeout") ||
          text.toLowerCase().includes("an error occurred");
        return {
          ok: false,
          error: looksLikeTimeout
            ? `Campaign video fetch timed out (HTTP ${res.status}). High-spend campaigns with 100+ ads can exceed Vercel's function timeout. Try a smaller campaign selection or wait for Meta's rate limit to recover.`
            : `Server returned non-JSON response (HTTP ${res.status})`,
          rateLimited: res.status === 429,
        };
      }
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
          skippedCount: typeof json.skippedCount === "number" ? json.skippedCount : 0,
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
