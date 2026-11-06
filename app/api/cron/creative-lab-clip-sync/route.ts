/**
 * GET /api/cron/creative-lab-clip-sync
 *
 * 03:45 UTC. Imports new clips from each approved artist's folder.
 * At most 10 new files per artist. No Meta calls. Auth is the cron bearer.
 *
 * A cron_runs row is written only when something was imported or failed.
 * A quiet night is not a heartbeat.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { clipSyncShouldRecord, runClipSync } from "@/lib/creative-lab/clip-sync";
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
    const result = await runClipSync(supabase);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "").trim() : "Unknown error";
    console.error(`[creative-lab-clip-sync] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "creative-lab-clip-sync",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (body) => Number(body.imported ?? 0),
    detail: (body) => ({ failed: body.failed ?? 0, skippedArchived: body.skippedArchived ?? 0, artists: body.artists ?? 0 }),
    recordWhen: (body, status) => {
      if (status >= 400 || body.ok === false) return true;
      return clipSyncShouldRecord({ imported: Number(body.imported ?? 0), failed: Number(body.failed ?? 0) });
    },
  },
  handleGET,
);
