/**
 * Persist a launched ad set. Runs after Meta create succeeds.
 * Must never throw — a bookkeeping miss is worse than rolling back
 * an ad set that already exists on Meta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AdSetSuggestion, AudienceSettings, CampaignObjective } from "../types.ts";
import {
  effectiveAdvantagePlus,
  joinLaunchNotes,
  snapshotAudienceDescriptor,
  type DescriptorSource,
  type LaunchedAdSetChannel,
} from "./snapshot.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function uuidOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || "";
  return UUID.test(trimmed) ? trimmed : null;
}

export type LaunchedAdSetWrite = {
  metaAdsetId: string;
  metaCampaignId: string | null;
  adAccountId: string | null;
  draftId: string | null;
  userId: string | null;
  clientId: string | null;
  eventId: string | null;
  launchedAt?: Date;
  launchRunId: string;
  channel?: LaunchedAdSetChannel;
  objective: CampaignObjective | string | null;
  phaseAtLaunch: string | null;
  descriptorSource: DescriptorSource;
  suggestion: AdSetSuggestion;
  audiences: AudienceSettings | null;
  ageModeOverride?: "strict" | null;
  launchNote?: string | null;
  droppedNote?: string | null;
};

function payloadFromWrite(row: LaunchedAdSetWrite): Record<string, unknown> {
  const descriptor = snapshotAudienceDescriptor(row.suggestion, row.audiences);
  return {
    meta_adset_id: row.metaAdsetId,
    meta_campaign_id: row.metaCampaignId?.trim() || null,
    ad_account_id: row.adAccountId?.trim() || null,
    draft_id: uuidOrNull(row.draftId),
    user_id: uuidOrNull(row.userId),
    client_id: uuidOrNull(row.clientId),
    event_id: uuidOrNull(row.eventId),
    launched_at: (row.launchedAt ?? new Date()).toISOString(),
    launch_run_id: row.launchRunId,
    channel: row.channel ?? "meta",
    source_type: descriptor.sourceType,
    source_id: descriptor.sourceId,
    source_name: descriptor.sourceName,
    age_min: descriptor.ageMin,
    age_max: descriptor.ageMax,
    lookalike_range: descriptor.lookalikeRange,
    geo: descriptor.geo,
    advantage_plus: descriptor.advantagePlus,
    advantage_plus_effective: effectiveAdvantagePlus(
      descriptor.advantagePlus,
      row.ageModeOverride,
    ),
    launch_note: joinLaunchNotes(row.droppedNote, row.launchNote),
    interest_ids: descriptor.interestIds,
    objective: row.objective,
    phase_at_launch: row.phaseAtLaunch,
    initial_daily_budget_pence: descriptor.initialDailyBudgetPence,
    suggestion_id: descriptor.suggestionId,
    descriptor_source: row.descriptorSource,
  };
}

export function launchedAdSetPayload(row: LaunchedAdSetWrite): Record<string, unknown> {
  return payloadFromWrite(row);
}

export async function recordLaunchedAdSet(
  supabase: SupabaseClient,
  row: LaunchedAdSetWrite,
): Promise<void> {
  const metaAdsetId = row.metaAdsetId?.trim();
  if (!metaAdsetId) {
    console.error("[launched_ad_sets] upsert failed", {
      meta_adset_id: row.metaAdsetId,
      error: "missing meta_adset_id",
    });
    return;
  }
  if (!uuidOrNull(row.launchRunId)) {
    console.error("[launched_ad_sets] upsert failed", {
      meta_adset_id: metaAdsetId,
      error: "missing launch_run_id",
    });
    return;
  }
  try {
    const { error } = await supabase
      .from("launched_ad_sets")
      .upsert(payloadFromWrite({ ...row, metaAdsetId }), { onConflict: "meta_adset_id" });
    if (error) {
      console.error("[launched_ad_sets] upsert failed", {
        meta_adset_id: metaAdsetId,
        error: error.message,
      });
    }
  } catch (err) {
    console.error("[launched_ad_sets] upsert failed", {
      meta_adset_id: metaAdsetId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
