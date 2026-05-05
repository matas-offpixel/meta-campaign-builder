const TTL_MS = 5 * 60 * 1000;

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
