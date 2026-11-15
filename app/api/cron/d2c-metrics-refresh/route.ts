import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { refreshSendMetrics } from "@/lib/d2c/metrics/refresh";
import { isNightlyStatsSlot, isStatsIngestEnabled } from "@/lib/d2c/stats-ingest/run";
import { runNightlyStatsIngest, type NightlyStatsSummary } from "@/lib/d2c/stats-ingest/nightly";

/**
 * /api/cron/d2c-metrics-refresh
 *
 * Walks sends that fired in the last 14 days and refreshes their delivery
 * metrics onto result_jsonb.metrics (Goal 4). Idempotent + safe to re-run —
 * refreshSendMetrics is itself 60s-rate-limited per send. 15-min cadence
 * (registered in vercel.json).
 *
 * HE3: when ENABLE_D2C_STATS_INGEST is exactly "1", the 04:00–04:14 UTC
 * run first reads Bird and Mailchimp stats into d2c_broadcast_stats
 * (lib/d2c/stats-ingest). `?stats=now` runs it outside the slot, still
 * only behind the flag. With the flag off this route is unchanged.
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

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  let statsIngest: NightlyStatsSummary | undefined;
  if (
    isStatsIngestEnabled() &&
    (req.nextUrl.searchParams.get("stats") === "now" || isNightlyStatsSlot(new Date()))
  ) {
    statsIngest = await runNightlyStatsIngest(admin);
  }

  const since = new Date(Date.now() - FOURTEEN_DAYS_MS).toISOString();
  const { data, error } = await admin
    .from("d2c_scheduled_sends")
    .select("id")
    .eq("status", "sent")
    .gte("scheduled_for", since)
    .order("scheduled_for", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  let refreshed = 0;
  let skipped = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    // force:true — the cron owns the authoritative refresh; the per-send map
    // still guards against the manual button racing it within the same minute.
    const res = await refreshSendMetrics(admin, id, { force: false });
    if (res.ok) refreshed += 1;
    else if (res.rateLimited) skipped += 1;
    else errors.push({ id, error: res.error ?? "unknown" });
  }

  return NextResponse.json({
    ok: true,
    scanned: ids.length,
    refreshed,
    skipped,
    errors: errors.slice(0, 20),
    ...(statsIngest ? { statsIngest } : {}),
  });
}
