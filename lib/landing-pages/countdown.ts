/**
 * lib/landing-pages/countdown.ts
 *
 * PURE countdown math for the LP countdown block. The React component
 * (components/landing-pages/countdown-block.tsx) only ticks + renders —
 * all logic that can be wrong lives here, under node:test.
 */

export interface CountdownParts {
  days: number;
  hours: number;
  mins: number;
  secs: number;
}

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Remaining time between now and the target, or null when the target is
 * reached/past/invalid — null is the component's "render nothing" signal.
 */
export function computeCountdown(
  targetAtIso: string,
  nowMs: number,
): CountdownParts | null {
  const target = Date.parse(targetAtIso);
  if (Number.isNaN(target)) return null;
  const diff = target - nowMs;
  if (diff <= 0) return null;

  return {
    days: Math.floor(diff / DAY_MS),
    hours: Math.floor((diff % DAY_MS) / HOUR_MS),
    mins: Math.floor((diff % HOUR_MS) / MINUTE_MS),
    secs: Math.floor((diff % MINUTE_MS) / SECOND_MS),
  };
}

/** Zero-padded 2-digit cell value ("07", "59"; days can exceed 2 digits). */
export function padCountdownValue(value: number): string {
  return String(value).padStart(2, "0");
}
