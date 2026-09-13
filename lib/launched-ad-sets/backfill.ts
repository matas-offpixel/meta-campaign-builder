/**
 * One honest backfill from launchSummary.adSetLaunchResults.
 * The descriptor is whatever the draft holds now — mark it so Phase 1
 * can weight these below launch-time snapshots.
 *
 * A meta_adset_id claimed by more than one draft is reported, not
 * resolved. Duplicates inherited launchSummary; last-write-wins would
 * stamp the copy's (possibly edited) descriptor as fact.
 */

import type { AdSetLaunchResult, AdSetSuggestion, CampaignDraft } from "../types.ts";
import { resolveDraftEventId } from "../campaign-event.ts";
import { launchedAdSetPayload, type LaunchedAdSetWrite } from "./record.ts";
import { phaseAtLaunchFromEvent } from "./snapshot.ts";

export type BackfillDraftInput = {
  id: string;
  user_id: string;
  event_id: string | null;
  status?: string | null;
  created_at?: string | null;
  name?: string | null;
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

export type BackfillClaimant = {
  draftId: string;
  status: string | null;
  createdAt: string | null;
  name: string | null;
  isCopy: boolean;
};

export type BackfillMultiClaim = {
  metaAdSetId: string;
  drafts: BackfillClaimant[];
};

export type BackfillPlan = {
  writes: ReturnType<typeof launchedAdSetPayload>[];
  missingSuggestion: BackfillMissingSuggestion[];
  multiClaim: BackfillMultiClaim[];
  distinctAdSets: number;
};

type PendingClaim = {
  draftRow: BackfillDraftInput;
  suggestionId: string;
  metaAdSetId: string;
  suggestion: AdSetSuggestion | undefined;
};

function claimantFromDraft(row: BackfillDraftInput): BackfillClaimant {
  const name =
    row.name?.trim() || row.draft_json.settings?.campaignName?.trim() || null;
  return {
    draftId: row.id,
    status: row.status ?? row.draft_json.status ?? null,
    createdAt: row.created_at ?? row.draft_json.createdAt ?? null,
    name,
    isCopy: Boolean(name?.endsWith("(Copy)")),
  };
}

export function planLaunchedAdSetBackfill(
  drafts: BackfillDraftInput[],
  eventsById: Map<string, BackfillEventFacts>,
  now: Date = new Date(),
  existingMetaAdSetIds: Set<string> = new Set(),
): BackfillPlan {
  const claims: PendingClaim[] = [];

  for (const draftRow of drafts) {
    const draft = draftRow.draft_json;
    const results = draft.launchSummary?.adSetLaunchResults ?? {};
    const suggestions = new Map(
      (draft.adSetSuggestions ?? []).map((row) => [row.id, row] as const),
    );
    for (const [suggestionId, raw] of Object.entries(results)) {
      const result = raw as AdSetLaunchResult;
      if (result.launchStatus !== "created" || !result.metaAdSetId?.trim()) continue;
      claims.push({
        draftRow,
        suggestionId,
        metaAdSetId: result.metaAdSetId,
        suggestion: suggestions.get(suggestionId),
      });
    }
  }

  const byAdSet = new Map<string, PendingClaim[]>();
  for (const claim of claims) {
    const list = byAdSet.get(claim.metaAdSetId) ?? [];
    list.push(claim);
    byAdSet.set(claim.metaAdSetId, list);
  }

  const writes: ReturnType<typeof launchedAdSetPayload>[] = [];
  const missingSuggestion: BackfillMissingSuggestion[] = [];
  const multiClaim: BackfillMultiClaim[] = [];

  for (const claim of claims) {
    if (claim.suggestion) continue;
    missingSuggestion.push({
      draftId: claim.draftRow.id,
      suggestionId: claim.suggestionId,
      metaAdSetId: claim.metaAdSetId,
    });
  }

  for (const [metaAdSetId, adSetClaims] of byAdSet) {
    const draftIds = new Set(adSetClaims.map((claim) => claim.draftRow.id));
    if (draftIds.size > 1) {
      const seen = new Set<string>();
      const claimants: BackfillClaimant[] = [];
      for (const claim of adSetClaims) {
        if (seen.has(claim.draftRow.id)) continue;
        seen.add(claim.draftRow.id);
        claimants.push(claimantFromDraft(claim.draftRow));
      }
      multiClaim.push({ metaAdSetId, drafts: claimants });
      continue;
    }
    if (existingMetaAdSetIds.has(metaAdSetId)) continue;

    for (const claim of adSetClaims) {
      if (!claim.suggestion) continue;
      const draftRow = claim.draftRow;
      const draft = draftRow.draft_json;
      const eventId = resolveDraftEventId(draft.settings?.eventId, draftRow.event_id);
      const event = eventId ? eventsById.get(eventId) : undefined;
      const launchedAtRaw = draft.updatedAt ?? draft.createdAt;
      const launchedAt = launchedAtRaw ? new Date(launchedAtRaw) : now;
      const write: LaunchedAdSetWrite = {
        metaAdsetId: claim.metaAdSetId,
        metaCampaignId: draft.launchSummary?.metaCampaignId ?? draft.metaCampaignId ?? null,
        adAccountId: draft.settings?.metaAdAccountId || draft.settings?.adAccountId || null,
        draftId: draftRow.id,
        userId: draftRow.user_id,
        clientId: event?.clientId ?? draft.settings?.clientId ?? null,
        eventId,
        launchedAt: Number.isNaN(launchedAt.getTime()) ? now : launchedAt,
        launchRunId: draftRow.id,
        objective: draft.settings?.objective ?? null,
        phaseAtLaunch: phaseAtLaunchFromEvent({
          launchedAt: Number.isNaN(launchedAt.getTime()) ? now : launchedAt,
          presaleAt: event?.presaleAt ?? null,
          generalSaleAt: event?.generalSaleAt ?? null,
          soldOutAt: event?.soldOutAt ?? null,
        }),
        descriptorSource: "backfill_from_launch_summary",
        suggestion: claim.suggestion,
        audiences: draft.audiences ?? null,
      };
      writes.push(launchedAdSetPayload(write));
    }
  }

  return {
    writes,
    missingSuggestion,
    multiClaim,
    distinctAdSets: byAdSet.size,
  };
}
