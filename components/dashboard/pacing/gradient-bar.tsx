/**
 * components/dashboard/pacing/gradient-bar.tsx
 *
 * Northbeam-style filled horizontal bar with an embedded benchmark
 * marker (a vertical tick on the bar itself, NOT a separate adjacent
 * bar). Fill uses a subtle left-to-right gradient for depth.
 *
 * Pure presentation. Tone colour comes from
 * `lib/dashboard/pacing-presentation.ts`.
 */

import {
  toneColors,
  type PacingTone,
} from "@/lib/dashboard/pacing-presentation";

export function FilledBar({
  /** Fill fraction [0..1]. */
  fill,
  tone,
  /** Optional benchmark marker position [0..1] drawn as a vertical tick. */
  benchmark,
  /** Optional label rendered at the filled end (inside or just after). */
  endLabel,
  /** Bar height in px. */
  height = 16,
  /** Accessible description. */
  ariaLabel,
  className = "",
}: {
  fill: number;
  tone: PacingTone;
  benchmark?: number | null;
  endLabel?: string;
  height?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const c = toneColors(tone);
  const fillPct = Math.max(0, Math.min(1, fill)) * 100;
  const benchPct =
    benchmark != null ? Math.max(0, Math.min(1, benchmark)) * 100 : null;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-muted ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(fillPct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <div
        className={`relative h-full rounded-full ${c.bar} transition-[width] duration-200 ease-out`}
        style={{ width: `${fillPct}%` }}
      >
        {/* subtle top sheen for depth (Northbeam-style) */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/25 to-transparent" />
      </div>
      {benchPct != null && (
        <div
          className="absolute top-0 h-full w-0.5 -translate-x-1/2 bg-foreground/70"
          style={{ left: `${benchPct}%` }}
          aria-hidden
          title="Benchmark"
        />
      )}
      {endLabel ? (
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] font-medium tabular-nums text-foreground/80">
          {endLabel}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Two stacked thin bars sharing a track — used by the "Performance vs
 * Allocation" view (tickets sold % over spend deployed %).
 */
export function OverlayBars({
  topFill,
  topTone,
  topLabel,
  bottomFill,
  bottomTone,
  bottomLabel,
  className = "",
}: {
  topFill: number;
  topTone: PacingTone;
  topLabel: string;
  bottomFill: number;
  bottomTone: PacingTone;
  bottomLabel: string;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <BarWithLabel fill={topFill} tone={topTone} label={topLabel} lighter />
      <BarWithLabel fill={bottomFill} tone={bottomTone} label={bottomLabel} />
    </div>
  );
}

function BarWithLabel({
  fill,
  tone,
  label,
  lighter = false,
}: {
  fill: number;
  tone: PacingTone;
  label: string;
  lighter?: boolean;
}) {
  const c = toneColors(tone);
  const pct = Math.max(0, Math.min(1, fill)) * 100;
  return (
    <div className="relative h-5 w-full overflow-hidden rounded-md bg-muted">
      <div
        className={`h-full rounded-md ${c.bar} ${lighter ? "opacity-50" : ""} transition-[width] duration-200 ease-out`}
        style={{ width: `${pct}%` }}
      />
      <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[10px] font-medium tabular-nums text-foreground/80">
        {label}
      </span>
    </div>
  );
}
