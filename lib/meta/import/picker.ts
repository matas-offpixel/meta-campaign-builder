import { deriveAssetSignature } from "../../reporting/asset-signature.ts";
import { extractPreview } from "../../reporting/creative-preview-extract.ts";
import type { RawCreative } from "../../reporting/creative-preview-extract.ts";
import type { MetaLiveCampaignBundle } from "./types.ts";

export type MetaImportPickerRow = {
  /** Creative id — the key `carry` sends. */
  key: string;
  name: string;
  mediaType: "image" | "video" | null;
  thumbnailUrl: string | null;
  copies: number;
  defaultTicked: boolean;
  disabled: boolean;
  unsupportedReason: "no_asset_reported" | null;
};

export type MetaImportPickerPayload = {
  campaign: { id: string; name: string; objective: string | null };
  adSets: { id: string; name: string }[];
  rows: MetaImportPickerRow[];
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Creatives the operator can tick. A creative whose asset cannot be
 * resolved is listed disabled — it is not a draft row.
 */
export function buildMetaImportPicker(bundle: MetaLiveCampaignBundle): MetaImportPickerPayload {
  const copies = new Map<string, number>();
  for (const ad of bundle.ads) {
    const creative = ad.creative;
    const id =
      creative && typeof creative === "object" && !Array.isArray(creative)
        ? str((creative as { id?: unknown }).id)
        : null;
    if (!id) continue;
    copies.set(id, (copies.get(id) ?? 0) + 1);
  }

  const rows: MetaImportPickerRow[] = [];
  for (const [id, creative] of Object.entries(bundle.creatives)) {
    const raw = creative as RawCreative;
    const signature = deriveAssetSignature(raw);
    const preview = extractPreview(raw);
    const mediaType = signature?.startsWith("video") ? "video" : signature ? "image" : null;
    rows.push({
      key: str(raw.id) ?? id,
      name: str(raw.name) ?? preview.headline ?? id,
      mediaType,
      thumbnailUrl: preview.image_url,
      copies: copies.get(str(raw.id) ?? id) ?? 0,
      defaultTicked: signature != null,
      disabled: signature == null,
      unsupportedReason: signature == null ? "no_asset_reported" : null,
    });
  }

  return {
    campaign: {
      id: str(bundle.campaign.id) ?? "",
      name: str(bundle.campaign.name) ?? "",
      objective: str(bundle.campaign.objective),
    },
    adSets: bundle.adSets.map((adSet) => ({
      id: str(adSet.id) ?? "",
      name: str(adSet.name) ?? "",
    })),
    rows,
  };
}

export function defaultMetaImportCarry(picker: MetaImportPickerPayload): string[] {
  return picker.rows.filter((row) => row.defaultTicked && !row.disabled).map((row) => row.key);
}
