/**
 * One honest backfill from launchSummary.creativesCreated[].ads[].
 * The descriptor is whatever the draft holds now — marked
 * backfill_from_launch_summary so learning jobs can weight these below
 * launch-time snapshots. No Meta calls.
 *
 * launchSummary records ads by ad set *name* (attach-all: the synthetic
 * "attached:<id>" key). The Meta ad set id comes from that key, then
 * adSetsCreated, then the suggestion's adSetLaunchResults; a name that
 * maps to zero or several ids is left null and counted. In attach modes
 * the campaign id is launchSummary.metaCampaignId — the first campaign.
 *
 * A meta_ad_id claimed by more than one draft (copies inherit
 * launchSummary) is reported, not written.
 */

import { parseAttachedAdSetKey, type CampaignDraft } from "../types.ts";
import { resolveDraftEventId } from "../campaign-event.ts";
import { uuidOrNull } from "../launched-ad-sets/record.ts";
import { metaAdName } from "../creative-name-from-filename.ts";
import {
  launchedAdPayload,
  snapshotCreativeDescriptor,
  type CreativeDescriptor,
  type LaunchedAdWrite,
} from "./record.ts";

export type AdBackfillDraftInput = {
  id: string;
  user_id: string;
  event_id: string | null;
  client_id?: string | null;
  draft_json: CampaignDraft;
};

export type AdBackfillPlan = {
  writes: ReturnType<typeof launchedAdPayload>[];
  draftsWithAds: number;
  adsFound: number;
  alreadyRecorded: number;
  unresolvedAdSet: number;
  missingCreative: number;
  multiClaim: { metaAdId: string; draftIds: string[] }[];
};

type Claim = { draft: AdBackfillDraftInput; write: LaunchedAdWrite; creativeMissing: boolean };

/** adSetName → metaAdSetId, null when the name is ambiguous. */
function adSetIdsByName(draft: CampaignDraft): Map<string, string | null> {
  const ids = new Map<string, Set<string>>();
  const add = (name: string | undefined, id: string | undefined) => {
    const n = name?.trim();
    const v = id?.trim();
    if (!n || !v) return;
    const set = ids.get(n) ?? new Set<string>();
    set.add(v);
    ids.set(n, set);
  };
  const summary = draft.launchSummary;
  for (const row of summary?.adSetsCreated ?? []) add(row.name, row.metaAdSetId);
  const results = summary?.adSetLaunchResults ?? {};
  for (const suggestion of draft.adSetSuggestions ?? []) {
    const result = results[suggestion.id];
    if (result?.launchStatus === "created") add(suggestion.name, result.metaAdSetId);
  }
  const out = new Map<string, string | null>();
  for (const [name, set] of ids) out.set(name, set.size === 1 ? [...set][0] : null);
  return out;
}

function emptyDescriptor(name: string): CreativeDescriptor {
  return {
    creativeName: name.trim() || null,
    mediaType: null,
    sourceType: null,
    placementMode: null,
    variationCount: 0,
    cta: null,
    destinationUrl: null,
    urlTagsApplied: null,
    assetContentHashes: [],
  };
}

export function planLaunchedAdBackfill(
  drafts: AdBackfillDraftInput[],
  clientIdByEventId: ReadonlyMap<string, string | null>,
  contentHashByRegistryId: ReadonlyMap<string, string> = new Map(),
  existingMetaAdIds: ReadonlySet<string> = new Set(),
  now: Date = new Date(),
): AdBackfillPlan {
  const claims: Claim[] = [];
  let draftsWithAds = 0;

  for (const row of drafts) {
    const draft = row.draft_json;
    const summary = draft.launchSummary;
    const entries = summary?.creativesCreated ?? [];
    if (!entries.some((entry) => (entry.ads ?? []).some((ad) => ad.metaAdId?.trim()))) continue;
    draftsWithAds++;

    const adSetIds = adSetIdsByName(draft);
    const eventId = resolveDraftEventId(draft.settings?.eventId, row.event_id);
    const clientId =
      (eventId ? clientIdByEventId.get(eventId) : null) ??
      uuidOrNull(draft.settings?.clientId) ??
      uuidOrNull(row.client_id);
    const launchedAtRaw = draft.updatedAt ?? draft.createdAt;
    const parsed = launchedAtRaw ? new Date(launchedAtRaw) : now;
    const launchedAt = Number.isNaN(parsed.getTime()) ? now : parsed;
    const launchRunId = uuidOrNull(summary?.launchRunId) ?? row.id;

    for (const entry of entries) {
      const creative = (draft.creatives ?? []).find((c) => c.name === entry.name);
      // url_tags shipped in PR #1027; whether an older ad carried them is unknown.
      const descriptor = creative
        ? { ...snapshotCreativeDescriptor(creative, contentHashByRegistryId), urlTagsApplied: null }
        : emptyDescriptor(entry.name);
      for (const ad of entry.ads ?? []) {
        const metaAdId = ad.metaAdId?.trim();
        if (!metaAdId) continue;
        const adSetName = ad.adSetName?.trim() ?? "";
        const metaAdsetId = parseAttachedAdSetKey(adSetName) ?? adSetIds.get(adSetName) ?? null;
        claims.push({
          draft: row,
          creativeMissing: !creative,
          write: {
            metaAdId,
            metaCreativeId: entry.metaCreativeId ?? null,
            metaAdsetId,
            metaCampaignId: summary?.metaCampaignId ?? draft.metaCampaignId ?? null,
            adAccountId: draft.settings?.metaAdAccountId || draft.settings?.adAccountId || null,
            draftId: row.id,
            userId: row.user_id,
            clientId,
            eventId,
            launchedAt,
            launchRunId,
            descriptorSource: "backfill_from_launch_summary",
            adName: metaAdName(entry.name),
            descriptor,
          },
        });
      }
    }
  }

  const byAd = new Map<string, Claim[]>();
  for (const claim of claims) {
    const list = byAd.get(claim.write.metaAdId) ?? [];
    list.push(claim);
    byAd.set(claim.write.metaAdId, list);
  }

  const writes: AdBackfillPlan["writes"] = [];
  const multiClaim: AdBackfillPlan["multiClaim"] = [];
  let alreadyRecorded = 0;
  let unresolvedAdSet = 0;
  let missingCreative = 0;
  for (const [metaAdId, list] of byAd) {
    const draftIds = [...new Set(list.map((c) => c.draft.id))];
    if (draftIds.length > 1) {
      multiClaim.push({ metaAdId, draftIds });
      continue;
    }
    if (existingMetaAdIds.has(metaAdId)) {
      alreadyRecorded++;
      continue;
    }
    const claim = list[0];
    if (!claim.write.metaAdsetId) unresolvedAdSet++;
    if (claim.creativeMissing) missingCreative++;
    writes.push(launchedAdPayload(claim.write));
  }

  return {
    writes,
    draftsWithAds,
    adsFound: byAd.size,
    alreadyRecorded,
    unresolvedAdSet,
    missingCreative,
    multiClaim,
  };
}
