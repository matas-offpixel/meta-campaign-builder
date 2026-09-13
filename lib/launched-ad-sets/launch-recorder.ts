/**
 * Bind a never-throw recorder for one launch run. Event facts are
 * loaded once; each successful Meta create is one remember() call.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveDraftEventId } from "../campaign-event.ts";
import { createServiceRoleClient } from "../supabase/server.ts";
import type { AdSetSuggestion, CampaignDraft } from "../types.ts";
import { rememberLaunchedAdSet, uuidOrNull } from "./record.ts";
import { phaseAtLaunchFromEvent } from "./snapshot.ts";

export async function bindLaunchAdSetRecorder(input: {
  session: SupabaseClient;
  draft: CampaignDraft;
  userId: string;
  adAccountId: string;
  launchRunId: string;
}): Promise<
  (
    metaCampaignId: string | undefined,
    suggestion: AdSetSuggestion,
    metaAdSetId: string,
  ) => void
> {
  let db = input.session;
  try {
    db = createServiceRoleClient();
  } catch {
    db = input.session;
  }

  const eventId = resolveDraftEventId(input.draft.settings.eventId, null);
  let phaseAtLaunch: string | null = null;
  let clientId = uuidOrNull(input.draft.settings.clientId);

  if (eventId) {
    try {
      const { data } = await db
        .from("events")
        .select("client_id, presale_at, general_sale_at, sold_out_at")
        .eq("id", eventId)
        .maybeSingle();
      if (data) {
        const row = data as {
          client_id?: string | null;
          presale_at?: string | null;
          general_sale_at?: string | null;
          sold_out_at?: string | null;
        };
        clientId = uuidOrNull(row.client_id) ?? clientId;
        phaseAtLaunch = phaseAtLaunchFromEvent({
          launchedAt: new Date(),
          presaleAt: row.presale_at ?? null,
          generalSaleAt: row.general_sale_at ?? null,
          soldOutAt: row.sold_out_at ?? null,
        });
      }
    } catch (err) {
      console.error("[launched_ad_sets] event facts failed", {
        event_id: eventId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (metaCampaignId, suggestion, metaAdSetId) => {
    rememberLaunchedAdSet(db, {
      metaAdsetId: metaAdSetId,
      metaCampaignId: metaCampaignId ?? null,
      adAccountId: input.adAccountId,
      draftId: input.draft.id ?? null,
      userId: input.userId,
      clientId,
      eventId,
      launchRunId: input.launchRunId,
      objective: input.draft.settings.objective,
      phaseAtLaunch,
      descriptorSource: "launch",
      suggestion,
      audiences: input.draft.audiences,
    });
  };
}
