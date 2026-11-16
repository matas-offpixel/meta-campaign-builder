/**
 * Runtime cache for /j/{segment} alias lookups.
 *
 * Vercel Runtime Cache (`getCache` from @vercel/functions). KV was withdrawn
 * and Edge Config is not provisioned. Keys are `alias:${segment}`, tagged
 * `alias:${segment}` so a repoint can expireTag that slug.
 *
 * Positive TTL 3600s. Negative TTL 300s — minting an alias for a code that
 * was passing through takes up to 5 minutes when the purge does not land.
 *
 * A cache read or write failure is a miss: the database is still consulted.
 * A database failure is not caught here; lookupAliasFailOpen turns it into
 * passthrough.
 */

import type { AliasLookupRow } from "./resolve.ts";

export const ALIAS_CACHE_POSITIVE_TTL_SECONDS = 3600;
export const ALIAS_CACHE_NEGATIVE_TTL_SECONDS = 300;
export const ALIAS_READ_CACHE_TTL_SECONDS = 60;

export function aliasCacheKey(segment: string): string {
  return `alias:${segment}`;
}

export function aliasCacheTag(segment: string): string {
  return `alias:${segment}`;
}

export function aliasReadCacheKey(slug: string): string {
  return `alias-read:${slug}`;
}

type CacheEntry =
  | { v: 1; found: true; destination_invite_code: string }
  | { v: 1; found: false };

export interface AliasCache {
  get(key: string): Promise<unknown | null>;
  set(
    key: string,
    value: unknown,
    options?: { ttl?: number; tags?: string[] },
  ): Promise<void>;
  expireTag(tag: string | string[]): Promise<void>;
  delete(key: string): Promise<void>;
}

let testCache: AliasCache | null = null;

/** Tests inject a memory cache. Production uses getCache(). */
export function setAliasCacheForTests(cache: AliasCache | null): void {
  testCache = cache;
}

export async function getAliasRuntimeCache(): Promise<AliasCache> {
  if (testCache) return testCache;
  const { getCache } = await import("@vercel/functions");
  return getCache({ namespace: "wa-community-alias" });
}

function readEntry(value: unknown): CacheEntry | null {
  if (value == null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1) return null;
  if (row.found === false) return { v: 1, found: false };
  if (row.found === true && typeof row.destination_invite_code === "string") {
    return {
      v: 1,
      found: true,
      destination_invite_code: row.destination_invite_code,
    };
  }
  return null;
}

/**
 * Cache then database. Cache errors degrade to a live read. Database errors
 * propagate so the fail-open wrapper can passthrough.
 */
export async function cacheOrLookup(
  segment: string,
  lookup: (segment: string) => Promise<AliasLookupRow | null>,
): Promise<AliasLookupRow | null> {
  const key = aliasCacheKey(segment);
  const tag = aliasCacheTag(segment);

  try {
    const cached = readEntry(await (await getAliasRuntimeCache()).get(key));
    if (cached?.found === true) {
      return { destination_invite_code: cached.destination_invite_code };
    }
    if (cached?.found === false) return null;
  } catch (err) {
    console.warn(
      "[wa-community-alias] cache read failed; reading database",
      err instanceof Error ? err.message : err,
    );
  }

  const row = await lookup(segment);

  try {
    const cache = await getAliasRuntimeCache();
    const code = row?.destination_invite_code ?? null;
    if (code) {
      const entry: CacheEntry = {
        v: 1,
        found: true,
        destination_invite_code: code,
      };
      await cache.set(key, entry, {
        ttl: ALIAS_CACHE_POSITIVE_TTL_SECONDS,
        tags: [tag],
      });
    } else {
      const entry: CacheEntry = { v: 1, found: false };
      await cache.set(key, entry, {
        ttl: ALIAS_CACHE_NEGATIVE_TTL_SECONDS,
        tags: [tag],
      });
    }
  } catch (err) {
    console.warn(
      "[wa-community-alias] cache write failed",
      err instanceof Error ? err.message : err,
    );
  }

  return row;
}

export type CachePurgeResult = "purged" | "failed";

/**
 * Expire the slug's tag, then delete the public and read-API keys.
 *
 * If this fails after the repoint transaction has committed, the row is
 * already the new code and this region can serve the old destination until
 * the positive TTL (3600s). The caller retries once. A second failure is
 * accepted: the operator response says the cache is stale, and the runbook
 * says to verify with curl -I. The database write is not rolled back.
 */
export async function purgeAliasCache(slug: string): Promise<CachePurgeResult> {
  const once = async (): Promise<void> => {
    const cache = await getAliasRuntimeCache();
    await cache.expireTag(aliasCacheTag(slug));
    await cache.delete(aliasCacheKey(slug));
    await cache.delete(aliasReadCacheKey(slug));
  };

  try {
    await once();
    return "purged";
  } catch (first) {
    console.warn(
      "[wa-community-alias] cache purge failed; retrying",
      first instanceof Error ? first.message : first,
    );
    try {
      await once();
      return "purged";
    } catch (second) {
      console.error(
        "[wa-community-alias] cache purge failed after retry; stale for up to 3600s",
        second instanceof Error ? second.message : second,
      );
      return "failed";
    }
  }
}
