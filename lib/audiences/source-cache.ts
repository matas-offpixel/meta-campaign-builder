export const AUDIENCE_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;

const TTL_MS = AUDIENCE_SOURCE_CACHE_TTL_MS;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Returns whether a successful loader result should be stored in the audience
 * source cache. Errors are never cached (loaders throw). Empty arrays and empty
 * video payloads are not cached so transient failures are not replayed for 30m.
 */
export function audienceSourcePayloadIsCacheable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("videos" in o && Array.isArray(o.videos)) {
      return o.videos.length > 0;
    }
    return Object.keys(o).length > 0;
  }
  return true;
}

export async function getCachedAudienceSource<T>(
  keyParts: readonly string[],
  load: () => Promise<T>,
): Promise<T> {
  const key = keyParts.join(":");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await load();
  if (audienceSourcePayloadIsCacheable(value)) {
    cache.set(key, { value, expiresAt: now + TTL_MS });
  }
  return value;
}

export function clearAudienceSourceCache() {
  cache.clear();
}
