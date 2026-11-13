/**
 * GET /api/cron/internal-counts-pull
 *
 * Hourly, 09:00–19:00 UK time on weekdays (the schedule runs every weekday
 * hour in UTC; outside UK hours the route answers 200 with skippedReason).
 * Reads the connected inbox (gmail.readonly) for Electric's Internal Counts
 * PDFs from the last 3 days and runs each new one through the parser
 * (lib/internal-counts). Idempotent on the message id. No Meta or Google
 * Ads calls, no sends. Auth is the cron bearer.
 *
 * ENABLE_INTERNAL_COUNTS_PULL must be exactly "1"; anything else → 200 with
 * skippedReason "killswitch".
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { recordPull } from "@/lib/gmail/connection";
import { loadRunContext } from "@/lib/internal-counts/context";
import { openGmailSession } from "@/lib/internal-counts/gmail-session";
import { gmailSource, PULL_QUERY, runInternalCountsPull, withinPullHours } from "@/lib/internal-counts/pull";
import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (process.env.ENABLE_INTERNAL_COUNTS_PULL !== "1") {
    return NextResponse.json({ ok: true, skippedReason: "killswitch" });
  }
  if (!withinPullHours(new Date()) && req.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ ok: true, skippedReason: "outside_uk_weekday_hours" });
  }
  const sb = createServiceRoleClient();
  let connectionId: string | null = null;
  try {
    const session = await openGmailSession(sb);
    if (!session.ok) return NextResponse.json({ ok: true, skippedReason: session.reason });
    connectionId = session.connection.id;
    const ctx = await loadRunContext(sb);
    const summary = await runInternalCountsPull(sb, ctx, gmailSource(session.gmail, PULL_QUERY), {
      userId: session.connection.user_id,
    });
    await recordPull(sb, connectionId, null);
    const { lines, ...rest } = summary;
    return NextResponse.json({
      ok: true,
      ...rest,
      priceFirings: rest.priceFirings.length,
      messages: lines.map((l) => ({ id: l.messageId, subject: l.subject, kind: l.kind, status: l.result?.status ?? null })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "").trim() : "Unknown error";
    console.error(`[internal-counts-pull] ${message}`);
    if (connectionId) await recordPull(sb, connectionId, message).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "internal-counts-pull",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (body) => Number(body.blocksWritten ?? 0),
    detail: (body) => ({
      found: body.found ?? 0,
      counts: body.counts ?? 0,
      replies: body.replies ?? 0,
      nearMisses: body.nearMisses ?? 0,
      alreadyRead: body.alreadyRead ?? 0,
      blocksHeld: body.blocksHeld ?? 0,
      reviewByKind: body.reviewByKind ?? {},
    }),
    recordWhen: (body, status) => {
      if (status >= 400 || body.ok === false) return true;
      if (body.skippedReason) return false;
      return Number(body.counts ?? 0) + Number(body.replies ?? 0) + Number(body.nearMisses ?? 0) > 0;
    },
  },
  handleGET,
);
