/**
 * Bind a never-throw recorder for one launch run. The event's client is
 * loaded once; each successful Meta create awaits one upsert.
 * phase_at_launch comes from the draft objective, never the event dates.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveDraftEventId } from "../campaign-event.ts";
import { createServiceRoleClient } from "../supabase/server.ts";
import type { AdSetSuggestion, CampaignDraft } from "../types.ts";
import { recordLaunchedAdSet, uuidOrNull } from "./record.ts";
import { phaseAtLaunchFromObjective, stampLaunchGeo } from "./snapshot.ts";

export type RecordCreatedAdSetAccepted = {
  ageModeOverride?: "strict" | null;
  note?: string | null;
  droppedNote?: string | null;
};

export type RecordCreatedAdSet = (
  metaCampaignId: string | undefined,
  suggestion: AdSetSuggestion,
  metaAdSetId: string,
  accepted?: RecordCreatedAdSetAccepted,
) => Promise<void>;

export async function bindLaunchAdSetRecorder(input: {
  session: SupabaseClient;
  draft: CampaignDraft;
  userId: string;
  adAccountId: string;
  launchRunId: string;
}): Promise<RecordCreatedAdSet> {
  let db = input.session;
  try {
    db = createServiceRoleClient();
  } catch {
    db = input.session;
  }

  const eventId = resolveDraftEventId(input.draft.settings.eventId, null);
  const objective = input.draft.settings.objective;
  const phaseAtLaunch = phaseAtLaunchFromObjective(objective);
  let clientId = uuidOrNull(input.draft.settings.clientId);

  if (eventId) {
    try {
      const { data } = await db
        .from("events")
        .select("client_id")
        .eq("id", eventId)
        .maybeSingle();
      if (data) {
        const row = data as { client_id?: string | null };
        clientId = uuidOrNull(row.client_id) ?? clientId;
      }
    } catch (err) {
      console.error("[launched_ad_sets] event client lookup failed", {
        event_id: eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return async (metaCampaignId, suggestion, metaAdSetId, accepted) => {
    await recordLaunchedAdSet(db, {
      metaAdsetId: metaAdSetId,
      metaCampaignId: metaCampaignId ?? null,
      adAccountId: input.adAccountId,
      draftId: input.draft.id ?? null,
      userId: input.userId,
      clientId,
      eventId,
      launchRunId: input.launchRunId,
      objective,
      phaseAtLaunch,
      descriptorSource: "launch",
      suggestion: stampLaunchGeo(
        suggestion,
        input.draft.budgetSchedule.locationGroups,
        input.draft.budgetSchedule.excludedLocations,
      ),
      audiences: input.draft.audiences,
      ageModeOverride: accepted?.ageModeOverride,
      launchNote: accepted?.note,
      droppedNote: accepted?.droppedNote,
    });
  };
}
