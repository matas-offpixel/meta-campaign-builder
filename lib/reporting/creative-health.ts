/**
 * lib/reporting/creative-health.ts
 *
 * Two-axis creative health scorer used by the share + internal
 * "Active creatives" cards. Replaces the old purchase-CPA pill,
 * which was meaningless on traffic / LPV campaigns that book
 * zero purchases by design (PR #56 #4).
 *
 * The pill answers two questions a marketer actually asks at a
 * glance:
 *
 *   1. Is the audience burning out?  (fatigue → frequency)
 *   2. Is the creative landing?     (attention → inline link CTR)
 *
 * Combining the two yields a single next-action label
 * (SCALE / OK / ROTATE / FATIGUED / KILL) so the user doesn't
 * have to translate two numbers into a decision themselves. The
 * tooltip on the rendered badge always shows the underlying
 * frequency + CTR + which threshold each one tripped, so the
 * scoring is never opaque.
 *
 * Pure module — no React, no Next, no DB. Drives the badge UI
 * but is independently unit-testable.
 */

/** Fatigue tier — frequency in impressions per reached user. */
export type FatigueTier = "fresh" | "watch" | "fatigued";

/** Attention tier — inline link CTR as a fraction (0–1). */
export type AttentionTier = "strong" | "ok" | "weak";

/**
 * Combined next-action recommendation. `paused` is reserved for
 * the "no underlying ad currently active" branch — we never tell
 * the user to SCALE / KILL / ROTATE a creative whose campaign
 * isn't even running. `insufficient` covers the early-window
 * case (fewer than `MIN_IMPRESSIONS_FOR_BADGE`) where the score
 * would just be noise.
 */
export type HealthAction =
  | "scale"
  | "ok"
  | "rotate"
  | "fatigued"
  | "kill"
  | "paused"
  | "insufficient";

/**
 * Minimum impressions before we trust the score. Below this the
 * frequency is mathematically defined but the CTR has too few
 * trials to be informative — surfacing SCALE on a 200-impression
 * card with one accidental click is worse than no badge at all.
 */
export const MIN_IMPRESSIONS_FOR_BADGE = 1000;

/**
 * Fatigue thresholds (Meta `frequency` field — average impressions
 * per reached user). Defaults sourced from spec PR #56 #4.
 *
 *   < 2.5  → fresh
 *   2.5–4.0 → watch (renders as "watch" but the action label is
 *             still "rotate" / "fatigued" depending on CTR)
 *   > 4.0  → fatigued
 */
export const FATIGUE_FRESH_MAX = 2.5;
export const FATIGUE_FATIGUED_MIN = 4.0;

/**
 * Attention thresholds (`inline_link_click_ctr`, expressed as a
 * fraction — 0.015 == 1.5%). Defaults sourced from spec PR #56 #4.
 *
 *   > 1.5%       → strong
 *   0.8 – 1.5%   → ok
 *   < 0.8%       → weak
 */
export const ATTENTION_STRONG_MIN = 0.015;
export const ATTENTION_OK_MIN = 0.008;

export interface HealthInput {
  /** Meta `frequency`. `null` when reach is zero. */
  frequency: number | null;
  /** Sum of `inline_link_clicks` across the concept's underlying ads. */
  inlineLinkClicks: number;
  /** Sum of `impressions` across the concept's underlying ads. */
  impressions: number;
  /**
   * `true` when at least one underlying ad has `status === ACTIVE`.
   * `false` collapses all the "campaign paused / ad paused" cases
   * (we don't surface scoring on dormant creatives — PAUSED pill
   * instead). Defaults to `true` when unknown so older callers
   * that haven't been re-plumbed don't accidentally show PAUSED.
   */
  anyAdActive?: boolean;
}

export interface HealthScore {
  /**
   * `paused` and `insufficient` are terminal — fatigue/attention
   * are reported as `null` because they're not meaningful in
   * those branches (insufficient → too few impressions to trust;
   * paused → the question "should I scale?" doesn't apply).
   */
  action: HealthAction;
  fatigue: FatigueTier | null;
  attention: AttentionTier | null;
  /** Underlying numbers — surfaced verbatim in the tooltip. */
  frequency: number | null;
  ctr: number | null;
  impressions: number;
}

export function classifyFatigue(frequency: number | null): FatigueTier | null {
  if (frequency == null || !Number.isFinite(frequency)) return null;
  if (frequency < FATIGUE_FRESH_MAX) return "fresh";
  if (frequency > FATIGUE_FATIGUED_MIN) return "fatigued";
  return "watch";
}

export function classifyAttention(ctr: number | null): AttentionTier | null {
  if (ctr == null || !Number.isFinite(ctr)) return null;
  if (ctr > ATTENTION_STRONG_MIN) return "strong";
  if (ctr >= ATTENTION_OK_MIN) return "ok";
  return "weak";
}

/**
 * `inline_link_click_ctr` as a fraction (0-1). Returned as `null`
 * when impressions are zero — division-by-zero is a "we don't
 * know" answer, not a "0% CTR" answer.
 */
export function computeInlineLinkCtr(
  inlineLinkClicks: number,
  impressions: number,
): number | null {
  if (!impressions || impressions <= 0) return null;
  return inlineLinkClicks / impressions;
}

/**
 * Map fatigue × attention → next-action. Mirrors the matrix in
 * the spec exactly so tweaks land in one place.
 *
 *   fresh    + strong → SCALE       (working, push budget)
 *   fresh    + weak   → KILL        (never landed, cut it)
 *   fatigued + strong → ROTATE      (still works, swap soon)
 *   fatigued + weak   → FATIGUED    (burned out, swap now)
 *   any mid / mid     → OK          (keep running)
 */
export function combine(
  fatigue: FatigueTier,
  attention: AttentionTier,
): Exclude<HealthAction, "paused" | "insufficient"> {
  if (fatigue === "fresh" && attention === "strong") return "scale";
  if (fatigue === "fresh" && attention === "weak") return "kill";
  if (fatigue === "fatigued" && attention === "strong") return "rotate";
  if (fatigue === "fatigued" && attention === "weak") return "fatigued";
  return "ok";
}

export function scoreHealth(input: HealthInput): HealthScore {
  const ctr = computeInlineLinkCtr(input.inlineLinkClicks, input.impressions);
  const fatigue = classifyFatigue(input.frequency);
  const attention = classifyAttention(ctr);
  const base: Omit<HealthScore, "action"> = {
    fatigue,
    attention,
    frequency: input.frequency,
    ctr,
    impressions: input.impressions,
  };

  // Order matters: paused wins over insufficient (a paused
  // creative on 200 impressions should still read PAUSED, not
  // "not enough data"), and insufficient wins over scoring
  // (don't render SCALE on noise).
  const isActive = input.anyAdActive ?? true;
  if (!isActive) return { ...base, action: "paused" };
  if (input.impressions < MIN_IMPRESSIONS_FOR_BADGE) {
    return { ...base, action: "insufficient" };
  }
  if (!fatigue || !attention) {
    // Can't classify (frequency null OR CTR null with active ad
    // and >= 1000 impressions). Falls back to OK so the card
    // isn't blank — same semantics as the old fatigueScore
    // default.
    return { ...base, action: "ok" };
  }

  return { ...base, action: combine(fatigue, attention) };
}

/**
 * Human label rendered inside the badge. Short on purpose —
 * the badge sits in a tight card slot.
 */
export const HEALTH_LABELS: Record<HealthAction, string> = {
  scale: "SCALE",
  ok: "OK",
  rotate: "ROTATE",
  fatigued: "FATIGUED",
  kill: "KILL",
  paused: "PAUSED",
  insufficient: "—",
};

/**
 * One-line "what next?" suggestion appended to the tooltip after
 * the threshold breakdown. Empty for `insufficient` (the dash
 * already says "wait for more data") and `paused` (the campaign
 * status already says "do nothing").
 */
export const HEALTH_NEXT_HINT: Record<HealthAction, string> = {
  scale: "working, push budget",
  ok: "keep running",
  rotate: "still working but tiring, swap soon",
  fatigued: "burned out, swap now",
  kill: "never landed, cut it",
  paused: "campaign paused, no action",
  insufficient: "<1k impressions — too early to score",
};

const FATIGUE_LABEL: Record<FatigueTier, string> = {
  fresh: "Fresh",
  watch: "Watch",
  fatigued: "Fatigued",
};
const ATTENTION_LABEL: Record<AttentionTier, string> = {
  strong: "Strong",
  ok: "OK",
  weak: "Weak",
};

/**
 * Build the tooltip body for the badge. Always shows the raw
 * numbers + which tier each tripped + the next-action hint, so
 * the scoring is never a black box.
 *
 * Examples:
 *   "Frequency 3.2 (Watch) · Link CTR 1.8% (Strong) · Next: ROTATE — still working but tiring, swap soon"
 *   "<1k impressions (412) — too early to score"
 *   "Campaign paused — no action while dormant"
 */
export function tooltipFor(score: HealthScore): string {
  if (score.action === "insufficient") {
    return `<1k impressions (${formatInt(score.impressions)}) — too early to score`;
  }
  if (score.action === "paused") {
    return "Campaign paused — no action while dormant";
  }
  const freqLabel =
    score.frequency != null && Number.isFinite(score.frequency)
      ? `Frequency ${score.frequency.toFixed(2)}${
          score.fatigue ? ` (${FATIGUE_LABEL[score.fatigue]})` : ""
        }`
      : "Frequency —";
  const ctrLabel =
    score.ctr != null && Number.isFinite(score.ctr)
      ? `Link CTR ${(score.ctr * 100).toFixed(2)}%${
          score.attention ? ` (${ATTENTION_LABEL[score.attention]})` : ""
        }`
      : "Link CTR —";
  const next = `Next: ${HEALTH_LABELS[score.action]} — ${HEALTH_NEXT_HINT[score.action]}`;
  return `${freqLabel} · ${ctrLabel} · ${next}`;
}

function formatInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-GB");
}
