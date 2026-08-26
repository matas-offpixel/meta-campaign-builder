/**
 * One-time, operator-triggered registration of historical Meta assets
 * into creative_assets. Never automatic. Bytes come from storage paths
 * the draft actually references — missing bytes are reported honestly,
 * never guessed from a Meta CDN URL.
 */

import {
  findAssetByChannelId,
  fingerprintBytes,
  recordChannelId,
  resolveRegistryAspect,
  upsertRegisteredAsset,
  type CreativeAssetRow,
  type RegistryMediaKind,
} from "../creatives/asset-registry.ts";
import type { Asset, CampaignDraft } from "../types.ts";
import { extractMetaDraftAssetRefs, type MetaDraftAssetRef } from "./asset-routing.ts";

export const CANNOT_REGISTER_REASON = "cannot register — original file not in storage";

export const DEFAULT_BACKFILL_BUCKET = "campaign-assets";

const STORAGE_OBJECT_URL =
  /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

export type BackfillRowStatus = "registered" | "already_registered" | "cannot_register";

export interface BackfillOutcomeRow {
  platformId: string;
  filename: string;
  mediaKind: RegistryMediaKind;
  status: BackfillRowStatus;
  reason: string | null;
  assetId: string | null;
}

export interface BackfillReport {
  rows: BackfillOutcomeRow[];
  registered: number;
  alreadyRegistered: number;
  cannotRegister: number;
  pendingBefore: number;
  draft: CampaignDraft;
}

export interface BackfillCandidate {
  ref: MetaDraftAssetRef;
  storageBucket: string | null;
  storagePath: string | null;
}

export interface BackfillStorage {
  download(bucket: string, path: string): Promise<Uint8Array | null>;
}

export function storageRefFromUrl(
  url: string | null | undefined,
): { bucket: string; path: string } | null {
  if (!url) return null;
  const match = url.match(STORAGE_OBJECT_URL);
  if (!match) return null;
  try {
    const path = decodeURIComponent(match[2]);
    if (!path.trim()) return null;
    return { bucket: decodeURIComponent(match[1]), path };
  } catch {
    return null;
  }
}

export function storageRefFromAsset(asset: Asset): { bucket: string; path: string } | null {
  const explicit = asset.storagePath?.trim();
  if (explicit) {
    return {
      bucket: asset.storageBucket?.trim() || DEFAULT_BACKFILL_BUCKET,
      path: explicit.replace(/^\//, ""),
    };
  }
  return storageRefFromUrl(asset.uploadedUrl) ?? storageRefFromUrl(asset.thumbnailUrl);
}

export function collectBackfillCandidates(draft: CampaignDraft): BackfillCandidate[] {
  const refs = extractMetaDraftAssetRefs(draft);
  const byPlatform = indexDraftAssetsByPlatformId(draft);
  return refs.map((ref) => {
    const asset = byPlatform.get(`${ref.mediaKind}:${ref.metaPlatformId}`);
    const storage = asset ? storageRefFromAsset(asset) : null;
    return {
      ref,
      storageBucket: storage?.bucket ?? null,
      storagePath: storage?.path ?? null,
    };
  });
}

export function countUnregisteredMetaAssets(
  refs: readonly MetaDraftAssetRef[],
): number {
  return refs.filter((ref) => !ref.registryAssetId).length;
}

export async function backfillHistoricalMetaAssets(input: {
  supabase: unknown;
  userId: string;
  draft: CampaignDraft;
  storage: BackfillStorage;
  existingAssets?: CreativeAssetRow[];
}): Promise<BackfillReport> {
  const adAccountId = input.draft.settings.adAccountId?.trim() ?? "";
  const candidates = collectBackfillCandidates(input.draft);
  const rows: BackfillOutcomeRow[] = [];
  const stamped = new Map<string, string>();

  for (const candidate of candidates) {
    const already = await resolveAlreadyRegistered(input, candidate.ref, adAccountId);
    if (already) {
      stamped.set(candidate.ref.metaPlatformId, already);
      rows.push({
        platformId: candidate.ref.metaPlatformId,
        filename: candidate.ref.filename,
        mediaKind: candidate.ref.mediaKind,
        status: "already_registered",
        reason: null,
        assetId: already,
      });
      continue;
    }

    if (!candidate.storagePath || !candidate.storageBucket) {
      rows.push(cannotRegisterRow(candidate));
      continue;
    }

    const bytes = await input.storage.download(candidate.storageBucket, candidate.storagePath);
    if (!bytes || bytes.byteLength === 0) {
      rows.push(cannotRegisterRow(candidate));
      continue;
    }

    const identity = fingerprintBytes(bytes);
    const upserted = await upsertRegisteredAsset(input.supabase, {
      userId: input.userId,
      identity,
      filename: candidate.ref.filename,
      mediaKind: candidate.ref.mediaKind,
      aspectRatio: resolveRegistryAspect({
        filename: candidate.ref.filename,
        slotHint: candidate.ref.aspectRatio,
      }),
      storageBucket: candidate.storageBucket,
      storagePath: candidate.storagePath,
      thumbnailUrl: candidate.ref.thumbnailUrl,
    });
    if (!upserted.ok) {
      rows.push(cannotRegisterRow(candidate, upserted.error));
      continue;
    }

    if (adAccountId) {
      await recordChannelId(input.supabase, {
        assetId: upserted.asset.id,
        userId: input.userId,
        channel: "meta",
        scope: adAccountId,
        platformId: candidate.ref.metaPlatformId,
      });
    }

    stamped.set(candidate.ref.metaPlatformId, upserted.asset.id);
    rows.push({
      platformId: candidate.ref.metaPlatformId,
      filename: candidate.ref.filename,
      mediaKind: candidate.ref.mediaKind,
      status: upserted.created ? "registered" : "already_registered",
      reason: null,
      assetId: upserted.asset.id,
    });
  }

  const draft = stampRegistryIdsOnDraft(input.draft, stamped);
  return { ...summariseBackfill(rows), draft };
}

export function stampRegistryIdsOnDraft(
  draft: CampaignDraft,
  platformIdToAssetId: Map<string, string>,
): CampaignDraft {
  if (platformIdToAssetId.size === 0) return draft;
  return {
    ...draft,
    creatives: (draft.creatives ?? []).map((creative) => ({
      ...creative,
      assetVariations: (creative.assetVariations ?? []).map((variation) => ({
        ...variation,
        assets: (variation.assets ?? []).map((asset) => {
          const platformId = (asset.videoId ?? asset.assetHash)?.trim();
          if (!platformId || asset.registryAssetId) return asset;
          const assetId = platformIdToAssetId.get(platformId);
          return assetId ? { ...asset, registryAssetId: assetId } : asset;
        }),
      })),
    })),
  };
}

export function liveBackfillStorage(supabase: {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message?: string } | null }>;
    };
  };
}): BackfillStorage {
  return {
    async download(bucket, path) {
      const { data, error } = await supabase.storage.from(bucket).download(path);
      if (error || !data) return null;
      const buffer = await data.arrayBuffer();
      return buffer.byteLength === 0 ? null : new Uint8Array(buffer);
    },
  };
}

function cannotRegisterRow(
  candidate: BackfillCandidate,
  reason: string = CANNOT_REGISTER_REASON,
): BackfillOutcomeRow {
  return {
    platformId: candidate.ref.metaPlatformId,
    filename: candidate.ref.filename,
    mediaKind: candidate.ref.mediaKind,
    status: "cannot_register",
    reason,
    assetId: null,
  };
}

function summariseBackfill(rows: BackfillOutcomeRow[]): Omit<BackfillReport, "draft"> {
  return {
    rows,
    registered: rows.filter((row) => row.status === "registered").length,
    alreadyRegistered: rows.filter((row) => row.status === "already_registered").length,
    cannotRegister: rows.filter((row) => row.status === "cannot_register").length,
    pendingBefore: rows.filter((row) => row.status !== "already_registered").length,
  };
}

async function resolveAlreadyRegistered(
  input: {
    supabase: unknown;
    userId: string;
    existingAssets?: CreativeAssetRow[];
  },
  ref: MetaDraftAssetRef,
  adAccountId: string,
): Promise<string | null> {
  if (ref.registryAssetId) return ref.registryAssetId;
  if (input.existingAssets?.some((asset) => asset.id === ref.registryAssetId)) {
    return ref.registryAssetId;
  }
  if (!adAccountId) return null;
  const found = await findAssetByChannelId(input.supabase, {
    userId: input.userId,
    channel: "meta",
    scope: adAccountId,
    platformId: ref.metaPlatformId,
  });
  return found.ok ? found.assetId : null;
}

function indexDraftAssetsByPlatformId(draft: CampaignDraft): Map<string, Asset> {
  const map = new Map<string, Asset>();
  for (const creative of draft.creatives ?? []) {
    for (const variation of creative.assetVariations ?? []) {
      for (const asset of variation.assets ?? []) {
        if (asset.uploadStatus !== "uploaded") continue;
        const mediaKind: RegistryMediaKind =
          creative.mediaType === "video" || Boolean(asset.videoId) ? "video" : "image";
        const platformId =
          mediaKind === "video" ? asset.videoId?.trim() ?? "" : asset.assetHash?.trim() ?? "";
        if (!platformId) continue;
        map.set(`${mediaKind}:${platformId}`, asset);
      }
    }
  }
  return map;
}
