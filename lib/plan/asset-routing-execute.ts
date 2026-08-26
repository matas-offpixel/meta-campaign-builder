import {
  findAssetByChannelId,
  findChannelId,
  loadAssetsByIds,
  recordChannelId,
  type CreativeAssetRow,
} from "../creatives/asset-registry.ts";
import { uploadRegistryVideoToTikTok } from "../tiktok/upload-from-registry.ts";
import type { TikTokUploadServiceStorage } from "../tiktok/upload-route.ts";
import type { TikTokVideoUploadMode } from "../tiktok/upload.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import { upsertTikTokDraft } from "../db/tiktok-drafts.ts";
import {
  TIKTOK_IMAGE_UNSUPPORTED_REASON,
  buildRoutingMatrix,
  canRouteAssetToTikTok,
  extractMetaDraftAssetRefs,
  mergeRoutedTikTokCreatives,
  resolveTikTokRoute,
  type PlanAssetRouteRow,
} from "./asset-routing.ts";
import { loadPlanAssetRoutes, routeStatusAfterUpload, upsertPlanAssetRoute } from "./asset-routing-db.ts";
import type { CampaignPlan } from "./types.ts";

export interface TikTokRegistryUpload {
  (input: {
    asset: CreativeAssetRow;
    advertiserId: string;
    token: string;
  }): Promise<{ ok: true; videoId: string; durationSeconds: number | null } | { ok: false; error: string }>;
}

export interface ApplyTikTokAssetRoutingResult {
  draft: TikTokCampaignDraft;
  cells: Array<{
    assetId: string;
    ok: boolean;
    skipped: boolean;
    reason: string | null;
    uploaded: boolean;
  }>;
  added: number;
  removed: number;
  skippedLaunched: number;
}

export async function resolveLinkedRegistryAssets(
  supabase: unknown,
  userId: string,
  draft: CampaignDraft | null,
): Promise<{ assets: CreativeAssetRow[]; refs: ReturnType<typeof extractMetaDraftAssetRefs> }> {
  if (!draft) return { assets: [], refs: [] };
  const refs = extractMetaDraftAssetRefs(draft);
  const adAccountId = draft.settings.adAccountId?.trim() ?? "";
  const ids = new Set<string>();
  for (const ref of refs) {
    if (ref.registryAssetId) {
      ids.add(ref.registryAssetId);
      continue;
    }
    if (!adAccountId) continue;
    const found = await findAssetByChannelId(supabase, {
      userId,
      channel: "meta",
      scope: adAccountId,
      platformId: ref.metaPlatformId,
    });
    if (found.ok && found.assetId) {
      ref.registryAssetId = found.assetId;
      ids.add(found.assetId);
    }
  }
  const loaded = await loadAssetsByIds(supabase, userId, [...ids]);
  return { assets: loaded.ok ? loaded.assets : [], refs };
}

export function liveTikTokRegistryUploader(input: {
  token: string;
  storage: TikTokUploadServiceStorage;
  mode?: TikTokVideoUploadMode;
  fetchImpl?: typeof fetch;
  upload?: typeof import("../tiktok/upload.ts").uploadTikTokAdVideo;
}): TikTokRegistryUpload {
  return async ({ asset, advertiserId, token }) => {
    const result = await uploadRegistryVideoToTikTok({
      bucket: asset.storageBucket,
      path: asset.storagePath,
      advertiserId,
      fileName: asset.filename,
      token,
      mode: input.mode,
      storage: input.storage,
      fetchImpl: input.fetchImpl,
      upload: input.upload,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      videoId: result.uploaded.videoId,
      durationSeconds: result.uploaded.durationSeconds,
    };
  };
}

export async function applyTikTokAssetRouting(input: {
  supabase: unknown;
  plan: CampaignPlan;
  metaDraft: CampaignDraft | null;
  tiktokDraft: TikTokCampaignDraft;
  advertiserId: string | null;
  token: string | null;
  launched: boolean;
  upload?: TikTokRegistryUpload;
}): Promise<ApplyTikTokAssetRoutingResult> {
  const { assets, refs } = await resolveLinkedRegistryAssets(
    input.supabase,
    input.plan.userId,
    input.metaDraft,
  );
  const saved = await loadPlanAssetRoutes(input.supabase, input.plan.id, input.plan.userId);
  const routes = saved.ok ? saved.routes : [];
  const matrix = buildRoutingMatrix({ assets, refs, routes });

  const routed: Array<{
    assetId: string;
    videoId: string;
    filename: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    adText: string;
    landingPageUrl: string;
  }> = [];
  const cells: ApplyTikTokAssetRoutingResult["cells"] = [];

  for (const row of matrix) {
    const decision = resolveTikTokRoute(row.asset, routes.find((r) => r.assetId === row.asset.id) ?? null);
    if (!decision.enabled) {
      cells.push({
        assetId: row.asset.id,
        ok: true,
        skipped: true,
        reason: decision.disabledReason,
        uploaded: false,
      });
      continue;
    }
    if (!canRouteAssetToTikTok(row.asset)) {
      cells.push({
        assetId: row.asset.id,
        ok: false,
        skipped: true,
        reason: TIKTOK_IMAGE_UNSUPPORTED_REASON,
        uploaded: false,
      });
      await persistCell(input, row.asset.id, {
        enabled: false,
        uploadStatus: "failed",
        uploadError: TIKTOK_IMAGE_UNSUPPORTED_REASON,
        derivedCreativeId: null,
      });
      continue;
    }
    if (!input.advertiserId || !input.token) {
      const reason = "TikTok advertiser is not bound on this plan yet";
      cells.push({
        assetId: row.asset.id,
        ok: false,
        skipped: false,
        reason,
        uploaded: false,
      });
      await persistCell(input, row.asset.id, {
        enabled: true,
        uploadStatus: "failed",
        uploadError: reason,
        derivedCreativeId: null,
      });
      continue;
    }

    const existing = await findChannelId(input.supabase, {
      assetId: row.asset.id,
      userId: input.plan.userId,
      channel: "tiktok",
      scope: input.advertiserId,
    });
    let videoId = existing.ok ? existing.platformId : null;
    let uploaded = false;
    let durationSeconds = row.asset.durationSeconds;
    if (!videoId) {
      const upload =
        input.upload ??
        (async () => ({ ok: false as const, error: "TikTok upload is not configured" }));
      const result = await upload({
        asset: row.asset,
        advertiserId: input.advertiserId,
        token: input.token,
      });
      if (!result.ok) {
        cells.push({
          assetId: row.asset.id,
          ok: false,
          skipped: false,
          reason: result.error,
          uploaded: false,
        });
        await persistCell(input, row.asset.id, {
          enabled: true,
          uploadStatus: "failed",
          uploadError: result.error,
          derivedCreativeId: null,
        });
        continue;
      }
      videoId = result.videoId;
      durationSeconds = result.durationSeconds;
      uploaded = true;
      await recordChannelId(input.supabase, {
        assetId: row.asset.id,
        userId: input.plan.userId,
        channel: "tiktok",
        scope: input.advertiserId,
        platformId: videoId,
      });
    }

    routed.push({
      assetId: row.asset.id,
      videoId,
      filename: row.asset.filename,
      thumbnailUrl: row.asset.thumbnailUrl,
      durationSeconds,
      adText: row.caption,
      landingPageUrl: input.plan.intent.destinationUrl,
    });
    cells.push({
      assetId: row.asset.id,
      ok: true,
      skipped: false,
      reason: null,
      uploaded,
    });
  }

  const merged = mergeRoutedTikTokCreatives({
    draft: input.tiktokDraft,
    routed,
    launched: input.launched,
  });

  for (const row of matrix) {
    const cell = cells.find((item) => item.assetId === row.asset.id);
    const creative = merged.draft.creatives.items.find(
      (item) => item.derivedFrom === `registry:${row.asset.id}`,
    );
    if (!cell || cell.skipped && !cell.ok) continue;
    if (cell.skipped) {
      await persistCell(input, row.asset.id, {
        enabled: false,
        uploadStatus: input.launched && creative ? "launched" : "idle",
        uploadError: null,
        derivedCreativeId: creative?.id ?? null,
      });
      continue;
    }
    if (!cell.ok) continue;
    await persistCell(input, row.asset.id, {
      enabled: true,
      uploadStatus: routeStatusAfterUpload(true, input.launched),
      uploadError: null,
      derivedCreativeId: creative?.id ?? null,
    });
  }

  return {
    draft: merged.draft,
    cells,
    added: merged.added,
    removed: merged.removed,
    skippedLaunched: merged.skippedLaunched,
  };
}

export async function persistRoutedTikTokDraft(
  supabase: unknown,
  draft: TikTokCampaignDraft,
  userId: string,
): Promise<void> {
  await upsertTikTokDraft(supabase as never, draft.id, { ...draft, userId });
}

async function persistCell(
  input: { supabase: unknown; plan: CampaignPlan },
  assetId: string,
  patch: Omit<PlanAssetRouteRow, "planId" | "assetId" | "channel">,
): Promise<void> {
  await upsertPlanAssetRoute(input.supabase, {
    planId: input.plan.id,
    assetId,
    userId: input.plan.userId,
    channel: "tiktok",
    ...patch,
  });
}

export function tikTokLaunchIsLive(input: {
  planStatus: CampaignPlan["launches"]["tiktok"]["status"];
  publishedIds: TikTokCampaignDraft["publishedIds"];
}): boolean {
  if (input.planStatus === "live") return true;
  return Boolean(input.publishedIds?.campaignId);
}
