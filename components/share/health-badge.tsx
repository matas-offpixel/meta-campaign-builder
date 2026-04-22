/**
 * components/share/health-badge.tsx
 *
 * Pill rendered top-right of every "Active creatives" card,
 * replacing the old purchase-CPA-based fatigue pill (PR #56 #4).
 * Two-axis scoring (fatigue × attention) lives in
 * `lib/reporting/creative-health.ts` — this component is just the
 * paint surface.
 *
 * Used on both surfaces:
 *   - share/active-creatives-client.tsx (public share page)
 *   - the same renderer wrapped by InternalEventReport on the
 *     Reporting tab — i.e. the badge ships once and lights up in
 *     both places by virtue of the share components being the
 *     single source of render.
 */

import {
  HEALTH_LABELS,
  scoreHealth,
  tooltipFor,
  type HealthAction,
  type HealthInput,
} from "@/lib/reporting/creative-health";

/**
 * Tailwind classes per action. SCALE is the only "good news"
 * green so it stands out in a grid of mostly-OK cards. KILL +
 * FATIGUED share the same red because the operator's response
 * (swap creative) is identical — only the urgency differs, which
 * the label conveys. PAUSED + insufficient ("—") use the muted
 * neutral so they sink visually relative to actionable badges.
 */
const PILL_CLASSES: Record<HealthAction, string> = {
  scale:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  ok: "bg-muted text-muted-foreground border-border",
  rotate:
    "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  fatigued: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  kill: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
  paused: "bg-muted/60 text-muted-foreground border-border",
  insufficient: "bg-muted/60 text-muted-foreground border-border",
};

interface Props extends HealthInput {
  /**
   * Optional override for the visible label — defaults to the
   * spec's SCALE / OK / ROTATE / FATIGUED / KILL / PAUSED / —
   * mapping. Exposed only for Storybook-style fixtures, not
   * normal use.
   */
  labelOverride?: string;
}

export function HealthBadge(props: Props) {
  const score = scoreHealth(props);
  const label = props.labelOverride ?? HEALTH_LABELS[score.action];
  return (
    <span
      title={tooltipFor(score)}
      data-action={score.action}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
        PILL_CLASSES[score.action]
      }`}
    >
      <span>{label}</span>
    </span>
  );
}
