/**
 * POST /api/admin/rollup-pre-pr395-backfill
 *
 * One-shot admin backfill for the pre-PR-#395 data bug.
 *
 * Background:
 *   Before PR #395 merged (~2026-05-08), the 4theFans / foursomething rollup
 *   runner wrote the provider's *cumulative* lifetime total into
 *   `event_daily_rollups.tickets_sold` instead of the daily delta.  PR #395
 *   fixed the forward path, but did not backfill existing rows.
 *
 *   Symptom: a row like 2026-05-07 tickets_sold=242 followed by 2026-05-08
 *   tickets_sold=4 (LAG delta = -238) — the 242 is the lifetime cumulative,
 *   not a one-day count.  Trend charts show a phantom spike a week ago.
 *
 * What this route does:
 *   1. Finds every event that has BOTH:
 *      - at least one `ticket_sales_snapshots` row with source IN
 *        ('fourthefans', 'foursomething')
 *      - at least one `event_daily_rollups` row with date < '2026-05-08'
 *   2. For each event, fetches all its snapshots up to 2026-05-07 (inclusive)
 *      using the multi-link-aware `aggregateMultiLinkSnapshots` function
 *      (SUM across external_event_id links before diffing).
 *   3. Reconstructs daily deltas via `reconstructFourthefansRollupDeltas`,
 *      passing an empty existing-rollups list so NO dates are "protected" —
 *      every pre-PR-395 row must be corrected regardless of its current value.
 *   4. UPDATEs `tickets_sold` and `revenue` for each (event_id, date) row,
 *      capturing before/after for the audit log.
 *   5. Returns { rows_updated, events_affected, drift_per_event } so operators
 *      can verify the fix before and after in prod.
 *
 * Auth: Bearer <CRON_SECRET>.  Never touches a user session.
 *
 * Dry-run: pass `{ "dry_run": true }` to preview without writing.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  reconstructFourthefansRollupDeltas,
  aggregateMultiLinkSnapshots,
  type FourthefansRawSnapshotForBackfill,
  type FourthefansBackfillRow,
} from "@/lib/ticketing/fourthefans-rollup-backfill";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Inclusive cutoff for "pre-PR-395 era" rows. */
const PRE_PR395_CUTOFF = "2026-05-08";

interface RequestBody {
  dry_run?: unknown;
  /** Optional: restrict backfill to a single event_id for targeted ops. */
  event_id?: unknown;
}

interface DriftRow {
  date: string;
  before_tickets: number | null;
  after_tickets: number;
  before_revenue: number | null;
  after_revenue: number | null;
}

interface EventDriftSummary {
  event_id: string;
  dates_updated: number;
  max_ticket_drift: number;
  rows: DriftRow[];
  error?: string;
}

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    // empty body is fine — defaults apply
  }
  const dryRun = body.dry_run === true;
  const targetEventId =
    typeof body.event_id === "string" && body.event_id.trim()
      ? body.event_id.trim()
      : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  // ── 1. Find events in scope ─────────────────────────────────────────────
  //
  // Candidate events: those with any ticket_sales_snapshots from a
  // fourthefans/foursomething provider AND at least one event_daily_rollups
  // row before the PR-395 cutoff.
  const snapshotQuery = admin
    .from("ticket_sales_snapshots")
    .select("event_id")
    .in("source", ["fourthefans", "foursomething"]);
  if (targetEventId) {
    snapshotQuery.eq("event_id", targetEventId);
  }
  const { data: snapshotEventRows, error: snapshotEventErr } = await snapshotQuery;
  if (snapshotEventErr) {
    return NextResponse.json(
      { ok: false, error: snapshotEventErr.message },
      { status: 500 },
    );
  }
  const candidateEventIds = [
    ...new Set(
      (snapshotEventRows ?? []).map(
        (r: { event_id: string }) => r.event_id,
      ),
    ),
  ] as string[];

  if (candidateEventIds.length === 0) {
    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      rows_updated: 0,
      events_affected: 0,
      drift_per_event: [],
    });
  }

  // Filter to only events that actually have pre-cutoff rollup rows.
  const { data: rollupEventRows, error: rollupEventErr } = await admin
    .from("event_daily_rollups")
    .select("event_id")
    .in("event_id", candidateEventIds)
    .lt("date", PRE_PR395_CUTOFF);
  if (rollupEventErr) {
    return NextResponse.json(
      { ok: false, error: rollupEventErr.message },
      { status: 500 },
    );
  }
  const affectedEventIds = [
    ...new Set(
      (rollupEventRows ?? []).map((r: { event_id: string }) => r.event_id),
    ),
  ] as string[];

  if (affectedEventIds.length === 0) {
    return NextResponse.json({
      ok: true,
      dry_run: dryRun,
      rows_updated: 0,
      events_affected: 0,
      drift_per_event: [],
    });
  }

  // ── 2–4. Per-event: reconstruct deltas → diff → update ─────────────────
  const driftPerEvent: EventDriftSummary[] = [];
  let totalRowsUpdated = 0;

  for (const eventId of affectedEventIds) {
    try {
      // 2a. Fetch raw per-link snapshots for this event, all dates.
      const { data: rawSnaps, error: rawSnapErr } = await admin
        .from("ticket_sales_snapshots")
        .select(
          "event_id, user_id, connection_id, external_event_id, snapshot_at, tickets_sold, gross_revenue_cents",
        )
        .eq("event_id", eventId)
        .in("source", ["fourthefans", "foursomething"])
        .order("snapshot_at", { ascending: true });
      if (rawSnapErr) {
        driftPerEvent.push({
          event_id: eventId,
          dates_updated: 0,
          max_ticket_drift: 0,
          rows: [],
          error: rawSnapErr.message,
        });
        continue;
      }

      // 2b. Aggregate multi-link snapshots into per-(event, date) totals.
      const aggregated = aggregateMultiLinkSnapshots(
        (rawSnaps ?? []) as FourthefansRawSnapshotForBackfill[],
      );

      // 2c. Reconstruct daily deltas — pass empty existing so NO date is
      // protected (all pre-PR-395 rows need correction).
      const allDeltas: FourthefansBackfillRow[] =
        reconstructFourthefansRollupDeltas(aggregated, []);

      // 2d. Only touch rows in the pre-PR-395 window.
      const deltasToApply = allDeltas.filter((r) => r.date < PRE_PR395_CUTOFF);

      if (deltasToApply.length === 0) {
        continue;
      }

      // 3. Fetch current (before) values for audit.
      const { data: beforeRows, error: beforeErr } = await admin
        .from("event_daily_rollups")
        .select("date, tickets_sold, revenue")
        .eq("event_id", eventId)
        .lt("date", PRE_PR395_CUTOFF);
      if (beforeErr) {
        driftPerEvent.push({
          event_id: eventId,
          dates_updated: 0,
          max_ticket_drift: 0,
          rows: [],
          error: beforeErr.message,
        });
        continue;
      }
      const beforeByDate = new Map<string, { date: string; tickets_sold: number | null; revenue: number | null }>(
        (beforeRows ?? []).map(
          (r: { date: string; tickets_sold: number | null; revenue: number | null }) => [
            r.date,
            r,
          ],
        ),
      );

      // Build drift rows for audit.
      const driftRows: DriftRow[] = deltasToApply.map((delta) => {
        const before = beforeByDate.get(delta.date);
        return {
          date: delta.date,
          before_tickets: before?.tickets_sold ?? null,
          after_tickets: delta.tickets_sold,
          before_revenue: before?.revenue ?? null,
          after_revenue: delta.revenue,
        };
      });

      const maxTicketDrift = driftRows.reduce((max, r) => {
        const drift = Math.abs((r.before_tickets ?? 0) - r.after_tickets);
        return Math.max(max, drift);
      }, 0);

      // 4. Write back (unless dry-run).
      if (!dryRun) {
        const now = new Date().toISOString();
        const { error: upsertErr } = await admin
          .from("event_daily_rollups")
          .upsert(
            deltasToApply.map((row) => ({
              user_id: row.user_id,
              event_id: row.event_id,
              date: row.date,
              tickets_sold: row.tickets_sold,
              revenue: row.revenue,
              source_eventbrite_at: now,
            })),
            { onConflict: "event_id,date" },
          );
        if (upsertErr) {
          driftPerEvent.push({
            event_id: eventId,
            dates_updated: 0,
            max_ticket_drift: maxTicketDrift,
            rows: driftRows,
            error: upsertErr.message,
          });
          continue;
        }
        totalRowsUpdated += deltasToApply.length;
        console.info(
          `[rollup-pre-pr395-backfill] event_id=${eventId} rows_updated=${deltasToApply.length} max_ticket_drift=${maxTicketDrift}`,
        );
      }

      driftPerEvent.push({
        event_id: eventId,
        dates_updated: dryRun ? 0 : deltasToApply.length,
        max_ticket_drift: maxTicketDrift,
        rows: driftRows,
      });
    } catch (err) {
      driftPerEvent.push({
        event_id: eventId,
        dates_updated: 0,
        max_ticket_drift: 0,
        rows: [],
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const failed = driftPerEvent.filter((r) => r.error);
  return NextResponse.json(
    {
      ok: failed.length === 0,
      dry_run: dryRun,
      rows_updated: dryRun
        ? driftPerEvent.reduce((s, r) => s + r.rows.length, 0)
        : totalRowsUpdated,
      events_affected: driftPerEvent.filter((r) => r.rows.length > 0).length,
      drift_per_event: driftPerEvent,
    },
    { status: failed.length === 0 ? 200 : 207 },
  );
}
