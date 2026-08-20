import { isTikTokPreviewExpired, resolveTikTokPreviewExpiry } from "../tiktok/video-preview.ts";
import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";

export async function refreshExpiredTikTokThumbnails(input: {
  items: TikTokCreativeDraft[];
  fetchInfo: (videoId: string) => Promise<{
    thumbnailUrl: string | null;
    expiresAt?: unknown;
  } | null>;
  now?: number;
}): Promise<{ items: TikTokCreativeDraft[]; refetchedIds: string[] }> {
  const now = input.now ?? Date.now();
  const refetchedIds: string[] = [];
  const items = await Promise.all(
    input.items.map(async (item) => {
      if (!item.videoId || !isTikTokPreviewExpired(item.thumbnailExpiresAt, now)) {
        return item;
      }
      const info = await input.fetchInfo(item.videoId);
      if (!info?.thumbnailUrl) return item;
      refetchedIds.push(item.id);
      return {
        ...item,
        thumbnailUrl: info.thumbnailUrl,
        thumbnailExpiresAt: resolveTikTokPreviewExpiry(info.expiresAt, now),
      };
    }),
  );
  return { items, refetchedIds };
}
