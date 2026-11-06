/**
 * GET /api/cron/creative-lab-render-tick
 *
 * Every minute. Claims one queued Creative Lab caption render and burns
 * it. No Meta calls. Auth is the cron bearer.
 *
 * A cron_runs row is written only when the tick claimed a render, timed
 * one out, or failed. /admin/cron-health does not treat a missing minute
 * as a failure: it watches snapshot-table freshness and CRON_ALARMS, and
 * this cron is in neither. A quiet minute is not a heartbeat.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { loadArchivedClientScope } from "@/lib/db/client-status";
import { isRemotionEnabled } from "@/lib/creatives/types";
import { runRenderTick } from "@/lib/creative-lab/render-queue";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  try {
    const scope = await loadArchivedClientScope(supabase);
    const result = await runRenderTick(supabase, { archivedEventIds: scope.eventIds, remotionEnabled: isRemotionEnabled() });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[creative-lab-render-tick] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "creative-lab-render-tick",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (body) => Number(body.claimed ?? 0),
    detail: (body) => ({ timedOut: body.timedOut ?? 0, busy: body.busy ?? false, skippedArchived: body.skippedArchived ?? 0 }),
    recordWhen: (body, status) => {
      if (status >= 400 || body.ok === false) return true;
      return Number(body.claimed ?? 0) > 0 || Number(body.timedOut ?? 0) > 0;
    },
  },
  handleGET,
);
