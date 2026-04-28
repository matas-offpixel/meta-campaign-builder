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

/**
 * Subset of `SyncSummary` from the server — only the fields the
 * button needs to surface. Kept local rather than imported so the
 * client bundle stays free of the server types (SyncSummary carries
 * allocator shapes + diagnostics we don't want to ship to the
 * browser).
 */
interface SyncResponseBody {
  ok?: boolean;
  error?: string;
  summary?: {
    synced?: boolean;
    metaOk?: boolean;
    metaError?: string | null;
    metaReason?: string | null;
    metaRowsUpserted?: number;
    eventbriteOk?: boolean;
    eventbriteError?: string | null;
    eventbriteReason?: string | null;
    eventbriteRowsUpserted?: number;
    allocatorOk?: boolean | null;
    allocatorError?: string | null;
    allocatorReason?: string | null;
    allocatorClassErrors?: number;
    rowsUpserted?: number;
  };
}

/**
 * Robust JSON parser — same pattern as PR #113's
 * `additional-spend-card.tsx` helper. Distinguishes empty bodies
 * (unexpected) and HTML auth redirects (middleware bounced us to
 * /login — surfaces the DOCTYPE clipping so operators can see
 * "session expired" without opening devtools) from real JSON.
 */
async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`HTTP ${res.status}: empty response body`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `HTTP ${res.status}: non-JSON response — ${text.slice(0, 160)}`,
    );
  }
}

/**
 * Pick the most actionable error string out of a rollup-sync
 * response body. Precedence walks from the primary leg (Meta)
 * outwards; allocator errors land last because they're never
 * fatal to the overall sync and would otherwise mask a real
 * leg failure.
 */
function extractErrorMessage(body: SyncResponseBody): string {
  const s = body.summary;
  if (s) {
    if (s.metaError) return `Meta: ${s.metaError}`;
    if (s.eventbriteError && s.eventbriteReason !== "not_linked") {
      return `Eventbrite: ${s.eventbriteError}`;
    }
    if (s.allocatorError) return `Allocator: ${s.allocatorError}`;
  }
  if (typeof body.error === "string" && body.error.length > 0) {
    return body.error;
  }
  return "Sync failed (no error detail reported)";
}

export function VenueSyncButton({ eventIds, pendingLabel = "Syncing…" }: Props) {
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

    // Promise.allSettled so one failed event doesn't cancel the
    // others — per-event POST failures are expected (rate-limited
    // account, missing event_code, etc.) and we want the rest of the
    // venue's events to still sync.
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
        // The runner now exposes `summary.synced` as the semantic
        // success signal. Fall back to the legacy strict `ok`
        // for servers running pre-#121 code — they'll report the
        // old false-positive but at least the new chip still
        // shows a meaningful error string.
        const successful =
          typeof body.summary?.synced === "boolean"
            ? body.summary.synced
            : body.ok !== false;
        if (!successful) {
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
