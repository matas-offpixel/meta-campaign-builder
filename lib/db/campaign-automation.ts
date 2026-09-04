/**
 * Session-scoped reads/writes for task #120 PR C.
 * Flags live on campaign_drafts columns (not draft_json). Decisions are
 * read-only here — inserts stay on the cron / service-role path.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  presentDecisionRow,
  type DecisionRowInput,
  type DecisionRowView,
} from "@/lib/optimisation/automation-ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

export type CampaignAutomationState = {
  enabled: boolean;
  live: boolean;
  status: string;
  lastEvaluatedAt: string | null;
  decisions: DecisionRowView[];
  materialisedPreset: { presetId: string; presetVersion: number } | null;
};

interface DraftFlagRow {
  id: string;
  user_id: string;
  status: string | null;
  optimisation_automation_enabled: boolean | null;
  optimisation_automation_live: boolean | null;
  draft_json?: unknown;
}

export async function loadCampaignAutomationState(
  supabase: SupabaseClient,
  draftId: string,
  userId: string,
): Promise<CampaignAutomationState | null> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("campaign_drafts")
    .select(
      "id, user_id, status, optimisation_automation_enabled, optimisation_automation_live, draft_json",
    )
    .eq("id", draftId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as DraftFlagRow;

  const { data: decisionRows, error: decErr } = await sb
    .from("campaign_automation_decisions")
    .select(
      "decided_at, metric, metric_value, metric_window, rule_matched, action_recommended, budget_before_pence, budget_after_pence, applied, dry_run, reason_text, channel, scope, campaign_id, adset_id, meta_response_json",
    )
    .eq("draft_id", draftId)
    .order("decided_at", { ascending: false })
    .limit(40);

  if (decErr) {
    const missingOptionalColumn =
      decErr.code === "42703" ||
      (/(channel|scope)/i.test(decErr.message ?? "") &&
        /does not exist|schema cache|could not find/i.test(decErr.message ?? ""));
    if (!missingOptionalColumn) {
      throw new Error(`loadCampaignAutomationState: decisions query failed: ${decErr.message}`);
    }
    const retry = await sb
      .from("campaign_automation_decisions")
      .select(
        "decided_at, metric, metric_value, metric_window, rule_matched, action_recommended, budget_before_pence, budget_after_pence, applied, dry_run, reason_text, campaign_id, adset_id, meta_response_json",
      )
      .eq("draft_id", draftId)
      .order("decided_at", { ascending: false })
      .limit(40);
    if (retry.error) {
      throw new Error(`loadCampaignAutomationState: decisions query failed: ${retry.error.message}`);
    }
    const decisions = ((retry.data ?? []) as DecisionRowInput[]).map(presentDecisionRow);
    const lastEvaluatedAt = decisions[0]?.decidedAt ?? null;
    return {
      enabled: row.optimisation_automation_enabled === true,
      live: row.optimisation_automation_live === true,
      status: row.status ?? "draft",
      lastEvaluatedAt,
      decisions,
      materialisedPreset: materialisedFromDraftJson(row.draft_json),
    };
  }

  const decisions = ((decisionRows ?? []) as DecisionRowInput[]).map(presentDecisionRow);
  const lastEvaluatedAt = decisions[0]?.decidedAt ?? null;

  return {
    enabled: row.optimisation_automation_enabled === true,
    live: row.optimisation_automation_live === true,
    status: row.status ?? "draft",
    lastEvaluatedAt,
    decisions,
    materialisedPreset: materialisedFromDraftJson(row.draft_json),
  };
}

function materialisedFromDraftJson(
  json: unknown,
): { presetId: string; presetVersion: number } | null {
  if (!json || typeof json !== "object") return null;
  const strategy = (json as { optimisationStrategy?: { preset?: { presetId?: unknown; presetVersion?: unknown } } })
    .optimisationStrategy;
  const preset = strategy?.preset;
  if (!preset || typeof preset.presetId !== "string") return null;
  if (typeof preset.presetVersion !== "number" || !Number.isFinite(preset.presetVersion)) {
    return null;
  }
  return { presetId: preset.presetId, presetVersion: preset.presetVersion };
}

export async function updateCampaignAutomationFlags(
  supabase: SupabaseClient,
  draftId: string,
  userId: string,
  flags: { enabled: boolean; live: boolean },
): Promise<boolean> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("campaign_drafts")
    .update({
      optimisation_automation_enabled: flags.enabled,
      optimisation_automation_live: flags.live,
    })
    .eq("id", draftId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error(`updateCampaignAutomationFlags: ${error.message}`);
  }
  return Boolean(data);
}
