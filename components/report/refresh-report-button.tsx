"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

/**
 * components/report/refresh-report-button.tsx
 *
 * Manual refresh control rendered next to the "Last updated …
 * refreshes every 5 minutes" footer text on the live Meta Report
 * block (PR #57 #3). Owned by the report view rather than each
 * caller so the spinner / error chrome stays identical between the
 * public share page and the internal Reporting tab mirror.
 *
 * Caller wires up the actual cache-bust through `onRefresh`:
 *
 *   - Internal — re-fires the auth `/api/insights/event/[id]?force=1`
 *     fetch and updates local state with the fresh payload.
 *   - Public  — pushes the URL with `?refresh=1` (alias `force=1`)
 *     and calls `router.refresh()` so the share RSC re-renders
 *     past the share-snapshots cache.
 *
 * Pending + error state lives on this component so the parent
 * (`<EventReportView>`) doesn't have to thread booleans through
 * for a one-off control.
 */

interface Props {
  /** Async refresh handler. Should reject on error so the inline
   *  "Refresh failed: <message>" line can render. Resolves on
   *  success — the button just resets to its idle state and trusts
   *  the parent to have re-rendered with fresh data. */
  onRefresh: () => Promise<void>;
}

export function RefreshReportButton({ onRefresh }: Props) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleClick = async () => {
    if (pending) return;
    setErr(null);
    setPending(true);
    try {
      await onRefresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title="Bypass the 5-minute cache and refetch from Meta now"
        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-3 w-3" aria-hidden />
        )}
        {pending ? "Refreshing" : "Refresh"}
      </button>
      {err ? (
        <span
          role="alert"
          className="text-[10px] normal-case tracking-normal text-destructive"
        >
          Refresh failed: {err}
        </span>
      ) : null}
    </span>
  );
}
