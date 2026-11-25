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
  /** The file's own name (the picker's), else null. */
  fileName: string | null;
  mediaKind: "image" | "video";
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
          fileName: a.fileName?.trim() || null,
          mediaKind: c.mediaType === "video" ? "video" : "image",
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

/**
 * FC4's words (record 2026-11-25-mcp-full-control, word list
 * scratch/mcp/words-mcp-today-2026-11-25.tsv, rows launch.upload.*), pinned
 * by a test against the list. Review & launch reads `review` where the
 * pending-file blocker was; the launch progress runs `progress` then, when
 * any are videos, `video`, each a step whose entity is `entity`; a failed
 * upload stops the launch with `stopped` in the launch panel, and the slot
 * keeps today's "Upload failed — retry or remove".
 */
export const LAUNCH_UPLOAD_WORDS = {
  review: (n: number) => (n === 1 ? "1 file goes to Meta when you launch." : `${n} files go to Meta when you launch.`),
  progress: (n: number) => (n === 1 ? "Sending 1 file to Meta…" : `Sending ${n} files to Meta…`),
  entity: "Files",
  video: (n: number) => (n === 1 ? "Waiting for Meta to finish 1 video…" : `Waiting for Meta to finish ${n} videos…`),
  stopped: (n: number) =>
    n === 1 ? "Launch stopped: 1 file didn’t reach Meta, so nothing was created." : `Launch stopped: ${n} files didn’t reach Meta, so nothing was created.`,
} as const;

/** The slot's existing failure line (lib/validation.ts), which the launch panel lists under `stopped`. */
export const UPLOAD_FAILED_SUFFIX = ": Upload failed — retry or remove";

/** Pending files the launch will send (Review's line). Failed ones are blockers, not counted. */
export function filesToSendAtLaunch(draft: Pick<CampaignDraft, "creatives">): { files: number; videos: number } {
  let files = 0;
  let videos = 0;
  for (const c of draft.creatives ?? []) {
    if ((c.sourceType ?? "new") !== "new") continue;
    for (const v of c.assetVariations ?? []) {
      for (const a of v.assets ?? []) {
        if (!sendsAtLaunch(a)) continue;
        files += 1;
        if (c.mediaType === "video") videos += 1;
      }
    }
  }
  return { files, videos };
}

/** Where FC4's two launch steps are: sending the files, waiting for the videos, then the existing steps. */
export interface StoredSendProgress {
  phase: "files" | "videos" | "launch";
  files: number;
  videos: number;
}

/**
 * FC4's steps ahead of the existing ones, in the launch progress: "Sending
 * {n} files to Meta…", then, when any are videos, "Waiting for Meta to
 * finish {n} videos…". A step behind the current phase is done.
 */
export function storedSendSteps(p: StoredSendProgress): Array<{ id: string; entity: string; label: string; done: boolean }> {
  const steps = [{ id: "u-files", entity: LAUNCH_UPLOAD_WORDS.entity, label: LAUNCH_UPLOAD_WORDS.progress(p.files), done: p.phase !== "files" }];
  if (p.videos > 0) steps.push({ id: "u-videos", entity: LAUNCH_UPLOAD_WORDS.entity, label: LAUNCH_UPLOAD_WORDS.video(p.videos), done: p.phase === "launch" });
  return steps;
}
