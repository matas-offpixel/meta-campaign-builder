"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BenchmarkAlertRow } from "@/lib/db/benchmark-alerts";

function alertTitle(row: BenchmarkAlertRow): string {
  switch (row.alert_type) {
    case "creative_fatigue": return "Creative fatigue";
    case "creative_scaling": return "Scaling candidate";
    case "audience_outperform": return "Audience outperforming";
    case "audience_underperform":
      return row.entity_type === "creative_concept" ? "Creative CPA stress" : "Audience underperforming";
    case "campaign_stalled": return "Campaign stalled";
    case "campaign_breakout": return "Campaign breakout";
    default: return row.alert_type;
  }
}

function severityStyles(severity: string) {
  switch (severity) {
    case "critical":
      return { bar: "border-l-red-600 dark:border-l-red-500", badge: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" };
    case "warning":
      return { bar: "border-l-amber-600 dark:border-l-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" };
    default:
      return { bar: "border-l-sky-600 dark:border-l-sky-500", badge: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" };
  }
}

function metricSummary(row: BenchmarkAlertRow): string {
  const parts: string[] = [];
  if (row.entity_name) parts.push(row.entity_name);
  if (row.metric && row.metric_value != null) {
    const mv = Number(row.metric_value);
    const formatted = Number.isFinite(mv) ? (mv >= 100 ? mv.toFixed(0) : mv.toFixed(2)) : String(row.metric_value);
    parts.push(`${row.metric.toUpperCase()} ${formatted}`);
  }
  if (row.benchmark_value != null && row.metric) {
    const bv = Number(row.benchmark_value);
    const bf = Number.isFinite(bv) ? (bv >= 100 ? bv.toFixed(0) : bv.toFixed(2)) : String(row.benchmark_value);
    parts.push(`median ${bf}`);
  }
  return parts.join(" · ") || "Benchmark deviation";
}

export function BenchmarkAlertsWidget() {
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<BenchmarkAlertRow[]>([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/benchmark-alerts?limit=5", { credentials: "same-origin" });
      const json = (await res.json()) as { ok?: boolean; alerts?: BenchmarkAlertRow[] };
      setAlerts(json.ok && json.alerts ? json.alerts : []);
    } catch { setAlerts([]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patchAction(id: string, action: "acknowledge" | "dismiss") {
    try {
      const res = await fetch(`/api/dashboard/benchmark-alerts/${id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch { /* noop */ }
  }

  if (loading) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 font-heading text-base tracking-wide">
          <Bell className="h-3.5 w-3.5" /> Alerts
        </div>
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }
  if (alerts.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-base tracking-wide">
          <Bell className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5" />
          Alerts
          <span className="ml-2 text-xs font-normal text-muted-foreground">{alerts.length}</span>
        </h2>
      </div>
      <p className="text-xs text-muted-foreground">Benchmark signals from last night&apos;s account sweep (Meta).</p>
      <div className="space-y-2">
        {alerts.map((row) => {
          const ss = severityStyles(row.severity);
          const href = row.event_id != null ? `/events/${row.event_id}` : `/clients/${row.client_id}`;
          return (
            <div key={row.id} className={`rounded-md border border-border bg-card border-l-4 pl-3 pr-3 py-3 ${ss.bar}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ss.badge}`}>{row.severity}</span>
                    <span className="text-sm font-medium text-foreground">{alertTitle(row)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{metricSummary(row)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => patchAction(row.id, "acknowledge")}>Acknowledge</Button>
                  <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => patchAction(row.id, "dismiss")}>Dismiss</Button>
                  <Link href={href} className="inline-flex h-8 items-center justify-center rounded-md bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-card">
                    Open event<ExternalLink className="ml-1 h-3 w-3" />
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
