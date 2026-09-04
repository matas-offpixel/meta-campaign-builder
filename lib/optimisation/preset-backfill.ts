/**
 * lib/optimisation/preset-backfill.ts
 *
 * Pure planner behind `scripts/backfill-optimisation-presets.mjs`.
 *
 * One preset per client × objective, seeded from the most recent PUBLISHED
 * campaign with that objective (its absolute bands re-expressed as
 * multipliers of its own target), or from the industry seed when the client
 * has never published at that objective.
 *
 * Split out from the script so the dry run is testable on a fixture without
 * a database: the script does Supabase I/O and table printing, this module
 * makes every decision.
 *
 * Existing presets are never overwritten. A backfill that clobbered a
 * hand-tuned ladder would be worse than not running.
 */

import {
  DEFAULT_PRESET_GUARDRAILS,
  industrySeedPreset,
  presetLadderMetric,
  ruleToPresetRule,
  type ClientOptimisationPreset,
  type PresetArm,
  type PresetGuardrails,
  type PresetRule,
} from "./presets.ts";
import { OBJECTIVE_METRIC_PRIORITY } from "../optimisation-rules.ts";
import type {
  CampaignObjective,
  OptimisationRule,
  OptimisationStrategyMode,
  OptimisationStrategySettings,
} from "../types.ts";

/** A published campaign, reduced to what the backfill reads. */
export interface BackfillCampaign {
  id: string;
  name: string | null;
  clientId: string;
  objective: CampaignObjective;
  status: string;
  updatedAt: string;
  strategy: OptimisationStrategySettings | null;
}

export interface BackfillClient {
  id: string;
  name: string;
}

export type BackfillOutcome =
  /** A preset already exists — left alone. */
  | "exists"
  /** Seeded from a published campaign's own ladder. */
  | "from campaign"
  /** No published campaign at this objective — industry seed. */
  | "industry seed"
  /**
   * A published campaign existed but its ladder cannot serve this
   * objective — see `objectiveLadderMismatch`. Industry seed instead, and
   * the source campaign is named so the mislabelling can be fixed.
   */
  | "seed · mismatch";

export interface BackfillRow {
  clientId: string;
  clientName: string;
  objective: CampaignObjective;
  outcome: BackfillOutcome;
  /** The campaign the ladder came from, when `outcome` is "from campaign". */
  sourceCampaignId: string | null;
  sourceCampaignName: string | null;
  /** The denominator the multipliers were computed against. */
  benchmarkTarget: number | null;
  metric: string;
  timeWindow: string;
  bandCount: number;
  defaultArm: PresetArm;
  mode: OptimisationStrategyMode;
  rules: PresetRule[];
  guardrails: PresetGuardrails;
  /** True when the row would be written by `--apply`. */
  willWrite: boolean;
}

export interface BackfillPlan {
  rows: BackfillRow[];
  /** Rows `--apply` would insert. */
  writes: number;
  skipped: number;
}

/**
 * `off`, always.
 *
 * A backfill exists to record what a client's campaigns already do, not to
 * change what any of them will do next. Arming even shadow across every
 * client from a script is a decision an operator should make per client, in
 * the UI, with the ladder in front of them.
 */
export const BACKFILL_DEFAULT_ARM: PresetArm = "off";

export function planPresetBackfill(input: {
  clients: readonly BackfillClient[];
  campaigns: readonly BackfillCampaign[];
  existing: readonly ClientOptimisationPreset[];
}): BackfillPlan {
  const nameById = new Map(input.clients.map((c) => [c.id, c.name]));
  const existingKeys = new Set(
    input.existing.map((p) => `${p.clientId}:${p.objective}`),
  );

  // Every client × objective pair that shows up anywhere, in a stable order.
  const pairs = new Map<string, { clientId: string; objective: CampaignObjective }>();
  for (const campaign of input.campaigns) {
    if (!nameById.has(campaign.clientId)) continue;
    pairs.set(`${campaign.clientId}:${campaign.objective}`, {
      clientId: campaign.clientId,
      objective: campaign.objective,
    });
  }

  const rows: BackfillRow[] = [];
  for (const [key, pair] of [...pairs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const clientName = nameById.get(pair.clientId) ?? pair.clientId;
    const source = mostRecentPublished(input.campaigns, pair.clientId, pair.objective);
    const exists = existingKeys.has(key);

    const candidate = source
      ? presetFromCampaign(pair.clientId, pair.objective, source)
      : null;
    // A ladder that cannot price this objective is not this objective's
    // policy, however recently it was published.
    const mismatch = candidate != null && objectiveLadderMismatch(candidate);
    const seeded = mismatch ? null : candidate;
    const preset = seeded ?? industrySeedPreset(pair.clientId, pair.objective);
    const primary =
      preset.rules.find((r) => r.metric === presetLadderMetric(preset)) ??
      preset.rules[0] ??
      null;

    rows.push({
      clientId: pair.clientId,
      clientName,
      objective: pair.objective,
      outcome: exists
        ? "exists"
        : seeded
          ? "from campaign"
          : mismatch
            ? "seed · mismatch"
            : "industry seed",
      // The mislabelled campaign is named too — that is the thing to fix.
      sourceCampaignId: seeded || mismatch ? source!.id : null,
      sourceCampaignName: seeded || mismatch ? source!.name : null,
      benchmarkTarget: primary?.benchmarkTarget ?? null,
      metric: primary?.metric ?? "—",
      timeWindow: primary?.timeWindow ?? "—",
      bandCount: primary?.thresholds.length ?? 0,
      defaultArm: BACKFILL_DEFAULT_ARM,
      mode: preset.mode,
      rules: preset.rules,
      guardrails: preset.guardrails,
      willWrite: !exists,
    });
  }

  return {
    rows,
    writes: rows.filter((r) => r.willWrite).length,
    skipped: rows.filter((r) => !r.willWrite).length,
  };
}

/**
 * True when none of the preset's rules carry the metric this objective is
 * priced in — so `materialiseStrategy` would scale nothing and a campaign
 * target would move no band.
 *
 * Prod has at least one of these: a signups campaign copied and flipped to
 * `purchase` while keeping its CPR ladder. Seeding a client's purchase
 * policy from it would write a preset that silently ignores every
 * £-per-purchase target ever typed against it.
 */
export function objectiveLadderMismatch(preset: ClientOptimisationPreset): boolean {
  const required = OBJECTIVE_METRIC_PRIORITY[preset.objective].primary;
  return !preset.rules.some((rule) => rule.metric === required);
}

function mostRecentPublished(
  campaigns: readonly BackfillCampaign[],
  clientId: string,
  objective: CampaignObjective,
): BackfillCampaign | null {
  const candidates = campaigns.filter(
    (c) =>
      c.clientId === clientId &&
      c.objective === objective &&
      c.status === "published" &&
      hasUsableLadder(c.strategy),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, c) =>
    c.updatedAt > best.updatedAt ? c : best,
  );
}

/**
 * A ladder is usable when at least one enabled rule has bands. A published
 * campaign whose mode was `none`, or whose rules were never generated, has
 * no policy to learn from — the industry seed is the honest answer.
 */
function hasUsableLadder(strategy: OptimisationStrategySettings | null): boolean {
  if (!strategy || strategy.mode === "none") return false;
  return strategy.rules.some((r) => r.enabled && r.thresholds.length > 0);
}

/**
 * A published campaign's strategy, turned into client policy: absolute
 * bands become multipliers of that campaign's own target, and the two
 * budget-derived guardrails are dropped (they belong to that campaign's
 * budget, not to the client).
 */
export function presetFromCampaign(
  clientId: string,
  objective: CampaignObjective,
  campaign: BackfillCampaign,
): ClientOptimisationPreset | null {
  const strategy = campaign.strategy;
  if (!strategy) return null;

  const rules = strategy.rules
    .filter((r: OptimisationRule) => r.thresholds.length > 0)
    .map((r: OptimisationRule) => ruleToPresetRule(r));
  if (rules.length === 0) return null;

  return {
    id: `backfill:${clientId}:${objective}`,
    clientId,
    objective,
    version: 0,
    defaultArm: BACKFILL_DEFAULT_ARM,
    mode: strategy.mode,
    rules,
    guardrails: guardrailsFromCampaign(strategy),
    updatedAt: campaign.updatedAt,
  };
}

function guardrailsFromCampaign(
  strategy: OptimisationStrategySettings,
): PresetGuardrails {
  const g = strategy.guardrails;
  if (!g) return { ...DEFAULT_PRESET_GUARDRAILS };
  const out: PresetGuardrails = {
    maxExpansionPercent: g.maxExpansionPercent,
    ceilingBehaviour: g.ceilingBehaviour,
  };
  if (g.maxSingleAdSetBudget != null) {
    out.maxSingleAdSetBudget = g.maxSingleAdSetBudget;
    out.maxSingleAdSetBudgetType = g.maxSingleAdSetBudgetType ?? "fixed";
  }
  if (g.maxDailyIncreasePercent != null) {
    out.maxDailyIncreasePercent = g.maxDailyIncreasePercent;
  }
  if (g.cooldownHours != null) out.cooldownHours = g.cooldownHours;
  return out;
}

// ─── Table rendering ──────────────────────────────────────────────────────

/**
 * The dry-run table, one block per client. Returned as a string rather than
 * printed so the fixture test can assert on it.
 */
export function renderBackfillTable(plan: BackfillPlan): string {
  if (plan.rows.length === 0) {
    return "No client × objective pairs found — no published campaigns with a client attached.";
  }

  const byClient = new Map<string, BackfillRow[]>();
  for (const row of plan.rows) {
    const list = byClient.get(row.clientId) ?? [];
    list.push(row);
    byClient.set(row.clientId, list);
  }

  const blocks: string[] = [];
  for (const rows of byClient.values()) {
    const lines = [`${rows[0].clientName}  (${rows[0].clientId})`];
    lines.push(
      pad("objective", 13) +
        pad("outcome", 16) +
        pad("metric", 10) +
        pad("win", 5) +
        pad("target", 9) +
        pad("bands", 6) +
        pad("arm", 7) +
        "source",
    );
    for (const row of rows) {
      lines.push(
        pad(row.objective, 13) +
          pad(row.outcome, 16) +
          pad(row.metric, 10) +
          pad(row.timeWindow, 5) +
          pad(row.benchmarkTarget == null ? "—" : String(row.benchmarkTarget), 9) +
          pad(String(row.bandCount), 6) +
          pad(row.defaultArm, 7) +
          (row.outcome === "seed · mismatch" ? "! " : "") +
          (row.sourceCampaignName ?? (row.outcome === "exists" ? "(kept)" : "—")),
      );
    }
    blocks.push(lines.join("\n"));
  }

  blocks.push(
    `${plan.writes} to write · ${plan.skipped} already present · ${plan.rows.length} pairs`,
  );

  const mismatched = plan.rows.filter((r) => r.outcome === "seed · mismatch");
  if (mismatched.length > 0) {
    blocks.push(
      [
        `! ${mismatched.length} pair(s) fell back to the seed: the named campaign's ladder`,
        "  cannot price its objective, so it was not used as policy. Fix the",
        "  campaign's objective (or hand-tune the preset) and re-run:",
        ...mismatched.map(
          (r) =>
            `    ${r.clientName} / ${r.objective} ← ${r.sourceCampaignName ?? r.sourceCampaignId}`,
        ),
      ].join("\n"),
    );
  }
  return blocks.join("\n\n");
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)} ` : value.padEnd(width);
}
