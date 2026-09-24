import type { TikTokCreativeDraft } from "../types/tiktok-draft.ts";

export async function resolveTikTokCreativeCovers(input: {
  advertiserId: string;
  items: TikTokCreativeDraft[];
  fetchCover?: (creative: TikTokCreativeDraft) => Promise<{ coverImageId: string | null; error: string | null }>;
}): Promise<TikTokCreativeDraft[]> {
  const pending = input.items.filter(
    (item) =>
      item.mode === "VIDEO_REFERENCE" &&
      Boolean(item.videoId?.trim()) &&
      !item.coverImageId?.trim() &&
      !item.coverImageError?.trim(),
  );
  if (pending.length === 0) return input.items;
  const fetchCover = input.fetchCover ?? defaultFetchCover(input.advertiserId);
  const updates = new Map<string, { coverImageId: string | null; error: string | null }>();
  for (const item of pending) {
    updates.set(item.id, await fetchCover(item));
  }
  return input.items.map((item) => {
    const update = updates.get(item.id);
    if (!update) return item;
    if (update.coverImageId) {
      return { ...item, coverImageId: update.coverImageId, coverImageError: null };
    }
    return { ...item, coverImageError: update.error };
  });
}

function defaultFetchCover(advertiserId: string) {
  return async (creative: TikTokCreativeDraft) => {
    const res = await fetch("/api/tiktok/creative/cover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        advertiserId,
        creative: {
          id: creative.id,
          name: creative.name,
          videoId: creative.videoId,
          thumbnailUrl: creative.thumbnailUrl,
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      coverImageId?: string | null;
      error?: string | null;
    };
    return {
      coverImageId: json.coverImageId ?? null,
      error: json.error ?? "Cover image could not be uploaded to TikTok. Open Creatives and re-select the video.",
    };
  };
}
