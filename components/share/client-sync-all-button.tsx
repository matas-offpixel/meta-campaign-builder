"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";

import {
  extractErrorMessage,
  isSyncSuccessful,
  runWithConcurrency,
  safeJson,
  type SyncResponseBody,
} from "@/lib/dashboard/sync-button-helpers";

/**
 * "Sync all" button for the top of `/clients/[id]/dashboard`.
 *
 * Fires rollup-sync for every event under the client — no
 * per-venue drill-down required. Parallelism is capped at 5
 * concurrent POSTs (the Meta API rate budget; higher than that and
 * ad-account throttling kicks in and we start getting 429s that
 * add latency without wins).
 *
 * Relationship to `VenueSyncButton`:
 *
 *   Both hit the same session-authenticated
 *   `/api/ticketing/rollup-sync?eventId=` endpoint, same success
 *   semantics (see `isSyncSuccessful` in sync-button-helpers). The
 *   venue button is the ergonomic "I only care about this venue"
 *   variant; this button is the "sweep everything" variant and is
 *   gated behind `isInternal` since the route is session-scoped
 *   (no public share-token variant exists).
 *
 * Progress surface:
 *   - Idle: simple "Sync all" button
 *   - In-flight: `Syncing 12 of 64…` counter + spinner
 *   - Done: green chip `64 of 64 synced` OR amber chip
 *     `60 of 64 synced · 4 failed (click to expand)`; clicking the
 *     amber chip reveals the first failure's message.
 *
 * Progress is maintained locally via state; `runWithConcurrency`
 * from `sync-button-helpers` handles the sliding-window
 * parallelism and invokes the progress callback as each task
 * resolves. The callback runs in a React event handler (`setState`
 * within a running `useCallback`) so batching is automatic.
 *
 * Refresh strategy:
 *   Same as VenueSyncButton — call `router.refresh()` after all
 *   syncs resolve. Re-runs the server component, re-executes
 *   `loadClientPortalByClientId`, fresh rollup rows flow back
 *   through props.
 */
interface Props {
  /** Every event id under the client — the button fans out one POST
   *  per id, batched 5 concurrent. */
  eventIds: string[];
}

type Status =
  | { kind: "idle" }
  | { kind: "pending"; completed: number; total: number }
  | {
      kind: "done";
      total: number;
      ok: number;
      failed: number;
      firstError: string | null;
    };

const CONCURRENCY = 5;

export function ClientSyncAllButton({ eventIds }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errorExpanded, setErrorExpanded] = useState(false);

  const total = eventIds.length;

  const onClick = useCallback(async () => {
    if (status.kind === "pending") return;
    if (total === 0) return;
    setErrorExpanded(false);
    setStatus({ kind: "pending", completed: 0, total });

    console.log(
      `[sync-all] start eventCount=${total} concurrency=${CONCURRENCY}`,
    );
    const t0 = performance.now();

    const results = await runWithConcurrency(
      eventIds,
      CONCURRENCY,
      async (id) => {
        const url = `/api/ticketing/rollup-sync?eventId=${encodeURIComponent(id)}`;
        const legStart = performance.now();
        const r = await fetch(url, { method: "POST" });
        const legElapsed = Math.round(performance.now() - legStart);
        let body: SyncResponseBody;
        try {
          body = await safeJson<SyncResponseBody>(r);
        } catch (parseErr) {
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          console.warn(
            `[sync-all] eventId=${id} status=${r.status} parse_failed elapsed_ms=${legElapsed} msg=${message}`,
          );
          throw new Error(message);
        }
        if (!r.ok && r.status !== 207) {
          throw new Error(extractErrorMessage(body) + ` (HTTP ${r.status})`);
        }
        if (!isSyncSuccessful(body)) {
          throw new Error(extractErrorMessage(body));
        }
        return body;
      },
      (completed, totalSoFar) => {
        setStatus({ kind: "pending", completed, total: totalSoFar });
      },
    );

    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const failed = total - okCount;
    const firstErr = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    const firstError =
      firstErr && firstErr.reason instanceof Error
        ? firstErr.reason.message
        : firstErr
          ? String(firstErr.reason)
          : null;

    const totalElapsed = Math.round(performance.now() - t0);
    console.log(
      `[sync-all] done ok=${okCount}/${total} elapsed_ms=${totalElapsed}${
        firstError ? ` first_error=${JSON.stringify(firstError)}` : ""
      }`,
    );

    setStatus({ kind: "done", total, ok: okCount, failed, firstError });

    if (okCount > 0) router.refresh();
  }, [eventIds, router, status.kind, total]);

  const disabled = status.kind === "pending" || total === 0;
  const pct = useMemo(() => {
    if (status.kind !== "pending") return 0;
    return status.total === 0
      ? 0
      : Math.round((status.completed / status.total) * 100);
  }, [status]);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded border border-border-strong px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        aria-busy={status.kind === "pending"}
        title={
          total === 0
            ? "No events to sync"
            : `Sync all ${total} events in batches of ${CONCURRENCY}`
        }
      >
        {status.kind === "pending" ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Syncing {status.completed} of {status.total}…
          </>
        ) : (
          <>
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Sync all
            {total > 0 && (
              <span className="text-muted-foreground">({total})</span>
            )}
          </>
        )}
      </button>

      {status.kind === "pending" && (
        <div
          className="h-1 w-24 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Syncing ${status.completed} of ${status.total}`}
        >
          <div
            className="h-full bg-foreground transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {status.kind === "done" && (
        <SyncAllResult
          status={status}
          expanded={errorExpanded}
          onToggleError={() => setErrorExpanded((v) => !v)}
        />
      )}
    </div>
  );
}

function SyncAllResult({
  status,
  expanded,
  onToggleError,
}: {
  status: Extract<Status, { kind: "done" }>;
  expanded: boolean;
  onToggleError: () => void;
}) {
  if (status.failed === 0) {
    return (
      <span className="text-[11px] text-emerald-600">
        {status.ok} of {status.total} synced
      </span>
    );
  }
  return (
    <div className="flex flex-col text-[11px] text-amber-600">
      <button
        type="button"
        onClick={status.firstError ? onToggleError : undefined}
        className="text-left hover:underline disabled:cursor-default disabled:no-underline"
        aria-expanded={status.firstError ? expanded : undefined}
        disabled={!status.firstError}
      >
        {status.ok} of {status.total} synced · {status.failed} failed
        {status.firstError ? (expanded ? " (hide)" : " (details)") : ""}
      </button>
      {expanded && status.firstError && (
        <span className="mt-1 max-w-xl break-words rounded border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-amber-800">
          {truncate(status.firstError, 600)}
        </span>
      )}
    </div>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
