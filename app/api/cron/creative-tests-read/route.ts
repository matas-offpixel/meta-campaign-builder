import { NextResponse, type NextRequest } from "next/server";

import { runCreativeTestsRead } from "@/lib/creative-tests/read-job";
import { graphPostWithToken } from "@/lib/meta/client";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * GET /api/cron/creative-tests-read
 *
 * The creative tests' daily read (TF2; issue 6's TF5–TF8,
 * docs/design-record/2026-11-18-creative-testing-6.html): for every running
 * test in a {code} · Tests ad set, one creative_test_reads row a London day,
 * and TF6's extension (the ad set's end_time out 4 days) or stop (the ad set
 * paused) through the gated, ledgered writes. lib/creative-tests/read-job.ts.
 *
 * vercel.json runs "0 7,8 * * *" (UTC) and the read acts on the one that is
 * 08:00 London (07:00 UTC in summer, 08:00 in winter): TF2's read hour. That's
 * after the 02:30 UTC ad-daily-insights run restates yesterday, so a read sees
 * complete days. A test ad set ends at 23:59 London; the day after its last day
 * is the first read at or past its 96 h (TF2), so an extension lands then and
 * pushes the end out to 23:59 on day 8 (or 12). `?force=1` runs whatever the
 * hour, `?event=CODE` narrows it.
 *
 * Killswitch: ENABLE_CREATIVE_TESTS_READ must be exactly "1"; unset responds 200
 * with skippedReason "killswitch". Writes need CREATIVE_TESTS_READ_WRITES_ENABLED
 * and CREATIVE_TESTS_CREATE_ENABLED exactly "true" (a pause also
 * OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED); without them the read lands and the
 * write waits. Meta is written only, with META_ACCESS_TOKEN, single shot.
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
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  const eventCodes = req.nextUrl.searchParams.getAll("event").map((code) => code.trim()).filter(Boolean);
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const result = await runCreativeTestsRead({
      env: process.env,
      db: supabase,
      force: req.nextUrl.searchParams.get("force") === "1",
      eventCodes: eventCodes.length ? eventCodes : undefined,
      graph: token
        ? {
            async postAdSetEndTime(adsetId, endTime) {
              await graphPostWithToken(`/${adsetId}`, { end_time: endTime }, token);
            },
            async postAdSetStatus(adsetId, status) {
              await graphPostWithToken(`/${adsetId}`, { status }, token);
            },
          }
        : null,
    });
    return NextResponse.json(result, { status: "errors" in result && !result.ok ? 207 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[creative-tests-read] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "creative-tests-read",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => (typeof b.tests === "number" ? b.tests : 0),
    detail: (b) => ({ tests: b.tests ?? 0, writes: b.writes ?? 0, readDay: b.readDay ?? null, skippedReason: b.skippedReason ?? null, errors: Array.isArray(b.errors) ? b.errors.length : 0 }),
  },
  handleGET,
);
