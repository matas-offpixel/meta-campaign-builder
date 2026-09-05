/**
 * lib/db/campaign-automation-decisions.ts
 *
 * Supabase glue for task #120 PR A (dry-run Optimisation Strategy
 * automation). Kept separate from the pure `lib/optimisation/tick-runner.ts`
 * orchestration so that module stays `node --test`-friendly (no `@/`
 * imports, no live Supabase client) — this file is the thin, untested-by-design
 * adapter the cron route wires the pure runner up to, same split as
 * `lib/reporting/cron-health-monitor.ts`'s `runCronHealthCheck` /
 * `writeCronHealthReport`.
 *
 * `campaign_automation_decisions` and `campaign_drafts.optimisation_automation_enabled`
 * are new as of migration 151 and may not yet be in the generated Supabase
 * types on a fresh checkout — same `as unknown as any` cast used by every
 * other freshly-migrated-table writer in this codebase (see
 * `writeCronHealthReport`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { migrateDraft } from "@/lib/autosave";
import type { CampaignAutomationInput, DecisionToInsert } from "@/lib/optimisation/tick-runner";

function isUndefinedColumnError(
  error: { message?: string; code?: string } | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  if (error.code === "42703") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes(column.toLowerCase()) &&
    (msg.includes("does not exist") ||
      msg.includes("schema cache") ||
      msg.includes("could not find"))
  );
}

function mergeInsightJson(
  existing: unknown,
  channel: string,
  resultCount: number | null | undefined,
): unknown {
  const extra: Record<string, unknown> = { channel };
  if (resultCount != null) extra.resultCount = resultCount;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>), ...extra };
  }
  if (existing == null) return extra;
  return existing;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

interface OptedInDraftRow {
  id: string;
  ad_account_id: string | null;
  draft_json: Record<string, unknown>;
  optimisation_automation_live: boolean | null;
}

/**
 * Campaigns opted into the automation loop: `status = 'published' AND
 * optimisation_automation_enabled = true`. Draft rows that fail to migrate
 * or have no `metaCampaignId` yet (launched-but-not-yet-published edge case)
 * are skipped with a console warning rather than thrown — one malformed
 * draft should never abort the whole tick.
 */
export async function loadOptedInCampaignsForAutomation(
  supabase: SupabaseClient,
): Promise<CampaignAutomationInput[]> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("campaign_drafts")
    .select("id, ad_account_id, draft_json, optimisation_automation_live")
    .eq("status", "published")
    .eq("optimisation_automation_enabled", true);

  if (error) {
    throw new Error(`loadOptedInCampaignsForAutomation: query failed: ${error.message}`);
  }

  const rows = (data ?? []) as OptedInDraftRow[];
  const campaigns: CampaignAutomationInput[] = [];
  for (const row of rows) {
    try {
      const draft = migrateDraft(row.draft_json);
      if (!draft.metaCampaignId) {
        console.warn(
          `[campaign-automation-decisions] draft=${row.id} opted in but has no metaCampaignId — skipping`,
        );
        continue;
      }
      campaigns.push({
        draftId: draft.id,
        campaignId: draft.metaCampaignId,
        adAccountId: row.ad_account_id ?? draft.settings.adAccountId,
        objective: draft.settings.objective,
        optimisationStrategy: draft.optimisationStrategy,
        optimisationAutomationLive: row.optimisation_automation_live === true,
        campaignName: draft.settings.campaignName || draft.metaCampaignId,
      });
    } catch (err) {
      console.warn(
        `[campaign-automation-decisions] draft=${row.id} failed to migrate — skipping`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return campaigns;
}

/**
 * True if `adsetId` has a CHANGE decision newer than `sinceISO`.
 * Unused by the tick (cooldown reads `getAdSetAutomationState`); kept
 * filtered so a future caller cannot treat maintain/skip as a touch.
 */
export async function hasRecentDecisionForAdSet(
  supabase: SupabaseClient,
  adsetId: string,
  sinceISO: string,
): Promise<boolean> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("campaign_automation_decisions")
    .select("id")
    .eq("adset_id", adsetId)
    .in("action_recommended", ["scale_up", "scale_down", "pause"])
    .gt("decided_at", sinceISO)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`hasRecentDecisionForAdSet: query failed: ${error.message}`);
  }
  return Boolean(data);
}

/** Insert one decision row. PR B sets `dry_run` / `applied` / `applied_at` / `meta_response_json` per outcome. */
export async function insertAutomationDecision(
  supabase: SupabaseClient,
  decision: DecisionToInsert,
): Promise<void> {
  const sb = anySb(supabase);
  const channel = decision.channel ?? "meta";
  const scope = decision.scope ?? "ad_set";
  const row = {
    campaign_id: decision.campaignId,
    adset_id: decision.adsetId,
    scope,
    ad_account_id: decision.adAccountId,
    draft_id: decision.draftId,
    metric: decision.metric,
    metric_value: decision.metricValue,
    metric_window: decision.metricWindow,
    rule_matched: decision.ruleMatched,
    action_recommended: decision.actionRecommended,
    action_delta: decision.actionDelta,
    budget_before_pence: decision.budgetBeforePence,
    budget_after_pence: decision.budgetAfterPence,
    guardrail_note: decision.guardrailNote,
    reason_text: decision.reasonText,
    dry_run: decision.dryRun ?? true,
    applied: decision.applied ?? false,
    applied_at: decision.appliedAt ?? null,
    meta_response_json: mergeInsightJson(decision.metaResponseJson, channel, decision.resultCount),
    channel,
  };
  const { error } = await sb.from("campaign_automation_decisions").insert(row);

  if (error && isUndefinedColumnError(error, "scope")) {
    const withoutScope = { ...row };
    delete (withoutScope as { scope?: string }).scope;
    const retryScope = await sb.from("campaign_automation_decisions").insert(withoutScope);
    if (retryScope.error && isUndefinedColumnError(retryScope.error, "channel")) {
      const withoutBoth = { ...withoutScope };
      delete (withoutBoth as { channel?: string }).channel;
      const retry = await sb.from("campaign_automation_decisions").insert(withoutBoth);
      if (retry.error) {
        throw new Error(`insertAutomationDecision: insert failed: ${retry.error.message}`);
      }
      return;
    }
    if (retryScope.error) {
      throw new Error(`insertAutomationDecision: insert failed: ${retryScope.error.message}`);
    }
    return;
  }

  if (error && isUndefinedColumnError(error, "channel")) {
    const withoutChannel = { ...row };
    delete (withoutChannel as { channel?: string }).channel;
    const retry = await sb.from("campaign_automation_decisions").insert(withoutChannel);
    if (retry.error) {
      throw new Error(`insertAutomationDecision: insert failed: ${retry.error.message}`);
    }
    return;
  }

  if (error) {
    throw new Error(`insertAutomationDecision: insert failed: ${error.message}`);
  }
}
