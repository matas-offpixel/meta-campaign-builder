import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { isLearningRefreshEnabled, runLearningRefresh } from "@/lib/learning/runner";

/**
 * GET /api/cron/learning-refresh
 *
 * Learning loop B — nightly (03:30 UTC, `vercel.json`, after
 * ad-daily-insights) stored learnings: creative_scores, tag_performance,
 * client_funnel_benchmarks, interest_clusters.live_evidence. DB-only,
 * zero Meta calls. Logic lives in `lib/learning/runner.ts`.
 *
 * Killswitch: `ENABLE_LEARNING_REFRESH` must be exactly `"1"`. Unset
 * responds 200 with `skippedReason: "killswitch"`.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
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
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isLearningRefreshEnabled(process.env)) {
    return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" },
      { status: 500 },
    );
  }

  try {
    const result = await runLearningRefresh({ env: process.env, db: supabase });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[learning-refresh] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
