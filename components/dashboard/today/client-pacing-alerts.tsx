import Link from "next/link";

/**
 * components/dashboard/today/client-pacing-alerts.tsx
 *
 * "Client Pacing Alerts" section for the Today dashboard (Workstream B).
 * One condensed card per active client, status pill + top 2-3 issues.
 * Server-rendered from `loadClientPacingAlerts()`; the issue lines and
 * the card body deep-link into the relevant surfaces.
 *
 * Internal-only. No client-side data fetch.
 */

import { loadClientPacingAlerts } from "@/lib/dashboard/client-pacing-alerts-server";
import {
  clientInitials,
  type ClientPacingAlert,
  type PacingIssue,
} from "@/lib/dashboard/venue-pacing-summary";
import { toneColors } from "@/lib/dashboard/pacing-presentation";

const MAX_VISIBLE_ISSUES = 3;

export async function ClientPacingAlerts() {
  const alerts = await loadClientPacingAlerts();
  if (alerts.length === 0) return null;

  const anyIssues = alerts.some((a) => a.severity !== "ok");

  return (
    <section className="space-y-3" data-testid="today-client-pacing-alerts">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-lg tracking-wide">
          Client Pacing Alerts
        </h2>
        {!anyIssues ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
            🎯 All clients on track
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {alerts.map((alert) => (
          <AlertCard key={alert.clientId} alert={alert} />
        ))}
      </div>
    </section>
  );
}

function pillFor(severity: ClientPacingAlert["severity"]) {
  if (severity === "red") {
    return { tone: toneColors("below"), label: "Action needed" };
  }
  if (severity === "amber") {
    return { tone: toneColors("within"), label: "Review" };
  }
  return { tone: toneColors("above"), label: "On track" };
}

function AlertCard({ alert }: { alert: ClientPacingAlert }) {
  const pill = pillFor(alert.severity);
  const visible = alert.issues.slice(0, MAX_VISIBLE_ISSUES);
  const overflow = alert.issues.length - visible.length;

  return (
    <div className="relative rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Card-level link (covers the whole card; issue links sit above it). */}
      <Link
        href={alert.href}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Open ${alert.clientName} dashboard`}
      />
      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light text-xs font-semibold text-primary-foreground">
            {clientInitials(alert.clientName)}
          </span>
          <span className="font-medium">{alert.clientName}</span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${pill.tone.chipBg} ${pill.tone.chipText}`}
        >
          {pill.label}
        </span>
      </div>

      {visible.length > 0 ? (
        <ul className="relative z-10 mt-3 space-y-1.5">
          {visible.map((issue) => (
            <IssueLine key={issue.id} issue={issue} />
          ))}
          {overflow > 0 ? (
            <li className="text-[11px] text-muted-foreground">
              +{overflow} more
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="relative z-10 mt-3 text-xs text-muted-foreground">
          🟢 All active venues pacing on or above benchmark.
        </p>
      )}
    </div>
  );
}

function IssueLine({ issue }: { issue: PacingIssue }) {
  const emoji = issue.severity === "red" ? "🔴" : "🟠";
  return (
    <li className="text-xs leading-snug">
      <Link
        href={issue.href}
        className="relative z-10 inline-flex items-start gap-1.5 rounded hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden>{emoji}</span>
        <span>{issue.message}</span>
      </Link>
    </li>
  );
}
