import { tiktokGet } from "./client.ts";
import { logUnmatchedCandidates } from "./unmatched-candidates.ts";

type TikTokGet = typeof tiktokGet;

export interface TikTokVideoInfo {
  video_id: string;
  thumbnail_url: string | null;
  preview_url_expire_time?: string | number | null;
  duration_seconds: number | null;
  title: string | null;
}

interface VideoInfoRow {
  video_id?: string;
  thumbnail_url?: string;
  video_cover_url?: string;
  preview_url?: string;
  preview_url_expire_time?: string | number;
  duration?: number;
  duration_seconds?: number;
  title?: string;
  file_name?: string;
}

interface VideoInfoResponse {
  list?: VideoInfoRow[];
}

/** Confirmed live 2026-09-07: HTTP 200, code 0, `{ list, page_info }`. */
export const TIKTOK_VIDEO_LIBRARY_PATH = "/file/video/ad/search/";

export const TIKTOK_VIDEO_LIBRARY_COPY = {
  choose: "choose from this account",
  empty: "no videos in this account yet — upload one above",
} as const;

export interface TikTokVideoLibraryPage {
  videos: TikTokVideoInfo[];
  page: number;
  pageSize: number;
  totalNumber: number;
  totalPage: number;
}

interface VideoSearchResponse {
  list?: VideoInfoRow[];
  page_info?: {
    page?: number;
    page_size?: number;
    total_number?: number;
    total_page?: number;
  };
}

function normalizeTikTokVideoRow(
  row: VideoInfoRow & { video_id: string },
): TikTokVideoInfo {
  const thumbnailUrl =
    row.video_cover_url ?? row.thumbnail_url ?? row.preview_url ?? null;
  if (thumbnailUrl == null) {
    logUnmatchedCandidates("/file/video/ad thumbnail", [
      "video_cover_url",
      "thumbnail_url",
      "preview_url",
    ]);
  }
  const durationSeconds = row.duration_seconds ?? row.duration ?? null;
  if (durationSeconds == null) {
    logUnmatchedCandidates("/file/video/ad duration", [
      "duration_seconds",
      "duration",
    ]);
  }
  const title = row.title ?? row.file_name ?? null;
  if (title == null) {
    logUnmatchedCandidates("/file/video/ad title", ["title", "file_name"]);
  }
  return {
    video_id: row.video_id,
    thumbnail_url: thumbnailUrl,
    preview_url_expire_time: row.preview_url_expire_time ?? null,
    duration_seconds: durationSeconds,
    title,
  };
}

function rowsWithVideoId(
  list: VideoInfoRow[] | undefined,
): Array<VideoInfoRow & { video_id: string }> {
  return (list ?? []).filter((row): row is VideoInfoRow & { video_id: string } =>
    Boolean(row.video_id),
  );
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
  return rowsWithVideoId(res.list).map(normalizeTikTokVideoRow);
}

function clampLibraryPage(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, n);
}

function clampLibraryPageSize(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 20;
  return Math.min(100, Math.max(1, n));
}

export async function fetchTikTokVideoLibrary(input: {
  advertiserId: string;
  token: string;
  page?: number;
  pageSize?: number;
  request?: TikTokGet;
}): Promise<TikTokVideoLibraryPage> {
  const page = clampLibraryPage(input.page);
  const pageSize = clampLibraryPageSize(input.pageSize);
  const request = input.request ?? tiktokGet;
  const res = await request<VideoSearchResponse>(
    TIKTOK_VIDEO_LIBRARY_PATH,
    {
      advertiser_id: input.advertiserId,
      page,
      page_size: pageSize,
    },
    input.token,
  );
  return {
    videos: rowsWithVideoId(res.list).map(normalizeTikTokVideoRow),
    page: res.page_info?.page ?? page,
    pageSize: res.page_info?.page_size ?? pageSize,
    totalNumber: res.page_info?.total_number ?? 0,
    totalPage: res.page_info?.total_page ?? 0,
  };
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
