import { deriveAssetSignature } from "../../reporting/asset-signature.ts";
import type { RawCreative } from "../../reporting/creative-preview-extract.ts";
import {
  classifyImportedExistingPost,
  importedExistingPostMedia,
  type ImportCreativeSource,
} from "./creative-copy.ts";
import {
  adNameStem,
  adNameWithoutAdSetSuffix,
  creativeContentKey,
  isMetaAutoCreativeName,
  stripMetaAutoCreativeName,
  type CreativeContentSpec,
} from "./content-key.ts";
import type { MetaLiveCampaignBundle } from "./types.ts";

/**
 * One creative as an operator sees it: every Meta AdCreative object with the
 * same content key, and every ad that ran one of them.
 */
export type MetaImportCreativeGroup = {
  /** `creativeContentKey`, or `id:<creative id>` when the read carries no content. */
  key: string;
  /** The object the draft is built from, and the key `carry` sends. */
  representativeId: string;
  creativeIds: string[];
  adIds: string[];
  /** In the order the ads were created. */
  adSetIds: string[];
  name: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A creative the import can build a draft row from. */
export function metaImportCreativeCarriable(creative: RawCreative & { id: string }): boolean {
  const source = creative as ImportCreativeSource;
  const existing = classifyImportedExistingPost(source);
  if (existing) return !("unreachable" in existing) && importedExistingPostMedia(source) != null;
  return deriveAssetSignature(creative) != null;
}

type Ad = {
  id: string;
  /** Without our launcher's ` — <ad set>` suffix. */
  name: string | null;
  /** `adNameStem`: also without Ads Manager's ` – Copy N`. */
  stem: string | null;
  adSetId: string | null;
  creativeId: string;
  at: number;
  index: number;
};

function adsByCreated(bundle: MetaLiveCampaignBundle): Ad[] {
  const adSetNames = new Set(
    bundle.adSets.map((adSet) => str(adSet.name)).filter((name): name is string => name != null),
  );
  const ads: Ad[] = [];
  bundle.ads.forEach((raw, index) => {
    const creativeId = str(record(raw.creative)?.id);
    if (!creativeId) return;
    const at = Date.parse(str(raw.created_time) ?? "");
    const rawName = str(raw.name);
    ads.push({
      id: str(raw.id) ?? "",
      name: rawName ? adNameWithoutAdSetSuffix(rawName, adSetNames) || null : null,
      stem: rawName ? adNameStem(rawName, adSetNames) || null : null,
      adSetId: str(raw.adset_id),
      creativeId,
      at: Number.isFinite(at) ? at : Number.POSITIVE_INFINITY,
      index,
    });
  });
  return ads.sort((a, b) => a.at - b.at || a.index - b.index);
}

/** Most common value; a tie goes to the one whose first ad was created first. */
function mostCommon(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  for (const [name, count] of counts) {
    if (best == null || count > counts.get(best)!) best = name;
  }
  return best;
}

/**
 * The ad name. A Meta auto-name on the object is never used; a name the
 * operator gave the object is used only when no ad carries a name.
 */
function groupName(ads: readonly Ad[], objectNames: readonly string[], fallback: string): string {
  const adName = mostCommon(ads.map((ad) => ad.name));
  if (adName) return adName;
  const own = objectNames.find((name) => !isMetaAutoCreativeName(name));
  if (own) return own;
  for (const name of objectNames) {
    const prefix = stripMetaAutoCreativeName(name);
    if (prefix) return prefix;
  }
  return fallback;
}

/**
 * Group the read's creative objects by what they show. Groups keep the
 * order of their first object in `bundle.creatives`.
 */
export function groupMetaImportCreatives(bundle: MetaLiveCampaignBundle): MetaImportCreativeGroup[] {
  const ads = adsByCreated(bundle);
  const adsOf = new Map<string, Ad[]>();
  for (const ad of ads) adsOf.set(ad.creativeId, [...(adsOf.get(ad.creativeId) ?? []), ad]);

  const members = new Map<string, (RawCreative & { id: string })[]>();
  for (const [key, raw] of Object.entries(bundle.creatives)) {
    const creative = raw as RawCreative & { id?: string };
    const id = str(creative.id) ?? key;
    const named = { ...creative, id };
    const nameStem = mostCommon((adsOf.get(id) ?? []).map((ad) => ad.stem));
    const contentKey = creativeContentKey(named as CreativeContentSpec, { nameStem }) ?? `id:${id}`;
    members.set(contentKey, [...(members.get(contentKey) ?? []), named]);
  }

  const groups: MetaImportCreativeGroup[] = [];
  for (const [key, creatives] of members) {
    const groupAds = ads.filter((ad) => creatives.some((creative) => creative.id === ad.creativeId));
    const firstAt = (creative: { id: string }) => adsOf.get(creative.id)?.[0]?.at ?? Number.POSITIVE_INFINITY;
    const ordered = [...creatives].sort((a, b) => firstAt(a) - firstAt(b));
    const representative = ordered.find(metaImportCreativeCarriable) ?? ordered[0]!;
    groups.push({
      key,
      representativeId: representative.id,
      creativeIds: ordered.map((creative) => creative.id),
      adIds: groupAds.map((ad) => ad.id).filter(Boolean),
      adSetIds: [...new Set(groupAds.map((ad) => ad.adSetId).filter((id): id is string => id != null))],
      name: groupName(
        groupAds,
        ordered.map((creative) => str(creative.name)).filter((name): name is string => name != null),
        representative.id,
      ),
    });
  }
  return groups;
}
