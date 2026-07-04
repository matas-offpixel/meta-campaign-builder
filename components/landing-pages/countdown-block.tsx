"use client";

import { useEffect, useState } from "react";

import {
  computeCountdown,
  padCountdownValue,
  type CountdownParts,
} from "@/lib/landing-pages/countdown";
import { formatPresaleHeaderLabel } from "@/lib/landing-pages/format-datetime";

import styles from "./landing-page.module.css";

/**
 * components/landing-pages/countdown-block.tsx
 *
 * Countdown block (PR 6, de-emphasised in PR 7): white container, 4-cell
 * bordered grid, Futura numbers in the tenant accent. The math lives in
 * lib/landing-pages/countdown.ts
 * (pure, node:test); this component only ticks.
 *
 * PR 8: the old "PRESALE OPENS IN" + ticket-icon header row is replaced
 * by a static "Presale: HH:mm EEE d MMMM" text line, formatted from the
 * SAME targetAt the ticker below counts down to (no separate resolver —
 * one source of truth for both).
 *
 * The server shell already gates on targetAt > now, but the client
 * re-computes every second and returns null once the target passes — an
 * SSR-cached page can't show a stuck 00:00:00 block. The interval is
 * cleaned up on unmount (and once the countdown dies).
 */

export function CountdownBlock({
  targetAt,
  label,
  accent,
}: {
  /** ISO timestamp. */
  targetAt: string;
  label: string;
  accent: string;
}) {
  const [parts, setParts] = useState<CountdownParts | null>(() =>
    computeCountdown(targetAt, Date.now()),
  );

  useEffect(() => {
    const tick = () => setParts(computeCountdown(targetAt, Date.now()));
    tick();
    const interval = setInterval(tick, 1_000);
    return () => clearInterval(interval);
  }, [targetAt]);

  if (!parts) return null;

  const cells: Array<[string, number]> = [
    ["days", parts.days],
    ["hours", parts.hours],
    ["mins", parts.mins],
    ["secs", parts.secs],
  ];

  return (
    <section className={styles.countdown} aria-label={label}>
      <p className={styles.countdownPresale}>
        {formatPresaleHeaderLabel(targetAt)}
      </p>
      <div className={styles.countdownGrid}>
        {cells.map(([unit, value]) => (
          <div className={styles.countdownCell} key={unit}>
            {/* Server + client render moments differ by design — the
                ticker corrects immediately after hydration. */}
            <span
              className={styles.countdownNumber}
              style={{ color: accent }}
              suppressHydrationWarning
            >
              {padCountdownValue(value)}
            </span>
            <span className={styles.countdownLabel}>{unit}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
