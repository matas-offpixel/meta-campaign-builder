import type { CrmConnectionSummary } from "@/lib/db/crm-connections";

/**
 * components/admin/crm-status-panel.tsx — shared status strip for the
 * Bird + Mailchimp integration pages (OP909 Phase 8). Server component.
 *
 * Live sending is intentionally read-only here: the 3-of-3 gate
 * (FEATURE_D2C_LIVE env + live_enabled + approved_by_matas) is toggled
 * by Off/Pixel, never by the client.
 */
export function CrmStatusPanel({
  summary,
}: {
  summary: CrmConnectionSummary | null;
}) {
  return (
    <div className="mt-6 rounded-md border border-border bg-card p-4">
      <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-1">
            {!summary ? (
              <Badge tone="gray">not set up</Badge>
            ) : summary.status === "error" ? (
              <Badge tone="red">error</Badge>
            ) : summary.config.apiKeyConfigured ? (
              <Badge tone="green">configured</Badge>
            ) : (
              <Badge tone="amber">incomplete</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last tested</dt>
          <dd className="mt-1 font-medium">
            {summary?.lastSyncedAt ? formatWhen(summary.lastSyncedAt) : "never"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Live sending</dt>
          <dd className="mt-1">
            {summary?.liveEnabled && summary?.approvedByMatas ? (
              <Badge tone="green">enabled</Badge>
            ) : (
              <Badge tone="gray">off — enabled by Off/Pixel</Badge>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Approval</dt>
          <dd className="mt-1">
            {summary?.approvedByMatas ? (
              <Badge tone="green">approved</Badge>
            ) : (
              <Badge tone="gray">pending review</Badge>
            )}
          </dd>
        </div>
      </dl>
      {summary?.status === "error" && summary.lastError && (
        <p className="mt-3 border-t border-border pt-3 text-xs text-destructive">
          Last error: {summary.lastError}
        </p>
      )}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "amber" | "red" | "gray";
  children: React.ReactNode;
}) {
  const cls = {
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800",
    gray: "bg-gray-100 text-gray-600",
  }[tone];
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  }).format(date);
}
