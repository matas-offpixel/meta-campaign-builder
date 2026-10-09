import "server-only";

import sharp from "sharp";

import { probeAspectFromBuffer } from "../clients/asset-queue/aspect-detect.server.ts";
import {
  loadChannelDefaultsForEvent,
  resolveChannelDefaults,
} from "../clients/channel-defaults.ts";
import {
  findChannelId,
  fingerprintBytes,
  loadAssetsByIds,
  upsertRegisteredAsset,
  type CreativeAssetRow,
} from "../creatives/asset-registry.ts";
import { handleUploadAsset } from "../meta/upload-asset-handler.ts";
import { upsertPlanAssetRoute, loadPlanAssetRoutes } from "./asset-routing-db.ts";
import { runPlanTikTokAssetFanout } from "./asset-routing-server.ts";
import { tikTokLaunchIsLive } from "./asset-routing-execute.ts";
import {
  applyIntakeToMetaDraft,
  creativeDraftFingerprint,
  type IntakeAssetRecord as ApplyAsset,
} from "./creative-intake-apply.ts";
import {
  intakeAspect,
  isMultiPlacementEnabled,
  matchRefusal,
  isIntakeUploadPath,
  mayDeleteIntakeUpload,
  planIntakeSend,
  intakeSendChanges,
  uploadIntakeSlots,
  type IntakeBucket,
  type IntakeMetaUploadSlot,
  type IntakeSendAsset,
} from "./creative-intake.ts";
import {
  attachIntakeAsset,
  clearGroupMembers,
  deleteEmptyIntakeGroups,
  insertIntakeGroup,
  listIntakeAssets,
  listIntakeGroups,
  replaceGroupMembers,
  setIntakeAspectOverride,
  stampIntakeGroup,
} from "./creative-intake-db.ts";
import { loadLinkedDraftsForPlan, upsertLinkedMetaDraft } from "./linked-drafts.ts";
import type { CampaignDraft } from "../types.ts";
import type { CampaignPlan } from "./types.ts";

const BUCKET = "campaign-assets";

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      download: (path: string) => Promise<{ data: Blob | null; error: { message?: string } | null }>;
      remove: (paths: string[]) => Promise<{ error: { message?: string } | null }>;
      createSignedUrl: (
        path: string,
        seconds: number,
      ) => Promise<{ data: { signedUrl: string } | null; error: { message?: string } | null }>;
      copy: (from: string, to: string) => Promise<{ error: { message?: string } | null }>;
    };
  };
};

function storageOf(supabase: unknown): StorageClient["storage"] {
  return (supabase as StorageClient).storage;
}

export interface IntakeViewAsset {
  id: string;
  filename: string;
  mediaKind: "image" | "video";
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  detectedBucket: IntakeBucket;
  override: IntakeBucket | null;
  bucket: IntakeBucket;
  reason: string | null;
  thumbnailUrl: string | null;
  groupId: string | null;
  uploadError: string | null;
}

export interface IntakeView {
  ok: true;
  tableMissing: boolean;
  multiPlacement: boolean;
  assets: IntakeViewAsset[];
  groups: Array<{ id: string; assetIds: string[]; stableKey: string }>;
  notes: string[];
}

function effectiveBucket(detected: IntakeBucket, override: IntakeBucket | null): IntakeBucket {
  return override ?? detected;
}

async function signedUrl(supabase: unknown, path: string): Promise<string | null> {
  const signed = await storageOf(supabase).from(BUCKET).createSignedUrl(path, 60 * 30);
  return signed.data?.signedUrl ?? null;
}

export async function loadCreativeIntakeView(
  supabase: unknown,
  plan: CampaignPlan,
): Promise<IntakeView | { ok: false; error: string }> {
  const [assets, groups] = await Promise.all([
    listIntakeAssets(supabase, plan.id, plan.userId),
    listIntakeGroups(supabase, plan.id, plan.userId),
  ]);
  if (!assets.ok) {
    if (assets.tableMissing) {
      return { ok: true, tableMissing: true, multiPlacement: isMultiPlacementEnabled(process.env.ENABLE_MULTI_PLACEMENT_ASSETS), assets: [], groups: [], notes: [] };
    }
    return { ok: false, error: assets.error };
  }
  if (!groups.ok) {
    if (groups.tableMissing) {
      return { ok: true, tableMissing: true, multiPlacement: isMultiPlacementEnabled(process.env.ENABLE_MULTI_PLACEMENT_ASSETS), assets: [], groups: [], notes: [] };
    }
    return { ok: false, error: groups.error };
  }
  const registry = await loadAssetsByIds(
    supabase,
    plan.userId,
    assets.assets.map((row) => row.assetId),
  );
  if (!registry.ok) return { ok: false, error: registry.error };
  const byId = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const groupOf = new Map<string, string>();
  for (const group of groups.groups) {
    if (group.stableKey.startsWith("single:")) continue;
    for (const assetId of group.assetIds) groupOf.set(assetId, group.id);
  }
  const drafts = await loadLinkedDraftsForPlan(supabase, plan);
  const uploadErrorByAsset = new Map<string, string>();
  for (const creative of drafts.meta?.creatives ?? []) {
    for (const variation of creative.assetVariations ?? []) {
      for (const asset of variation.assets ?? []) {
        if (asset.registryAssetId && asset.uploadStatus === "pending" && asset.error) {
          uploadErrorByAsset.set(asset.registryAssetId, asset.error);
        }
      }
    }
  }
  const viewAssets: IntakeViewAsset[] = [];
  for (const row of assets.assets) {
    const asset = byId.get(row.assetId);
    if (!asset) continue;
    viewAssets.push({
      id: asset.id,
      filename: asset.filename,
      mediaKind: asset.mediaKind,
      width: row.detectedWidth,
      height: row.detectedHeight,
      durationSeconds: asset.durationSeconds,
      detectedBucket: row.detectedBucket,
      override: row.aspectOverride,
      bucket: effectiveBucket(row.detectedBucket, row.aspectOverride),
      reason: row.unreadableReason,
      thumbnailUrl: asset.thumbnailUrl ?? (await signedUrl(supabase, asset.storagePath)),
      groupId: groupOf.get(asset.id) ?? null,
      uploadError: uploadErrorByAsset.get(asset.id) ?? null,
    });
  }
  return {
    ok: true,
    tableMissing: false,
    multiPlacement: isMultiPlacementEnabled(process.env.ENABLE_MULTI_PLACEMENT_ASSETS),
    assets: viewAssets,
    groups: groups.groups
      .filter((group) => !group.stableKey.startsWith("single:") && group.assetIds.length > 0)
      .map((group) => ({ id: group.id, assetIds: group.assetIds, stableKey: group.stableKey })),
    notes: [],
  };
}

async function measureStoredFile(input: {
  supabase: unknown;
  storagePath: string;
  contentType: string;
  filename: string;
  clientWidth: number | null;
  clientHeight: number | null;
}): Promise<{ bucket: IntakeBucket; width: number | null; height: number | null; reason: string | null; bytes: Buffer | null }> {
  const image = input.contentType.startsWith("image/");
  if (!image) {
    const sorted = intakeAspect({
      width: input.clientWidth,
      height: input.clientHeight,
      filename: input.filename,
    });
    return {
      bucket: sorted.bucket,
      width: input.clientWidth,
      height: input.clientHeight,
      reason: sorted.reason,
      bytes: null,
    };
  }
  const downloaded = await storageOf(input.supabase).from(BUCKET).download(input.storagePath);
  if (!downloaded.data) {
    return {
      bucket: "other",
      width: null,
      height: null,
      reason: downloaded.error?.message ?? "Dimensions could not be read",
      bytes: null,
    };
  }
  const bytes = Buffer.from(await downloaded.data.arrayBuffer());
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(bytes).metadata();
    width = meta.width ?? null;
    height = meta.height ?? null;
  } catch {
    width = null;
    height = null;
  }
  const probed = await probeAspectFromBuffer(bytes, input.contentType);
  if (probed !== "other") {
    return { bucket: probed, width, height, reason: null, bytes };
  }
  const sorted = intakeAspect({ width, height, filename: input.filename });
  return { bucket: sorted.bucket, width, height, reason: sorted.reason, bytes };
}

export async function registerIntakeUpload(
  supabase: unknown,
  plan: CampaignPlan,
  input: {
    storagePath: string;
    filename: string;
    contentType: string;
    contentHash: string;
    byteSize: number;
    mediaKind: "image" | "video";
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
  },
): Promise<{ ok: true; assetId: string; created: boolean } | { ok: false; status: number; error: string; tableMissing?: boolean }> {
  if (!isIntakeUploadPath(input.storagePath)) {
    return { ok: false, status: 400, error: "storagePath must be an images/mml- or videos/mml- path" };
  }
  const measured = await measureStoredFile({
    supabase,
    storagePath: input.storagePath,
    contentType: input.contentType,
    filename: input.filename,
    clientWidth: input.width,
    clientHeight: input.height,
  });
  let identity = { contentHash: input.contentHash, byteSize: input.byteSize };
  if (measured.bytes) {
    identity = fingerprintBytes(measured.bytes);
  }
  const upserted = await upsertRegisteredAsset(supabase, {
    userId: plan.userId,
    identity,
    filename: input.filename,
    mediaKind: input.mediaKind,
    aspectRatio: measured.bucket,
    durationSeconds: input.durationSeconds,
    storageBucket: BUCKET,
    storagePath: input.storagePath,
  });
  if (!upserted.ok) {
    return { ok: false, status: upserted.tableMissing ? 503 : 500, error: upserted.error, tableMissing: upserted.tableMissing };
  }
  if (
    !upserted.created &&
    mayDeleteIntakeUpload(input.storagePath, upserted.asset.storagePath)
  ) {
    await storageOf(supabase).from(BUCKET).remove([input.storagePath]).catch(() => undefined);
  }
  const attached = await attachIntakeAsset(supabase, {
    planId: plan.id,
    assetId: upserted.asset.id,
    userId: plan.userId,
    detectedBucket: upserted.created ? measured.bucket : upserted.asset.aspectRatio,
    detectedWidth: measured.width,
    detectedHeight: measured.height,
    unreadableReason: measured.reason,
  });
  if (!attached.ok) {
    return { ok: false, status: attached.tableMissing ? 503 : 500, error: attached.error, tableMissing: attached.tableMissing };
  }
  return { ok: true, assetId: upserted.asset.id, created: upserted.created };
}

export async function moveIntakeAsset(
  supabase: unknown,
  plan: CampaignPlan,
  assetId: string,
  bucket: IntakeBucket,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const assets = await listIntakeAssets(supabase, plan.id, plan.userId);
  if (!assets.ok) return { ok: false, status: assets.tableMissing ? 503 : 500, error: assets.error };
  const row = assets.assets.find((asset) => asset.assetId === assetId);
  if (!row) return { ok: false, status: 404, error: "Asset is not on this MML" };
  const override = bucket === row.detectedBucket ? null : bucket;
  const saved = await setIntakeAspectOverride(supabase, {
    planId: plan.id,
    assetId,
    userId: plan.userId,
    override,
  });
  if (!saved.ok) return { ok: false, status: saved.tableMissing ? 503 : 500, error: saved.error };
  return { ok: true };
}

export async function matchIntakeAssets(
  supabase: unknown,
  plan: CampaignPlan,
  assetIds: string[],
): Promise<{ ok: true; groupId: string } | { ok: false; status: number; error: string }> {
  const view = await loadCreativeIntakeView(supabase, plan);
  if (!view.ok) return { ok: false, status: 500, error: view.error };
  if (view.tableMissing) return { ok: false, status: 503, error: "Apply migration 193 before matching" };
  const selected = assetIds.map((id) => view.assets.find((asset) => asset.id === id)).filter((asset) => asset != null);
  if (selected.length !== assetIds.length) return { ok: false, status: 404, error: "Asset is not on this MML" };
  const reason = matchRefusal(selected.map((asset) => ({ id: asset.id, mediaKind: asset.mediaKind, bucket: asset.bucket })));
  if (reason) return { ok: false, status: 400, error: reason };
  const groupId = crypto.randomUUID();
  const inserted = await insertIntakeGroup(supabase, {
    id: groupId,
    planId: plan.id,
    userId: plan.userId,
    stableKey: groupId,
    position: view.groups.length,
  });
  if (!inserted.ok) return { ok: false, status: inserted.tableMissing ? 503 : 500, error: inserted.error };
  const members = await replaceGroupMembers(supabase, {
    planId: plan.id,
    userId: plan.userId,
    groupId,
    assetIds,
  });
  if (!members.ok) return { ok: false, status: members.tableMissing ? 503 : 500, error: members.error };
  return { ok: true, groupId };
}

export async function unmatchIntakeGroup(
  supabase: unknown,
  plan: CampaignPlan,
  groupId: string,
): Promise<{ ok: true; notes: string[] } | { ok: false; status: number; error: string }> {
  const cleared = await clearGroupMembers(supabase, { planId: plan.id, groupId });
  if (!cleared.ok) return { ok: false, status: cleared.tableMissing ? 503 : 500, error: cleared.error };
  return { ok: true, notes: [] };
}

export async function syncPlanCreativeIntake(
  supabase: unknown,
  plan: CampaignPlan,
): Promise<{ ok: true; notes: string[]; changed: boolean } | { ok: false; status: number; error: string }> {
  const drafts = await loadLinkedDraftsForPlan(supabase, plan);
  if (!drafts.meta) {
    return { ok: false, status: 409, error: "Prepare the Meta draft before sending" };
  }
  const [intakeAssets, groups, savedRoutes] = await Promise.all([
    listIntakeAssets(supabase, plan.id, plan.userId),
    listIntakeGroups(supabase, plan.id, plan.userId),
    loadPlanAssetRoutes(supabase, plan.id, plan.userId),
  ]);
  if (!intakeAssets.ok) return { ok: false, status: intakeAssets.tableMissing ? 503 : 500, error: intakeAssets.error };
  if (!groups.ok) return { ok: false, status: groups.tableMissing ? 503 : 500, error: groups.error };
  const registry = await loadAssetsByIds(
    supabase,
    plan.userId,
    intakeAssets.assets.map((row) => row.assetId),
  );
  if (!registry.ok) return { ok: false, status: registry.tableMissing ? 503 : 500, error: registry.error };
  const byRegistry = new Map(registry.assets.map((asset) => [asset.id, asset]));
  const groupOf = new Map<string, string>();
  for (const group of groups.groups) {
    if (group.stableKey.startsWith("single:")) continue;
    for (const assetId of group.assetIds) groupOf.set(assetId, group.stableKey);
  }
  const sendAssets: IntakeSendAsset[] = intakeAssets.assets.flatMap((row) => {
    const asset = byRegistry.get(row.assetId);
    if (!asset) return [];
    return [{
      id: asset.id,
      mediaKind: asset.mediaKind,
      bucket: effectiveBucket(row.detectedBucket, row.aspectOverride),
      groupId: groupOf.get(asset.id) ?? null,
    }];
  });
  const creativeById = new Map(drafts.meta.creatives.map((creative) => [creative.id, creative]));
  const owned = groups.groups.flatMap((group) => {
    if (!group.metaCreativeId) return [];
    const creative = creativeById.get(group.metaCreativeId);
    if (!creative) return [];
    return [{
      key: group.stableKey,
      creativeId: group.metaCreativeId,
      fingerprint: group.sentFingerprint,
      draftFingerprint: creativeDraftFingerprint(creative),
    }];
  });
  const routes = savedRoutes.ok ? savedRoutes.routes : [];
  const tiktokLaunched = drafts.tiktok
    ? tikTokLaunchIsLive({
        planStatus: plan.launches.tiktok.status,
        publishedIds: drafts.tiktok.publishedIds,
      })
    : plan.launches.tiktok.status === "live" || Boolean(plan.launches.tiktok.platformCampaignId);
  const planSend = planIntakeSend({
    assets: sendAssets,
    owned,
    routes: routes.map((route) => ({
      assetId: route.assetId,
      enabled: route.enabled,
      uploadStatus: route.uploadStatus,
    })),
    metaLaunched: plan.launches.meta.status === "live" || Boolean(plan.launches.meta.platformCampaignId),
    tiktokLaunched,
  });
  const loadedDefaults = await loadChannelDefaultsForEvent(supabase, plan.intent.eventId);
  const resolved = resolveChannelDefaults(loadedDefaults?.stored ?? null, loadedDefaults?.overrides ?? {});
  const applyAssets: ApplyAsset[] = sendAssets.flatMap((asset) => {
    if (asset.bucket === "other") return [];
    const row = byRegistry.get(asset.id);
    if (!row) return [];
    return [toApplyAsset(row, asset.bucket)];
  });
  const applied = applyIntakeToMetaDraft(drafts.meta, planSend, applyAssets, {
    pageId: drafts.meta.settings.metaPageId || resolved.facebookPage.value || "",
    instagramActorId: drafts.meta.settings.metaIGAccountId || resolved.instagramActor.value || "",
  });
  const uploaded = await uploadMmlDraftAssets({
    supabase,
    draft: applied.draft,
    creativeIds: new Set(applied.fingerprints.map((row) => row.creativeId)),
    userId: plan.userId,
    byRegistry,
  });
  if (applied.changed || uploaded.changed) {
    const saved = await upsertLinkedMetaDraft(supabase, uploaded.draft, plan.userId);
    if (!saved.ok) return { ok: false, status: 500, error: saved.error };
  }
  for (const [index, stamped] of applied.fingerprints.entries()) {
    const write = await stampIntakeGroup(supabase, {
      planId: plan.id,
      userId: plan.userId,
      stableKey: stamped.key,
      metaCreativeId: stamped.creativeId,
      fingerprint: stamped.fingerprint,
      position: index,
    });
    if (!write.ok) return { ok: false, status: write.tableMissing ? 503 : 500, error: write.error };
  }
  await deleteEmptyIntakeGroups(supabase, plan.id, plan.userId);
  for (const write of planSend.tiktokWrites) {
    const current = routes.find((route) => route.assetId === write.assetId);
    const saved = await upsertPlanAssetRoute(supabase, {
      planId: plan.id,
      assetId: write.assetId,
      userId: plan.userId,
      channel: "tiktok",
      enabled: write.enabled,
      uploadStatus: current?.uploadStatus ?? "idle",
      uploadError: write.enabled ? null : current?.uploadError ?? null,
      derivedCreativeId: current?.derivedCreativeId ?? null,
    });
    if (!saved.ok) return { ok: false, status: saved.tableMissing ? 503 : 500, error: saved.error };
  }
  const notes = [...planSend.notes];
  if (drafts.tiktok && planSend.tiktokWrites.length > 0) {
    const fresh = await loadLinkedDraftsForPlan(supabase, plan);
    if (fresh.tiktok && fresh.meta) {
      const fanout = await runPlanTikTokAssetFanout({
        supabase,
        plan,
        metaDraft: fresh.meta,
        tiktokDraft: fresh.tiktok,
      });
      for (const cell of fanout.cells) {
        if (!cell.ok && cell.reason) notes.push(cell.reason);
      }
    }
  }
  return {
    ok: true,
    notes: [...new Set(notes)],
    changed: applied.changed || uploaded.changed || intakeSendChanges(planSend),
  };
}

/**
 * Uploads pending MML assets through `/api/meta/upload-asset`'s storage-path
 * body. A `creative_asset_channel_ids` hit for this ad account makes no call.
 * The route is given a copy, never the registry object's path, because a
 * failed upload deletes the path it was handed.
 */
async function uploadMmlDraftAssets(input: {
  supabase: unknown;
  draft: CampaignDraft;
  creativeIds: Set<string>;
  userId: string;
  byRegistry: Map<string, CreativeAssetRow>;
}): Promise<{ draft: CampaignDraft; changed: boolean }> {
  type Slot = IntakeMetaUploadSlot & { assetId: string };
  const slots: Slot[] = [];
  for (const creative of input.draft.creatives) {
    if (!input.creativeIds.has(creative.id)) continue;
    for (const variation of creative.assetVariations) {
      for (const asset of variation.assets) {
        if (!asset.registryAssetId || !asset.storagePath) continue;
        const row = input.byRegistry.get(asset.registryAssetId);
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

  const adAccountId = input.draft.settings.adAccountId || input.draft.settings.metaAdAccountId || "";
  if (!adAccountId) {
    const flagged = slots.map((slot) =>
      slot.uploadStatus === "uploaded"
        ? slot
        : { ...slot, uploadStatus: "pending" as const, error: "No Meta ad account on this draft" },
    );
    return { draft: writeUploadOntoDraft(input.draft, flagged, input.creativeIds), changed: flagged.some((slot, index) => slot.error !== slots[index]?.error) };
  }

  const channelId = new Map<string, string | null>();
  const readError = new Map<string, string>();
  for (const slot of slots) {
    if (channelId.has(slot.registryAssetId) || readError.has(slot.registryAssetId)) continue;
    const found = await findChannelId(input.supabase, {
      assetId: slot.registryAssetId,
      userId: input.userId,
      channel: "meta",
      scope: adAccountId,
    });
    if (!found.ok) readError.set(slot.registryAssetId, found.error);
    else channelId.set(slot.registryAssetId, found.platformId);
  }

  const result = await uploadIntakeSlots({
    slots,
    channelPlatformId: (assetId) => channelId.get(assetId) ?? null,
    upload: async (slot) => {
      const failed = readError.get(slot.registryAssetId);
      if (failed) return { ok: false as const, error: failed };
      const row = input.byRegistry.get(slot.registryAssetId);
      if (!row) return { ok: false as const, error: "Asset is not in the registry" };
      return postStoredAssetToMeta(input.supabase, {
        adAccountId,
        filename: row.filename,
        mediaKind: slot.mediaKind,
        contentHash: row.contentHash,
        byteSize: row.byteSize,
        storagePath: row.storagePath,
        aspectRatio: row.aspectRatio === "other" ? undefined : row.aspectRatio,
      });
    },
  });
  return {
    draft: writeUploadOntoDraft(input.draft, result.slots, input.creativeIds),
    changed: result.slots.some(
      (slot, index) =>
        slot.uploadStatus !== slots[index]?.uploadStatus ||
        slot.assetHash !== slots[index]?.assetHash ||
        slot.videoId !== slots[index]?.videoId ||
        slot.error !== slots[index]?.error,
    ),
  };
}

async function postStoredAssetToMeta(
  supabase: unknown,
  input: {
    adAccountId: string;
    filename: string;
    mediaKind: "image" | "video";
    contentHash: string;
    byteSize: number;
    storagePath: string;
    aspectRatio?: string;
  },
): Promise<{ ok: true; hash?: string; videoId?: string } | { ok: false; error: string }> {
  const folder = input.mediaKind === "video" ? "videos" : "images";
  const copyPath = `${folder}/mml-${crypto.randomUUID()}-meta-upload`;
  const copied = await storageOf(supabase).from(BUCKET).copy(input.storagePath, copyPath);
  if (copied.error) {
    return { ok: false, error: copied.error.message ?? "Could not copy the file for Meta" };
  }
  try {
    const response = await handleUploadAsset(
      new Request("http://localhost/api/meta/upload-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: copyPath,
          storageBucket: BUCKET,
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
      await storageOf(supabase).from(BUCKET).remove([copyPath]).catch(() => undefined);
    }
  }
}

function writeUploadOntoDraft(
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

function toApplyAsset(row: CreativeAssetRow, bucket: Exclude<IntakeBucket, "other">): ApplyAsset {
  return {
    id: row.id,
    filename: row.filename,
    mediaKind: row.mediaKind,
    aspectRatio: bucket,
    storageBucket: row.storageBucket,
    storagePath: row.storagePath,
    thumbnailUrl: row.thumbnailUrl,
  };
}

