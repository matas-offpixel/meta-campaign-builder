/**
 * lib/google-search/push-guard.ts
 *
 * Pure helper that the push route (`app/api/google-search/[id]/push/route.ts`)
 * uses as a defence-in-depth guard against unintentional re-pushes of an
 * already-pushed plan.
 *
 * The Phase 3 adapter is per-row idempotent (rows with
 * `pushed_resource_name` already set are skipped), so the worst case
 * without this guard is "the second push noops" — not "duplicate
 * campaigns are created". BUT: the wizard autosave used to nuke-and-
 * rewrite the subtree on every edit, dropping `pushed_resource_name`
 * and defeating that per-row check. Phase 3.5's save fix preserves
 * those markers, AND this route guard makes a double-click / stale-tab
 * re-push explicit by requiring `{ force: true }` in the request body.
 *
 * Pure so it's easy to test without booting Next.js.
 */

export interface PushGuardInput {
  planStatus: string;
  campaigns: Array<{ pushed_resource_name: string | null }>;
}

export interface PushGuardDecision {
  /** True when the route should refuse the push (HTTP 409). */
  refuse: boolean;
  /** Count of campaigns that already carry a `pushed_resource_name`. */
  pushedCampaignCount: number;
  /** True if any signal indicates the plan was previously pushed. */
  alreadyPushed: boolean;
  /** Human-readable refusal message (only meaningful when `refuse` is true). */
  message?: string;
}

export function evaluatePushGuard(
  input: PushGuardInput,
  force: boolean,
): PushGuardDecision {
  const pushedCampaignCount = input.campaigns.filter(
    (c) => !!c.pushed_resource_name,
  ).length;
  const alreadyPushed = input.planStatus === "pushed" || pushedCampaignCount > 0;
  const refuse = alreadyPushed && !force;
  return {
    refuse,
    pushedCampaignCount,
    alreadyPushed,
    message: refuse
      ? `This plan was already pushed. ${pushedCampaignCount} campaign${pushedCampaignCount === 1 ? " is" : "s are"} ` +
        "live on Google Ads. Pushing again will only create newly-added campaigns / ad groups / keywords " +
        "(per-row idempotency via pushed_resource_name). Re-send with { force: true } to confirm."
      : undefined,
  };
}
