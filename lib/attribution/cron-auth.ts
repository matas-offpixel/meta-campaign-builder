import "server-only";

import type { NextRequest } from "next/server";

/**
 * Shared CRON_SECRET-bearer auth check for the attribution cron +
 * admin routes. Mirrors the helper in
 * `app/api/internal/refresh-active-creatives/route.ts` exactly so a
 * single env var auths every cron / admin route this PR adds.
 *
 * Returns `false` when:
 *   - `CRON_SECRET` is unset (defence-in-depth: refuse if the env
 *     var slipped out of the deploy)
 *   - the `Authorization` header is missing or doesn't match
 *
 * Trim-tolerant on both sides so a trailing newline in the env var
 * (a very real prod foot-gun) doesn't lock the cron out.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}
