"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  /**
   * Seconds between successive `router.refresh()` calls.
   * Defaults to 45 — long enough for a Meta rate-limit window to
   * tick over without thrashing the route on every render cycle.
   */
  intervalSec?: number;
  /**
   * Hard ceiling on the number of refresh attempts. After
   * exhausting them we stop the timer and render a quieter
   * "auto-retry stopped" line so the visitor knows to refresh
   * manually instead of staring at a counter that never moves.
   * Default 5 → at the default 45s interval this caps total
   * unattended retries at ~3:45.
   */
  maxTicks?: number;
}

/**
 * components/report/auto-retry.tsx
 *
 * Tiny "we're retrying for you" countdown for the
 * `<ReportUnavailable>` surface. Renders nothing tall — just a
 * muted line below the existing status — and on each tick fires
 * `router.refresh()`, which re-runs the parent RSC against the
 * same URL. When the underlying transient Meta error has cleared
 * the share page swaps back to the live render on its own; the
 * visitor never has to touch the page.
 *
 * Why client-only: hooks (useState / useEffect / useRouter) and
 * a setTimeout. The `<ReportUnavailable>` parent stays an RSC.
 *
 * Defensive choices:
 *   - Single `setTimeout` chain (not `setInterval`), reset after
 *     each tick. Avoids a leftover timer firing after the
 *     component unmounts.
 *   - `useRef` keeps the timer handle outside React state so the
 *     effect cleanup can clear the right one even when the next
 *     state update has already started.
 *   - Stops cleanly at `maxTicks`. The Meta outage that motivated
 *     this fix typically clears in 1–2 minutes; if it hasn't
 *     after ~4 minutes we'd rather the visitor see "Retry
 *     stopped" than a forever-spinning countdown.
 */
export function AutoRetry({ intervalSec = 45, maxTicks = 5 }: Props) {
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number>(intervalSec);
  const [ticks, setTicks] = useState<number>(0);
  const stopped = ticks >= maxTicks;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (stopped) return;
    timerRef.current = setTimeout(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Tick: fire the soft refresh and reset the countdown.
          // `router.refresh()` re-runs the RSC for the current
          // URL, picking up any cleared-up upstream Meta state
          // without a full navigation.
          router.refresh();
          setTicks((t) => t + 1);
          return intervalSec;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [secondsLeft, stopped, intervalSec, router]);

  if (stopped) {
    return (
      <p className="mt-3 text-[11px] text-muted-foreground">
        Auto-retry stopped. Please refresh the page to try again.
      </p>
    );
  }

  return (
    <p
      className="mt-3 text-[11px] text-muted-foreground"
      aria-live="polite"
    >
      Retrying automatically in {secondsLeft}s
      {ticks > 0 ? ` · attempt ${ticks + 1} of ${maxTicks}` : ""}
    </p>
  );
}
