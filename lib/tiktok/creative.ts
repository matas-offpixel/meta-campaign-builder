import { tiktokGet } from "./client.ts";

type TikTokGet = typeof tiktokGet;

export interface TikTokVideoInfo {
  video_id: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  title: string | null;
}

interface VideoInfoRow {
  video_id?: string;
  thumbnail_url?: string;
  duration?: number;
  duration_seconds?: number;
  title?: string;
  file_name?: string;
}

interface VideoInfoResponse {
  list?: VideoInfoRow[];
}

export async function fetchTikTokVideoInfo(input: {
  advertiserId: string;
  token: string;
  videoIds: string[];
  request?: TikTokGet;
}): Promise<TikTokVideoInfo[]> {
  if (input.videoIds.length === 0) return [];
  const request = input.request ?? tiktokGet;
  const res = await request<VideoInfoResponse>(
    "/file/video/ad/info/",
    {
      advertiser_id: input.advertiserId,
      video_ids: input.videoIds,
    },
    input.token,
  );
  return (res.list ?? [])
    .filter((row): row is VideoInfoRow & { video_id: string } =>
      Boolean(row.video_id),
    )
    .map((row) => ({
      video_id: row.video_id,
      thumbnail_url: row.thumbnail_url ?? null,
      duration_seconds: row.duration_seconds ?? row.duration ?? null,
      title: row.title ?? row.file_name ?? null,
    }));
}

export function extractTikTokVideoId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^[A-Za-z0-9_-]{6,}$/.test(value) && !value.includes("/")) {
    return value;
  }
  const match =
    value.match(/\/video\/(\d+)/) ??
    value.match(/[?&]video_id=([A-Za-z0-9_-]+)/) ??
    value.match(/[?&]item_id=([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

export function nameCreativeVariations(baseName: string, count: number): string[] {
  const base = baseName.trim() || "TikTok creative";
  return Array.from({ length: count }, (_, index) => `${base} · v${index + 1}`);
}
