/**
 * Additive registration at existing Meta upload points.
 *
 * A missing 161 table or a registry write error never fails the Meta
 * upload — the wizard still gets hash / video_id as today.
 */

import { probeAspectFromBuffer } from "../clients/asset-queue/aspect-detect.server.ts";
import type { AssetUploadType, UploadAssetResult } from "../meta/upload.ts";
import {
  findAssetByFingerprint,
  findChannelId,
  fingerprintBytes,
  metaPlatformId,
  recordChannelId,
  resolveRegistryAspect,
  upsertRegisteredAsset,
  type ContentIdentity,
  type CreativeAssetRow,
} from "./asset-registry.ts";

export interface RegisterMetaUploadInput {
  supabase: unknown;
  userId: string;
  bytes: Uint8Array | Buffer;
  fileName: string;
  mediaKind: AssetUploadType;
  adAccountId: string;
  storageBucket: string;
  storagePath: string;
  result: UploadAssetResult;
  slotHint?: string | null;
  durationSeconds?: number | null;
}

export interface ExistingMetaChannelHit {
  identity: ContentIdentity;
  asset: CreativeAssetRow;
  platformId: string;
}

/**
 * If these bytes are already on this ad account, return the stored Meta
 * id so the route can skip a second Graph upload.
 */
export async function findExistingMetaChannelUpload(
  supabase: unknown,
  input: {
    userId: string;
    bytes: Uint8Array | Buffer;
    adAccountId: string;
  },
): Promise<ExistingMetaChannelHit | null> {
  const identity = fingerprintBytes(input.bytes);
  const found = await findAssetByFingerprint(supabase, input.userId, identity);
  if (!found.ok || !found.asset) return null;
  const channel = await findChannelId(supabase, {
    assetId: found.asset.id,
    userId: input.userId,
    channel: "meta",
    scope: input.adAccountId,
  });
  if (!channel.ok || !channel.platformId) return null;
  return { identity, asset: found.asset, platformId: channel.platformId };
}

export function existingMetaResult(
  hit: ExistingMetaChannelHit,
  mediaKind: AssetUploadType,
): UploadAssetResult {
  if (mediaKind === "image") {
    return {
      assetType: "image",
      url: hit.asset.thumbnailUrl ?? "",
      hash: hit.platformId,
      previewUrl: hit.asset.thumbnailUrl ?? "",
      registryAssetId: hit.asset.id,
    };
  }
  return {
    assetType: "video",
    url: hit.asset.thumbnailUrl ?? "",
    videoId: hit.platformId,
    previewUrl: hit.asset.thumbnailUrl ?? "",
    registryAssetId: hit.asset.id,
  };
}

export async function registerMetaUpload(
  input: RegisterMetaUploadInput,
): Promise<string | undefined> {
  const platformId = metaPlatformId({
    mediaKind: input.mediaKind,
    hash: input.result.hash,
    videoId: input.result.videoId,
  });
  if (!platformId) return undefined;

  const identity = fingerprintBytes(input.bytes);
  const probed = await probeAspectFromBuffer(
    Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes),
    input.mediaKind === "image" ? "image/jpeg" : "video/mp4",
  );
  const upserted = await upsertRegisteredAsset(input.supabase, {
    userId: input.userId,
    identity,
    filename: input.fileName,
    mediaKind: input.mediaKind,
    aspectRatio: resolveRegistryAspect({
      filename: input.fileName,
      probed,
      slotHint: input.slotHint,
    }),
    durationSeconds: input.durationSeconds ?? null,
    storageBucket: input.storageBucket,
    storagePath: input.storagePath,
    thumbnailUrl: input.result.previewUrl ?? input.result.url ?? null,
  });
  if (!upserted.ok) {
    if (!upserted.tableMissing) {
      console.error("[creative-assets] register failed:", upserted.error);
    }
    return undefined;
  }

  const channel = await recordChannelId(input.supabase, {
    assetId: upserted.asset.id,
    userId: input.userId,
    channel: "meta",
    scope: input.adAccountId,
    platformId,
  });
  if (!channel.ok && !channel.tableMissing) {
    console.error("[creative-assets] channel id failed:", channel.error);
  }
  return upserted.asset.id;
}
