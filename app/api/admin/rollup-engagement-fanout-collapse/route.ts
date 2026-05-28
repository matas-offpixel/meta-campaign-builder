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
 * Columns Meta returns at campaign granularity. Sibling events
 * sharing one bracketed `event_code` always carry the IDENTICAL
 * value for each calendar day, REGARDLESS of allocator state — the
 * venue allocator never rewrites these.
 *
 * Mirrors `ALWAYS_CAMPAIGN_WIDE_META_COLUMNS` in
 * `lib/dashboard/venue-rollup-dedup.ts`; keep them in sync.
 */
const ALWAYS_CAMPAIGN_WIDE_COLUMNS = [
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

/**
 * `link_clicks` is the only engagement/attribution column the venue
 * spend allocator may rewrite per-fixture. When it has (Brighton,
 * Manchester), siblings in the group hold DISTINCT positive values
 * that SUM to the campaign total and MUST NOT be NULLed. When it
 * hasn't (Edinburgh, SWG3), every sibling holds the IDENTICAL
 * event-code total and must be collapsed.
 *
 * Detection used here: per-group `distinct(link_clicks) > 1`. This
 * is strictly stronger than the dedup helper's
 * `ad_spend_allocated != null` heuristic — Edinburgh's rows have
 * `ad_spend_presale = 0` (non-null) but `link_clicks` is still
 * fanned out (the allocator wrote spend allocation but not a
 * per-fixture click split). Using the column's own distinct-value
 * count avoids that false-positive.
 *
 * Verification of why this matters (issue #471 audit dry-run on
 * prod data, 2026-05-28):
 *
 *   - Brighton  (4 fixtures, distinct link_clicks > 1):
 *       SUM(link_clicks) = 64,132 = lifetime cache (already correct)
 *   - Manchester (4 fixtures, distinct link_clicks > 1):
 *       SUM(link_clicks) = 67,844 = lifetime cache (already correct)
 *   - Edinburgh (3 fixtures, distinct link_clicks = 1):
 *       SUM(link_clicks) = 316,689 = 3 × 105,563 (the fanout bug)
 *   - SWG3      (3 fixtures, distinct link_clicks = 1):
 *       SUM(link_clicks) = 74,615 ≠ 3,503 cache (also fanned out)
 */
const PER_FIXTURE_CANDIDATE_COLUMNS = ["link_clicks"] as const;

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
  // We pull keys + `meta_impressions` (jitter detection) +
  // `link_clicks` (per-column fanout detection — see the comment on
  // `PER_FIXTURE_CANDIDATE_COLUMNS`). All other engagement columns
  // are unconditionally campaign-wide so we don't need their values
  // here — the update will blank them on every non-owner sibling in
  // every group.
  //
  // The query joins events for `event_code` and filters to multi-
  // sibling groups in JS (PostgREST's filtering on joins is limited).
  //
  // Pagination is REQUIRED. PostgREST silently caps any unbounded
  // SELECT at 1,000 rows; prod `event_daily_rollups` with non-null
  // `event_code` is ~11k rows, so the first ship of this route only
  // saw the first 1,000 and updated 128 of ~6,000 expected rows
  // (Edinburgh barely touched). Same class-of-bug fixed in PR #459
  // for `listDailyHistoryForEvents` — range-page until a short page
  // returns. Order by `(event_id, date)` to make the page boundary
  // deterministic across runs. On any page error: log a warning,
  // break, and return what we have rather than silently dropping
  // every group already accumulated.
  type SiblingRow = {
    event_id: string;
    date: string;
    meta_impressions: number | null;
    link_clicks: number | null;
    events:
      | { id: string; event_code: string }
      | Array<{ id: string; event_code: string }>;
  };
  const PAGE = 1000;
  const rows: SiblingRow[] = [];
  let pagesRead = 0;
  for (let from = 0; ; from += PAGE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pageData, error: enumErr } = await (supabase as any)
      .from("event_daily_rollups")
      .select(
        "event_id,date,meta_impressions,link_clicks,events!inner(id,event_code)",
      )
      .not("events.event_code", "is", null)
      .order("event_id", { ascending: true })
      .order("date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (enumErr) {
      summary.errors.push(
        `enumerate page from=${from}: ${enumErr.message as string}`,
      );
      console.warn(
        `[rollup-engagement-fanout-collapse] enumerate page from=${from}: ${enumErr.message as string}`,
      );
      break;
    }
    const page = (pageData ?? []) as SiblingRow[];
    pagesRead += 1;
    for (const r of page) rows.push(r);
    if (page.length < PAGE) break;
  }
  console.log(
    `[rollup-engagement-fanout-collapse] paginated read: ${pagesRead} pages, ${rows.length} total rows`,
  );

  interface GroupMember {
    event_id: string;
    impressions: number | null;
    link_clicks: number | null;
  }
  const groups = new Map<string, GroupMember[]>();
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
      link_clicks: row.link_clicks,
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
  //     the same rationale as `dedupVenueRollupsByEventCode`).
  //
  // PER-COLUMN fanout decision for `link_clicks`:
  //   The allocator may rewrite link_clicks per-fixture (Brighton,
  //   Manchester). Detect that by counting distinct non-null values
  //   in the group. > 1 → leave alone (already per-fixture). <= 1 →
  //   NULL on non-owners along with the always-campaign-wide set.
  //
  // We tag each NULL target with the column subset so the UPDATE
  // pass writes the correct columns.

  type ColumnSet = "always" | "full";
  interface NullTarget {
    event_id: string;
    date: string;
    columnSet: ColumnSet;
  }
  const fanoutTargets: NullTarget[] = [];
  const jitterTargets: NullTarget[] = [];

  for (const [key, members] of groups.entries()) {
    if (members.length < 2) continue;
    summary.groups_processed += 1;

    const distinctImpressions = new Set<number | "null">();
    for (const m of members) {
      distinctImpressions.add(m.impressions === null ? "null" : m.impressions);
    }
    const isJitter = distinctImpressions.size > 1;

    // Per-column decision for link_clicks: count distinct positive
    // values across siblings. > 1 means at least 2 fixtures hold
    // different positive clicks → allocator-split, leave alone.
    const distinctPositiveLinkClicks = new Set<number>();
    for (const m of members) {
      if (typeof m.link_clicks === "number" && m.link_clicks > 0) {
        distinctPositiveLinkClicks.add(m.link_clicks);
      }
    }
    const linkClicksIsPerFixture = distinctPositiveLinkClicks.size > 1;
    const columnSet: ColumnSet = linkClicksIsPerFixture ? "always" : "full";

    let keeperEventId: string;
    if (isJitter) {
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
      const target: NullTarget = { event_id: m.event_id, date, columnSet };
      if (isJitter) jitterTargets.push(target);
      else fanoutTargets.push(target);
    }
  }

  if (dryRun) {
    summary.fanout_rows_nulled = fanoutTargets.length;
    summary.jitter_rows_resolved = jitterTargets.length;
    return NextResponse.json(summary);
  }

  // ── Step 3: apply NULL updates in bulk batches ─────────────────────
  //
  // We chunk by (date, columnSet) and emit one UPDATE per chunk so
  // PostgREST writes only the columns we want. Groups whose
  // link_clicks is per-fixture (Brighton, Manchester) skip the
  // `PER_FIXTURE_CANDIDATE_COLUMNS` set so the allocator's split
  // survives.
  const alwaysPayload: Record<string, null> = {};
  for (const col of ALWAYS_CAMPAIGN_WIDE_COLUMNS) alwaysPayload[col] = null;
  const fullPayload: Record<string, null> = { ...alwaysPayload };
  for (const col of PER_FIXTURE_CANDIDATE_COLUMNS) {
    fullPayload[col] = null;
  }

  async function applyNullsBatch(targets: NullTarget[]): Promise<number> {
    if (targets.length === 0) return 0;
    const byBucket = new Map<string, { columnSet: ColumnSet; ids: string[] }>();
    for (const t of targets) {
      const k = `${t.columnSet}\u0000${t.date}`;
      const bucket = byBucket.get(k) ?? { columnSet: t.columnSet, ids: [] };
      bucket.ids.push(t.event_id);
      byBucket.set(k, bucket);
    }
    let updated = 0;
    for (const [k, bucket] of byBucket.entries()) {
      const date = k.slice(k.indexOf("\u0000") + 1);
      const payload =
        bucket.columnSet === "full" ? fullPayload : alwaysPayload;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error, count } = await (supabase as any)
        .from("event_daily_rollups")
        .update(payload, { count: "exact" })
        .eq("date", date)
        .in("event_id", bucket.ids);
      if (error) {
        summary.errors.push(
          `update date=${date} columnSet=${bucket.columnSet} ids=${bucket.ids.length}: ${error.message as string}`,
        );
        summary.ok = false;
        continue;
      }
      updated += (count as number | null) ?? bucket.ids.length;
    }
    return updated;
  }

  summary.fanout_rows_nulled = await applyNullsBatch(fanoutTargets);
  summary.jitter_rows_resolved = await applyNullsBatch(jitterTargets);

  return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
}
