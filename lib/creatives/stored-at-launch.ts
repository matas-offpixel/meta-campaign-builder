/**
 * lib/creatives/stored-at-launch.ts
 *
 * M3a (scratch/mcp/m3-full-control-2026-11-25.md, step 1): a slot whose file
 * is already in Storage goes to Meta at Launch, so it is no longer a launch
 * blocker. Files attached through the connector or the Drive picker are
 * copied into the `campaign-assets` bucket and registered in creative_assets
 * (registryAssetId); until Launch they sit "pending". Launch sends each one
 * through the MML upload path (lib/plan/stored-assets-meta.ts) and stamps
 * its Meta hash or video id before anything is created.
 *
 * A pending slot with no Storage copy (or no registry row) still blocks with
 * "Asset not yet uploaded": there is nothing on the server to send.
 *
 * Pure. Relative imports only (node:test).
 */
import type { Asset, CampaignDraft } from "../types.ts";

type SlotLike = Pick<Asset, "uploadStatus" | "storagePath" | "registryAssetId" | "assetHash" | "videoId">;

/** A pending slot whose file is in Storage and registered: Launch sends it to Meta first. */
export function sendsAtLaunch(slot: SlotLike): boolean {
  return slot.uploadStatus === "pending" && Boolean(slot.storagePath?.trim()) && Boolean(slot.registryAssetId?.trim());
}

/**
 * What the send step takes: pending slots that send at launch, and failed
 * ones that still hold their Storage copy (a retry from the connector's
 * upload_draft_assets). An uploaded slot is never sent again.
 */
export function storedSlotToSend(slot: SlotLike): boolean {
  if (sendsAtLaunch(slot)) return true;
  return slot.uploadStatus === "error" && Boolean(slot.storagePath?.trim()) && Boolean(slot.registryAssetId?.trim()) && !slot.assetHash && !slot.videoId;
}

export interface StoredSlotRef {
  creativeId: string;
  creativeName: string;
  variationName: string;
  assetId: string;
  aspectRatio: string;
  registryAssetId: string;
}

/** Every slot the send step takes, in the draft's order. */
export function storedSlotsToSend(draft: Pick<CampaignDraft, "creatives">): StoredSlotRef[] {
  const out: StoredSlotRef[] = [];
  for (const c of draft.creatives ?? []) {
    if ((c.sourceType ?? "new") !== "new") continue;
    for (const v of c.assetVariations ?? []) {
      for (const a of v.assets ?? []) {
        if (!storedSlotToSend(a)) continue;
        out.push({
          creativeId: c.id,
          creativeName: c.name?.trim() || "Ad",
          variationName: v.name?.trim() || "Variation",
          assetId: a.id,
          aspectRatio: a.aspectRatio,
          registryAssetId: a.registryAssetId!,
        });
      }
    }
  }
  return out;
}

/** One slot's outcome from the send step. */
export interface StoredSlotResult {
  assetId: string;
  uploadStatus: Asset["uploadStatus"];
  assetHash?: string;
  videoId?: string;
  error?: string;
}

/**
 * Lays the send step's outcomes onto a draft by slot id (the browser applies
 * them to the draft it holds now, which may have moved on while the files
 * went). Slots not in `results` are left as they are.
 */
export function applyStoredSlotResults<T extends Pick<CampaignDraft, "creatives">>(draft: T, results: readonly StoredSlotResult[]): T {
  if (results.length === 0) return draft;
  const byId = new Map(results.map((r) => [r.assetId, r]));
  return {
    ...draft,
    creatives: draft.creatives.map((c) => ({
      ...c,
      assetVariations: (c.assetVariations ?? []).map((v) => ({
        ...v,
        assets: v.assets.map((a) => {
          const r = byId.get(a.id);
          if (!r) return a;
          return { ...a, uploadStatus: r.uploadStatus, assetHash: r.assetHash, videoId: r.videoId, error: r.error };
        }),
      })),
    })),
  };
}

/** The slot results for `refs`, read off a draft the send step returned. */
export function storedSlotResults(draft: Pick<CampaignDraft, "creatives">, refs: readonly StoredSlotRef[]): StoredSlotResult[] {
  const want = new Set(refs.map((r) => r.assetId));
  const out: StoredSlotResult[] = [];
  for (const c of draft.creatives ?? []) {
    for (const v of c.assetVariations ?? []) {
      for (const a of v.assets ?? []) {
        if (!want.has(a.id)) continue;
        out.push({ assetId: a.id, uploadStatus: a.uploadStatus, assetHash: a.assetHash, videoId: a.videoId, error: a.error });
      }
    }
  }
  return out;
}
