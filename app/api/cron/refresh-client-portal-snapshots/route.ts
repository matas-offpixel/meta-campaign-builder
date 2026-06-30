import { NextResponse, type NextRequest } from "next/server";

import { refreshAllClientPortalSnapshots } from "@/lib/reporting/client-portal-snapshot-runner";

/**
 * GET /api/cron/refresh-client-portal-snapshots
 *
 * Vercel Cron entry point. Walks every active client and pre-populates
 * `client_portal_snapshots` (migration 123) so the internal dashboard read
 * path (`/clients/[id]`, `/clients/[id]/dashboard`, the Today pacing alerts)
 * serves a warm snapshot from Postgres in <1s instead of re-running the
 * ~3-5s `loadClientPortalByClientId` waterfall on every cold load.
 *
 * Cadence: every 15 minutes (see `vercel.json`) — a 15-minute freshness
 * window matched by `readClientPortalSnapshot`'s default `maxAgeMs`.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`. Identical helper
 * to `refresh-active-creatives` / `rollup-sync-events` so the bearer-vs-raw
 * tolerance stays consistent across crons. The route lives under the
 * `/api/cron/` PUBLIC_PREFIXES carve-out (the proxy's default-deny would
 * otherwise 302 the scheduled invocation to /login before this check runs);
 * the prefix only stops the session check — this handler still enforces its
 * own bearer auth and 401s on mismatch.
 *
 * Service-role posture: no user session. The runner enumerates clients and
 * writes snapshots via the service-role client, processing clients
 * SEQUENTIALLY to stay within the Nano Supabase memory budget.
 */

export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof refreshAllClientPortalSnapshots>>;
  try {
    result = await refreshAllClientPortalSnapshots();
  } catch (err) {
    console.error(
      `[cron refresh-client-portal-snapshots] runner threw: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return NextResponse.json(
      {
        ok: 0,
        failed: [],
        duration_ms: Date.now() - startedAt,
        error: err instanceof Error ? err.message : "Runner failed",
      },
      { status: 500 },
    );
  }

  const durationMs = Date.now() - startedAt;
  console.error(
    `[cron refresh-client-portal-snapshots] done ok=${result.ok} failed=${result.failed.length} duration_ms=${durationMs}`,
  );

  return NextResponse.json(
    { ok: result.ok, failed: result.failed, duration_ms: durationMs },
    { status: result.failed.length === 0 ? 200 : 207 },
  );
}
