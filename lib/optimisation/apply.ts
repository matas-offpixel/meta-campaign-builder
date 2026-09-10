/**
 * lib/optimisation/apply.ts
 *
 * PR B executor — consumes an `EvaluateAdSetResult` (already folded into
 * `DecisionToInsert`) and either writes the Meta daily_budget or records
 * a shadow / abort / pause-recommend row. Decision *logic* stays in
 * `evaluate.ts`; this module only executes.
 *
 * Pause is heavier than a budget change: a wrong scale-up costs a few
 * percent; a wrong pause kills delivery and resets learning. So pause
 * writes need the three budget-write gates PLUS
 * `ENABLE_OPTIMISATION_PAUSE_WRITES`, a configured `pauseFloorBudget`
 * (reduce first; pause only at the floor), and the blast-radius limits
 * below. Never auto-resume — a human unpauses.
 *
 * Pure except for injected Meta / DB / Slack seams — no `@/` imports so
 * `node --test` can load it.
 */

import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";
import type { OptimisationDryRunGates } from "./gates.ts";
import type { DecisionToInsert } from "./tick-runner.ts";

export const MAX_WRITES_PER_RUN = 25;

/**
 * Hard cap on Meta pause writes per tick. Well below
 * {@link MAX_WRITES_PER_RUN}: a run that wants to pause six ad sets is
 * describing a campaign problem, not six ad-set problems.
 */
export const MAX_PAUSES_PER_RUN = 2;

/**
 * Minimum raw conversion count before a pause write is allowed.
 * Five conversions is enough to raise a budget and much too thin to
 * kill delivery. Direct-field metrics (`resultCount` null) cannot
 * pause automatically.
 */
export const MIN_PAUSE_CONVERSION_RESULT_COUNT = 15;

export type ApplyOutcomeKind =
  | "shadow"
  | "pause_recommended"
  | "pause_reduced_to_floor"
  | "paused"
  | "pause_blocked"
  | "applied"
  | "write_failed"
  | "aborted_underfoot"
  | "cap_reached"
  | "no_op";

export interface ApplyOutcome {
  kind: ApplyOutcomeKind;
  decision: DecisionToInsert;
  wrote: boolean;
}

export interface ApplyOptimisationInput {
  decision: DecisionToInsert;
  campaignName: string;
  adsetName: string;
  gates: OptimisationDryRunGates;
  /** How many Meta writes this run may still issue. 0 → shadow the rest. */
  writesRemaining: number;
  /**
   * Fourth gate. Default false — pause stays recommend-only (today's
   * behaviour) even when the three budget-write gates are open.
   */
  pauseWritesEnabled?: boolean;
  /**
   * Configured pause floor in pence. Null / undefined / ≤0 = floor off;
   * no automatic pause and no reduce-to-floor.
   */
  pauseFloorBudgetPence?: number | null;
  /** Delivering ad sets left in this campaign (decrements after a pause). */
  activeAdSetCount?: number;
  /** Active ad sets that evaluated to pause on this tick. */
  pauseCandidatesInCampaign?: number;
  /** True when every delivering ad set on this tick evaluated to pause. */
  campaignWideBreach?: boolean;
  /** Remaining pause writes this run. Default {@link MAX_PAUSES_PER_RUN}. */
  pausesRemaining?: number;
}

export interface ApplyOptimisationDeps {
  readAdSetDailyBudget: (adsetId: string) => Promise<number | null>;
  updateAdSetDailyBudget: (adsetId: string, dailyBudgetPence: number) => Promise<unknown>;
  readCampaignDailyBudget: (campaignId: string) => Promise<number | null>;
  updateCampaignDailyBudget: (campaignId: string, dailyBudgetPence: number) => Promise<unknown>;
  insertDecision: (row: DecisionToInsert) => Promise<void>;
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  /** Meta `POST /{adset_id}` `{ status: "PAUSED" }`. Never writes ACTIVE. */
  pauseAdSet?: (adsetId: string) => Promise<unknown>;
  now?: Date;
  log?: (message: string) => void;
}

/** Meta `effective_status` values that still spend. Missing status is not active. */
export function isDeliveringAdSetStatus(status: string | null | undefined): boolean {
  return status === "ACTIVE" || status === "LEARNING" || status === "LEARNING_LIMITED";
}

function isCampaignScope(decision: DecisionToInsert): boolean {
  return decision.scope === "campaign";
}

function targetId(decision: DecisionToInsert): string {
  return isCampaignScope(decision) ? decision.campaignId : decision.adsetId;
}

function logLine(deps: ApplyOptimisationDeps, message: string): void {
  (deps.log ?? console.log)(message);
}

function metaErrorPayload(err: unknown): Record<string, unknown> {
  if (err && typeof err === "object") {
    const e = err as {
      message?: string;
      code?: number;
      type?: string;
      subcode?: number;
      name?: string;
    };
    return {
      error: e.message ?? String(err),
      code: e.code,
      type: e.type,
      error_subcode: e.subcode,
      name: e.name,
    };
  }
  return { error: String(err) };
}

function readMetaCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && typeof (err as { code?: unknown }).code === "number") {
    return (err as { code: number }).code;
  }
  return undefined;
}

function wouldWriteBudget(decision: DecisionToInsert): boolean {
  const action = decision.actionRecommended;
  return (
    (action === "scale_up" || action === "scale_down") &&
    decision.budgetAfterPence !== decision.budgetBeforePence
  );
}

async function persist(
  deps: ApplyOptimisationDeps,
  decision: DecisionToInsert,
): Promise<void> {
  await deps.insertDecision(decision);
}

export async function applyOptimisationDecision(
  input: ApplyOptimisationInput,
  deps: ApplyOptimisationDeps,
): Promise<ApplyOutcome> {
  const { decision, campaignName, adsetName, gates, writesRemaining } = input;

  if (gates.dryRun) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: true,
      applied: false,
    };
    await persist(deps, row);
    return { kind: "shadow", decision: row, wrote: false };
  }

  if (decision.actionRecommended === "pause") {
    return applyPauseDecision(input, deps);
  }

  if (!wouldWriteBudget(decision)) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: true,
      applied: false,
    };
    await persist(deps, row);
    return { kind: "no_op", decision: row, wrote: false };
  }

  if (writesRemaining <= 0) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: true,
      applied: false,
    };
    await persist(deps, row);
    logLine(
      deps,
      `[optimisation-tick] write cap reached — shadowing target=${targetId(decision)} (MAX_WRITES_PER_RUN)`,
    );
    return { kind: "cap_reached", decision: row, wrote: false };
  }

  // Re-read live daily_budget immediately before writing so a mid-flight
  // operator change is not clobbered.
  const target = targetId(decision);
  const campaignScoped = isCampaignScope(decision);
  let liveBudget: number | null;
  try {
    liveBudget = campaignScoped
      ? await deps.readCampaignDailyBudget(decision.campaignId)
      : await deps.readAdSetDailyBudget(decision.adsetId);
  } catch (err) {
    const payload = metaErrorPayload(err);
    logLine(
      deps,
      `[optimisation-tick] re-read failed target=${target} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
    );
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      metaResponseJson: payload,
    };
    await persist(deps, row);
    await deps.notify({
      channel: "ads_urgent",
      text:
        `Optimisation write failed (re-read) — campaign="${campaignName}" ` +
        `${campaignScoped ? "campaign" : `ad set="${adsetName}"`} (${target}) meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      dedupeKey: `optimisation_write_error:${target}`,
    });
    return { kind: "write_failed", decision: row, wrote: false };
  }

  if (liveBudget !== decision.budgetBeforePence) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      guardrailNote: "budget_changed_underfoot",
      reasonText:
        `${decision.reasonText} Aborted: live daily_budget=${liveBudget} ` +
        `≠ evaluated budget_before_pence=${decision.budgetBeforePence}.`,
    };
    await persist(deps, row);
    logLine(
      deps,
      `[optimisation-tick] budget_changed_underfoot target=${target} live=${liveBudget} evaluated=${decision.budgetBeforePence}`,
    );
    return { kind: "aborted_underfoot", decision: row, wrote: false };
  }

  try {
    const response = campaignScoped
      ? await deps.updateCampaignDailyBudget(decision.campaignId, decision.budgetAfterPence)
      : await deps.updateAdSetDailyBudget(decision.adsetId, decision.budgetAfterPence);
    const now = deps.now ?? new Date();
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: true,
      appliedAt: now.toISOString(),
      metaResponseJson: response ?? { success: true },
    };
    await persist(deps, row);
    return { kind: "applied", decision: row, wrote: true };
  } catch (err) {
    const payload = metaErrorPayload(err);
    logLine(
      deps,
      `[optimisation-tick] write failed target=${target} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
    );
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      metaResponseJson: payload,
    };
    await persist(deps, row);
    await deps.notify({
      channel: "ads_urgent",
      text:
        `Optimisation write failed — campaign="${campaignName}" ` +
        `${campaignScoped ? "campaign" : `ad set="${adsetName}"`} (${target}) ` +
        `${decision.budgetBeforePence} → ${decision.budgetAfterPence} ` +
        `meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      dedupeKey: `optimisation_write_error:${target}`,
    });
    return { kind: "write_failed", decision: row, wrote: false };
  }
}

async function recommendPause(
  input: ApplyOptimisationInput,
  deps: ApplyOptimisationDeps,
  extras: Partial<DecisionToInsert> = {},
  kind: "pause_recommended" | "pause_blocked" = "pause_recommended",
  slackText?: string,
  dedupeKey?: string,
): Promise<ApplyOutcome> {
  const { decision, campaignName, adsetName } = input;
  const row: DecisionToInsert = {
    ...decision,
    dryRun: true,
    applied: false,
    ...extras,
  };
  await persist(deps, row);
  await deps.notify({
    channel: "ads_urgent",
    text:
      slackText ??
      `Optimisation recommended PAUSE — campaign="${campaignName}" ` +
        `ad set="${adsetName}" (${decision.adsetId}): ${row.reasonText}`,
    dedupeKey: dedupeKey ?? `optimisation_pause:${decision.adsetId}`,
    respectBusinessHours: false,
  });
  return { kind, decision: row, wrote: false };
}

async function applyPauseDecision(
  input: ApplyOptimisationInput,
  deps: ApplyOptimisationDeps,
): Promise<ApplyOutcome> {
  const { decision, campaignName, adsetName, writesRemaining } = input;
  const pauseWritesEnabled = input.pauseWritesEnabled === true;

  // Fourth gate closed — today's behaviour exactly: shadow + ads_urgent.
  if (!pauseWritesEnabled) {
    return recommendPause(input, deps);
  }

  // CBO / campaign-scope pause is a dead campaign nobody chose to kill.
  if (isCampaignScope(decision)) {
    const slack =
      `campaign-wide breach — campaign-budget pause, no automatic pause ` +
      `(campaign="${campaignName}"): ${decision.reasonText}`;
    return recommendPause(
      input,
      deps,
      {
        guardrailNote: "pause_campaign_wide",
        reasonText: `${decision.reasonText} ${slack}`,
      },
      "pause_blocked",
      slack,
      `optimisation_pause_campaign_wide:${decision.campaignId}`,
    );
  }

  const active = input.activeAdSetCount ?? 0;
  const candidates = input.pauseCandidatesInCampaign ?? 0;
  if (input.campaignWideBreach === true) {
    const slack =
      `campaign-wide breach — ${candidates} of ${candidates} ad sets over threshold, ` +
      `no automatic pause (campaign="${campaignName}")`;
    return recommendPause(
      input,
      deps,
      {
        guardrailNote: "pause_campaign_wide",
        reasonText: `${decision.reasonText} ${slack}`,
      },
      "pause_blocked",
      slack,
      `optimisation_pause_campaign_wide:${decision.campaignId}`,
    );
  }

  const floor = input.pauseFloorBudgetPence;
  if (floor == null || floor <= 0) {
    return recommendPause(
      input,
      deps,
      {
        guardrailNote: "pause_floor_unset",
        reasonText: `${decision.reasonText} Pause floor unset — no automatic pause.`,
      },
      "pause_blocked",
    );
  }

  const target = decision.adsetId;
  let liveBudget: number | null;
  try {
    liveBudget = await deps.readAdSetDailyBudget(decision.adsetId);
  } catch (err) {
    const payload = metaErrorPayload(err);
    logLine(
      deps,
      `[optimisation-tick] re-read failed target=${target} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
    );
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      metaResponseJson: payload,
    };
    await persist(deps, row);
    await deps.notify({
      channel: "ads_urgent",
      text:
        `Optimisation write failed (re-read) — campaign="${campaignName}" ` +
        `ad set="${adsetName}" (${target}) meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      dedupeKey: `optimisation_write_error:${target}`,
      respectBusinessHours: false,
    });
    return { kind: "write_failed", decision: row, wrote: false };
  }

  if (liveBudget !== decision.budgetBeforePence) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      guardrailNote: "budget_changed_underfoot",
      reasonText:
        `${decision.reasonText} Aborted: live daily_budget=${liveBudget} ` +
        `≠ evaluated budget_before_pence=${decision.budgetBeforePence}.`,
    };
    await persist(deps, row);
    logLine(
      deps,
      `[optimisation-tick] budget_changed_underfoot target=${target} live=${liveBudget} evaluated=${decision.budgetBeforePence}`,
    );
    return { kind: "aborted_underfoot", decision: row, wrote: false };
  }

  // Prefer a floor to a stop. First breach above the floor is a cut.
  if (liveBudget > floor) {
    if (writesRemaining <= 0) {
      const row: DecisionToInsert = {
        ...decision,
        dryRun: true,
        applied: false,
      };
      await persist(deps, row);
      logLine(
        deps,
        `[optimisation-tick] write cap reached — cutting to pause floor skipped target=${target}`,
      );
      return { kind: "cap_reached", decision: row, wrote: false };
    }
    try {
      const response = await deps.updateAdSetDailyBudget(decision.adsetId, floor);
      const now = deps.now ?? new Date();
      const row: DecisionToInsert = {
        ...decision,
        budgetAfterPence: floor,
        guardrailNote: "reduced_to_pause_floor",
        reasonText:
          `${decision.reasonText} Reduced to pause floor ${floor}p ` +
          `(was ${liveBudget}p) — not paused.`,
        dryRun: false,
        applied: true,
        appliedAt: now.toISOString(),
        metaResponseJson: {
          ...(response && typeof response === "object" ? (response as Record<string, unknown>) : { success: true }),
          adset_id: decision.adsetId,
          budget_before_pence: liveBudget,
          budget_after_pence: floor,
        },
      };
      await persist(deps, row);
      await deps.notify({
        channel: "ads_urgent",
        text:
          `Optimisation reduced to pause floor — campaign="${campaignName}" ` +
          `ad set="${adsetName}" (${decision.adsetId}) ${liveBudget} → ${floor}: ${row.reasonText}`,
        dedupeKey: `optimisation_pause_floor:${decision.adsetId}`,
        respectBusinessHours: false,
      });
      return { kind: "pause_reduced_to_floor", decision: row, wrote: true };
    } catch (err) {
      const payload = metaErrorPayload(err);
      logLine(
        deps,
        `[optimisation-tick] pause-floor write failed target=${target} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      );
      const row: DecisionToInsert = {
        ...decision,
        dryRun: false,
        applied: false,
        metaResponseJson: payload,
      };
      await persist(deps, row);
      await deps.notify({
        channel: "ads_urgent",
        text:
          `Optimisation write failed — campaign="${campaignName}" ` +
          `ad set="${adsetName}" (${target}) ${liveBudget} → ${floor} ` +
          `meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
        dedupeKey: `optimisation_write_error:${target}`,
        respectBusinessHours: false,
      });
      return { kind: "write_failed", decision: row, wrote: false };
    }
  }

  const resultCount = decision.resultCount;
  if (resultCount == null || resultCount < MIN_PAUSE_CONVERSION_RESULT_COUNT) {
    return recommendPause(
      input,
      deps,
      {
        guardrailNote: "pause_insufficient_conversions",
        reasonText:
          `${decision.reasonText} ${resultCount ?? 0}/${MIN_PAUSE_CONVERSION_RESULT_COUNT} ` +
          `conversions — pause evidence too thin, no automatic pause.`,
      },
      "pause_blocked",
    );
  }

  if (active <= 1) {
    const slack =
      `last active ad set — no automatic pause (campaign="${campaignName}" ` +
      `ad set="${adsetName}")`;
    return recommendPause(
      input,
      deps,
      {
        guardrailNote: "pause_last_active",
        reasonText: `${decision.reasonText} ${slack}`,
      },
      "pause_blocked",
      slack,
    );
  }

  const pausesRemaining = input.pausesRemaining ?? MAX_PAUSES_PER_RUN;
  if (pausesRemaining <= 0) {
    return recommendPause(
      input,
      deps,
      {
        guardrailNote: "pause_cap_reached",
        reasonText:
          `${decision.reasonText} Pause cap reached ` +
          `(MAX_PAUSES_PER_RUN=${MAX_PAUSES_PER_RUN}) — no automatic pause.`,
      },
      "pause_blocked",
    );
  }

  if (writesRemaining <= 0) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: true,
      applied: false,
    };
    await persist(deps, row);
    logLine(
      deps,
      `[optimisation-tick] write cap reached — pause shadowed target=${target} (MAX_WRITES_PER_RUN)`,
    );
    return { kind: "cap_reached", decision: row, wrote: false };
  }

  if (!deps.pauseAdSet) {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      metaResponseJson: { error: "pauseAdSet seam missing" },
    };
    await persist(deps, row);
    return { kind: "write_failed", decision: row, wrote: false };
  }

  try {
    const response = await deps.pauseAdSet(decision.adsetId);
    const now = deps.now ?? new Date();
    const row: DecisionToInsert = {
      ...decision,
      budgetAfterPence: liveBudget,
      guardrailNote: "paused_at_floor",
      reasonText: `${decision.reasonText} Paused at floor ${floor}p (budget at pause ${liveBudget}p).`,
      dryRun: false,
      applied: true,
      appliedAt: now.toISOString(),
      metaResponseJson: {
        ...(response && typeof response === "object" ? (response as Record<string, unknown>) : { success: true }),
        adset_id: decision.adsetId,
        budget_at_pause_pence: liveBudget,
        status: "PAUSED",
      },
    };
    await persist(deps, row);
    await deps.notify({
      channel: "ads_urgent",
      text:
        `Optimisation PAUSED — campaign="${campaignName}" ` +
        `ad set="${adsetName}" (${decision.adsetId}) budget_at_pause=${liveBudget}p: ${row.reasonText}`,
      dedupeKey: `optimisation_pause:${decision.adsetId}`,
      respectBusinessHours: false,
    });
    return { kind: "paused", decision: row, wrote: true };
  } catch (err) {
    const payload = metaErrorPayload(err);
    logLine(
      deps,
      `[optimisation-tick] pause write failed target=${target} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
    );
    const row: DecisionToInsert = {
      ...decision,
      dryRun: false,
      applied: false,
      metaResponseJson: payload,
    };
    await persist(deps, row);
    await deps.notify({
      channel: "ads_urgent",
      text:
        `Optimisation pause write failed — campaign="${campaignName}" ` +
        `ad set="${adsetName}" (${target}) ` +
        `meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      dedupeKey: `optimisation_write_error:${target}`,
      respectBusinessHours: false,
    });
    return { kind: "write_failed", decision: row, wrote: false };
  }
}
