import { type NextRequest, NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { runMatchAttribution } from "@/lib/cron/match-attribution";

/**
 * app/api/internal/match-attribution/route.ts
 *
 * Cron transport for the dark-build matching pass. Vercel calls
 * this every 6h on the `30 *_/6 * * *` schedule (offset from rollup-
 * sync at the top of the hour). Manual triggers go through the same
 * route with a `Bearer ${CRON_SECRET}` Authorization header.
 *
 * Runtime: nodejs (Supabase service-role client + node:crypto for
 * future signature work). `force-dynamic` so Vercel doesn't try to
 * cache the response.
 *
 * Auth: cron-secret-only. Mirrors `refresh-active-creatives` —
 * there's no per-user surface to fall back on; the route only
 * makes sense as a system-cron call.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "service-role client unavailable",
      },
      { status: 500 },
    );
  }

  try {
    const result = await runMatchAttribution(admin);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "match attribution failed";
    console.error("[api/internal/match-attribution]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/** Vercel crons issue GET; explicit POST kept for ad-hoc retriggers. */
export async function POST(req: NextRequest) {
  return GET(req);
}
