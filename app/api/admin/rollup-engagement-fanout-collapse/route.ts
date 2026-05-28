import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/rollup-engagement-fanout-collapse
 *
 * One-shot historical backfill for issue #471 PR-A.5 — the rollup
 * writer per-fixture fanout fix. Reshapes existing
 * `event_daily_rollups` rows so that for every `(event_code, date)`
 * group with multiple siblings, ONE row keeps the Meta engagement +
 * attribution values and the others are NULLed out. SUM-across-
 * siblings then collapses to the single event-code total instead of
 * triple-counting (Edinburgh 316,689 vs Meta's 105,563 — exactly ×3).
 *
 * Why option (iii) — no Meta calls
 * --------------------------------
 *   The values are already in the DB; pre-PR-A.5 the writer fanned
 *   out the SAME event-code-level number to every sibling row. The
 *   bug is shape, not value. So we can reshape from the existing
 *   rows with a single SQL `UPDATE` — no Meta API quota, no daylight
 *   between the live writer and the historical state.
 *
 *   Confirmed in the issue #471 audit:
 *     - 2,144 day-rows are byte-identical fanout (trivial NULL-out)
 *     - 45 day-rows have race-jitter divergence (MAX-pick tie-break)
 *     - 1,982 day-rows are single-sibling already
 *
 * Auth: Bearer `CRON_SECRET` only. Same pattern as PR #468's
 * canonical-clicks-lpv backfill route (and the PUBLIC_PREFIXES
 * lesson from PR #470 — see `lib/auth/public-routes.ts`).
 *
 * Idempotent. Re-running is a no-op on already-reshaped rows (the
 * non-owner rows already hold NULL on the affected columns, so the
 * UPDATE matches zero rows the second time).
 *
 * Request body (optional):
 *   {
 *     "event_code": "WC26-EDINBURGH",  // narrow to one event_code
 *     "dry_run": true                  // count affected rows w/o writing
 *   }
 *
 * Response:
 *   {
 *     "ok": true,
 *     "dry_run": false,
 *     "fanout_rows_nulled": 3160,
 *     "jitter_rows_resolved": 84,
 *     "groups_processed": 2189,
 *     "jitter_examples": [{event_code, date, distinct_impressions}],
 *     "errors": [...]
 *   }
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface RequestBody {
  event_code?: unknown;
  dry_run?: unknown;
}

interface RouteSummary {
  ok: boolean;
  dry_run: boolean;
  fanout_rows_nulled: number;
  jitter_rows_resolved: number;
  groups_processed: number;
  jitter_examples: Array<{
    event_code: string;
    date: string;
    distinct_impressions: number;
  }>;
  errors: string[];
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

/**
 * Columns that are engagement-owner-only post-PR-A.5. Every column
 * here is event-code-level (Meta returns the same number for every
 * sibling because of the substring-on-campaign-name filter), so
 * non-owner siblings hold NULL.
 *
 * Keep this list in sync with the `ownedOrNull` block in
 * `lib/dashboard/rollup-sync-runner.ts` — adding a column to one
 * place but not the other re-introduces the fanout.
 */
const ENGAGEMENT_COLUMNS = [
  "link_clicks",
  "landing_page_views",
  "meta_regs",
  "meta_purchases",
  "meta_leads",
  "meta_impressions",
  "meta_reach",
  "meta_video_plays_3s",
  "meta_video_plays_15s",
  "meta_video_plays_p100",
  "meta_engagements",
] as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    body = {};
  }
  const filterEventCode =
    typeof body.event_code === "string" && body.event_code.length > 0
      ? body.event_code
      : null;
  const dryRun = body.dry_run === true;

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const summary: RouteSummary = {
    ok: true,
    dry_run: dryRun,
    fanout_rows_nulled: 0,
    jitter_rows_resolved: 0,
    groups_processed: 0,
    jitter_examples: [],
    errors: [],
  };

  // ── Step 1: enumerate (event_code, date) groups + their siblings ──
  //
  // We pull JUST the keys + the canonical engagement column
  // (`meta_impressions`) to decide:
  //   - Which sibling is the owner (lex-min event_id) — keep its row.
  //   - Is the group byte-identical fanout, or race-jitter divergent?
  //     Divergence detected by `distinct(meta_impressions) > 1`.
  //
  // Pulling only one column keeps the payload small even at 10k rows;
  // we do not need the actual values because the live writer/runner
  // will re-converge them on the next sync.
  //
  // The query joins events for `event_code` and filters to multi-
  // sibling groups via a subquery.
  //
  // NB: we don't paginate. The aggregate row count is ~10k; well under
  // the default 50k limit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: siblingRows, error: enumErr } = await (supabase as any)
    .from("event_daily_rollups")
    .select(
      "event_id,date,meta_impressions,events!inner(id,event_code)",
    )
    .not("events.event_code", "is", null);

  if (enumErr) {
    summary.ok = false;
    summary.errors.push(`enumerate: ${enumErr.message as string}`);
    return NextResponse.json(summary, { status: 500 });
  }

  type SiblingRow = {
    event_id: string;
    date: string;
    meta_impressions: number | null;
    events: { id: string; event_code: string } | Array<{ id: string; event_code: string }>;
  };
  const rows = (siblingRows ?? []) as SiblingRow[];

  // Group by (event_code, date) → list of {event_id, impressions}.
  const groups = new Map<
    string,
    Array<{ event_id: string; impressions: number | null }>
  >();
  const codeByGroupKey = new Map<string, string>();
  const dateByGroupKey = new Map<string, string>();

  for (const row of rows) {
    const eventCodeRel = Array.isArray(row.events) ? row.events[0] : row.events;
    if (!eventCodeRel) continue;
    const ec = eventCodeRel.event_code;
    if (!ec) continue;
    if (filterEventCode && ec !== filterEventCode) continue;
    const key = `${ec}\u0000${row.date}`;
    const bucket = groups.get(key) ?? [];
    bucket.push({
      event_id: row.event_id,
      impressions: row.meta_impressions,
    });
    groups.set(key, bucket);
    codeByGroupKey.set(key, ec);
    dateByGroupKey.set(key, row.date);
  }

  // ── Step 2: classify each multi-sibling group ─────────────────────
  //
  //   - Singletons: leave alone (already correct shape).
  //   - Byte-identical fanout: every sibling has the same impressions
  //     (or all NULL); keep min(event_id) row, NULL the rest.
  //   - Race-jitter: distinct impressions across siblings; keep the
  //     row with MAX impressions (most recent / fullest snapshot per
  //     the same rationale as `dedupVenueRollupsByEventCode`), NULL
  //     the rest.
  //
  // We accumulate "rows to NULL" into two id lists so we can run two
  // bulk UPDATEs at the end.

  const idsToNullFanout: Array<{ event_id: string; date: string }> = [];
  const idsToNullJitter: Array<{ event_id: string; date: string }> = [];

  for (const [key, members] of groups.entries()) {
    if (members.length < 2) continue;
    summary.groups_processed += 1;

    const distinctImpressions = new Set<number | "null">();
    for (const m of members) {
      distinctImpressions.add(m.impressions === null ? "null" : m.impressions);
    }
    const isJitter = distinctImpressions.size > 1;
    let keeperEventId: string;

    if (isJitter) {
      // MAX-pick tie-break: highest impressions wins. NULLs lose.
      let best = members[0]!;
      for (const m of members) {
        const cur = m.impressions ?? -1;
        const winner = best.impressions ?? -1;
        if (cur > winner) best = m;
      }
      keeperEventId = best.event_id;
      summary.jitter_examples.push({
        event_code: codeByGroupKey.get(key)!,
        date: dateByGroupKey.get(key)!,
        distinct_impressions: distinctImpressions.size,
      });
    } else {
      // Identical fanout: pick lex-min event_id (matches the live
      // writer's owner-selection rule in
      // `lib/db/event-code-primary-sibling.ts`).
      members.sort((a, b) => a.event_id.localeCompare(b.event_id));
      keeperEventId = members[0]!.event_id;
    }

    const date = dateByGroupKey.get(key)!;
    for (const m of members) {
      if (m.event_id === keeperEventId) continue;
      const target = { event_id: m.event_id, date };
      if (isJitter) idsToNullJitter.push(target);
      else idsToNullFanout.push(target);
    }
  }

  if (dryRun) {
    summary.fanout_rows_nulled = idsToNullFanout.length;
    summary.jitter_rows_resolved = idsToNullJitter.length;
    return NextResponse.json(summary);
  }

  // ── Step 3: apply NULL updates in bulk batches ─────────────────────
  //
  // Supabase doesn't support a single multi-key UPDATE through the
  // PostgREST surface, so we chunk by date. Per date, a single
  // `UPDATE … WHERE event_id IN (...) AND date = $date` blanks every
  // affected row in one round-trip.
  const nullPayload: Record<string, null> = {};
  for (const col of ENGAGEMENT_COLUMNS) nullPayload[col] = null;

  async function applyNullsBatch(
    targets: Array<{ event_id: string; date: string }>,
  ): Promise<number> {
    if (targets.length === 0) return 0;
    const byDate = new Map<string, string[]>();
    for (const t of targets) {
      const list = byDate.get(t.date) ?? [];
      list.push(t.event_id);
      byDate.set(t.date, list);
    }
    let updated = 0;
    for (const [date, eventIds] of byDate.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await (supabase as any)
        .from("event_daily_rollups")
        .update(nullPayload, { count: "exact" })
        .eq("date", date)
        .in("event_id", eventIds);
      if (error) {
        summary.errors.push(
          `update date=${date} ids=${eventIds.length}: ${error.message as string}`,
        );
        summary.ok = false;
        continue;
      }
      updated += (count as number | null) ?? eventIds.length;
    }
    return updated;
  }

  summary.fanout_rows_nulled = await applyNullsBatch(idsToNullFanout);
  summary.jitter_rows_resolved = await applyNullsBatch(idsToNullJitter);

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}
