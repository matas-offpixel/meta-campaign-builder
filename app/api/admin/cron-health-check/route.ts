import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  runCronHealthCheck,
  writeCronHealthReport,
} from "@/lib/reporting/cron-health-monitor";

/**
 * POST /api/admin/cron-health-check
 *
 * Admin "Refresh now" trigger for the cron silent-failure monitor. Runs the
 * check inline and writes a fresh `cron_health_reports` row, then returns it.
 *
 * Auth: cookie-bound Supabase session (any authenticated operator — the app is
 * invite-only). Same pattern as the other /api/admin/* session routes. Session
 * routes don't need a PUBLIC_PREFIXES carve-out — the proxy lets authenticated
 * requests through.
 */

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const report = await runCronHealthCheck();
  try {
    await writeCronHealthReport(report);
  } catch (err) {
    console.error(
      `[admin cron-health-check] failed to persist report: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return NextResponse.json(
      { ok: false, error: "report computed but persist failed", anyStale: report.anyStale, tables: report.tables },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { ok: true, anyStale: report.anyStale, tables: report.tables },
    { status: 200 },
  );
}
