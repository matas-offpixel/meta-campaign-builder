"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Bulk wrapper around POST /api/meta/campaign-spend.
 *
 * The single-event refresh button (in event-form.tsx) hits the same
 * endpoint one event_code at a time. This component lifts that to the
 * client overview: it walks the unique non-null event_codes across all
 * the client's events and refreshes each one in series.
 *
 * Why sequential, not parallel:
 *   The endpoint pages through Meta's account-level insights for every
 *   call. Firing N of them at once would (a) burn through Meta's per-app
 *   rate limit on big accounts and (b) make a 429 from one event poison
 *   the whole batch. Sequential keeps the throughput predictable and
 *   lets us surface per-code errors without aborting the rest.
 *
 * Why no own state for spend:
 *   The cached values are read by the rest of the page from the server-
 *   fetched row. After the batch finishes we router.refresh() so RSCs
 *   re-execute and the new meta_spend_cached values land in the UI.
 */

interface EventLike {
  id: string;
  event_code: string | null;
}

interface Props {
  events: EventLike[];
  /**
   * The client's Meta ad account ID. Required by the API and the same
   * value used by the per-event refresh — passed in from the parent so
   * we don't re-derive it from event rows (the client record is the
   * source of truth, an event row never overrides it).
   */
  adAccountId: string | null;
}

interface FailedCode {
  code: string;
  reason: string;
}

interface ZeroMatchCode {
  code: string;
}

export function RefreshAllSpendButton({ events, adAccountId }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<{
    succeeded: number;
    failed: FailedCode[];
    zeroMatched: ZeroMatchCode[];
  } | null>(null);
  const [, startTransition] = useTransition();

  // Unique, non-empty event_codes — multiple events sharing one code
  // (e.g. a multi-night residency at one venue) only need one refresh.
  const uniqueCodes = Array.from(
    new Set(
      events
        .map((e) => e.event_code?.trim())
        .filter((c): c is string => Boolean(c)),
    ),
  );
  const total = uniqueCodes.length;

  const disabled =
    running || total === 0 || !adAccountId;

  const disabledReason = !adAccountId
    ? "This client has no Meta ad account configured."
    : total === 0
      ? "None of this client's events have an event code."
      : null;

  const handleClick = async () => {
    if (!adAccountId || total === 0) return;
    setRunning(true);
    setSummary(null);
    setProgress({ done: 0, total });

    const failed: FailedCode[] = [];
    const zeroMatched: ZeroMatchCode[] = [];
    let succeeded = 0;

    for (let i = 0; i < uniqueCodes.length; i += 1) {
      const code = uniqueCodes[i];
      setProgress({ done: i, total });
      try {
        const res = await fetch("/api/meta/campaign-spend", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_code: code,
            ad_account_id: adAccountId,
          }),
        });
        const json = (await res.json().catch(() => null)) as
          | {
              ok?: boolean;
              campaigns_matched?: number;
              error?: string;
            }
          | null;
        if (!res.ok || !json?.ok) {
          failed.push({
            code,
            reason: json?.error ?? `HTTP ${res.status}`,
          });
        } else {
          succeeded += 1;
          if ((json.campaigns_matched ?? 0) === 0) {
            zeroMatched.push({ code });
          }
        }
      } catch (err) {
        failed.push({
          code,
          reason: err instanceof Error ? err.message : "Network error",
        });
      }
    }

    setProgress({ done: total, total });
    setSummary({ succeeded, failed, zeroMatched });
    setRunning(false);

    // Re-fetch the server component so the events list (and any other
    // surface reading meta_spend_cached) shows the freshly-cached values
    // without a hard reload.
    startTransition(() => {
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {running && progress && (
          <span className="text-xs text-muted-foreground tabular-nums">
            Refreshing {Math.min(progress.done + 1, progress.total)} of{" "}
            {progress.total}…
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleClick}
          disabled={disabled}
          title={disabledReason ?? undefined}
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh all spend
          {total > 0 && !running && (
            <span className="ml-1 text-muted-foreground">({total})</span>
          )}
        </Button>
      </div>

      {!running && disabledReason && (
        <p className="text-[11px] text-muted-foreground">{disabledReason}</p>
      )}

      {summary && !running && (
        <div className="text-[11px] text-right space-y-0.5">
          <p className="text-muted-foreground">
            {summary.succeeded} of {total} venue
            {total === 1 ? "" : "s"} refreshed
            {summary.failed.length > 0 && (
              <>
                {" · "}
                <span className="text-destructive">
                  {summary.failed.length} failed
                </span>
              </>
            )}
          </p>
          {summary.zeroMatched.length > 0 && (
            <p className="text-muted-foreground">
              No matching campaigns:{" "}
              <span className="font-mono">
                {summary.zeroMatched.map((z) => z.code).join(", ")}
              </span>
            </p>
          )}
          {summary.failed.length > 0 && (
            <ul className="text-destructive">
              {summary.failed.map((f) => (
                <li key={f.code}>
                  <span className="font-mono">{f.code}</span>: {f.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
