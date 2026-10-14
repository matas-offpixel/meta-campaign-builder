import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notify/slack";
import { buildLiveNotifyDeps } from "@/lib/notify/slack-deps";
import { runCronAlarmEvaluator } from "@/lib/reporting/cron-alarm-evaluator";

/**
 * GET /api/cron/cron-alarm-evaluator
 *
 * The watcher. Reads `cron_runs`, decides which zeros are implausible, and
 * posts to Slack `ads_ops` once per condition per 24 h.
 *
 * Hourly (see `vercel.json`) — the shortest alarmed interval is
 * `budget-pacing-check` at 60 min, and an evaluator slower than the thing
 * it watches cannot notice a single miss.
 *
 * Always returns 200 when authorised: a raised alarm is the DATA, not a
 * request failure. Read `conditions` to see what fired.
 */

export const maxDuration = 60;
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

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const notifyDeps = buildLiveNotifyDeps(supabase);
  const result = await runCronAlarmEvaluator(supabase, {
    notify: (opts) => notify(opts, notifyDeps),
  });

  return NextResponse.json({
    ok: result.ok,
    cronsSeen: result.cronsSeen,
    conditions: result.conditions,
    alerted: result.alerted.map((a) => ({ dedupeKey: a.dedupeKey, sent: a.result.sent, reason: a.result.reason })),
    evidence: result.evidence,
  });
}
