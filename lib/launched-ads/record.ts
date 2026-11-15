/**
 * Persist a launched ad. Runs after Meta ad create succeeds.
 * Must never throw — a bookkeeping miss is worse than failing a launch
 * whose ads already exist on Meta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeAdAccountId } from "../meta/ad-account.ts";
import { urlTagsFor } from "../meta/url-tags.ts";
import type { AdCreativeDraft } from "../types.ts";
import { uuidOrNull } from "../launched-ad-sets/record.ts";

export type LaunchedAdDescriptorSource = "launch" | "backfill_from_launch_summary";

/** The creative facts a learning job needs, frozen at launch. */
export type CreativeDescriptor = {
  creativeName: string | null;
  mediaType: string | null;
  sourceType: string | null;
  placementMode: string | null;
  variationCount: number;
  cta: string | null;
  destinationUrl: string | null;
  /** null when unknown (backfill: most predate url_tags). */
  urlTagsApplied: boolean | null;
  assetContentHashes: string[];
};

/** Registry ids on the creative's assets, in variation order, deduped. */
export function registryAssetIds(creative: Pick<AdCreativeDraft, "assetVariations">): string[] {
  const ids: string[] = [];
  for (const variation of creative.assetVariations ?? []) {
    for (const asset of variation.assets ?? []) {
      const id = asset.registryAssetId?.trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export function snapshotCreativeDescriptor(
  creative: AdCreativeDraft,
  contentHashByRegistryId: ReadonlyMap<string, string> = new Map(),
): CreativeDescriptor {
  const hashes: string[] = [];
  for (const id of registryAssetIds(creative)) {
    const hash = contentHashByRegistryId.get(id);
    if (hash && !hashes.includes(hash)) hashes.push(hash);
  }
  const destinationUrl = creative.destinationUrl?.trim() || null;
  return {
    creativeName: creative.name?.trim() || null,
    mediaType: creative.mediaType ?? null,
    sourceType: creative.sourceType === "existing_post" ? "existing_post" : creative.sourceType ? "uploaded" : null,
    placementMode: creative.assetMode ?? null,
    variationCount: creative.assetVariations?.length ?? 0,
    cta: creative.cta || null,
    destinationUrl,
    urlTagsApplied: urlTagsFor(creative.destinationUrl) !== undefined,
    assetContentHashes: hashes,
  };
}

export type LaunchedAdWrite = {
  metaAdId: string;
  metaCreativeId: string | null;
  metaAdsetId: string | null;
  metaCampaignId: string | null;
  adAccountId: string | null;
  draftId: string | null;
  userId: string | null;
  clientId: string | null;
  eventId: string | null;
  launchedAt?: Date;
  launchRunId: string;
  descriptorSource: LaunchedAdDescriptorSource;
  adName: string | null;
  descriptor: CreativeDescriptor;
};

export function launchedAdPayload(row: LaunchedAdWrite): Record<string, unknown> {
  const d = row.descriptor;
  return {
    meta_ad_id: row.metaAdId.trim(),
    meta_creative_id: row.metaCreativeId?.trim() || null,
    meta_adset_id: row.metaAdsetId?.trim() || null,
    meta_campaign_id: row.metaCampaignId?.trim() || null,
    ad_account_id: normalizeAdAccountId(row.adAccountId),
    draft_id: uuidOrNull(row.draftId),
    user_id: uuidOrNull(row.userId),
    client_id: uuidOrNull(row.clientId),
    event_id: uuidOrNull(row.eventId),
    launched_at: (row.launchedAt ?? new Date()).toISOString(),
    launch_run_id: row.launchRunId,
    channel: "meta",
    descriptor_source: row.descriptorSource,
    creative_name: d.creativeName,
    ad_name: row.adName?.trim() || null,
    media_type: d.mediaType,
    source_type: d.sourceType,
    placement_mode: d.placementMode,
    variation_count: d.variationCount,
    cta: d.cta,
    destination_url: d.destinationUrl,
    url_tags_applied: d.urlTagsApplied,
    asset_content_hashes: d.assetContentHashes,
  };
}

/** One-row upsert. A hung connection must not stall the launch. */
export const LAUNCHED_AD_UPSERT_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function recordLaunchedAd(
  supabase: SupabaseClient,
  row: LaunchedAdWrite,
  timeoutMs: number = LAUNCHED_AD_UPSERT_TIMEOUT_MS,
): Promise<void> {
  const metaAdId = row.metaAdId?.trim();
  if (!metaAdId) {
    console.error("[launched_ads] upsert failed", { meta_ad_id: row.metaAdId, error: "missing meta_ad_id" });
    return;
  }
  if (!uuidOrNull(row.launchRunId)) {
    console.error("[launched_ads] upsert failed", { meta_ad_id: metaAdId, error: "missing launch_run_id" });
    return;
  }
  try {
    const { error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("launched_ads")
          .upsert(launchedAdPayload({ ...row, metaAdId }), { onConflict: "meta_ad_id" }),
      ),
      timeoutMs,
      `upsert timed out after ${timeoutMs}ms`,
    );
    if (error) {
      console.error("[launched_ads] upsert failed", { meta_ad_id: metaAdId, error: error.message });
    }
  } catch (err) {
    console.error("[launched_ads] upsert failed", {
      meta_ad_id: metaAdId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
