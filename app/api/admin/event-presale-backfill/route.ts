import { NextResponse, type NextRequest } from "next/server";

import { allocateVenueSpendForCode } from "@/lib/dashboard/venue-spend-allocator";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

/**
 * One-shot historical presale rebalance — Stage B of PR #499.
 *
 * The live rollup cron's venue allocator can only auto-extend its window
 * ~60 days back (MAX_ALLOCATOR_BACKFILL_DAYS), so it cannot reach the WC26
 * presale windows (Jan–Apr 2026, 57–143 days old). Migration 109 zeros the
 * clobbered presale on the verified-broken venues; this route then re-runs
 * `allocateVenueSpendForCode` with an EXPLICIT historical `since` (which the
 * allocator honours — `resolveAllocatorSince` only extends backward, it
 * never clamps the requested `since` forward). The allocator re-reads the
 * Meta venue presale total per day and writes the correct `total / n`
 * per-fixture share to every sibling.
 *
 * Migration 109 + this route are the two halves of one fix and must run
 * together (audit §6.3) — see
 * docs/dashboard-presale-overattribution-mechanism-2026-06-05.md.
 *
 * Auth: Bearer CRON_SECRET only (one-shot ops route, curled manually). The
 * proxy carve-out lives in lib/auth/public-routes.ts so the bearer-only curl
 * reaches this handler instead of 307→/login (PR #479 lesson).
 *
 * Usage:
 *   curl -X POST https://app.offpixel.co.uk/api/admin/event-presale-backfill \
 *     -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
 *     -d '{"client_id":"37906506-56b7-4d58-ab62-1b042e2b561a"}'
 *
 * Body:
 *   client_id   (required) — scope for the sibling lookup.
 *   since/until (optional, YYYY-MM-DD) — Meta fetch window. Defaults to
 *               [today − 365d, today], wide enough to cover every presale
 *               window. Pass an explicit narrow window to bound the fetch.
 *   event_codes (optional string[]) — override the default target list.
 */

export const DEFAULT_WINDOW_DAYS = 365;

/**
 * The 7 venues the Stage A audit (§2c) verified as replicated (broken) and
 * that migration 109 zeros. The even-split venues (BRIGHTON / ABERDEEN /
 * MARGATE) and mixed-but-correct MANCHESTER already SUM to truth and are NOT
 * zeroed, so they do not need rebalancing here. Override via `event_codes`.
 */
export const DEFAULT_TARGET_EVENT_CODES = [
  "WC26-BIRMINGHAM",
  "WC26-BOURNEMOUTH",
  "WC26-BRISTOL",
  "WC26-LEEDS",
  "WC26-NEWCASTLE",
  "WC26-EDINBURGH",
  "WC26-GLASGOW-SWG3",
];

interface RequestBody {
  client_id?: unknown;
  since?: unknown;
  until?: unknown;
  event_codes?: unknown;
}

interface CodeResult {
  event_code: string;
  ok: boolean;
  rows_written: number;
  sibling_count: number;
  presale_total: number;
  reason?: string;
  error?: string;
}

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Allocator ok=true and graceful skips are not failures. */
function isAllocatorSoftSkip(reason: string | undefined): boolean {
  return (
    reason === "solo_pass_through" ||
    reason === "equal_split_non_wc26" ||
    reason === "no_siblings"
  );
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (typeof body.client_id !== "string" || body.client_id.length === 0) {
    return NextResponse.json(
      { ok: false, error: "client_id is required" },
      { status: 400 },
    );
  }
  const clientId = body.client_id;

  if (body.since !== undefined && (typeof body.since !== "string" || !YMD_RE.test(body.since))) {
    return NextResponse.json(
      { ok: false, error: "since must be YYYY-MM-DD when provided" },
      { status: 400 },
    );
  }
  if (body.until !== undefined && (typeof body.until !== "string" || !YMD_RE.test(body.until))) {
    return NextResponse.json(
      { ok: false, error: "until must be YYYY-MM-DD when provided" },
      { status: 400 },
    );
  }
  let targetCodes = DEFAULT_TARGET_EVENT_CODES;
  if (body.event_codes !== undefined) {
    if (
      !Array.isArray(body.event_codes) ||
      !body.event_codes.every((c) => typeof c === "string" && c.length > 0)
    ) {
      return NextResponse.json(
        { ok: false, error: "event_codes must be a non-empty string array when provided" },
        { status: 400 },
      );
    }
    targetCodes = body.event_codes as string[];
  }

  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - DEFAULT_WINDOW_DAYS);
  const window = {
    since: (body.since as string | undefined) ?? ymd(since),
    until: (body.until as string | undefined) ?? ymd(until),
  };

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  // Representative sibling per target event_code (any one row carries the
  // user_id + ad account we need; the allocator re-discovers all siblings by
  // (client_id, event_code) itself).
  const { data: rawEvents, error: listErr } = await admin
    .from("events")
    .select(
      "id, user_id, event_code, event_date, client:clients ( meta_ad_account_id )",
    )
    .eq("client_id", clientId)
    .in("event_code", targetCodes);

  if (listErr) {
    return NextResponse.json(
      { ok: false, error: listErr.message },
      { status: 500 },
    );
  }

  type EvRow = {
    id: string;
    user_id: string;
    event_code: string | null;
    event_date: string | null;
    client: { meta_ad_account_id: string | null } | Array<{ meta_ad_account_id: string | null }> | null;
  };
  const events = (rawEvents ?? []) as unknown as EvRow[];

  // Group siblings by event_code; keep one representative + a count.
  const byCode = new Map<string, { rep: EvRow; count: number }>();
  for (const ev of events) {
    if (!ev.event_code) continue;
    const existing = byCode.get(ev.event_code);
    if (existing) {
      existing.count += 1;
    } else {
      byCode.set(ev.event_code, { rep: ev, count: 1 });
    }
  }

  const tokenCache = new Map<string, string>();
  const results: CodeResult[] = [];

  for (const code of targetCodes) {
    const entry = byCode.get(code);
    if (!entry) {
      results.push({
        event_code: code,
        ok: false,
        rows_written: 0,
        sibling_count: 0,
        presale_total: 0,
        reason: "no_event",
        error: "No event with this event_code for client_id.",
      });
      continue;
    }
    const { rep, count } = entry;
    const clientRel = rep.client;
    const client = Array.isArray(clientRel) ? clientRel[0] : clientRel;
    const adAccountId = client?.meta_ad_account_id ?? null;

    try {
      let token = tokenCache.get(rep.user_id);
      if (token === undefined) {
        ({ token } = await resolveServerMetaToken(admin, rep.user_id));
        tokenCache.set(rep.user_id, token);
      }
      const alloc = await allocateVenueSpendForCode({
        supabase: admin,
        userId: rep.user_id,
        clientId,
        eventCode: code,
        eventDate: rep.event_date,
        adAccountId,
        token,
        since: window.since,
        until: window.until,
      });
      const presaleTotal = alloc.perEventLifetime.reduce(
        (sum, e) => sum + (e.presale ?? 0),
        0,
      );
      results.push({
        event_code: code,
        ok: alloc.ok,
        rows_written: alloc.rowsWritten,
        sibling_count: count,
        presale_total: Math.round(presaleTotal * 100) / 100,
        ...(alloc.reason ? { reason: alloc.reason } : {}),
        ...(alloc.error ? { error: alloc.error } : {}),
      });
      console.info(
        `[presale-backfill] event_code=${code} ok=${alloc.ok} rows=${alloc.rowsWritten} presale=${presaleTotal.toFixed(2)} reason=${alloc.reason ?? "ran"}`,
      );
    } catch (err) {
      console.error("[presale-backfill] allocator threw", {
        event_code: code,
        message: err instanceof Error ? err.message : String(err),
      });
      results.push({
        event_code: code,
        ok: false,
        rows_written: 0,
        sibling_count: count,
        presale_total: 0,
        reason: "allocator_threw",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const ok = results.every((r) => r.ok || isAllocatorSoftSkip(r.reason));
  return NextResponse.json(
    {
      ok,
      mode: "event_presale_backfill",
      client_id: clientId,
      window,
      event_codes_processed: results.length,
      results,
    },
    { status: ok ? 200 : 207 },
  );
}
