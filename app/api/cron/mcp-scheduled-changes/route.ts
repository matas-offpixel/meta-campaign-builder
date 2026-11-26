import { NextResponse, type NextRequest } from "next/server";

import { isMcpEnabled } from "@/lib/mcp/config";
import { runScheduledChanges } from "@/lib/mcp/live/scheduled";
import { realLiveDeps } from "@/lib/mcp/meta-deps";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/mcp-scheduled-changes
 *
 * The Off/Pixel connector's scheduled budget changes (M3b, migration 271):
 * every 15 minutes, each due scheduled_meta_changes row is claimed once,
 * its campaign or ad set re-read, and the change applied through the same
 * budget write as set_budget now (lib/mcp/live/scheduled.ts). A row whose
 * object changed since it was asked (budget edited in Ads Manager, paused,
 * ended) is skipped with the reason, never forced; a spend-raising one
 * re-checks the show's spend ceiling (lib/mcp/meta/show-ceiling.ts).
 *
 * Killswitch: ENABLE_MCP must be exactly "1" (the connector's own switch, no
 * new env var). Off, it answers 200 with skippedReason "killswitch" and
 * reads nothing. Every run is a cron_runs row.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 */

export const maxDuration = 300;
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
  if (!isMcpEnabled()) return NextResponse.json({ ok: true, skippedReason: "killswitch", due: 0, applied: 0 });
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  try {
    const result = await runScheduledChanges({ db: supabase, live: realLiveDeps(supabase), now: new Date() });
    console.log(`[mcp-scheduled-changes] due=${result.due} applied=${result.applied} skipped=${result.skipped} failed=${result.failed} taken=${result.taken} meta_gets=${result.metaGets}`);
    return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed > 0 ? 207 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[mcp-scheduled-changes] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "mcp-scheduled-changes",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => (typeof b.applied === "number" ? b.applied : 0),
    considered: (b) => (typeof b.due === "number" ? b.due : 0),
    detail: (b) => ({ due: b.due ?? 0, applied: b.applied ?? 0, skipped: b.skipped ?? 0, failed: b.failed ?? 0, taken: b.taken ?? 0, meta_calls: b.metaGets ?? 0, skippedReason: b.skippedReason ?? null }),
  },
  handleGET,
);
