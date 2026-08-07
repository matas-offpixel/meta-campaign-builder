/**
 * lib/db/budget-pacing-campaigns.ts
 *
 * Supabase glue for task #121 Phase 2
 * (`app/api/cron/budget-pacing-check/route.ts`). Kept separate from the
 * pure `lib/budget-pacing/tick-runner.ts` orchestration so that module stays
 * `node --test`-friendly — same split as
 * `lib/db/campaign-automation-decisions.ts`'s `loadOptedInCampaignsForAutomation`.
 *
 * Unlike task #120's automation loop, Phase 2 has no opt-in flag — every
 * `status = 'published'` campaign with a real `metaCampaignId` is eligible
 * (the budget plan itself, via `computeCampaignBudgetPlan`, is what filters
 * out campaigns with nothing sensible to alert against).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { migrateDraft } from "@/lib/autosave";
import type { BudgetPacingCampaignInput } from "@/lib/budget-pacing/tick-runner";
import { buildMetaAdsManagerCampaignUrl } from "@/lib/notify/ads-manager-url";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any;

function anySb(supabase: SupabaseClient): AnySupabase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}

interface PublishedDraftRow {
  id: string;
  ad_account_id: string | null;
  draft_json: Record<string, unknown>;
}

export async function loadPublishedCampaignsForBudgetPacing(
  supabase: SupabaseClient,
): Promise<BudgetPacingCampaignInput[]> {
  const sb = anySb(supabase);
  const { data, error } = await sb
    .from("campaign_drafts")
    .select("id, ad_account_id, draft_json")
    .eq("status", "published");

  if (error) {
    throw new Error(`loadPublishedCampaignsForBudgetPacing: query failed: ${error.message}`);
  }

  const rows = (data ?? []) as PublishedDraftRow[];
  const campaigns: BudgetPacingCampaignInput[] = [];

  for (const row of rows) {
    try {
      const draft = migrateDraft(row.draft_json);
      if (!draft.metaCampaignId) {
        console.warn(`[budget-pacing-campaigns] draft=${row.id} published but has no metaCampaignId — skipping`);
        continue;
      }

      const adAccountId = row.ad_account_id ?? draft.settings.metaAdAccountId ?? draft.settings.adAccountId;
      const adsManagerUrl = buildMetaAdsManagerCampaignUrl(adAccountId, draft.metaCampaignId);
      if (!adsManagerUrl) {
        console.warn(
          `[budget-pacing-campaigns] draft=${row.id} has an unrecognisable ad account id "${adAccountId}" — skipping`,
        );
        continue;
      }

      campaigns.push({
        campaignId: draft.metaCampaignId,
        campaignName: draft.settings.campaignName || draft.settings.campaignCode || draft.id,
        currency: draft.budgetSchedule.currency,
        enabledDailyBudgetsMajor: draft.adSetSuggestions.filter((s) => s.enabled).map((s) => s.budgetPerDay),
        startDate: draft.budgetSchedule.startDate,
        endDate: draft.budgetSchedule.endDate,
        adsManagerUrl,
      });
    } catch (err) {
      console.warn(
        `[budget-pacing-campaigns] draft=${row.id} failed to migrate — skipping`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return campaigns;
}
