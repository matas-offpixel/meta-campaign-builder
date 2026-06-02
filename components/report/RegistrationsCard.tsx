"use client";

import { useState, useEffect } from "react";
import type { MailchimpRegistrationsData } from "@/lib/mailchimp/registrations-loader";

interface Props extends MailchimpRegistrationsData {
  /** Total paid media spent (same window as PAID MEDIA card). Used for CPR. */
  paidMediaSpent: number;
}

function fmtPlus(n: number): string {
  return `+${n.toLocaleString("en-GB")}`;
}

function fmtCpr(spent: number, newRegs: number): string | null {
  if (newRegs <= 0 || spent <= 0) return null;
  const cpr = spent / newRegs;
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
 * Mirrors the TICKETS card layout: title, large primary value,
 * secondary "cost per reg" line, optional stale warning caption.
 */
export function RegistrationsCard({
  newSinceBaseline,
  paidMediaSpent,
  lastSyncedAt,
  hasAudience,
}: Props) {
  // Stable mount-time clock — avoids `Date.now()` in render (impure).
  const [nowMs] = useState(() => Date.now());

  // Hydration: isStale and relSync start false/null and update after
  // mount so server and client renders stay in sync.
  const [isStale, setIsStale] = useState(false);
  const [relSync, setRelSync] = useState<string | null>(null);

  useEffect(() => {
    if (!lastSyncedAt) return;
    const diff = nowMs - new Date(lastSyncedAt).getTime();
    setIsStale(diff > STALE_MS);
    setRelSync(relativeTime(lastSyncedAt, nowMs));
  }, [lastSyncedAt, nowMs]);

  const hasGrowth =
    newSinceBaseline != null && newSinceBaseline > 0;

  const cprLine = hasGrowth
    ? fmtCpr(paidMediaSpent, newSinceBaseline!)
    : null;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Registrations
      </p>
      <div
        className="mt-3 space-y-2 text-foreground"
        title="New Mailchimp subscribers since launch baseline. Cost per registration = paid media spent ÷ new registrations."
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
        ) : (
          <>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {hasGrowth ? (
                fmtPlus(newSinceBaseline!)
              ) : (
                <span>
                  {newSinceBaseline != null ? "0" : (
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
                  {newSinceBaseline != null && newSinceBaseline <= 0
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
      </div>
    </div>
  );
}

interface Props extends MailchimpRegistrationsData {
  /** Total paid media spent (same window as PAID MEDIA card). Used for CPR. */
  paidMediaSpent: number;
}

function fmtPlus(n: number): string {
  return `+${n.toLocaleString("en-GB")}`;
}

function fmtCpr(spent: number, newRegs: number): string | null {
  if (newRegs <= 0 || spent <= 0) return null;
  const cpr = spent / newRegs;
  return `£${cpr.toFixed(2)} cost per reg`;
}

/**
 * Relative time from an ISO string — "2 hours ago", "3 days ago", etc.
 * Returns null when `iso` is null.
 */
function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
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
 * Mirrors the TICKETS card layout: title, large primary value,
 * secondary "cost per reg" line, optional stale warning caption.
 */
export function RegistrationsCard({
  newSinceBaseline,
  paidMediaSpent,
  lastSyncedAt,
  hasAudience,
}: Props) {
  const isStale = useMemo(() => {
    if (!lastSyncedAt) return false;
    return Date.now() - new Date(lastSyncedAt).getTime() > STALE_MS;
  }, [lastSyncedAt]);

  const relSync = useMemo(() => relativeTime(lastSyncedAt), [lastSyncedAt]);

  const hasGrowth =
    newSinceBaseline != null && newSinceBaseline > 0;

  const cprLine = hasGrowth
    ? fmtCpr(paidMediaSpent, newSinceBaseline!)
    : null;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Registrations
      </p>
      <div
        className="mt-3 space-y-2 text-foreground"
        title="New Mailchimp subscribers since launch baseline. Cost per registration = paid media spent ÷ new registrations."
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
        ) : (
          <>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {hasGrowth ? (
                fmtPlus(newSinceBaseline!)
              ) : (
                <span>
                  {newSinceBaseline != null ? "0" : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              )}
            </p>
            <p className="font-heading text-xl tracking-wide tabular-nums">
              {cprLine ? (
                <>
                  <span className="text-sm font-normal">
                    {cprLine}
                  </span>
                </>
              ) : (
                <span className="text-sm font-normal text-muted-foreground">
                  {newSinceBaseline != null && newSinceBaseline <= 0
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
      </div>
    </div>
  );
}
