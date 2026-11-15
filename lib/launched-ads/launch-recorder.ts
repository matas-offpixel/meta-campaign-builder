/**
 * Bind a never-throw ad recorder for one launch run. Event facts and
 * creative-asset hashes are loaded once; each successful Meta ad create
 * awaits one upsert.
 *
 * Routes without a draft (bulk-attach, create-creatives-and-ads) pass
 * `fillFromLaunchedAdSets`: the ad set's launched_ad_sets row, when there
 * is one, supplies the campaign, draft, client and event.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveDraftEventId } from "../campaign-event.ts";
import type { AdCreativeDraft, CampaignDraft } from "../types.ts";
import { uuidOrNull } from "../launched-ad-sets/record.ts";
import { recordLaunchedAd, registryAssetIds, snapshotCreativeDescriptor } from "./record.ts";

export type RecordCreatedAdInput = {
  creative: AdCreativeDraft;
  adName: string;
  metaAdId: string;
  metaCreativeId: string | null;
  metaAdSetId: string;
  metaCampaignId?: string | null;
};

export type RecordCreatedAd = (input: RecordCreatedAdInput) => Promise<void>;

export const noopRecordCreatedAd: RecordCreatedAd = async () => {};

type AdSetFacts = {
  metaCampaignId: string | null;
  draftId: string | null;
  clientId: string | null;
  eventId: string | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function bindLaunchAdRecorder(input: {
  session: SupabaseClient;
  /** Route-supplied so this module stays importable from node tests. */
  serviceRole?: () => SupabaseClient;
  userId: string;
  adAccountId: string;
  launchRunId: string;
  draft?: CampaignDraft | null;
  creatives: readonly AdCreativeDraft[];
  fillFromLaunchedAdSets?: boolean;
}): Promise<RecordCreatedAd> {
  let db = input.session;
  if (input.serviceRole) {
    try {
      db = input.serviceRole();
    } catch {
      db = input.session;
    }
  }

  const draft = input.draft ?? null;
  const eventId = draft ? resolveDraftEventId(draft.settings?.eventId, null) : null;
  let clientId = uuidOrNull(draft?.settings?.clientId);

  if (eventId) {
    try {
      const { data } = await db.from("events").select("client_id").eq("id", eventId).maybeSingle();
      clientId = uuidOrNull((data as { client_id?: string | null } | null)?.client_id) ?? clientId;
    } catch (err) {
      console.error("[launched_ads] event facts failed", { event_id: eventId, error: errorMessage(err) });
    }
  }

  const hashByRegistryId = new Map<string, string>();
  const registryIds = [...new Set(input.creatives.flatMap((c) => registryAssetIds(c)))];
  if (registryIds.length > 0) {
    try {
      const { data, error } = await db.from("creative_assets").select("id, content_hash").in("id", registryIds);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as { id: string; content_hash: string | null }[]) {
        if (row.content_hash) hashByRegistryId.set(row.id, row.content_hash);
      }
    } catch (err) {
      console.error("[launched_ads] asset hashes failed", { assets: registryIds.length, error: errorMessage(err) });
    }
  }

  const adSetFacts = new Map<string, Promise<AdSetFacts | null>>();
  const factsFor = (metaAdSetId: string): Promise<AdSetFacts | null> => {
    if (!input.fillFromLaunchedAdSets) return Promise.resolve(null);
    let pending = adSetFacts.get(metaAdSetId);
    if (!pending) {
      pending = (async () => {
        try {
          const { data } = await db
            .from("launched_ad_sets")
            .select("meta_campaign_id, draft_id, client_id, event_id")
            .eq("meta_adset_id", metaAdSetId)
            .maybeSingle();
          const row = data as Record<string, string | null> | null;
          if (!row) return null;
          return {
            metaCampaignId: row.meta_campaign_id ?? null,
            draftId: row.draft_id ?? null,
            clientId: row.client_id ?? null,
            eventId: row.event_id ?? null,
          };
        } catch (err) {
          console.error("[launched_ads] ad set facts failed", { meta_adset_id: metaAdSetId, error: errorMessage(err) });
          return null;
        }
      })();
      adSetFacts.set(metaAdSetId, pending);
    }
    return pending;
  };

  return async (ad) => {
    try {
      const facts = await factsFor(ad.metaAdSetId);
      await recordLaunchedAd(db, {
        metaAdId: ad.metaAdId,
        metaCreativeId: ad.metaCreativeId,
        metaAdsetId: ad.metaAdSetId,
        metaCampaignId: ad.metaCampaignId ?? facts?.metaCampaignId ?? null,
        adAccountId: input.adAccountId,
        draftId: draft?.id ?? facts?.draftId ?? null,
        userId: input.userId,
        clientId: clientId ?? facts?.clientId ?? null,
        eventId: eventId ?? facts?.eventId ?? null,
        launchRunId: input.launchRunId,
        descriptorSource: "launch",
        adName: ad.adName,
        descriptor: snapshotCreativeDescriptor(ad.creative, hashByRegistryId),
      });
    } catch (err) {
      console.error("[launched_ads] record failed", { meta_ad_id: ad.metaAdId, error: errorMessage(err) });
    }
  };
}
