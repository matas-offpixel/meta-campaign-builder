/**
 * Production adapter: run the campaign-daily pass from rollup-sync-events
 * or the backfill script. Injects Graph + token + upsert.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { graphGetWithToken } from "../meta/client.ts";
import { resolveServerMetaToken } from "../meta/server-token.ts";
import {
  loadArmedCampaignsForDailyInsights,
  upsertCampaignDailyInsights,
} from "../db/campaign-daily-insights.ts";
import { fetchCampaignDailyInsights } from "./campaign-daily-fetch.ts";
import {
  runCampaignDailyInsightsSync,
  type CampaignDailySyncResult,
} from "./campaign-daily.ts";

export async function runCampaignDailyInsightsPass(
  supabase: SupabaseClient,
  opts?: { dryRun?: boolean; now?: Date },
): Promise<CampaignDailySyncResult> {
  return runCampaignDailyInsightsSync({
    now: opts?.now ?? new Date(),
    dryRun: opts?.dryRun === true,
    loadCampaigns: () => loadArmedCampaignsForDailyInsights(supabase),
    resolveToken: async (userId) => {
      try {
        const resolved = await resolveServerMetaToken(supabase, userId);
        return resolved.token;
      } catch (err) {
        console.warn(
          `[campaign-daily-insights] token missing user=${userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return null;
      }
    },
    fetchInsights: (args) => fetchCampaignDailyInsights(graphGetWithToken, args),
    upsert: (rows) => upsertCampaignDailyInsights(supabase, rows),
  });
}
