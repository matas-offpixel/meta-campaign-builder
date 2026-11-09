/**
 * GET /api/cron/creative-lab-drive-tick
 *
 * Every 5 minutes. The Drive export (lib/drive/tick.ts): trees for new
 * clients and events, renames, the on-sale w/c folder, cancelled marks,
 * filing approved Lab renders, judged winners. All on the Shared Drive
 * GOOGLE_DRIVE_EXPORT_DRIVE_ID. No Meta calls. Auth is the cron bearer.
 *
 * Unset GOOGLE_DRIVE_EXPORT_DRIVE_ID → 200 with skippedReason, not a cron
 * failure. A cron_runs row is written only when the tick created, renamed,
 * filed or failed something: a quiet tick is not a heartbeat.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { driveFromEnv } from "@/lib/drive/client";
import { driveTickShouldRecord, runDriveTick, type DriveTickResult } from "@/lib/drive/tick";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { drive, reason } = driveFromEnv();
  if (!drive) return NextResponse.json({ ok: true, skippedReason: reason });
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  try {
    const result = await runDriveTick(supabase, drive, {
      download: async (bucket, path) => {
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error || !data) throw new Error(`storage download: ${error?.message ?? "no file"}`);
        return new Uint8Array(await data.arrayBuffer());
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "").trim() : "Unknown error";
    console.error(`[creative-lab-drive-tick] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "creative-lab-drive-tick",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (body) => (Array.isArray(body.filed) ? body.filed.length : 0),
    detail: (body) => ({
      created: Array.isArray(body.created) ? body.created.length : 0,
      renamed: Array.isArray(body.renamed) ? body.renamed.length : 0,
      winners: Array.isArray(body.winners) ? body.winners.length : 0,
      cycles: body.cycles ?? [],
      errors: body.errors ?? [],
    }),
    recordWhen: (body, status) => {
      if (status >= 400 || body.ok === false) return true;
      if (body.skippedReason) return false;
      return driveTickShouldRecord(body as unknown as DriveTickResult);
    },
  },
  handleGET,
);
