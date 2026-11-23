import { NextResponse, type NextRequest } from "next/server";

import { isLearningFindingsEnabled, learningFindingsRunLog, runLearningFindings, summariseFindings } from "@/lib/learning/findings/load-observed-tests";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/learning-findings
 *
 * RP1 (docs/design-record/2026-11-23-north-star-3.html): observed tests. Every
 * ad set in a show test campaign gets TF2's read with TF5's benchmark on TF9's
 * cadence, whether or not the app made it, written to learning_findings
 * (migration 264) as a test_verdict. lib/learning/findings/.
 *
 * vercel.json runs "15 4 * * *" (UTC): after the 02:30 UTC ad-daily-insights
 * restate and the 03:30 UTC learning-refresh. Its own cron, not a
 * learning-refresh job: that run takes ~185 s of its 300 s. DB-only, zero
 * Meta calls, never a Meta write. `?event=CODE` narrows it.
 *
 * Killswitch: ENABLE_LEARNING_FINDINGS must be exactly "1"; unset responds 200
 * with skippedReason "killswitch".
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 */

export const maxDuration = 120;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim() === expected.trim();
  return header.trim() === expected.trim();
}

async function handleGET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isLearningFindingsEnabled(process.env)) return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  const eventCodes = req.nextUrl.searchParams.getAll("event").map((code) => code.trim()).filter(Boolean);
  try {
    const result = await runLearningFindings({ env: process.env, db: supabase, eventCodes: eventCodes.length ? eventCodes : undefined });
    return NextResponse.json(summariseFindings(result), { status: result.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[learning-findings] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "learning-findings",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => learningFindingsRunLog(b).rows,
    considered: (b) => learningFindingsRunLog(b).considered,
    detail: (b) => learningFindingsRunLog(b).detail,
  },
  handleGET,
);
