/**
 * GET /api/community-aliases/:slug
 *
 * Shared-bearer read for cirqlin. Cirqlin is a different Supabase project
 * and cannot query wa_community_aliases. Bearer is
 * CIRQLIN_TO_DASHBOARD_BEARER, minted by Matas and set in both Vercel
 * projects. Same handling as CIRQLIN_PARTNER_READ_SECRET: this repo does
 * not generate or store the value.
 *
 * Internal failure → 200 with invite_code null (degraded), so cirqlin
 * passes the raw code through instead of failing the fan. No alias → 404.
 * Those two are distinguishable. Both still fail open for the fan, so a
 * repoint window where this endpoint is down sends fans to the previous
 * group. That is an accepted risk; the runbook names it.
 */
import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAliasLookupBySlug } from "@/lib/db/wa-community-aliases";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  aliasCacheTag,
  aliasReadCacheKey,
  ALIAS_READ_CACHE_TTL_SECONDS,
  getAliasRuntimeCache,
} from "@/lib/wa-communities/alias-cache";
import { communityAliasReadResponse } from "@/lib/wa-communities/community-alias-read";
import {
  checkCommunityAliasRateLimit,
  communityAliasRateKey,
} from "@/lib/wa-communities/read-rate-limit";

export const dynamic = "force-dynamic";

function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret || !header?.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(header.indexOf(" ") + 1).trim();
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type CachedRead = {
  destination_invite_code: string | null;
  interstitial_enabled: boolean;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const secret = (process.env.CIRQLIN_TO_DASHBOARD_BEARER ?? "").trim();
  const configured = secret.length > 0;
  const authorized = configured && bearerMatches(req.headers.get("authorization"), secret);

  const rate = checkCommunityAliasRateLimit(
    communityAliasRateKey(req.headers.get("x-forwarded-for")),
  );

  if (!rate.allowed || !configured || !authorized) {
    const mapped = communityAliasReadResponse({
      slug,
      configured,
      authorized,
      rateLimited: !rate.allowed,
      lookupError: null,
      destinationInviteCode: null,
      interstitialEnabled: false,
    });
    const headers = new Headers();
    if (mapped.cacheControl) headers.set("Cache-Control", mapped.cacheControl);
    if (!rate.allowed) {
      headers.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    }
    return NextResponse.json(mapped.body, { status: mapped.status, headers });
  }

  let destinationInviteCode: string | null = null;
  let interstitialEnabled = false;
  let lookupError: unknown | null = null;
  let fromCache = false;

  try {
    const cache = await getAliasRuntimeCache();
    const cached = (await cache.get(aliasReadCacheKey(slug))) as CachedRead | null;
    if (
      cached &&
      typeof cached === "object" &&
      "destination_invite_code" in cached &&
      "interstitial_enabled" in cached
    ) {
      destinationInviteCode = cached.destination_invite_code;
      interstitialEnabled = cached.interstitial_enabled === true;
      fromCache = true;
    }
  } catch (err) {
    console.warn(
      "[community-aliases] cache read failed; reading database",
      err instanceof Error ? err.message : err,
    );
  }

  if (!fromCache) {
    try {
      const service = createServiceRoleClient();
      const row = await getAliasLookupBySlug(service, slug);
      destinationInviteCode = row?.destination_invite_code ?? null;
      interstitialEnabled = row?.interstitial_enabled === true;
      try {
        const cache = await getAliasRuntimeCache();
        await cache.set(
          aliasReadCacheKey(slug),
          {
            destination_invite_code: destinationInviteCode,
            interstitial_enabled: interstitialEnabled,
          } satisfies CachedRead,
          { ttl: ALIAS_READ_CACHE_TTL_SECONDS, tags: [aliasCacheTag(slug)] },
        );
      } catch (err) {
        console.warn(
          "[community-aliases] cache write failed",
          err instanceof Error ? err.message : err,
        );
      }
    } catch (err) {
      lookupError = err;
      console.warn(
        "[community-aliases] lookup failed; returning degraded 200",
        err instanceof Error ? err.message : err,
      );
    }
  }

  const mapped = communityAliasReadResponse({
    slug,
    configured,
    authorized,
    rateLimited: false,
    lookupError,
    destinationInviteCode,
    interstitialEnabled,
  });
  const headers = new Headers();
  if (mapped.cacheControl) headers.set("Cache-Control", mapped.cacheControl);
  return NextResponse.json(mapped.body, { status: mapped.status, headers });
}
