/**
 * lib/plan/stored-assets-meta.ts
 *
 * The MML upload path for files already in Storage, shared by the canvas's
 * Send (syncPlanCreativeIntake), standalone Launch on /campaign/[id] and the
 * connector's launch_draft / upload_draft_assets (M3a):
 *
 *   creative_asset_channel_ids for this ad account (a hit makes no call)
 *   → deliverIntakeAssetsToMeta → /api/meta/upload-asset's storage-path body
 *     (handleUploadAsset, which waits for a video to be ready in file_url
 *     mode), on a service-role copy of the registry object
 *   → the slot stamped with its Meta hash or video id.
 *
 * Storage and the upload handler come in as deps, so this runs under
 * node:test. Relative imports only.
 */
import { findChannelId, loadAssetsByIds, type CreativeAssetRow } from "../creatives/asset-registry.ts";
import { storedSlotResults, storedSlotsToSend, type StoredSlotRef, type StoredSlotResult } from "../creatives/stored-at-launch.ts";
import type { CampaignDraft } from "../types.ts";
import { deliverIntakeAssetsToMeta, stampUploadedAssets, type MetaUploadStorage } from "./creative-intake-meta.ts";

export const NO_AD_ACCOUNT = "No Meta ad account on this draft";

type UploadEvent = { index: number; total: number; filename: string };

/**
 * Uploads pending MML assets through `/api/meta/upload-asset`'s storage-path
 * body. A `creative_asset_channel_ids` hit for this ad account makes no call.
 * The route is given a service-role copy, never the registry object's path,
 * because a failed upload deletes the path it was handed. The session client
 * cannot read this bucket, so its copy returns "Object not found".
 */
export async function uploadMmlDraftAssets(input: {
  supabase: unknown;
  draft: CampaignDraft;
  creativeIds: Set<string>;
  userId: string;
  byRegistry: Map<string, CreativeAssetRow>;
  /** The service-role bucket (copy and remove). */
  storage: MetaUploadStorage;
  /** POST /api/meta/upload-asset's handler (handleUploadAsset), for this user. */
  upload: (request: Request) => Promise<Response>;
  onUpload?: (event: UploadEvent) => void;
}): Promise<{ draft: CampaignDraft; changed: boolean }> {
  const adAccountId = input.draft.settings.adAccountId || input.draft.settings.metaAdAccountId || "";
  if (!adAccountId) {
    const slots = pendingSlots(input.draft, input.creativeIds).map((slot) =>
      slot.uploadStatus === "uploaded" ? slot : { ...slot, uploadStatus: "pending" as const, error: NO_AD_ACCOUNT },
    );
    return {
      draft: stampUploadedAssets(input.draft, slots, input.creativeIds),
      changed: slots.some((slot) => slot.error === NO_AD_ACCOUNT),
    };
  }

  const channelId = new Map<string, string | null>();
  const readError = new Map<string, string>();
  const registryIds = new Set<string>();
  for (const creative of input.draft.creatives) {
    if (!input.creativeIds.has(creative.id)) continue;
    for (const variation of creative.assetVariations) {
      for (const asset of variation.assets) {
        if (asset.registryAssetId) registryIds.add(asset.registryAssetId);
      }
    }
  }
  for (const assetId of registryIds) {
    const found = await findChannelId(input.supabase, {
      assetId,
      userId: input.userId,
      channel: "meta",
      scope: adAccountId,
    });
    if (!found.ok) readError.set(assetId, found.error);
    else channelId.set(assetId, found.platformId);
  }

  return deliverIntakeAssetsToMeta({
    draft: input.draft,
    creativeIds: input.creativeIds,
    assetsById: input.byRegistry,
    adAccountId,
    channelPlatformId: (assetId) => channelId.get(assetId) ?? null,
    channelReadError: (assetId) => readError.get(assetId) ?? null,
    storage: input.storage,
    upload: input.upload,
    onUpload: input.onUpload,
  });
}

function pendingSlots(draft: CampaignDraft, creativeIds: Set<string>) {
  const slots: Array<{
    assetId: string;
    registryAssetId: string;
    mediaKind: "image" | "video";
    uploadStatus: "pending" | "uploading" | "uploaded" | "error";
    assetHash?: string;
    videoId?: string;
    error?: string;
  }> = [];
  for (const creative of draft.creatives) {
    if (!creativeIds.has(creative.id)) continue;
    for (const variation of creative.assetVariations) {
      for (const asset of variation.assets) {
        if (!asset.registryAssetId || !asset.storagePath) continue;
        slots.push({
          assetId: asset.id,
          registryAssetId: asset.registryAssetId,
          mediaKind: creative.mediaType === "video" ? "video" : "image",
          uploadStatus: asset.uploadStatus,
          assetHash: asset.assetHash,
          videoId: asset.videoId,
          error: asset.error,
        });
      }
    }
  }
  return slots;
}

export interface StoredSendOutcome {
  /** The draft with every sent slot stamped (uploaded) or marked failed (uploadStatus "error"). */
  draft: CampaignDraft;
  /** The slots this step took. */
  slots: StoredSlotRef[];
  /** Each taken slot's outcome, by slot id. */
  results: StoredSlotResult[];
  /** Slots now uploaded (new uploads and already-on-the-account hits). */
  uploaded: number;
  /** POSTs to the upload handler (one per file not yet on the ad account). */
  calls: number;
  failed: Array<StoredSlotRef & { error: string }>;
  changed: boolean;
}

/**
 * Standalone Launch's first step, and the connector's upload_draft_assets:
 * every slot whose file is in Storage (lib/creatives/stored-at-launch.ts)
 * goes to the draft's ad account through uploadMmlDraftAssets. A slot that
 * didn't go is marked uploadStatus "error" with its reason, so Review shows
 * today's "Upload failed — retry or remove" and the launch stops.
 *
 * Nothing here launches or saves: the caller saves the stamped draft.
 */
export async function sendStoredDraftAssets(input: {
  supabase: unknown;
  draft: CampaignDraft;
  userId: string;
  storage: MetaUploadStorage;
  upload: (request: Request) => Promise<Response>;
  onUpload?: (event: UploadEvent) => void;
}): Promise<StoredSendOutcome> {
  const refs = storedSlotsToSend(input.draft);
  if (refs.length === 0) return { draft: input.draft, slots: [], results: [], uploaded: 0, calls: 0, failed: [], changed: false };
  const wanted = new Set(refs.map((r) => r.assetId));
  // A failed slot being retried goes back to pending, so the MML path takes it as one.
  const ready: CampaignDraft = {
    ...input.draft,
    creatives: input.draft.creatives.map((c) => ({
      ...c,
      assetVariations: c.assetVariations.map((v) => ({
        ...v,
        assets: v.assets.map((a) => (wanted.has(a.id) && a.uploadStatus === "error" ? { ...a, uploadStatus: "pending" as const, error: undefined } : a)),
      })),
    })),
  };

  const registry = await loadAssetsByIds(input.supabase, input.userId, [...new Set(refs.map((r) => r.registryAssetId))]);
  let calls = 0;
  const upload = async (request: Request) => {
    calls += 1;
    return input.upload(request);
  };
  let sent: CampaignDraft;
  if (!registry.ok) {
    sent = markFailed(ready, wanted, registry.error);
  } else {
    const byRegistry = new Map(registry.assets.map((a) => [a.id, a]));
    const out = await uploadMmlDraftAssets({
      supabase: input.supabase,
      draft: ready,
      creativeIds: new Set(refs.map((r) => r.creativeId)),
      userId: input.userId,
      byRegistry,
      storage: input.storage,
      upload,
      onUpload: input.onUpload,
    });
    sent = out.draft;
  }

  // Anything taken that isn't uploaded now failed: today's error state.
  const finished = markFailed(sent, wanted, "Upload failed");
  const results = storedSlotResults(finished, refs);
  const byId = new Map(results.map((r) => [r.assetId, r]));
  const failed = refs.flatMap((ref) => {
    const r = byId.get(ref.assetId);
    return r && r.uploadStatus !== "uploaded" ? [{ ...ref, error: r.error ?? "Upload failed" }] : [];
  });
  return {
    draft: finished,
    slots: refs,
    results,
    uploaded: results.filter((r) => r.uploadStatus === "uploaded").length,
    calls,
    failed,
    changed: true,
  };
}

/** Taken slots that aren't uploaded with an id become uploadStatus "error", keeping their reason. */
function markFailed(draft: CampaignDraft, wanted: ReadonlySet<string>, fallback: string): CampaignDraft {
  return {
    ...draft,
    creatives: draft.creatives.map((c) => ({
      ...c,
      assetVariations: c.assetVariations.map((v) => ({
        ...v,
        assets: v.assets.map((a) => {
          if (!wanted.has(a.id)) return a;
          if (a.uploadStatus === "uploaded" && (a.assetHash || a.videoId)) return a;
          return { ...a, uploadStatus: "error" as const, error: a.error || fallback };
        }),
      })),
    })),
  };
}
