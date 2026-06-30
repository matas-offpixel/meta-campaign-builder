import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * lib/reporting/cron-health-monitor.ts
 *
 * Cron silent-failure monitor. Samples the most-recent write timestamp of
 * each snapshot/rollup table that a cron is supposed to keep warm and flags
 * any whose freshest row is older than its expected cadence. Surfaces the
 * "the cron 401'd / timed out / silently no-op'd for days and nobody noticed"
 * class of failure (the exact shape that bit creative-insights + ticketing
 * sync historically).
 *
 * Read-only on existing infrastructure — it only does `MAX(freshColumn)`
 * reads. No external integrations (Slack/email deferred).
 *
 * No `import "server-only"`: reached only from the cron + admin route
 * handlers; omitting it keeps the module raw-Node importable, same rationale
 * as the other lib/reporting helpers.
 *
 * Column choices verified against the live schema 2026-06-30 (several drifted
 * from the original spec — most snapshot tables expose `fetched_at`, not
 * `refreshed_at`; `event_daily_rollups` has `updated_at`, no `last_synced_at`):
 *   active_creatives_snapshots        → fetched_at
 *   tiktok_active_creatives_snapshots → fetched_at
 *   client_portal_snapshots           → refreshed_at
 *   event_daily_rollups               → updated_at
 *   audience_source_cache             → fetched_at
 *   share_insight_snapshots           → fetched_at   (NB: traffic-driven, not cron-driven)
 *   tiktok_breakdown_snapshots        → fetched_at
 *   mailchimp_tag_snapshots           → snapshot_at
 */

export type CronHealthStatus = "fresh" | "stale" | "missing";

export interface TableStatus {
  name: string;
  lastRefreshedAt: string | null;
  ageMinutes: number | null;
  thresholdMinutes: number;
  status: CronHealthStatus;
}

interface TableConfigEntry {
  table: string;
  freshColumn: string;
  thresholdMinutes: number;
}

/**
 * The monitored set. `thresholdMinutes` = expected cron cadence + grace.
 * Order is purely cosmetic (drives the dashboard table order).
 */
const TABLE_CONFIG: readonly TableConfigEntry[] = [
  { table: "client_portal_snapshots", freshColumn: "refreshed_at", thresholdMinutes: 30 },
  { table: "event_daily_rollups", freshColumn: "updated_at", thresholdMinutes: 360 },
  { table: "active_creatives_snapshots", freshColumn: "fetched_at", thresholdMinutes: 720 },
  { table: "tiktok_active_creatives_snapshots", freshColumn: "fetched_at", thresholdMinutes: 720 },
  { table: "tiktok_breakdown_snapshots", freshColumn: "fetched_at", thresholdMinutes: 720 },
  { table: "share_insight_snapshots", freshColumn: "fetched_at", thresholdMinutes: 360 },
  { table: "audience_source_cache", freshColumn: "fetched_at", thresholdMinutes: 1440 },
  { table: "mailchimp_tag_snapshots", freshColumn: "snapshot_at", thresholdMinutes: 1440 },
];

/**
 * Sample every monitored table's freshest write and classify it. Tables are
 * queried SEQUENTIALLY (never Promise.all) to stay within the Nano Supabase
 * memory/connection budget — same burstable-cascade discipline as the other
 * cron runners.
 *
 * `anyStale` is true when ANY table is not fresh (stale OR missing) — the
 * useful "something needs attention" alert flag, stored denormalised on
 * `cron_health_reports.any_stale`.
 */
export async function runCronHealthCheck(): Promise<{
  tables: TableStatus[];
  anyStale: boolean;
}> {
  const admin = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as unknown as any;
  const now = Date.now();
  const tables: TableStatus[] = [];

  for (const cfg of TABLE_CONFIG) {
    let lastRefreshedAt: string | null = null;
    let ageMinutes: number | null = null;
    let status: CronHealthStatus = "missing";

    try {
      // Freshest row = MAX(freshColumn). Expressed as order-desc-limit-1 so we
      // avoid an aggregate RPC; NULLs are filtered so a table with rows but a
      // null timestamp doesn't masquerade as fresh.
      const { data, error } = await sb
        .from(cfg.table)
        .select(cfg.freshColumn)
        .not(cfg.freshColumn, "is", null)
        .order(cfg.freshColumn, { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error(
          `[cron-health] table=${cfg.table} column=${cfg.freshColumn} query_failed msg=${error.message}`,
        );
      } else if (data && data[cfg.freshColumn]) {
        lastRefreshedAt = String(data[cfg.freshColumn]);
        const ts = new Date(lastRefreshedAt).getTime();
        if (Number.isFinite(ts)) {
          ageMinutes = Math.floor((now - ts) / 60_000);
          status = ageMinutes <= cfg.thresholdMinutes ? "fresh" : "stale";
        } else {
          console.error(
            `[cron-health] table=${cfg.table} column=${cfg.freshColumn} unparseable_timestamp value=${lastRefreshedAt}`,
          );
          lastRefreshedAt = null;
        }
      }
      // data == null → no rows → status stays "missing".
    } catch (err) {
      console.error(
        `[cron-health] table=${cfg.table} column=${cfg.freshColumn} threw msg=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (status === "stale") {
      console.error(
        `[cron-health] STALE table=${cfg.table} age_min=${ageMinutes} threshold_min=${cfg.thresholdMinutes}`,
      );
    } else if (status === "missing") {
      console.error(
        `[cron-health] MISSING table=${cfg.table} (no rows / query failed)`,
      );
    }

    tables.push({
      name: cfg.table,
      lastRefreshedAt,
      ageMinutes,
      thresholdMinutes: cfg.thresholdMinutes,
      status,
    });
  }

  const anyStale = tables.some((t) => t.status !== "fresh");
  return { tables, anyStale };
}

/**
 * Persist a health report. Service-role only (throws if the key is missing).
 * Best-effort caller contract: the report is the product, so we surface write
 * failures to the caller (cron/admin route) rather than swallowing them.
 */
export async function writeCronHealthReport(report: {
  tables: TableStatus[];
  anyStale: boolean;
}): Promise<void> {
  const admin = createServiceRoleClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as unknown as any;
  const { error } = await sb.from("cron_health_reports").insert({
    report_jsonb: {
      tables: report.tables.map((t) => ({
        name: t.name,
        last_refreshed_at: t.lastRefreshedAt,
        age_minutes: t.ageMinutes,
        threshold_minutes: t.thresholdMinutes,
        status: t.status,
      })),
    },
    any_stale: report.anyStale,
  });
  if (error) {
    throw new Error(`writeCronHealthReport: insert failed: ${error.message}`);
  }
}
