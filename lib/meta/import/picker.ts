import { classifyImportedExistingPost, importedExistingPostMedia } from "./creative-copy.ts";
import { groupMetaImportCreatives, metaImportCreativeCarriable } from "./groups.ts";
import { deriveAssetSignature } from "../../reporting/asset-signature.ts";
import { extractPreview } from "../../reporting/creative-preview-extract.ts";
import type { RawCreative } from "../../reporting/creative-preview-extract.ts";
import type { MetaLiveCampaignBundle } from "./types.ts";

export type MetaImportPickerRow = {
  /** Representative creative id of a unique creative — the key `carry` sends. */
  key: string;
  name: string;
  /**
   * Set only when another row has the same name: `post …<last 6 of the story id>`
   * for an existing post, `…<last 6 of the creative id>` otherwise.
   */
  nameHint: string | null;
  mediaType: "image" | "video" | null;
  thumbnailUrl: string | null;
  /** Ads that ran this creative. */
  copies: number;
  /** Meta AdCreative objects grouped into this row. */
  objects: number;
  /** Ad sets the creative ran in. */
  adSets: { id: string; name: string }[];
  defaultTicked: boolean;
  disabled: boolean;
  /** Why a row cannot be carried. Unticked rows stay enabled; the picker counts those separately. */
  unsupportedReason: "no_asset_reported" | "no_media_reported" | "post_unreachable" | null;
};

export type MetaImportPickerPayload = {
  campaign: { id: string; name: string; objective: string | null };
  adSets: { id: string; name: string }[];
  /** Ads the read returned. */
  adsRead: number;
  rows: MetaImportPickerRow[];
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * One row per unique creative (`groupMetaImportCreatives`). A creative whose
 * asset cannot be resolved is listed disabled — it is not a draft row.
 */
export function buildMetaImportPicker(bundle: MetaLiveCampaignBundle): MetaImportPickerPayload {
  const adSets = bundle.adSets.map((adSet) => ({
    id: str(adSet.id) ?? "",
    name: str(adSet.name) ?? "",
  }));
  const adSetName = new Map(adSets.map((adSet) => [adSet.id, adSet.name]));
  const byId = new Map<string, RawCreative & { id: string }>();
  for (const [key, creative] of Object.entries(bundle.creatives)) {
    const raw = creative as RawCreative;
    const id = str(raw.id) ?? key;
    byId.set(id, { ...raw, id });
  }

  const rows: MetaImportPickerRow[] = groupMetaImportCreatives(bundle).map((group) => {
    const raw = byId.get(group.representativeId)!;
    const canCarry = metaImportCreativeCarriable(raw);
    const existing = classifyImportedExistingPost(raw);
    const signature = deriveAssetSignature(raw);
    const postMedia =
      existing != null && !("unreachable" in existing) ? importedExistingPostMedia(raw) : null;
    const preview = extractPreview(raw);
    const mediaType = postMedia ?? (signature?.startsWith("video") ? "video" : signature ? "image" : null);
    const postId = group.key.startsWith("post:") ? group.key.slice("post:".length) : null;
    return {
      key: group.representativeId,
      name: group.name,
      nameHint: postId ? `post …${postId.slice(-6)}` : `…${group.representativeId.slice(-6)}`,
      mediaType,
      thumbnailUrl: preview.image_url,
      copies: group.adIds.length,
      objects: group.creativeIds.length,
      adSets: group.adSetIds.map((id) => ({ id, name: adSetName.get(id) || id })),
      defaultTicked: canCarry,
      disabled: !canCarry,
      unsupportedReason: canCarry
        ? null
        : existing && "unreachable" in existing
          ? "post_unreachable"
          : existing
            ? "no_media_reported"
            : "no_asset_reported",
    };
  });

  const named = new Map<string, number>();
  for (const row of rows) named.set(row.name, (named.get(row.name) ?? 0) + 1);
  for (const row of rows) if (named.get(row.name) === 1) row.nameHint = null;

  return {
    campaign: {
      id: str(bundle.campaign.id) ?? "",
      name: str(bundle.campaign.name) ?? "",
      objective: str(bundle.campaign.objective),
    },
    adSets,
    adsRead: bundle.ads.length,
    rows,
  };
}

export function defaultMetaImportCarry(picker: MetaImportPickerPayload): string[] {
  return picker.rows.filter((row) => row.defaultTicked && !row.disabled).map((row) => row.key);
}
