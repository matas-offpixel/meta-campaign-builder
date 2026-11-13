/**
 * GET /api/cron/internal-counts-pull
 *
 * Hourly, 09:00–19:00 UK time on weekdays (the schedule runs every weekday
 * hour in UTC; outside UK hours the route answers 200 with skippedReason).
 * Reads GMAIL_INGEST_MAILBOX (gmail.readonly, the Drive service account
 * through domain-wide delegation) for Electric's Internal Counts PDFs from
 * the last 3 days and runs each new one through the parser
 * (lib/internal-counts). Idempotent on the message id. No Meta or Google
 * Ads calls, no sends. Auth is the cron bearer.
 *
 * ENABLE_INTERNAL_COUNTS_PULL must be exactly "1"; anything else → 200 with
 * skippedReason "killswitch". Delegation not granted yet → 200 with
 * skippedReason "gmail_not_delegated".
 */

import { NextResponse, type NextRequest } from "next/server";

import { isCronAuthorized } from "@/lib/attribution/cron-auth";
import { loadRunContext } from "@/lib/internal-counts/context";
import { openGmailSession, operatorForMailbox, skipReasonFor } from "@/lib/internal-counts/gmail-session";
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
  try {
    const session = await openGmailSession();
    if (!session.ok) return NextResponse.json({ ok: true, skippedReason: session.reason });
    const userId = await operatorForMailbox(sb, session.mailbox);
    if (!userId) return NextResponse.json({ ok: true, skippedReason: "no_operator_for_mailbox" });
    const ctx = await loadRunContext(sb);
    const summary = await runInternalCountsPull(sb, ctx, gmailSource(session.gmail, PULL_QUERY), { userId });
    const { lines, ...rest } = summary;
    return NextResponse.json({
      ok: true,
      ...rest,
      priceFirings: rest.priceFirings.length,
      messages: lines.map((l) => ({ id: l.messageId, subject: l.subject, kind: l.kind, status: l.result?.status ?? null })),
    });
  } catch (err) {
    // The Gmail API not switched on yet is setup, not a failure.
    const skip = skipReasonFor(err);
    if (skip) return NextResponse.json({ ok: true, skippedReason: skip });
    const message = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "").trim() : "Unknown error";
    console.error(`[internal-counts-pull] ${message}`);
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
