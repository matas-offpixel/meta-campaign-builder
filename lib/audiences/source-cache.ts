/** Read-heavy audience source lists — pickers tolerate staleness; longer TTL reduces Graph fan-out. */
export const AUDIENCE_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;

const TTL_MS = AUDIENCE_SOURCE_CACHE_TTL_MS;

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();

export async function getCachedAudienceSource<T>(
  keyParts: readonly string[],
  load: () => Promise<T>,
): Promise<T> {
  const key = keyParts.join(":");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const value = await load();
  cache.set(key, { value, expiresAt: now + TTL_MS });
  return value;
}

export function clearAudienceSourceCache() {
  cache.clear();
}
