/**
 * Response mapping for GET /api/community-aliases/:slug.
 *
 * Cirqlin has no access to the dashboard database. This is the shared-bearer
 * read. An internal failure returns 200 with invite_code null so cirqlin
 * passes the raw code through instead of 5xx-ing a fan. That makes "no
 * alias" (404) and "dashboard broken" (200, degraded) distinguishable in
 * the payload, while both still fail open for the fan.
 *
 * CIRQLIN_TO_DASHBOARD_BEARER unset refuses every request. The value is
 * never logged and never copied into the response.
 */

import { timingSafeEqual } from "node:crypto";

import { whatsappCommunityRedirectUrl } from "./resolve.ts";

export type CommunityAliasReadBody = {
  slug: string;
  invite_code: string | null;
  effective_destination: string | null;
  /** Cirqlin renders the card only when this is true. Absent or false → 302. */
  interstitial_enabled: boolean;
  degraded?: boolean;
  reason?: "lookup_failed";
};

/**
 * True when Authorization is `Bearer <secret>` and the token matches.
 * Lengths are compared first because timingSafeEqual throws when they differ.
 * An empty secret never matches.
 */
export function communityAliasBearerMatches(header: string | null, secret: string): boolean {
  if (!secret || !header?.toLowerCase().startsWith("bearer ")) return false;
  const token = header.slice(header.indexOf(" ") + 1).trim();
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type CommunityAliasHttpResult = {
  status: number;
  body: CommunityAliasReadBody | { error: string };
  cacheControl: string | null;
};

export function communityAliasReadResponse(args: {
  slug: string;
  configured: boolean;
  authorized: boolean;
  rateLimited: boolean;
  lookupError: unknown | null;
  destinationInviteCode: string | null;
  interstitialEnabled: boolean;
}): CommunityAliasHttpResult {
  if (args.rateLimited) {
    return {
      status: 429,
      body: { error: "Too many requests." },
      cacheControl: "private, no-store",
    };
  }

  if (!args.configured) {
    return {
      status: 401,
      body: { error: "Unauthorized." },
      cacheControl: "private, no-store",
    };
  }

  if (!args.authorized) {
    return {
      status: 401,
      body: { error: "Unauthorized." },
      cacheControl: "private, no-store",
    };
  }

  if (args.lookupError) {
    return {
      status: 200,
      body: {
        slug: args.slug,
        invite_code: null,
        effective_destination: null,
        interstitial_enabled: false,
        degraded: true,
        reason: "lookup_failed",
      },
      cacheControl: "private, no-store",
    };
  }

  if (!args.destinationInviteCode) {
    return {
      status: 404,
      body: { error: "Not found." },
      cacheControl: "private, max-age=60",
    };
  }

  return {
    status: 200,
    body: {
      slug: args.slug,
      invite_code: args.destinationInviteCode,
      effective_destination: whatsappCommunityRedirectUrl(args.destinationInviteCode),
      interstitial_enabled: args.interstitialEnabled,
    },
    cacheControl: "private, max-age=60",
  };
}
