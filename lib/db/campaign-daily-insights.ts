/**
 * Supabase glue for campaign_daily_insights (migration 178).
 *
 * Table is not in generated types until Matas applies the migration.
 * Same `as unknown as any` cast as campaign-automation-decisions.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { migrateDraft } from "@/lib/autosave";
import type {
  ArmedDailyCampaign,
  CampaignDailyInsightRow,
} from "@/lib/insights/campaign-daily";
import type { CampaignObjective } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  return supabase as unknown as AnySupabase;
}

interface ArmedDraftRow {
  id: string;
  user_id: string;
  ad_account_id: string | null;
  draft_json: Record<string, unknown>;
}

const OBJECTIVES = new Set<CampaignObjective>([
  "purchase",
  "initiate_checkout",
  "registration",
  "traffic",
  "awareness",
  "engagement",
]);

function asObjective(raw: string | undefined): CampaignObjective | null {
  if (raw && OBJECTIVES.has(raw as CampaignObjective)) {
    return raw as CampaignObjective;
  }
  return null;
}

export async function loadArmedCampaignsForDailyInsights(
  supabase: SupabaseClient,
): Promise<ArmedDailyCampaign[]> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("campaign_drafts")
    .select("id, user_id, ad_account_id, draft_json")
    .eq("status", "published")
    .eq("optimisation_automation_enabled", true);

  if (error) {
    throw new Error(
      `loadArmedCampaignsForDailyInsights: query failed: ${error.message}`,
    );
  }

  const out: ArmedDailyCampaign[] = [];
  for (const row of (data ?? []) as ArmedDraftRow[]) {
    try {
      const draft = migrateDraft(row.draft_json);
      if (!draft.metaCampaignId) continue;
      const adAccountId = row.ad_account_id ?? draft.settings.adAccountId;
      if (!adAccountId) continue;
      const objective = asObjective(draft.settings.objective);
      if (!objective) continue;
      out.push({
        draftId: row.id,
        userId: row.user_id,
        campaignId: draft.metaCampaignId,
        adAccountId,
        objective,
      });
    } catch (err) {
      console.warn(
        `[campaign-daily-insights] draft=${row.id} skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return out;
}

export async function upsertCampaignDailyInsights(
  supabase: SupabaseClient,
  rows: CampaignDailyInsightRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const sb = anySb(supabase);
  const { error } = await sb.from("campaign_daily_insights").upsert(rows, {
    onConflict: "meta_campaign_id,date",
  });
  if (error) {
    throw new Error(`upsertCampaignDailyInsights: ${error.message}`);
  }
  return rows.length;
}
