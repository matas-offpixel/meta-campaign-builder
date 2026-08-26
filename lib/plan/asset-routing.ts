/**
 * Plan asset routing matrix (M.2).
 *
 * Rows are the linked Meta draft's registered assets. Columns are channels.
 * TikTok is the only toggle; images cannot reach TikTok because the
 * launcher requires videoId. Google is copy, not a control.
 */

import type { CampaignDraft, AdCreativeDraft } from "../types.ts";
import type {
  TikTokCampaignDraft,
  TikTokCreativeDraft,
} from "../types/tiktok-draft.ts";
import type { CreativeAssetRow, RegistryAspect, RegistryMediaKind } from "../creatives/asset-registry.ts";

export const TIKTOK_IMAGE_UNSUPPORTED_REASON =
  "TikTok image ads not supported by the launcher yet";

export const GOOGLE_NO_ASSETS_COPY =
  "Search ads take no assets — keywords are the creative.";

export const HISTORICAL_BACKFILL_NOTE =
  "Historical Meta assets are not backfilled in this PR — new uploads in the Meta wizard appear here.";

export const TIKTOK_LAUNCHED_UNROUTE_NOTE =
  "This plan's TikTok campaign is already launched — unrouting will not delete the live ad.";

export const PLAN_ASSET_ROUTES_TABLE = "campaign_plan_asset_routes";

export type TikTokRouteUploadStatus = "idle" | "ready" | "failed" | "launched";

export interface MetaDraftAssetRef {
  registryAssetId: string | null;
  metaPlatformId: string;
  mediaKind: RegistryMediaKind;
  aspectRatio: RegistryAspect;
  filename: string;
  thumbnailUrl: string | null;
  caption: string;
  creativeName: string;
}

export interface TikTokRouteDecision {
  enabled: boolean;
  disabled: boolean;
  disabledReason: string | null;
}

export interface PlanAssetRouteRow {
  planId: string;
  assetId: string;
  channel: "tiktok";
  enabled: boolean;
  uploadStatus: TikTokRouteUploadStatus;
  uploadError: string | null;
  derivedCreativeId: string | null;
}

export interface RoutingMatrixRow {
  asset: CreativeAssetRow;
  caption: string;
  creativeName: string;
  meta: { present: true; platformId: string };
  tiktok: TikTokRouteDecision & {
    uploadStatus: TikTokRouteUploadStatus;
    uploadError: string | null;
    derivedCreativeId: string | null;
  };
  google: { copy: typeof GOOGLE_NO_ASSETS_COPY };
}

export function defaultTikTokRoute(asset: {
  mediaKind: RegistryMediaKind;
  aspectRatio: RegistryAspect | string;
}): TikTokRouteDecision {
  if (asset.mediaKind === "image") {
    return {
      enabled: false,
      disabled: true,
      disabledReason: TIKTOK_IMAGE_UNSUPPORTED_REASON,
    };
  }
  return { enabled: true, disabled: false, disabledReason: null };
}

export function canRouteAssetToTikTok(asset: {
  mediaKind: RegistryMediaKind;
}): boolean {
  return asset.mediaKind === "video";
}

export function resolveTikTokRoute(
  asset: { mediaKind: RegistryMediaKind; aspectRatio: RegistryAspect | string },
  saved: PlanAssetRouteRow | null,
): TikTokRouteDecision & {
  uploadStatus: TikTokRouteUploadStatus;
  uploadError: string | null;
  derivedCreativeId: string | null;
} {
  const defaults = defaultTikTokRoute(asset);
  if (defaults.disabled) {
    return {
      ...defaults,
      enabled: false,
      uploadStatus: saved?.uploadStatus ?? "idle",
      uploadError: saved?.uploadError ?? null,
      derivedCreativeId: saved?.derivedCreativeId ?? null,
    };
  }
  return {
    enabled: saved ? saved.enabled : defaults.enabled,
    disabled: false,
    disabledReason: null,
    uploadStatus: saved?.uploadStatus ?? "idle",
    uploadError: saved?.uploadError ?? null,
    derivedCreativeId: saved?.derivedCreativeId ?? null,
  };
}

export function registryProvenance(assetId: string): string {
  return `registry:${assetId}`;
}

export function isDerivedRegistryCreative(
  item: Pick<TikTokCreativeDraft, "derivedFrom">,
  assetId: string,
): boolean {
  return item.derivedFrom === registryProvenance(assetId);
}

export function extractMetaDraftAssetRefs(draft: CampaignDraft): MetaDraftAssetRef[] {
  const adAccountId = draft.settings.adAccountId?.trim() ?? "";
  const seen = new Set<string>();
  const refs: MetaDraftAssetRef[] = [];
  for (const creative of draft.creatives ?? []) {
    const caption = firstCaption(creative);
    for (const variation of creative.assetVariations ?? []) {
      for (const asset of variation.assets ?? []) {
        if (asset.uploadStatus !== "uploaded") continue;
        const mediaKind: RegistryMediaKind =
          creative.mediaType === "video" || Boolean(asset.videoId) ? "video" : "image";
        const platformId =
          mediaKind === "video" ? asset.videoId?.trim() ?? "" : asset.assetHash?.trim() ?? "";
        if (!platformId) continue;
        const key = `${adAccountId}:${mediaKind}:${platformId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push({
          registryAssetId: asset.registryAssetId ?? null,
          metaPlatformId: platformId,
          mediaKind,
          aspectRatio: asset.aspectRatio,
          filename: variation.name || creative.name || platformId,
          thumbnailUrl: asset.thumbnailUrl ?? asset.uploadedUrl ?? null,
          caption,
          creativeName: creative.name || variation.name || "Untitled",
        });
      }
    }
  }
  return refs;
}

function firstCaption(creative: AdCreativeDraft): string {
  const text = creative.captions?.find((item) => item.text?.trim())?.text?.trim();
  return text || creative.headline?.trim() || "";
}

export function buildRoutingMatrix(input: {
  assets: CreativeAssetRow[];
  refs: MetaDraftAssetRef[];
  routes: PlanAssetRouteRow[];
}): RoutingMatrixRow[] {
  const routeByAsset = new Map(input.routes.map((row) => [row.assetId, row]));
  const refByAsset = new Map(
    input.refs
      .filter((ref) => ref.registryAssetId)
      .map((ref) => [ref.registryAssetId as string, ref]),
  );
  return input.assets.map((asset) => {
    const ref = refByAsset.get(asset.id);
    const tiktok = resolveTikTokRoute(asset, routeByAsset.get(asset.id) ?? null);
    return {
      asset,
      caption: ref?.caption ?? "",
      creativeName: ref?.creativeName ?? asset.filename,
      meta: { present: true, platformId: ref?.metaPlatformId ?? "" },
      tiktok,
      google: { copy: GOOGLE_NO_ASSETS_COPY },
    };
  });
}

export interface MergeRoutedTikTokCreativesResult {
  draft: TikTokCampaignDraft;
  added: number;
  removed: number;
  keptOperatorItems: number;
  skippedLaunched: number;
}

/**
 * Re-route contract mirrors #854 targeting: operator-authored TikTok
 * creatives (no derivedFrom) are never removed. Derived creatives for
 * unrouted assets are removed only before launch.
 */
export function mergeRoutedTikTokCreatives(input: {
  draft: TikTokCampaignDraft;
  routed: Array<{
    assetId: string;
    videoId: string;
    filename: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    adText: string;
    landingPageUrl: string;
  }>;
  launched: boolean;
}): MergeRoutedTikTokCreativesResult {
  const routedByAsset = new Map(input.routed.map((item) => [item.assetId, item]));
  const items = [...(input.draft.creatives.items ?? [])];
  let added = 0;
  let removed = 0;
  let keptOperatorItems = 0;
  let skippedLaunched = 0;

  const kept: TikTokCreativeDraft[] = [];
  for (const item of items) {
    const assetId = assetIdFromProvenance(item.derivedFrom);
    if (!assetId) {
      keptOperatorItems += 1;
      kept.push(item);
      continue;
    }
    const routed = routedByAsset.get(assetId);
    if (!routed) {
      if (input.launched) {
        skippedLaunched += 1;
        kept.push(item);
        continue;
      }
      removed += 1;
      continue;
    }
    kept.push({
      ...item,
      videoId: routed.videoId,
      thumbnailUrl: routed.thumbnailUrl ?? item.thumbnailUrl,
      durationSeconds: routed.durationSeconds ?? item.durationSeconds,
      title: routed.filename,
      derivedFrom: registryProvenance(assetId),
    });
    routedByAsset.delete(assetId);
  }

  for (const routed of routedByAsset.values()) {
    kept.push(derivedTikTokCreative(input.draft, routed));
    added += 1;
  }

  return {
    draft: {
      ...input.draft,
      creatives: { items: kept },
    },
    added,
    removed,
    keptOperatorItems,
    skippedLaunched,
  };
}

function assetIdFromProvenance(value: string | undefined): string | null {
  if (!value?.startsWith("registry:")) return null;
  const id = value.slice("registry:".length).trim();
  return id || null;
}

function derivedTikTokCreative(
  draft: TikTokCampaignDraft,
  routed: {
    assetId: string;
    videoId: string;
    filename: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
    adText: string;
    landingPageUrl: string;
  },
): TikTokCreativeDraft {
  const name = routed.filename.replace(/\.[^.]+$/, "") || "TikTok creative";
  return {
    id: crypto.randomUUID(),
    name,
    mode: "VIDEO_REFERENCE",
    baseName: name,
    videoId: routed.videoId,
    videoUrl: null,
    thumbnailUrl: routed.thumbnailUrl,
    thumbnailExpiresAt: null,
    coverImageId: null,
    durationSeconds: routed.durationSeconds,
    title: routed.filename,
    sparkPostId: null,
    caption: routed.adText,
    adText: routed.adText,
    displayName: draft.accountSetup.identityDisplayName ?? "",
    landingPageUrl: routed.landingPageUrl || draft.creatives.items[0]?.landingPageUrl || "",
    cta: draft.creatives.items[0]?.cta ?? null,
    musicId: null,
    derivedFrom: registryProvenance(routed.assetId),
  };
}

export function rowToPlanAssetRoute(row: Record<string, unknown>): PlanAssetRouteRow {
  const status = row.upload_status;
  return {
    planId: String(row.plan_id),
    assetId: String(row.asset_id),
    channel: "tiktok",
    enabled: row.enabled === true,
    uploadStatus:
      status === "ready" || status === "failed" || status === "launched" ? status : "idle",
    uploadError: typeof row.upload_error === "string" ? row.upload_error : null,
    derivedCreativeId:
      typeof row.derived_creative_id === "string" ? row.derived_creative_id : null,
  };
}
