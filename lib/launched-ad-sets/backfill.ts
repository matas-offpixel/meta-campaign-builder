/**
 * One honest backfill from launchSummary.adSetLaunchResults.
 * The descriptor is whatever the draft holds now — mark it so Phase 1
 * can weight these below launch-time snapshots.
 */

import type { AdSetLaunchResult, AdSetSuggestion, CampaignDraft } from "../types.ts";
import { resolveDraftEventId } from "../campaign-event.ts";
import { launchedAdSetPayload, type LaunchedAdSetWrite } from "./record.ts";
import { phaseAtLaunchFromEvent } from "./snapshot.ts";

export type BackfillDraftInput = {
  id: string;
  user_id: string;
  event_id: string | null;
  draft_json: CampaignDraft;
};

export type BackfillEventFacts = {
  clientId: string | null;
  presaleAt: string | null;
  generalSaleAt: string | null;
  soldOutAt: string | null;
};

export type BackfillMissingSuggestion = {
  draftId: string;
  suggestionId: string;
  metaAdSetId: string;
};

export type BackfillPlan = {
  writes: ReturnType<typeof launchedAdSetPayload>[];
  missingSuggestion: BackfillMissingSuggestion[];
};

export function planLaunchedAdSetBackfill(
  drafts: BackfillDraftInput[],
  eventsById: Map<string, BackfillEventFacts>,
  now: Date = new Date(),
  existingMetaAdSetIds: Set<string> = new Set(),
): BackfillPlan {
  const writes: ReturnType<typeof launchedAdSetPayload>[] = [];
  const missingSuggestion: BackfillMissingSuggestion[] = [];

  for (const draftRow of drafts) {
    const draft = draftRow.draft_json;
    const results = draft.launchSummary?.adSetLaunchResults ?? {};
    const suggestions = new Map(
      (draft.adSetSuggestions ?? []).map((row) => [row.id, row] as const),
    );
    const eventId = resolveDraftEventId(draft.settings?.eventId, draftRow.event_id);
    const event = eventId ? eventsById.get(eventId) : undefined;
    const launchRunId = draftRow.id;
    const launchedAtRaw = draft.updatedAt ?? draft.createdAt;
    const launchedAt = launchedAtRaw ? new Date(launchedAtRaw) : now;
    const phaseAtLaunch = phaseAtLaunchFromEvent({
      launchedAt: Number.isNaN(launchedAt.getTime()) ? now : launchedAt,
      presaleAt: event?.presaleAt ?? null,
      generalSaleAt: event?.generalSaleAt ?? null,
      soldOutAt: event?.soldOutAt ?? null,
    });

    for (const [suggestionId, raw] of Object.entries(results)) {
      const result = raw as AdSetLaunchResult;
      if (result.launchStatus !== "created" || !result.metaAdSetId?.trim()) continue;
      if (existingMetaAdSetIds.has(result.metaAdSetId)) continue;
      const suggestion: AdSetSuggestion | undefined = suggestions.get(suggestionId);
      if (!suggestion) {
        missingSuggestion.push({
          draftId: draftRow.id,
          suggestionId,
          metaAdSetId: result.metaAdSetId,
        });
        continue;
      }
      const write: LaunchedAdSetWrite = {
        metaAdsetId: result.metaAdSetId,
        metaCampaignId: draft.launchSummary?.metaCampaignId ?? draft.metaCampaignId ?? null,
        adAccountId: draft.settings?.metaAdAccountId || draft.settings?.adAccountId || null,
        draftId: draftRow.id,
        userId: draftRow.user_id,
        clientId: event?.clientId ?? draft.settings?.clientId ?? null,
        eventId,
        launchedAt: Number.isNaN(launchedAt.getTime()) ? now : launchedAt,
        launchRunId,
        objective: draft.settings?.objective ?? null,
        phaseAtLaunch,
        descriptorSource: "backfill_from_launch_summary",
        suggestion,
        audiences: draft.audiences ?? null,
      };
      writes.push(launchedAdSetPayload(write));
    }
  }

  return { writes, missingSuggestion };
}
