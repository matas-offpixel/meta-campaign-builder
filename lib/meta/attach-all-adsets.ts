/**
 * `attach_all_adsets` Phase 2 ad-set pooling — extracted from
 * `launch-campaign/route.ts` (GOAL 2, PR #596) for unit testability without
 * mocking the full Meta client. Fetches every active/paused ad set across
 * one or more selected campaigns and pools them into a single synthetic-key
 * map that Phase 4 uses to attach the same ads to every one of them.
 */

// Relative import (not the `@/` alias) — the `node --test` runner used by
// `npm run test` can't resolve path aliases (see
// reference_test_runner_no_path_alias); this keeps the module importable
// both from the Next.js build and from a plain node unit test.
import { attachedAdSetKey } from "../types.ts";

export interface AttachAllAdSetsCampaignRef {
  id: string;
  name: string;
}

/** Minimal shape of a live Meta ad set needed for pooling — duck-typed so
 * callers can pass the real `RawMetaAdSet` from `lib/meta/client.ts` as-is. */
export interface AttachAllAdSetsLiveAdSet {
  id: string;
  name?: string;
  effective_status?: string;
}

export interface AttachAllAdSetsFetchResult {
  data: AttachAllAdSetsLiveAdSet[];
}

export interface AttachAllAdSetsRegisteredEntry {
  synthKey: string;
  metaAdSetId: string;
  name: string;
  campaignId: string;
  campaignName: string;
}

export interface AttachAllAdSetsResult {
  /** synthetic key → live Meta ad set id, ready for `adSetMetaIds`. */
  adSetMetaIds: Map<string, string>;
  /** One entry per pooled ad set, in fetch order, for logging/summaries. */
  registered: AttachAllAdSetsRegisteredEntry[];
  /** Per-campaign fetch failures — non-fatal, other campaigns still pool. */
  fetchErrors: { campaignId: string; campaignName: string; error: string }[];
}

const BLOCKED_STATUSES = new Set(["ARCHIVED", "DELETED"]);

/**
 * Pools active/paused ad sets from every supplied campaign, capped at `cap`
 * total across ALL campaigns combined (not per-campaign) — mirrors the
 * wizard picker's "up to N ad sets total" copy ({@link ATTACH_ALL_ADSETS_CAP}
 * in `lib/types.ts`).
 *
 * `fetchAdSets` is injected so this stays pure/testable — production callers
 * pass a thin wrapper around `fetchAdSetsForCampaign` (filter: "relevant").
 * A campaign whose fetch throws is recorded in `fetchErrors` and skipped;
 * it does not abort pooling for the remaining campaigns.
 */
export async function buildAttachAllAdSetsMap(
  campaigns: AttachAllAdSetsCampaignRef[],
  fetchAdSets: (campaignId: string) => Promise<AttachAllAdSetsFetchResult>,
  cap: number,
): Promise<AttachAllAdSetsResult> {
  const adSetMetaIds = new Map<string, string>();
  const registered: AttachAllAdSetsRegisteredEntry[] = [];
  const fetchErrors: AttachAllAdSetsResult["fetchErrors"] = [];
  let total = 0;

  for (const campaign of campaigns) {
    if (total >= cap) break;
    try {
      const result = await fetchAdSets(campaign.id);
      for (const liveAdSet of result.data) {
        if (total >= cap) break;
        if (liveAdSet.effective_status && BLOCKED_STATUSES.has(liveAdSet.effective_status)) {
          continue;
        }
        const synthKey = attachedAdSetKey(liveAdSet.id);
        adSetMetaIds.set(synthKey, liveAdSet.id);
        registered.push({
          synthKey,
          metaAdSetId: liveAdSet.id,
          name: liveAdSet.name || liveAdSet.id,
          campaignId: campaign.id,
          campaignName: campaign.name,
        });
        total++;
      }
    } catch (err) {
      fetchErrors.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { adSetMetaIds, registered, fetchErrors };
}
