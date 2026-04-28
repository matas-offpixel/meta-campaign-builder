"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import {
  extractErrorMessage,
  isSyncSuccessful,
  safeJson,
  type SyncResponseBody,
} from "@/lib/dashboard/sync-button-helpers";

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
 * Success semantics (PR #121):
 *
 *   The runner's `ok` flag is a strict `metaOk && eventbriteOk`, which
 *   made events without an Eventbrite binding (e.g. 4theFans events
 *   routed through internal ticketing) report "Sync failed" even when
 *   the Meta leg wrote rows cleanly. The button now consumes the
 *   dedicated `summary.synced` signal instead — that field treats
 *   expected terminal states (`not_linked`, `no_event_code`,
 *   `no_ad_account`) as success and only flips when a leg that *was*
 *   expected to run actually errored.
 *
 * Refresh strategy:
 *   After the parallel POSTs resolve we call `router.refresh()`. In
 *   the App Router this re-runs the containing server component
 *   (`app/(dashboard)/clients/[id]/dashboard/page.tsx`) which
 *   re-executes `loadClientPortalByClientId` and flows the fresh
 *   rollup rows back through props. No local cache invalidation
 *   needed — the server-side load is the source of truth.
 *
 * Compact variant (`size="compact"`):
 *   Per-event sync button used inline in the expanded venue card's
 *   Admin row. Same fan-out logic but with an icon-only trigger
 *   (tooltip-labelled for accessibility) and no detached status
 *   line — the status pill collapses into the button tail so the
 *   button sits naturally inline with the event name.
 */
interface Props {
  /** Every event in the venue group — the Sync Now button fires one
   *  POST per event id and aggregates the outcomes. */
  eventIds: string[];
  /** Short label displayed inline while the sync runs; defaults to
   *  "Syncing…". Kept as a prop so callers with space-constrained
   *  surfaces (small cards) can override with their own wording. */
  pendingLabel?: string;
  /**
   * `default` renders the standard venue button with an adjacent
   * status line. `compact` renders an icon-only button sized for
   * inline use next to an event name; the status collapses into
   * the button tail ("✓" / "!") so it stays on a single line.
   */
  size?: "default" | "compact";
  /**
   * Optional override for the compact variant's ARIA label /
   * tooltip. Useful when the button is embedded next to an event
   * name so screen readers announce "Sync England v Croatia" rather
   * than the generic "Sync now".
   */
  ariaLabel?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; total: number; ok: number; firstError: string | null }
  | { kind: "fatal"; message: string };

export function VenueSyncButton({
  eventIds,
  pendingLabel = "Syncing…",
  size = "default",
  ariaLabel,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const onClick = useCallback(async () => {
    if (status.kind === "pending") return;
    if (eventIds.length === 0) return;
    setStatus({ kind: "pending" });

    console.log(
      `[sync-now] start eventCount=${eventIds.length} eventIds=${JSON.stringify(eventIds)}`,
    );
    const t0 = performance.now();

    const results = await Promise.allSettled(
      eventIds.map(async (id) => {
        const url = `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(id)}`;
        const legStart = performance.now();
        console.log(`[sync-now] POST ${url}`);
        const r = await fetch(url, { method: "POST" });
        const legElapsed = Math.round(performance.now() - legStart);
        let body: SyncResponseBody;
        try {
          body = await safeJson<SyncResponseBody>(r);
        } catch (parseErr) {
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.warn(
            `[sync-now] eventId=${id} status=${r.status} parse_failed elapsed_ms=${legElapsed} msg=${message}`,
          );
          throw new Error(message);
        }
        console.log(
          `[sync-now] eventId=${id} status=${r.status} elapsed_ms=${legElapsed} ` +
            `ok=${body.ok} synced=${body.summary?.synced} ` +
            `meta_ok=${body.summary?.metaOk}${
              body.summary?.metaReason ? `(${body.summary.metaReason})` : ""
            } ` +
            `eb_ok=${body.summary?.eventbriteOk}${
              body.summary?.eventbriteReason
                ? `(${body.summary.eventbriteReason})`
                : ""
            } ` +
            `alloc_ok=${body.summary?.allocatorOk ?? "n/a"}${
              body.summary?.allocatorReason
                ? `(${body.summary.allocatorReason})`
                : ""
            } rows=${body.summary?.rowsUpserted ?? 0}`,
        );
        if (!r.ok && r.status !== 207) {
          throw new Error(extractErrorMessage(body) + ` (HTTP ${r.status})`);
        }
        if (!isSyncSuccessful(body)) {
          throw new Error(extractErrorMessage(body));
        }
        return body;
      }),
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

    const totalElapsed = Math.round(performance.now() - t0);
    console.log(
      `[sync-now] done ok=${okCount}/${eventIds.length} elapsed_ms=${totalElapsed}${
        message ? ` first_error=${JSON.stringify(message)}` : ""
      }`,
    );

    setStatus({
      kind: "done",
      total: eventIds.length,
      ok: okCount,
      firstError: message,
    });

    if (okCount > 0) router.refresh();
  }, [eventIds, router, status.kind]);

  const disabled = status.kind === "pending" || eventIds.length === 0;

  if (size === "compact") {
    // Compact variant: icon-only, inline-friendly, status collapses
    // into the button tail so the "Admin" row stays on one line.
    const label = ariaLabel ?? "Sync this event";
    const tail = (() => {
      if (status.kind === "done") {
        const failed = status.total - status.ok;
        if (failed === 0) {
          return (
            <span
              className="ml-1 text-emerald-600"
              title={status.ok === 1 ? "Synced" : `${status.ok} synced`}
            >
              ✓
            </span>
          );
        }
        return (
          <span
            className="ml-1 text-amber-600"
            title={status.firstError ?? `${failed} failed`}
          >
            !
          </span>
        );
      }
      if (status.kind === "fatal") {
        return (
          <span className="ml-1 text-red-600" title={status.message}>
            !
          </span>
        );
      }
      return null;
    })();
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        title={label}
        className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.kind === "pending" ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
        )}
        {tail}
      </button>
    );
  }

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
  const failed = status.total - status.ok;
  if (failed === 0) {
    return (
      <span className="text-[11px] text-emerald-600">
        {status.ok === 1 ? "Synced" : `${status.ok} of ${status.total} synced`}
      </span>
    );
  }
  const errFragment = status.firstError
    ? `: ${truncate(status.firstError, 120)}`
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
