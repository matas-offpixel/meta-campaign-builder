import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordCronRun } from "@/lib/reporting/cron-run-log";
import { STATS_CRON_NAME, runD2CStatsIngest } from "./run";

/**
 * lib/d2c/stats-ingest/nightly.ts
 *
 * The nightly HE3 run, called from /api/cron/d2c-metrics-refresh in its
 * 04:00–04:14 UTC slot when ENABLE_D2C_STATS_INGEST === "1". Writes the
 * last 56 days of Bird and Mailchimp sends and records a `cron_runs` row
 * ("d2c-stats-ingest"). Never throws: the metrics refresh that hosts it
 * must still run. The returned summary has counts only — no names, no
 * keys.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

export interface NightlyStatsSummary {
  ok: boolean;
  written: number;
  rows: number;
  calls: number;
  sources: Array<{
    provider: string;
    accountId: string;
    rows: number;
    calls: number;
    byAttribution: Record<string, number>;
    notes: string[];
    error?: string;
  }>;
  skippedConnections: number;
  error?: string;
}

export async function runNightlyStatsIngest(admin: AnySupabaseClient): Promise<NightlyStatsSummary> {
  const startedAt = new Date().toISOString();
  try {
    const result = await runD2CStatsIngest(admin, { apply: true });
    const summary: NightlyStatsSummary = {
      ok: result.ok,
      written: result.written,
      rows: result.rows.length,
      calls: result.calls,
      sources: result.sources.map((s) => ({
        provider: s.provider,
        accountId: s.accountId,
        rows: s.rows,
        calls: s.calls,
        byAttribution: s.byAttribution,
        notes: s.notes,
        ...(s.error ? { error: s.error } : {}),
      })),
      skippedConnections: result.skippedConnections.length,
      ...(result.error ? { error: result.error } : {}),
    };
    await recordCronRun(admin, {
      cronName: STATS_CRON_NAME,
      startedAt,
      ok: result.ok,
      rowsWritten: result.written,
      rowsConsidered: result.rows.length,
      detail: {
        calls: result.calls,
        sources: summary.sources,
        skippedConnections: result.skippedConnections,
      },
      error: result.error ?? result.sources.find((s) => s.error)?.error ?? null,
    });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordCronRun(admin, {
      cronName: STATS_CRON_NAME,
      startedAt,
      ok: false,
      rowsWritten: 0,
      error: message.slice(0, 300),
    });
    return { ok: false, written: 0, rows: 0, calls: 0, sources: [], skippedConnections: 0, error: message.slice(0, 300) };
  }
}
