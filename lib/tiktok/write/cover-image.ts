import { fetchTikTokVideoInfo } from "../creative.ts";
import { uploadTikTokAdImageByUrl } from "../image-upload.ts";
import { isTikTokDuplicateFileNameError, uniqueTikTokFileName } from "../upload.ts";
import type { TikTokCampaignDraft, TikTokCreativeDraft } from "../../types/tiktok-draft.ts";
import { suggestTikTokAdGroups } from "../../tiktok-wizard/review.ts";
import type { TikTokPost, Sleep } from "./idempotency.ts";
import type { tiktokGet } from "../client.ts";

export function assignedTikTokVideoCreatives(
  draft: TikTokCampaignDraft,
): TikTokCreativeDraft[] {
  const assigned = new Set<string>();
  for (const adGroup of suggestTikTokAdGroups(draft)) {
    for (const id of draft.creativeAssignments.byAdGroupId[adGroup.id] ?? []) {
      assigned.add(id);
    }
  }
  return draft.creatives.items.filter(
    (item) => assigned.has(item.id) && Boolean(item.videoId?.trim()),
  );
}

export function tikTokCreativeCoverImageId(
  creative: TikTokCreativeDraft,
): string | null {
  const id = creative.coverImageId?.trim();
  return id || null;
}

export function tikTokCoverImageFailureMessage(name: string, reason: string): string {
  return `Creative "${name}" — cover image could not be uploaded to TikTok (${reason}). Open Creatives and re-select the video.`;
}

export type TikTokCoverHydration = {
  resolved: number;
  failed: number;
};

/**
 * Upload a cover for every assigned video creative that does not have
 * one yet. A creative ends with `coverImageId` or `coverImageError`.
 * Neither is left unset after an attempt.
 */
export async function hydrateDraftCoverImageIds(input: {
  draft: TikTokCampaignDraft;
  token: string;
  request?: TikTokPost;
  requestGet?: typeof tiktokGet;
  sleep?: Sleep;
  now?: number;
}): Promise<TikTokCoverHydration> {
  const advertiserId = input.draft.accountSetup.advertiserId?.trim();
  if (!advertiserId) return { resolved: 0, failed: 0 };

  let resolved = 0;
  let failed = 0;
  for (const creative of assignedTikTokVideoCreatives(input.draft)) {
    if (tikTokCreativeCoverImageId(creative)) {
      creative.coverImageError = null;
      continue;
    }
    const outcome = await uploadCoverForCreative({
      creative,
      advertiserId,
      token: input.token,
      request: input.request,
      requestGet: input.requestGet,
      sleep: input.sleep,
      now: input.now,
    });
    if (outcome.imageId) {
      creative.coverImageId = outcome.imageId;
      creative.coverImageError = null;
      resolved += 1;
    } else {
      creative.coverImageError = outcome.error;
      failed += 1;
    }
  }
  return { resolved, failed };
}

export async function uploadCoverForCreative(input: {
  creative: TikTokCreativeDraft;
  advertiserId: string;
  token: string;
  request?: TikTokPost;
  requestGet?: typeof tiktokGet;
  sleep?: Sleep;
  now?: number;
}): Promise<{ imageId: string; error: null } | { imageId: null; error: string }> {
  const name = input.creative.name || "Creative";
  try {
    const imageUrl = await resolveCoverImageUrl({
      creative: input.creative,
      advertiserId: input.advertiserId,
      token: input.token,
      requestGet: input.requestGet,
    });
    if (!imageUrl) {
      return {
        imageId: null,
        error: tikTokCoverImageFailureMessage(
          name,
          "TikTok returned no cover URL for this video",
        ),
      };
    }
    const imageId = await uploadCoverRetryingDuplicateName({
      advertiserId: input.advertiserId,
      token: input.token,
      imageUrl,
      fileName: coverFileName(input.creative, input.now),
      request: input.request,
      sleep: input.sleep,
      now: input.now,
    });
    return { imageId, error: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[tiktok/cover-image] hydrate creative=${input.creative.id} failed: ${reason}`,
    );
    return { imageId: null, error: tikTokCoverImageFailureMessage(name, reason) };
  }
}

async function uploadCoverRetryingDuplicateName(input: {
  advertiserId: string;
  token: string;
  imageUrl: string;
  fileName: string;
  request?: TikTokPost;
  sleep?: Sleep;
  now?: number;
}): Promise<string> {
  try {
    return await uploadTikTokAdImageByUrl({
      advertiserId: input.advertiserId,
      token: input.token,
      imageUrl: input.imageUrl,
      fileName: input.fileName,
      request: input.request,
      sleep: input.sleep,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === "object" && "code" in err ? Number(err.code) : undefined;
    if (!isTikTokDuplicateFileNameError({ message, code: Number.isFinite(code) ? code : undefined })) {
      throw err;
    }
    const nextName = uniqueTikTokFileName(input.fileName, (input.now ?? Date.now()) + 1);
    console.error(
      `[tiktok/cover-image] duplicate material name retry advertiser=${input.advertiserId} next_name=${nextName}`,
    );
    return uploadTikTokAdImageByUrl({
      advertiserId: input.advertiserId,
      token: input.token,
      imageUrl: input.imageUrl,
      fileName: nextName,
      request: input.request,
      sleep: input.sleep,
    });
  }
}

async function resolveCoverImageUrl(input: {
  creative: TikTokCreativeDraft;
  advertiserId: string;
  token: string;
  requestGet?: typeof tiktokGet;
}): Promise<string | null> {
  const thumbnail = input.creative.thumbnailUrl?.trim();
  if (thumbnail) return thumbnail;
  const videoId = input.creative.videoId?.trim();
  if (!videoId) return null;
  const info = await fetchTikTokVideoInfo({
    advertiserId: input.advertiserId,
    token: input.token,
    videoIds: [videoId],
    request: input.requestGet,
  });
  return info[0]?.thumbnail_url?.trim() || null;
}

function coverFileName(creative: TikTokCreativeDraft, now?: number): string {
  const base =
    creative.name.trim().replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") ||
    "cover";
  return uniqueTikTokFileName(`${base.slice(0, 80)}.jpg`, now);
}
