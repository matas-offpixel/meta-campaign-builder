/**
 * components/dashboard/pacing/benchmark-chip.tsx
 *
 * Northbeam-style benchmark-vs-actual chip: a small pill with a
 * directional arrow, the signed delta percentage, and a tone colour.
 * Shared by every metric across the three pacing surfaces.
 *
 * Pure presentation — tone + delta are derived upstream by
 * `lib/dashboard/pacing-presentation.ts`. No data access.
 */

import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import {
  formatDeltaPct,
  toneColors,
  type PacingTone,
} from "@/lib/dashboard/pacing-presentation";

export function BenchmarkChip({
  tone,
  delta,
  label,
  className = "",
}: {
  tone: PacingTone;
  /** Signed fraction (e.g. +0.11). Drives the arrow + percentage. */
  delta: number | null;
  /** Optional override label; defaults to "{+11%} vs benchmark". */
  label?: string;
  className?: string;
}) {
  const c = toneColors(tone);
  const Arrow =
    delta == null || Math.abs(delta) < 0.005
      ? Minus
      : delta > 0
        ? ArrowUp
        : ArrowDown;
  const text = label ?? `${formatDeltaPct(delta)} vs benchmark`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums ${c.chipBg} ${c.chipText} ${className}`}
      role="status"
      aria-label={
        label ? label : `${formatDeltaPct(delta)} versus benchmark`
      }
    >
      <Arrow className="h-3 w-3 shrink-0" strokeWidth={2.5} aria-hidden />
      {text}
    </span>
  );
}

/**
 * A neutral "target" chip (no delta arrow) used where we want to show a
 * benchmark/target value rather than a comparison — e.g. the hero
 * countdown segment.
 */
export function TargetChip({
  label,
  tone = "neutral",
  className = "",
}: {
  label: string;
  tone?: PacingTone;
  className?: string;
}) {
  const c = toneColors(tone);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${c.chipBg} ${c.chipText} ${className}`}
    >
      {label}
    </span>
  );
}
