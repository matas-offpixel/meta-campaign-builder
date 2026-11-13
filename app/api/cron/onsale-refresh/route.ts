import { NextResponse, type NextRequest } from "next/server";

import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { buildLiveNotifyDeps } from "@/lib/notify/slack-deps";
import { notify } from "@/lib/notify/slack";
import { isOnsaleRefreshEnabled, postPendingProposals, refreshRunLog, runOnsaleRefresh } from "@/lib/onsale-refresh/runner";

/**
 * GET /api/cron/onsale-refresh
 *
 * The on-sale refresh (docs/design-record/2026-11-12-on-sale-refresh.html,
 * P1): on each Monday at 06:00 UTC (06:00 London in winter, 07:00 in
 * summer, after the 03:30 UTC learning-refresh) the cycle refresh or the
 * mid-cycle check for every on-sale event with Meta campaigns — one shadow
 * proposal per campaign, stored with its lines and posted to
 * ads_automation. Reads ad_daily_insights, creative_scores, live evidence,
 * ticket warnings and the cycle's Drive folders. Writes proposals only;
 * never to Meta.
 *
 * The purchase line (docs/design-record/2026-11-13-per-event-purchases.html)
 * reads Meta with `META_ACCESS_TOKEN`: the delivering ad sets'
 * promoted_object.pixel_id, the resolved pixels' names and the pixel's
 * purchases by domain — reads only, one attempt each, counted in
 * `metaCalls`. Without the token the line says it was not read. One
 * public CIRQLIN page is read per crqln.com signup link.
 * clients.meta_pixel_id is never written.
 *
 * `?shadow=YYYY-MM-DD` starts a shadow run for that day by hand (R1): it
 * reads the data to the day before. `?event=CODE` narrows to one event.
 *
 * `?post=pending` (F2) posts the proposals the 06:00 run stored but could
 * not post — notify() answers outside_business_hours before 10:00 London,
 * and slack_posted_at stays null — one Slack post per proposal, deduped on
 * its id. vercel.json runs it at 10:05 Monday.
 *
 * Killswitch: `ENABLE_ONSALE_REFRESH` must be exactly `"1"`. Unset
 * responds 200 with `skippedReason: "killswitch"`.
 *
 * Auth: bearer header `Authorization: Bearer <CRON_SECRET>`.
 *
 * vercel.json: "0 6 * * 1" for the run, "5 10 * * 1" for `?post=pending`.
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
  if (!isOnsaleRefreshEnabled(process.env)) return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }

  const shadow = req.nextUrl.searchParams.get("shadow")?.trim() || undefined;
  if (shadow && !/^\d{4}-\d{2}-\d{2}$/.test(shadow)) return NextResponse.json({ ok: false, error: "shadow must be YYYY-MM-DD" }, { status: 400 });
  const eventCodes = req.nextUrl.searchParams.getAll("event").map((code) => code.trim()).filter(Boolean);

  try {
    const notifyDeps = buildLiveNotifyDeps(supabase);
    if (req.nextUrl.searchParams.get("post") === "pending") {
      const posted = await postPendingProposals({ db: supabase, env: process.env, notify: (opts) => notify(opts, notifyDeps) });
      return NextResponse.json(posted, { status: posted.ok ? 200 : 207 });
    }
    const token = process.env.META_ACCESS_TOKEN;
    const result = await runOnsaleRefresh({
      env: process.env,
      db: supabase,
      shadowDay: shadow,
      eventCodes: eventCodes.length ? eventCodes : undefined,
      notify: (opts) => notify(opts, notifyDeps),
      // One attempt per call: a retry would hide its cost from metaCalls.
      graph: token
        ? { graphGet: (path, params) => graphGetWithToken(path, params, token, { maxAttempts: 1 }), multiGet: (path, params) => graphMultiGetByIds(path, params, token) }
        : null,
      graphReason: token ? undefined : "META_ACCESS_TOKEN is not configured",
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[onsale-refresh] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "onsale-refresh",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => refreshRunLog(b).rows,
    detail: (b) => refreshRunLog(b).detail,
  },
  handleGET,
);
