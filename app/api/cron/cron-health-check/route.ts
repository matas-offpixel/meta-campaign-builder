import { NextResponse, type NextRequest } from "next/server";

import {
  runCronHealthCheck,
  writeCronHealthReport,
} from "@/lib/reporting/cron-health-monitor";

/**
 * GET /api/cron/cron-health-check
 *
 * Vercel Cron entry point for the silent-failure monitor. Samples the freshest
 * write across every monitored snapshot/rollup table, writes one
 * `cron_health_reports` row, and returns the per-table status.
 *
 * Cadence: every 30 minutes (see `vercel.json`).
 *
 * Auth: bearer `Authorization: Bearer <CRON_SECRET>`, identical helper to the
 * other crons. Lives under the `/api/cron/` PUBLIC_PREFIXES carve-out (the
 * prefix only bypasses the session proxy — this handler still enforces its own
 * bearer auth and 401s on mismatch).
 *
 * Always returns 200 when authorised: staleness is the DATA, not a request
 * failure. Consumers read `anyStale` / the per-table `status` to decide if
 * something is wrong.
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
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const report = await runCronHealthCheck();
  try {
    await writeCronHealthReport(report);
  } catch (err) {
    console.error(
      `[cron cron-health-check] failed to persist report: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    // The report still computed — return it so the run isn't a total loss,
    // but flag the persistence failure.
    return NextResponse.json(
      {
        ok: false,
        anyStale: report.anyStale,
        tables: report.tables,
        error: "report computed but persist failed",
      },
      { status: 200 },
    );
  }

  console.error(
    `[cron cron-health-check] done any_stale=${report.anyStale} stale=${
      report.tables.filter((t) => t.status !== "fresh").length
    }/${report.tables.length}`,
  );

  return NextResponse.json(
    { ok: true, anyStale: report.anyStale, tables: report.tables },
    { status: 200 },
  );
}
