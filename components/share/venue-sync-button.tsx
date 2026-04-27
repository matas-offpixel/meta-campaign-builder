"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

/**
 * Per-venue Sync Now button rendered on the internal dashboard
 * surface (`/clients/[id]/dashboard`). Triggers a parallel
 * `rollup-sync` for every event in the venue group so the operator
 * doesn't have to click into each event page.
 *
 * Why internal-only:
 *   The public share-token route (`/api/ticketing/rollup-sync/by-share-token/[token]`)
 *   is event-scoped — a client-portal share token can't fan out to
 *   a venue's child events. Triggering sync over n events at once
 *   requires the session-authenticated route; external viewers
 *   don't have access to it. The parent gates this button behind
 *   `isInternal` so external portals don't render a dead UI.
 *
 * Refresh strategy:
 *   After the parallel POSTs resolve we call `router.refresh()`. In
 *   the App Router this re-runs the containing server component
 *   (`app/(dashboard)/clients/[id]/dashboard/page.tsx`) which
 *   re-executes `loadClientPortalByClientId` and flows the fresh
 *   rollup rows back through props. No local cache invalidation
 *   needed — the server-side load is the source of truth.
 */
interface Props {
  /** Every event in the venue group — the Sync Now button fires one
   *  POST per event id and aggregates the outcomes. */
  eventIds: string[];
  /** Short label displayed inline while the sync runs; defaults to
   *  "Syncing…". Kept as a prop so callers with space-constrained
   *  surfaces (small cards) can override with their own wording. */
  pendingLabel?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; total: number; ok: number; firstError: string | null }
  | { kind: "fatal"; message: string };

export function VenueSyncButton({ eventIds, pendingLabel = "Syncing…" }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onClick = useCallback(async () => {
    if (status.kind === "pending") return;
    if (eventIds.length === 0) return;
    setStatus({ kind: "pending" });

    // Promise.allSettled so one failed event doesn't cancel the
    // others — per-event POST failures are expected (rate-limited
    // account, missing event_code, etc.) and we want the rest of the
    // venue's events to still sync.
    const results = await Promise.allSettled(
      eventIds.map((id) =>
        fetch(
          `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(id)}`,
          { method: "POST" },
        ).then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(
              typeof body.error === "string"
                ? body.error
                : `HTTP ${r.status}`,
            );
          }
          const body = await r.json();
          if (body?.ok === false) {
            throw new Error(
              typeof body.error === "string"
                ? body.error
                : "Sync reported ok=false",
            );
          }
          return body;
        }),
      ),
    );

    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const firstErr = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    const message =
      firstErr && firstErr.reason instanceof Error
        ? firstErr.reason.message
        : firstErr
          ? String(firstErr.reason)
          : null;

    setStatus({
      kind: "done",
      total: eventIds.length,
      ok: okCount,
      firstError: message,
    });

    // Only refresh on at least one success — a wholesale failure
    // means upstream data hasn't changed and a refresh would just
    // re-paint the same numbers.
    if (okCount > 0) router.refresh();
  }, [eventIds, router, status.kind]);

  const disabled = status.kind === "pending" || eventIds.length === 0;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={status.kind === "pending"}
      >
        {status.kind === "pending" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            {pendingLabel}
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Sync now
          </>
        )}
      </button>
      <StatusLine status={status} />
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "pending") return null;
  if (status.kind === "fatal") {
    return (
      <span className="text-[11px] text-red-600">
        Sync failed: {status.message}
      </span>
    );
  }
  // done
  const failed = status.total - status.ok;
  if (failed === 0) {
    return (
      <span className="text-[11px] text-emerald-600">
        {status.ok === 1 ? "Synced" : `${status.ok} of ${status.total} synced`}
      </span>
    );
  }
  const errFragment = status.firstError
    ? `: ${truncate(status.firstError, 80)}`
    : "";
  return (
    <span className="text-[11px] text-amber-600">
      {status.ok} of {status.total} synced · {failed} failed{errFragment}
    </span>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
