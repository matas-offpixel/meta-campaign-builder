/**
 * Send a stored intake file to Meta.
 *
 * campaign-assets allows authenticated INSERT and has no SELECT policy.
 * The session client's storage.copy therefore answers "Object not found"
 * for an object that is in the bucket (Grid.jpg / Story.jpg, 2026-10-09).
 * The copy here is made by whatever storage the caller passes — production
 * passes the service role, the same client handleUploadAsset uses to sign
 * the object. The copy is removed after that call returns, not before.
 */

import { mayDeleteIntakeUpload, uploadIntakeSlots, type IntakeMetaUploadSlot } from "./creative-intake.ts";
import type { CampaignDraft } from "../types.ts";

export const META_UPLOAD_BUCKET = "campaign-assets";

export interface MetaUploadStorage {
  copy: (from: string, to: string) => Promise<{ error: { message?: string } | null }>;
  remove: (paths: string[]) => Promise<unknown>;
}

export async function postStoredAssetToMeta(
  storage: MetaUploadStorage,
  input: {
    adAccountId: string;
    filename: string;
    mediaKind: "image" | "video";
    contentHash: string;
    byteSize: number;
    storagePath: string;
    aspectRatio?: string;
  },
  upload: (request: Request) => Promise<Response>,
): Promise<{ ok: true; hash?: string; videoId?: string } | { ok: false; error: string }> {
  const folder = input.mediaKind === "video" ? "videos" : "images";
  const copyPath = `${folder}/mml-${crypto.randomUUID()}-meta-upload`;
  const copied = await storage.copy(input.storagePath, copyPath);
  if (copied.error) {
    return { ok: false, error: copied.error.message ?? "Could not copy the file for Meta" };
  }
  try {
    const response = await upload(
      new Request("http://localhost/api/meta/upload-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: copyPath,
          storageBucket: META_UPLOAD_BUCKET,
          type: input.mediaKind,
          adAccountId: input.adAccountId,
          fileName: input.filename,
          contentHash: input.contentHash,
          byteSize: input.byteSize,
          aspectRatio: input.aspectRatio,
        }),
      }),
    );
    const json = (await response.json().catch(() => null)) as { error?: string; hash?: string; videoId?: string } | null;
    if (!response.ok) return { ok: false, error: json?.error ?? `HTTP ${response.status}` };
    return { ok: true, hash: json?.hash, videoId: json?.videoId };
  } finally {
    if (mayDeleteIntakeUpload(copyPath, input.storagePath)) {
      await Promise.resolve(storage.remove([copyPath])).catch(() => undefined);
    }
  }
}

export interface IntakeRegistryFile {
  id: string;
  filename: string;
  mediaKind: "image" | "video";
  contentHash: string;
  byteSize: number;
  storagePath: string;
  aspectRatio: string;
}

/**
 * Uploads the pending assets on the creatives Send just wrote.
 * A channel-id hit makes no call. The draft comes back with Meta hashes.
 */
export async function deliverIntakeAssetsToMeta(input: {
  draft: CampaignDraft;
  creativeIds: Set<string>;
  assetsById: Map<string, IntakeRegistryFile>;
  adAccountId: string;
  channelPlatformId: (registryAssetId: string) => string | null;
  channelReadError?: (registryAssetId: string) => string | null;
  storage: MetaUploadStorage;
  upload: (request: Request) => Promise<Response>;
  onUpload?: (event: { index: number; total: number; filename: string }) => void;
}): Promise<{ draft: CampaignDraft; changed: boolean }> {
  type Slot = IntakeMetaUploadSlot & { assetId: string };
  const slots: Slot[] = [];
  for (const creative of input.draft.creatives) {
    if (!input.creativeIds.has(creative.id)) continue;
    for (const variation of creative.assetVariations) {
      for (const asset of variation.assets) {
        if (!asset.registryAssetId || !asset.storagePath) continue;
        const row = input.assetsById.get(asset.registryAssetId);
        slots.push({
          assetId: asset.id,
          registryAssetId: asset.registryAssetId,
          mediaKind: row?.mediaKind ?? (creative.mediaType === "video" ? "video" : "image"),
          uploadStatus: asset.uploadStatus,
          assetHash: asset.assetHash,
          videoId: asset.videoId,
          error: asset.error,
        });
      }
    }
  }
  if (slots.length === 0) return { draft: input.draft, changed: false };

  const pending = slots.filter((slot) => {
    if (slot.uploadStatus === "uploaded" && (slot.assetHash || slot.videoId)) return false;
    if (input.channelPlatformId(slot.registryAssetId)) return false;
    return true;
  });
  let index = 0;
  const result = await uploadIntakeSlots({
    slots,
    channelPlatformId: input.channelPlatformId,
    upload: async (slot) => {
      const failed = input.channelReadError?.(slot.registryAssetId);
      if (failed) return { ok: false as const, error: failed };
      const row = input.assetsById.get(slot.registryAssetId);
      if (!row) return { ok: false as const, error: "Asset is not in the registry" };
      index += 1;
      input.onUpload?.({ index, total: pending.length, filename: row.filename });
      return postStoredAssetToMeta(
        input.storage,
        {
          adAccountId: input.adAccountId,
          filename: row.filename,
          mediaKind: slot.mediaKind,
          contentHash: row.contentHash,
          byteSize: row.byteSize,
          storagePath: row.storagePath,
          aspectRatio: row.aspectRatio === "other" ? undefined : row.aspectRatio,
        },
        input.upload,
      );
    },
  });
  return {
    draft: stampUploadedAssets(input.draft, result.slots, input.creativeIds),
    changed: result.slots.some(
      (slot, i) =>
        slot.uploadStatus !== slots[i]?.uploadStatus ||
        slot.assetHash !== slots[i]?.assetHash ||
        slot.videoId !== slots[i]?.videoId ||
        slot.error !== slots[i]?.error,
    ),
  };
}

export function stampUploadedAssets(
  draft: CampaignDraft,
  slots: Array<IntakeMetaUploadSlot & { assetId: string }>,
  creativeIds: Set<string>,
): CampaignDraft {
  const byAsset = new Map(slots.map((slot) => [slot.assetId, slot]));
  return {
    ...draft,
    creatives: draft.creatives.map((creative) => {
      if (!creativeIds.has(creative.id)) return creative;
      return {
        ...creative,
        assetVariations: creative.assetVariations.map((variation) => ({
          ...variation,
          assets: variation.assets.map((asset) => {
            const slot = byAsset.get(asset.id);
            if (!slot) return asset;
            return {
              ...asset,
              uploadStatus: slot.uploadStatus,
              assetHash: slot.assetHash,
              videoId: slot.videoId,
              error: slot.error,
            };
          }),
        })),
      };
    }),
  };
}
