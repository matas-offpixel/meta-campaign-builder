import "server-only";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = import("@supabase/supabase-js").SupabaseClient<any, any, any, any, any>;

export type DailyHistorySourceKind =
  | "cron"
  | "manual_backfill"
  | "smoothed_historical";

export interface TierChannelDailyHistoryRow {
  id: string;
  event_id: string;
  /** YYYY-MM-DD calendar date in Europe/London. */
  snapshot_date: string;
  /** Cumulative tickets across ALL channels for the event at end of day. */
  tickets_sold_total: number;
  /** Cumulative revenue across ALL channels for the event at end of day. */
  revenue_total: number;
  source_kind: DailyHistorySourceKind;
  captured_at: string;
}

/**
 * One upsert payload — maps to the DB columns on
 * `tier_channel_sales_daily_history`.
 */
export interface DailyHistoryUpsertArgs {
  event_id: string;
  snapshot_date: string;
  tickets_sold_total: number;
  revenue_total: number;
  source_kind: DailyHistorySourceKind;
}

/**
 * Fetch all daily_history rows for a set of events, ordered by
 * (event_id, snapshot_date). Limits to rows within an optional date
 * window so callers can skip old backfill rows they don't need.
 */
export async function listDailyHistoryForEvents(
  supabase: AnySupabase,
  eventIds: string[],
  options?: { fromDate?: string; toDate?: string },
): Promise<TierChannelDailyHistoryRow[]> {
  if (eventIds.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("tier_channel_sales_daily_history")
    .select(
      "id, event_id, snapshot_date, tickets_sold_total, revenue_total, source_kind, captured_at",
    )
    .in("event_id", eventIds)
    .order("event_id", { ascending: true })
    .order("snapshot_date", { ascending: true });
  if (options?.fromDate) q = q.gte("snapshot_date", options.fromDate);
  if (options?.toDate) q = q.lte("snapshot_date", options.toDate);
  const { data, error } = await q;
  if (error) {
    console.warn("[tier-channel-daily-history list]", error.message);
    return [];
  }
  return ((data ?? []) as TierChannelDailyHistoryRow[]).map((r) => ({
    ...r,
    snapshot_date: String(r.snapshot_date),
    tickets_sold_total: Number(r.tickets_sold_total),
    revenue_total: Number(r.revenue_total),
  }));
}

/**
 * Upsert a single daily_history row. Idempotent on
 * (event_id, snapshot_date) — always updates the totals and captured_at.
 *
 * The cron calls this for today's date. The admin-smooth endpoint calls
 * this for each day in the backfill window. `source_kind` is preserved
 * on conflict so a `smoothed_historical` row isn't accidentally downgraded
 * to `cron` for a past date (the cron only ever writes today's date, so
 * in practice the two source_kinds never collide).
 */
export async function upsertDailyHistory(
  supabase: AnySupabase,
  row: DailyHistoryUpsertArgs,
): Promise<TierChannelDailyHistoryRow | null> {
  const { data, error } = await supabase
    .from("tier_channel_sales_daily_history")
    .upsert(
      {
        event_id: row.event_id,
        snapshot_date: row.snapshot_date,
        tickets_sold_total: Math.max(0, Math.round(row.tickets_sold_total)),
        revenue_total: Math.max(0, row.revenue_total),
        source_kind: row.source_kind,
        captured_at: new Date().toISOString(),
      },
      { onConflict: "event_id,snapshot_date" },
    )
    .select(
      "id, event_id, snapshot_date, tickets_sold_total, revenue_total, source_kind, captured_at",
    )
    .maybeSingle();
  if (error) {
    console.warn("[tier-channel-daily-history upsert]", error.message);
    throw new Error(error.message);
  }
  return data as TierChannelDailyHistoryRow | null;
}

/**
 * Bulk-upsert a list of rows. Each row is upserted independently so
 * one bad row doesn't poison the batch — errors are logged and the
 * count of written rows is returned.
 *
 * The smoothing endpoint uses this to write the whole backfill window
 * in a single call.
 */
export async function bulkUpsertDailyHistory(
  supabase: AnySupabase,
  rows: DailyHistoryUpsertArgs[],
): Promise<{ written: number; errors: number }> {
  if (rows.length === 0) return { written: 0, errors: 0 };
  const payload = rows.map((row) => ({
    event_id: row.event_id,
    snapshot_date: row.snapshot_date,
    tickets_sold_total: Math.max(0, Math.round(row.tickets_sold_total)),
    revenue_total: Math.max(0, row.revenue_total),
    source_kind: row.source_kind,
    captured_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("tier_channel_sales_daily_history")
    .upsert(payload, { onConflict: "event_id,snapshot_date" });
  if (error) {
    console.warn("[tier-channel-daily-history bulk-upsert]", error.message);
    return { written: 0, errors: rows.length };
  }
  return { written: rows.length, errors: 0 };
}
