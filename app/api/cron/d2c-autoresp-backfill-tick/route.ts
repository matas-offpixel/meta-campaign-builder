import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { listAutorespSendsByChannel } from "@/lib/db/d2c";
import { runBackfillChunk, readBackfillState } from "@/lib/d2c/autoresp/backfill";
import type { D2CScheduledSend } from "@/lib/d2c/types";

/**
 * GET /api/cron/d2c-autoresp-backfill-tick
 *
 * Drains autoresponder backfills one chunk per send per tick (Goal 7). Finds
 * autoresp_setup sends whose result_jsonb.autoresp_backfill is pending/running
 * and advances each by one chunk. Dedup (d2c_autoresp_fires) keeps every tick
 * idempotent, so a chunk that partially failed simply retries next minute.
 */
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

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Service client unavailable" }, { status: 500 });
  }

  const [emailSends, waSends] = await Promise.all([
    listAutorespSendsByChannel(admin, "email"),
    listAutorespSendsByChannel(admin, "whatsapp"),
  ]);
  const pending: D2CScheduledSend[] = [...emailSends, ...waSends].filter((s) => {
    const st = readBackfillState(s.result_jsonb);
    return st?.status === "pending" || st?.status === "running";
  });

  const results: Array<{ sendId: string; status: string; processed: number; fired: number }> = [];
  for (const send of pending) {
    const state = await runBackfillChunk(admin, send);
    results.push({
      sendId: send.id,
      status: state.status,
      processed: state.processed,
      fired: state.fired,
    });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
