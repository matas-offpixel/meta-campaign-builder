/**
 * `▷ resume` — the one status write this app makes.
 *
 * Fan-out creates every entity PAUSED (that is the point of `⏸ Launch`),
 * so resuming is a separate, explicit second gate. It is a NEW write and
 * therefore sits behind the same `ENABLE_PLAN_FANOUT` killswitch as the
 * launch it undoes: one flag for "this app may change things on Meta".
 *
 * Meta only. TikTok and Google have no status-write path in this app, and
 * inventing one from a canvas button is not something to do blind — the
 * rows show `▷` disabled with the Ads Manager link instead.
 */

import type { PlanAdapterName } from "./types.ts";

export const PLAN_RESUME_SUPPORTED: readonly PlanAdapterName[] = ["meta"];

export const PLAN_RESUME_UNSUPPORTED_REASON =
  "Resume in Ads Manager — this app writes campaign status on Meta only.";

export const PLAN_RESUME_NOT_LAUNCHED_REASON =
  "Nothing to resume — this channel has no campaign on the platform.";

export function canResumeAdapter(adapter: PlanAdapterName): boolean {
  return PLAN_RESUME_SUPPORTED.includes(adapter);
}

export type PlanResumeOutcome =
  | { ok: true; campaignId: string }
  | { ok: false; error: string; skippedReason?: "killswitch" | "unsupported" };

/**
 * Pure resume decision + write, with the Graph POST injected so the
 * decision is testable without a network. `ACTIVE` on the campaign node
 * is the same edge the optimisation tick already writes `daily_budget`
 * to — no new Graph surface, only a new field.
 */
export async function resumePlanAdapter(input: {
  adapter: PlanAdapterName;
  campaignId: string | null;
  gateEnabled: boolean;
  post: (campaignId: string) => Promise<unknown>;
}): Promise<PlanResumeOutcome> {
  if (!input.gateEnabled) {
    return { ok: false, error: "killswitch", skippedReason: "killswitch" };
  }
  if (!canResumeAdapter(input.adapter)) {
    return {
      ok: false,
      error: PLAN_RESUME_UNSUPPORTED_REASON,
      skippedReason: "unsupported",
    };
  }
  if (!input.campaignId) {
    return { ok: false, error: PLAN_RESUME_NOT_LAUNCHED_REASON };
  }
  try {
    await input.post(input.campaignId);
    return { ok: true, campaignId: input.campaignId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Resume failed" };
  }
}
