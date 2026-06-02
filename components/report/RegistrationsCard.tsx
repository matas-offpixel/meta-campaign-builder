"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import type { MailchimpRegistrationsData } from "@/lib/mailchimp/registrations-loader";

interface Props extends MailchimpRegistrationsData {
  /** Total paid media spent (same window as PAID MEDIA card). Used for CPR. */
  paidMediaSpent: number;
  /**
   * When true (a specific platform is active in the global filter), show
   * a small "All sources" footnote since registrations are not per-platform.
   */
  allSourcesCaption?: boolean;
  /**
   * When provided, a Refresh button is rendered (internal dashboard only).
   * Calling this triggers a re-sync of the Mailchimp audience data.
   */
  onRefreshRegistrations?: () => Promise<void>;
}

function fmtTotal(n: number): string {
  return n.toLocaleString("en-GB");
}

function fmtCpr(spent: number, total: number): string | null {
  if (total <= 0 || spent <= 0) return null;
  const cpr = spent / total;
  return `£${cpr.toFixed(2)} cost per reg`;
}

/**
 * Relative time from an ISO string — "2 hours ago", "3 days ago", etc.
 * Passed `nowMs` explicitly so callers can provide a stable value from state.
 */
function relativeTime(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const diff = nowMs - new Date(iso).getTime();
  const hours = diff / 3_600_000;
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const STALE_MS = 48 * 3_600_000;

/**
 * REGISTRATIONS summary card — rendered in the Campaign Performance
 * header strip for `brand_campaign` events.
 *
 * Mirrors the TICKETS card layout: large primary value = TOTAL
 * Mailchimp subscribers (not delta vs baseline). CPR = paid spend
 * ÷ total subscribers.
 */
export function RegistrationsCard({
  totalSubscribers,
  paidMediaSpent,
  lastSyncedAt,
  hasAudience,
  mailchimpAccountConnected,
  allSourcesCaption = false,
  onRefreshRegistrations,
}: Props) {
  // Stable mount-time clock — avoids `Date.now()` in render (impure).
  const [nowMs] = useState(() => Date.now());

  // Hydration: isStale and relSync start false/null and update after
  // mount so server and client renders stay in sync.
  const [isStale, setIsStale] = useState(false);
  const [relSync, setRelSync] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    if (!lastSyncedAt) return;
    const diff = nowMs - new Date(lastSyncedAt).getTime();
    setIsStale(diff > STALE_MS);
    setRelSync(relativeTime(lastSyncedAt, nowMs));
  }, [lastSyncedAt, nowMs]);

  const handleRefresh = useCallback(async () => {
    if (!onRefreshRegistrations || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      await onRefreshRegistrations();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshRegistrations, isRefreshing]);

  const hasTotal = totalSubscribers != null && totalSubscribers > 0;

  const cprLine = hasTotal
    ? fmtCpr(paidMediaSpent, totalSubscribers!)
    : null;

  const refreshDisabled = !mailchimpAccountConnected;
  const refreshTooltip = refreshDisabled
    ? "Connect Mailchimp at /settings/mailchimp to enable refresh"
    : isRefreshing
      ? "Refreshing…"
      : "Refresh Mailchimp data";

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Registrations
        </p>
        {onRefreshRegistrations != null ? (
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshDisabled || isRefreshing}
            title={refreshTooltip}
            aria-label={refreshTooltip}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RefreshCw
              className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>
        ) : null}
      </div>
      <div
        className="mt-3 space-y-2 text-foreground"
        title="Total Mailchimp subscribers on the linked audience. Cost per registration = paid media spent ÷ total subscribers."
      >
        {!hasAudience ? (
          <>
            <p className="font-heading text-xl tracking-wide text-muted-foreground">
              —
            </p>
            <p className="text-[11px] text-muted-foreground">
              Mailchimp not linked
            </p>
          </>
        ) : !hasTotal && totalSubscribers == null ? (
          <>
            <p className="font-heading text-xl tracking-wide text-muted-foreground">
              —
            </p>
            <p className="text-[11px] text-muted-foreground">
              Mailchimp not synced yet — run Backfill history or wait for the daily cron
            </p>
          </>
        ) : (
          <>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {hasTotal ? (
                fmtTotal(totalSubscribers!)
              ) : (
                <span>
                  {totalSubscribers != null ? "0" : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              )}
            </p>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {cprLine ? (
                <span className="text-sm font-normal">
                  {cprLine}
                </span>
              ) : (
                <span className="text-sm font-normal text-muted-foreground">
                  {totalSubscribers != null && totalSubscribers <= 0
                    ? "— awaiting growth"
                    : "—"}
                </span>
              )}
            </p>
          </>
        )}
        {isStale && relSync ? (
          <p className="text-[11px] text-amber-500 dark:text-amber-400">
            Last synced {relSync}
          </p>
        ) : null}
        {refreshError ? (
          <p className="text-[11px] text-red-500">{refreshError}</p>
        ) : null}
        {allSourcesCaption && hasAudience ? (
          <p className="text-[11px] text-muted-foreground">All sources</p>
        ) : null}
      </div>
    </div>
  );
}
