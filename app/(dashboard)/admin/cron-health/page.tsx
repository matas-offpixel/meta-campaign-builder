import { redirect } from "next/navigation";

import { CronHealthRefreshButton } from "@/components/admin/cron-health-refresh-button";
import { createClient } from "@/lib/supabase/server";
import type { CronHealthStatus } from "@/lib/reporting/cron-health-monitor";

/**
 * /admin/cron-health — operator view of the cron silent-failure monitor.
 *
 * Reads the latest `cron_health_reports` row (written by the every-30-minute
 * cron and the manual "Refresh now" button) and renders per-table freshness
 * with a status badge. No report yet → empty-state + manual trigger.
 *
 * Auth: cookie-bound Supabase session, same gate as the other /admin pages.
 */

export const dynamic = "force-dynamic";

interface ReportTableRow {
  name: string;
  last_refreshed_at: string | null;
  age_minutes: number | null;
  threshold_minutes: number;
  status: CronHealthStatus;
}

interface ReportRow {
  generated_at: string;
  any_stale: boolean;
  report_jsonb: { tables?: ReportTableRow[] } | null;
}

const STATUS_STYLES: Record<CronHealthStatus, string> = {
  fresh: "bg-green-100 text-green-800",
  stale: "bg-amber-100 text-amber-800",
  missing: "bg-red-100 text-red-800",
};

function formatAge(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  // Deterministic UTC render (server component → avoid locale/tz drift).
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function CronHealthPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS allows any authenticated user to read this table (operator dashboard).
  const { data } = await supabase
    .from("cron_health_reports")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("generated_at, any_stale, report_jsonb" as any)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const report = (data ?? null) as ReportRow | null;
  const tables = report?.report_jsonb?.tables ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cron health</h1>
          <p className="text-sm text-muted-foreground">
            Freshness of cron-managed snapshot &amp; rollup tables. Stale rows
            mean a cron silently stopped writing.
          </p>
        </div>
        <CronHealthRefreshButton />
      </div>

      {!report ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No reports yet — the monitor hasn&apos;t run. Use{" "}
            <span className="font-medium">Refresh now</span> to generate the
            first report.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">
              Report generated {formatTimestamp(report.generated_at)}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                report.any_stale
                  ? "bg-amber-100 text-amber-800"
                  : "bg-green-100 text-green-800"
              }`}
            >
              {report.any_stale ? "Attention needed" : "All fresh"}
            </span>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Table</th>
                  <th className="px-4 py-2.5 font-medium">Last write</th>
                  <th className="px-4 py-2.5 font-medium">Age</th>
                  <th className="px-4 py-2.5 font-medium">Threshold</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {tables.map((t) => (
                  <tr key={t.name}>
                    <td className="px-4 py-2.5 font-mono text-xs">{t.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatTimestamp(t.last_refreshed_at)}
                    </td>
                    <td className="px-4 py-2.5">{formatAge(t.age_minutes)}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {formatAge(t.threshold_minutes)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[t.status]
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}
