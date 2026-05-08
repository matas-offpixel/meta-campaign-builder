import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

import { audienceSourcePayloadIsCacheable } from "./source-cache";

/**
 * DB-backed counterpart to the per-worker `Map` cache in
 * `./source-cache.ts`. The Map dies on every Vercel cold start;
 * this helper persists payloads in `audience_source_cache`
 * (migration 087) so the second user / second cold-start hits cache,
 * killing the 20–40s Audience Builder video-views fetch latency on
 * J2-scale campaigns.
 *
 * Cache contract:
 *   - HIT when `expires_at > now()` AND `build_version === current
 *     VERCEL_GIT_COMMIT_SHA`. Mismatched / NULL build_version is
 *     treated as stale (mirrors `active_creatives_snapshots`,
 *     mig 067).
 *   - MISS → call `load()`, persist payload + `expires_at = now() +
 *     ttlMs`, stamp build_version, return payload. Empty payloads
 *     (per `audienceSourcePayloadIsCacheable`) are NOT persisted —
 *     transient failures shouldn't be replayed for 30m.
 *
 * Reads + writes BOTH go through the service-role client. Reads bypass
 * RLS so a fresh cold-start instance can see writes by other users
 * (cache is shared across users targeting the same client). The DB
 * uniqueness constraint scopes writes per-user so no two users
 * overwrite each other's payloads.
 */

type AudienceSourceKind =
  | "campaigns"
  | "campaign-videos"
  | "multi-campaign-videos"
  | "pages"
  | "pixels";

interface CacheArgs<T> {
  userId: string;
  clientId: string;
  sourceKind: AudienceSourceKind;
  cacheKey: string;
  ttlMs: number;
  load: () => Promise<T>;
}

interface CacheRow {
  payload: unknown;
  expires_at: string;
  build_version: string | null;
}

const BUILD_VERSION = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

function buildVersionMatches(rowBuildVersion: string | null): boolean {
  if (!BUILD_VERSION) {
    // No build version available locally (eg. dev) — fall back to
    // accepting any non-NULL row. Mismatch path only fires in
    // production where VERCEL_GIT_COMMIT_SHA is always populated.
    return rowBuildVersion !== null;
  }
  return rowBuildVersion === BUILD_VERSION;
}

export async function getCachedAudienceSourceDb<T>(
  args: CacheArgs<T>,
): Promise<T> {
  const admin = createServiceRoleClient();

  const { data, error } = await admin
    .from("audience_source_cache")
    .select("payload, expires_at, build_version")
    .eq("user_id", args.userId)
    .eq("client_id", args.clientId)
    .eq("source_kind", args.sourceKind)
    .eq("cache_key", args.cacheKey)
    .maybeSingle();

  if (error) {
    // Soft-fail: log + fall through to live fetch. A broken cache
    // can't take down the Audience Builder.
    console.warn("[audience-source-cache-db] read failed", {
      sourceKind: args.sourceKind,
      cacheKey: args.cacheKey,
      message: error.message,
    });
  }

  const row = data as CacheRow | null;
  if (
    row &&
    new Date(row.expires_at).getTime() > Date.now() &&
    buildVersionMatches(row.build_version)
  ) {
    return row.payload as T;
  }

  const value = await args.load();

  if (audienceSourcePayloadIsCacheable(value)) {
    const expiresAt = new Date(Date.now() + args.ttlMs).toISOString();
    const { error: writeError } = await admin
      .from("audience_source_cache")
      .upsert(
        {
          user_id: args.userId,
          client_id: args.clientId,
          source_kind: args.sourceKind,
          cache_key: args.cacheKey,
          payload: value as unknown,
          fetched_at: new Date().toISOString(),
          expires_at: expiresAt,
          build_version: BUILD_VERSION,
        },
        { onConflict: "user_id,client_id,source_kind,cache_key" },
      );
    if (writeError) {
      console.warn("[audience-source-cache-db] write failed", {
        sourceKind: args.sourceKind,
        cacheKey: args.cacheKey,
        message: writeError.message,
      });
    }
  }

  return value;
}
