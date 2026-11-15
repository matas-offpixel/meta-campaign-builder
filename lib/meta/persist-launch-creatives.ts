import type { AdCreativeDraft } from "../types.ts";

/** One Phase 3 success, plus the ads Phase 4 attached to it. */
export interface PublishedCreativeCreateRef {
  name: string;
  metaCreativeId: string;
  ads: readonly { metaAdId: string }[];
}

/**
 * Copy Meta creative ids and ad ids onto the creatives that a launch persists.
 *
 * Match is by creative name, the same way Phase 4 finds the draft creative
 * for a `creativesCreated` entry. Ad ids are that entry's Phase 4 ads, then
 * any multi-campaign ad ids recorded against the same name.
 *
 * A creative that is not in `creativesCreated` failed Phase 3. It is returned
 * unchanged: no invented `metaCreativeId`, and no ad ids copied from a failed
 * attempt or from the multi-campaign map.
 */
export function stampPublishedCreatives(
  creatives: readonly AdCreativeDraft[],
  creativesCreated: readonly PublishedCreativeCreateRef[],
  multiCampaignAdIdsByName: ReadonlyMap<string, readonly string[]> = new Map(),
): AdCreativeDraft[] {
  const byName = new Map<string, PublishedCreativeCreateRef[]>();
  for (const entry of creativesCreated) {
    const group = byName.get(entry.name);
    if (group) group.push(entry);
    else byName.set(entry.name, [entry]);
  }

  const consumed = new Map<string, number>();
  return creatives.map((creative) => {
    const group = byName.get(creative.name);
    if (!group) return creative;

    const index = consumed.get(creative.name) ?? 0;
    const entry = group[index];
    if (!entry) return creative;
    consumed.set(creative.name, index + 1);

    const phase4Ids = entry.ads.map((ad) => ad.metaAdId);
    const mcIds = index === 0 ? [...(multiCampaignAdIdsByName.get(creative.name) ?? [])] : [];
    const metaAdIds = [...phase4Ids, ...mcIds];

    const stamped: AdCreativeDraft = {
      ...creative,
      metaCreativeId: entry.metaCreativeId,
    };
    if (metaAdIds.length > 0) stamped.metaAdIds = metaAdIds;
    else delete stamped.metaAdIds;
    return stamped;
  });
}
