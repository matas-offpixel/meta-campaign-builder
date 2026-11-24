import { NextResponse, type NextRequest } from "next/server";

import { runLearningDigest } from "@/lib/learning/findings/digest";
import { notify } from "@/lib/notify/slack";
import { buildLiveNotifyDeps } from "@/lib/notify/slack-deps";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/learning-digest
 *
 * E8: the Monday digest of learning_findings (lib/learning/findings/digest.ts)
 * to ads_ops through notify(). vercel.json runs "0 10 * * 1" (UTC): 10:00
 * London in winter, 11:00 in summer, inside notify()'s business hours.
 * Deduped per ISO week (learning_digest:{iso_week}). DB-only.
 *
 * Off by default. ENABLE_LEARNING_DIGEST must be exactly "1" (else 200 with
 * skippedReason "killswitch"); notify() also needs ENABLE_SLACK_NOTIFICATIONS
 * and SLACK_WEBHOOK_ADS_OPS. `?dry=1` builds the text and returns it without
 * calling notify().
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 */

export const maxDuration = 60;
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
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  try {
    const deps = buildLiveNotifyDeps(supabase);
    const result = await runLearningDigest({
      env: process.env,
      db: supabase,
      dryRun: req.nextUrl.searchParams.get("dry") === "1",
      notify: (opts) => notify(opts, deps),
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[learning-digest] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "learning-digest",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => (b.sent === true ? 1 : 0),
    detail: (b) => ({ digestDay: b.digestDay ?? null, dedupeKey: b.dedupeKey ?? null, sent: b.sent ?? null, reason: b.reason ?? null, counts: b.counts ?? null, dryRun: b.dryRun ?? null, skippedReason: b.skippedReason ?? null }),
  },
  handleGET,
);
