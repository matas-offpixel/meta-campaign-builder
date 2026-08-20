/**
 * lib/optimisation/apply.ts
 *
 * PR B executor — consumes an `EvaluateAdSetResult` (already folded into
 * `DecisionToInsert`) and either writes the Meta daily_budget or records
 * a shadow / abort / pause-recommend row. Decision *logic* stays in
 * `evaluate.ts`; this module only executes.
 *
 * Pure except for injected Meta / DB / Slack seams — no `@/` imports so
 * `node --test` can load it.
 */

import type { NotifyOptions, NotifyResult } from "../notify/slack.ts";
import type { OptimisationDryRunGates } from "./gates.ts";
import type { DecisionToInsert } from "./tick-runner.ts";

export const MAX_WRITES_PER_RUN = 25;

export type ApplyOutcomeKind =
  | "shadow"
  | "pause_recommended"
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
}

export interface ApplyOptimisationDeps {
  readAdSetDailyBudget: (adsetId: string) => Promise<number | null>;
  updateAdSetDailyBudget: (adsetId: string, dailyBudgetPence: number) => Promise<unknown>;
  insertDecision: (row: DecisionToInsert) => Promise<void>;
  notify: (opts: NotifyOptions) => Promise<NotifyResult>;
  now?: Date;
  log?: (message: string) => void;
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

  // Pause is recommend-only in PR B — never a Meta write, even with all
  // three gates open. Killing delivery stays human.
  if (decision.actionRecommended === "pause") {
    const row: DecisionToInsert = {
      ...decision,
      dryRun: true,
      applied: false,
    };
    await persist(deps, row);
    await deps.notify({
      channel: "ads_urgent",
      text:
        `Optimisation recommended PAUSE — campaign="${campaignName}" ` +
        `ad set="${adsetName}" (${decision.adsetId}): ${decision.reasonText}`,
      dedupeKey: `optimisation_pause:${decision.adsetId}`,
    });
    return { kind: "pause_recommended", decision: row, wrote: false };
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
      `[optimisation-tick] write cap reached — shadowing adset=${decision.adsetId} (MAX_WRITES_PER_RUN)`,
    );
    return { kind: "cap_reached", decision: row, wrote: false };
  }

  // Re-read live daily_budget immediately before writing so a mid-flight
  // operator change is not clobbered.
  let liveBudget: number | null;
  try {
    liveBudget = await deps.readAdSetDailyBudget(decision.adsetId);
  } catch (err) {
    const payload = metaErrorPayload(err);
    logLine(
      deps,
      `[optimisation-tick] re-read failed adset=${decision.adsetId} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
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
        `ad set="${adsetName}" (${decision.adsetId}) meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      dedupeKey: `optimisation_write_error:${decision.adsetId}`,
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
      `[optimisation-tick] budget_changed_underfoot adset=${decision.adsetId} live=${liveBudget} evaluated=${decision.budgetBeforePence}`,
    );
    return { kind: "aborted_underfoot", decision: row, wrote: false };
  }

  try {
    const response = await deps.updateAdSetDailyBudget(
      decision.adsetId,
      decision.budgetAfterPence,
    );
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
      `[optimisation-tick] write failed adset=${decision.adsetId} meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
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
        `ad set="${adsetName}" (${decision.adsetId}) ` +
        `${decision.budgetBeforePence} → ${decision.budgetAfterPence} ` +
        `meta_code=${readMetaCode(err) ?? "?"}: ${payload.error}`,
      dedupeKey: `optimisation_write_error:${decision.adsetId}`,
    });
    return { kind: "write_failed", decision: row, wrote: false };
  }
}
