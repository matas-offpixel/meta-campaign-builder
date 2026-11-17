/**
 * GET /api/cron/creative-lab-drive-pickup
 *
 * Every 15 minutes. Drive → app (lib/drive/pickup.ts, HS14): the Shared
 * Drive's changes feed from the stored page token; new clips in Artist
 * clips/{artist} go through the existing folder import, new files in 01 Open
 * files and _Brand kit are queued for the kit audit. Its own cron rather
 * than a step in creative-lab-drive-tick: it downloads clips, and it keeps
 * HS14's 15-minute cadence. No Meta calls. Auth is the cron bearer.
 *
 * After the pickup it checks the drops (VW1, lib/creative-lab/clip-drops-run.ts)
 * of up to six clips imported in the last 48 h without them: the Instagram
 * add and the upload routes don't carry ffmpeg.
 *
 * Unset GOOGLE_DRIVE_EXPORT_DRIVE_ID → 200 with skippedReason. A cron_runs
 * row only when something came in or failed.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { driveFromEnv } from "@/lib/drive/client";
import { sweepClipDrops } from "@/lib/creative-lab/clip-drops-run";
import { pickupShouldRecord, runDrivePickup, type PickupResult } from "@/lib/drive/pickup";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
/** Clips whose drops the run checks after the pickup (VW1). Each decodes one clip's sound. */
const DROPS_SWEEP_LIMIT = 6;
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
    const result = await runDrivePickup(supabase, drive);
    // VW1: this route carries ffmpeg, so it checks the drops of clips imported where ffmpeg isn't.
    const drops = await sweepClipDrops(supabase, { limit: DROPS_SWEEP_LIMIT }).catch((err: unknown) => ({ error: err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "").slice(0, 160) : "sweep failed" }));
    return NextResponse.json({ ...result, drops });
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "").trim() : "Unknown error";
    console.error(`[creative-lab-drive-pickup] ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "creative-lab-drive-pickup",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (body) => (Array.isArray(body.clips) ? body.clips.filter((clip: { outcome?: string }) => clip.outcome === "imported").length : 0),
    detail: (body) => ({
      pages: body.pages ?? 0,
      changes: body.changes ?? 0,
      kitFiles: body.kitFiles ?? 0,
      misses: body.misses ?? [],
      skipped: body.skipped ?? {},
      errors: body.errors ?? [],
      // A file the import failed on, including one skipped after killing PICKUP_MAX_ATTEMPTS runs.
      failed: Array.isArray(body.clips)
        ? body.clips
          .filter((clip: { outcome?: string }) => clip.outcome === "failed")
          .map((clip: { name?: string; eventId?: string; reason?: string | null }) => ({ name: clip.name, eventId: clip.eventId, reason: clip.reason }))
        : [],
    }),
    recordWhen: (body, status) => {
      if (status >= 400 || body.ok === false) return true;
      if (body.skippedReason) return false;
      return pickupShouldRecord(body as unknown as PickupResult);
    },
  },
  handleGET,
);
