import { fetchTikTokVideoInfo } from "../creative.ts";
import { uploadTikTokAdImageByUrl } from "../image-upload.ts";
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

export async function hydrateDraftCoverImageIds(input: {
  draft: TikTokCampaignDraft;
  token: string;
  request?: TikTokPost;
  requestGet?: typeof tiktokGet;
  sleep?: Sleep;
}): Promise<number> {
  const advertiserId = input.draft.accountSetup.advertiserId?.trim();
  if (!advertiserId) return 0;

  let resolved = 0;
  for (const creative of assignedTikTokVideoCreatives(input.draft)) {
    if (tikTokCreativeCoverImageId(creative)) continue;
    try {
      const imageUrl = await resolveCoverImageUrl({
        creative,
        advertiserId,
        token: input.token,
        requestGet: input.requestGet,
      });
      if (!imageUrl) continue;
      const imageId = await uploadTikTokAdImageByUrl({
        advertiserId,
        token: input.token,
        imageUrl,
        fileName: coverFileName(creative),
        request: input.request,
        sleep: input.sleep,
      });
      creative.coverImageId = imageId;
      resolved += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[tiktok/cover-image] hydrate draft=${input.draft.id} creative=${creative.id} failed: ${message}`,
      );
    }
  }
  return resolved;
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

function coverFileName(creative: TikTokCreativeDraft): string {
  const base =
    creative.name.trim().replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") ||
    "cover";
  return `${base.slice(0, 90)}.jpg`;
}
