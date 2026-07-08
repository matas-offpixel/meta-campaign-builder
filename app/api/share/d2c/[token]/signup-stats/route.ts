import { NextResponse, type NextRequest } from "next/server";

import {
  buildLandingRateLimitKey,
  checkLandingPageRateLimit,
} from "@/lib/landing-pages/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveActiveShareByToken } from "@/lib/db/d2c-shares";
import { isValidD2CShareToken } from "@/lib/d2c/share-token";
import { getEventSignupStats } from "@/lib/d2c/stats";

/**
 * GET /api/share/d2c/{token}/signup-stats
 *
 * Public (token-gated) signup-count poll target for the share view (Goal 8).
 * The token is the credential — resolved via service-role, no session. Rate-
 * limited (reuses the landing-page limiter) since it's a public URL.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const key = buildLandingRateLimitKey(req.headers.get("x-forwarded-for"));
  const decision = checkLandingPageRateLimit(`d2c-share-stats:${key}`);
  if (!decision.allowed) {
    return NextResponse.json({ ok: false, error: "Too many requests" }, { status: 429 });
  }

  if (!isValidD2CShareToken(token)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const share = await resolveActiveShareByToken(admin, token);
  if (!share) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  try {
    const stats = await getEventSignupStats(admin, share.event_id);
    return NextResponse.json({ ok: true, stats });
  } catch {
    return NextResponse.json({ ok: false, error: "Stats unavailable" }, { status: 502 });
  }
}
