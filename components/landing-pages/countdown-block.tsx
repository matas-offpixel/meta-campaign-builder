"use client";

import { useEffect, useState } from "react";

import {
  computeCountdown,
  padCountdownValue,
  type CountdownParts,
} from "@/lib/landing-pages/countdown";

import styles from "./landing-page.module.css";

/**
 * components/landing-pages/countdown-block.tsx
 *
 * Countdown block (PR 6): black container, 4-cell grid, Futura numbers in
 * the tenant accent. The math lives in lib/landing-pages/countdown.ts
 * (pure, node:test); this component only ticks.
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
      <div className={styles.countdownHeader}>
        <TicketIcon />
        <span>{label}</span>
      </div>
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

function TicketIcon() {
  return (
    <svg
      className={styles.countdownIcon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  );
}
