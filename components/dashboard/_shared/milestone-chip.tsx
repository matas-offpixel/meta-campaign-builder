/**
 * Small pill rendering a milestone kind + relative timing.
 *
 * Pure render — safe in server or client components, no hooks. Caller
 * computes `daysAway` from a stabilised "now" so the chip itself stays
 * deterministic across renders.
 *
 *   "Announce today"   → daysAway === 0
 *   "Presale tomorrow" → daysAway === 1
 *   "Gen sale in 3d"   → daysAway > 1
 *   "Event 2d ago"     → daysAway < 0
 */

import {
  MILESTONE_COLOR,
  MILESTONE_LABEL,
  type MilestoneKind,
} from "@/lib/dashboard/format";

interface Props {
  kind: MilestoneKind;
  daysAway: number;
  /** Override the default MILESTONE_LABEL for this kind. */
  label?: string;
}

export function MilestoneChip({ kind, daysAway, label }: Props) {
  const timing =
    daysAway === 0
      ? "today"
      : daysAway === 1
        ? "tomorrow"
        : daysAway > 1
          ? `in ${daysAway}d`
          : `${Math.abs(daysAway)}d ago`;

  // bg-foreground inverts in dark mode; text-background follows it.
  // The saturated -500 colours read cleanly with white in either mode.
  const textCls = kind === "event" ? "text-background" : "text-white";
  const text = label ?? MILESTONE_LABEL[kind];

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${MILESTONE_COLOR[kind]} ${textCls}`}
    >
      {text} {timing}
    </span>
  );
}
