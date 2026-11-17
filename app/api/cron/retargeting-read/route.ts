import { NextResponse, type NextRequest } from "next/server";

import { withCronRunLog } from "@/lib/reporting/with-cron-run-log";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { graphGetWithToken } from "@/lib/meta/client";
import { graphMultiGetByIds } from "@/lib/meta/graph-multi-get";
import { isRetargetingReadEnabled, runRetargetingRead } from "@/lib/retargeting/runner";

/**
 * GET /api/cron/retargeting-read
 *
 * The Retargeting campaign's daily read (docs/design-record/2026-11-17-retargeting-campaign.html,
 * RT1, RT4, RT7, RT8): at 08:00 London, over the last 7 days to yesterday,
 * one `{code} · Retargeting` proposal per on-sale show, to the show day —
 * the Create line, or the sentence that replaces it. PR A writes the Create
 * line only; PR B adds the tiers' figures and moves, holds and cuts.
 *
 * Meta is read only, with `META_ACCESS_TOKEN`, one attempt per call: the
 * on-sale refresh's purchase read, the operator's pages with a role
 * (`/me/accounts`) and each account's min_daily_budget. Never a write.
 *
 * vercel.json runs "0 7,8 * * *" (UTC) and the read acts on the one that
 * is 08:00 London (07:00 UTC in summer, 08:00 in winter); `?force=1` runs it
 * whatever the hour, `?event=CODE` narrows it.
 *
 * Killswitch: `ENABLE_RETARGETING_READ` must be exactly `"1"`. Unset
 * responds 200 with `skippedReason: "killswitch"`.
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
  if (!isRetargetingReadEnabled(process.env)) return NextResponse.json({ ok: true, skippedReason: "killswitch" }, { status: 200 });
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Service-role client unavailable" }, { status: 500 });
  }
  const eventCodes = req.nextUrl.searchParams.getAll("event").map((code) => code.trim()).filter(Boolean);
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const result = await runRetargetingRead({
      env: process.env,
      db: supabase,
      force: req.nextUrl.searchParams.get("force") === "1",
      eventCodes: eventCodes.length ? eventCodes : undefined,
      graph: token ? { graphGet: (path, params) => graphGetWithToken(path, params, token, { maxAttempts: 1 }), multiGet: (path, params) => graphMultiGetByIds(path, params, token) } : null,
      graphReason: token ? undefined : "META_ACCESS_TOKEN is not configured",
    });
    return NextResponse.json(result, { status: "errors" in result && !result.ok ? 207 : 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[retargeting-read] unhandled error: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export const GET = withCronRunLog(
  {
    cronName: "retargeting-read",
    getDb: () => {
      try {
        return createServiceRoleClient();
      } catch {
        return null;
      }
    },
    rows: (b) => (Array.isArray(b.records) ? (b.records as { proposalId?: string | null }[]).filter((row) => row.proposalId).length : 0),
    detail: (b) => ({ events: b.events ?? 0, metaCalls: b.metaCalls ?? 0, skippedReason: b.skippedReason ?? null, errors: Array.isArray(b.errors) ? b.errors.length : 0 }),
  },
  handleGET,
);
