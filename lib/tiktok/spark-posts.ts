import { tiktokGet } from "./client.ts";
import type { TikTokAccountSetup } from "../types/tiktok-draft.ts";

type TikTokGet = typeof tiktokGet;

/** Confirmed live 2026-09-07: HTTP 200, code 0, `{ list, page_info }`. */
export const TIKTOK_SPARK_POSTS_PATH = "/tt_video/list/";

export const TIKTOK_SPARK_POST_COPY = {
  choose: "choose a post from the feed",
  empty:
    "no authorised posts on this account — authorise one in TikTok Ads Manager first",
  notPublic: "not public — the post owner has to make it public again",
} as const;

export const TIKTOK_SPARK_PUBLIC_STATUS = "HESITATE_RECOMMEND";

export interface TikTokSparkPost {
  item_id: string;
  text: string | null;
  status: string | null;
  item_type: "VIDEO";
  identity_id: string | null;
  identity_type: TikTokAccountSetup["identityType"];
  identity_display_name: string | null;
  ad_auth_status: string | null;
  auth_end_time: string | null;
  poster_url: string | null;
  preview_url: string | null;
  duration_seconds: number | null;
  fetched_at: string;
}

export interface TikTokSparkPostPage {
  posts: TikTokSparkPost[];
  page: number;
  pageSize: number;
  totalNumber: number;
  totalPage: number;
}

interface SparkListRow {
  item_info?: {
    item_id?: string;
    text?: string;
    status?: string;
    item_type?: string;
  };
  user_info?: {
    tiktok_name?: string;
    identity_id?: string;
    identity_type?: string;
  };
  auth_info?: {
    ad_auth_status?: string;
    auth_end_time?: string;
  };
  video_info?: {
    duration?: number;
    preview_url?: string;
    poster_url?: string;
  };
}

interface SparkListResponse {
  list?: SparkListRow[];
  page_info?: {
    page?: number;
    page_size?: number;
    total_number?: number;
    total_page?: number;
  };
}

function clampPage(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, n);
}

function clampPageSize(value: number | undefined): number {
  const n =
    typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 20;
  return Math.min(50, Math.max(1, n));
}

function asIdentityType(
  value: string | undefined,
): TikTokAccountSetup["identityType"] {
  if (
    value === "AUTH_CODE" ||
    value === "BC_AUTH_TT" ||
    value === "CUSTOMIZED_USER" ||
    value === "TT_USER" ||
    value === "MANUAL"
  ) {
    return value;
  }
  return null;
}

function normalizeSparkRow(
  row: SparkListRow,
  fetchedAt: string,
): TikTokSparkPost | null {
  const itemId = row.item_info?.item_id?.trim();
  if (!itemId) return null;
  if (row.item_info?.item_type && row.item_info.item_type !== "VIDEO") {
    return null;
  }
  const preview = row.video_info?.preview_url?.trim() || null;
  const poster = row.video_info?.poster_url?.trim() || null;
  return {
    item_id: itemId,
    text: row.item_info?.text?.trim() || null,
    status: row.item_info?.status ?? null,
    item_type: "VIDEO",
    identity_id: row.user_info?.identity_id?.trim() || null,
    identity_type: asIdentityType(row.user_info?.identity_type),
    identity_display_name: row.user_info?.tiktok_name?.trim() || null,
    ad_auth_status: row.auth_info?.ad_auth_status ?? null,
    auth_end_time: row.auth_info?.auth_end_time ?? null,
    poster_url: poster,
    preview_url: preview,
    duration_seconds:
      typeof row.video_info?.duration === "number" ? row.video_info.duration : null,
    fetched_at: fetchedAt,
  };
}

export function parseTikTokSparkAuthEnd(
  value: string | null | undefined,
): number | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const asIso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(asIso.endsWith("Z") ? asIso : `${asIso}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isTikTokSparkAuthExpired(
  post: Pick<TikTokSparkPost, "ad_auth_status" | "auth_end_time">,
  now = Date.now(),
): boolean {
  if (post.ad_auth_status === "EXPIRED") return true;
  const end = parseTikTokSparkAuthEnd(post.auth_end_time);
  return end != null && end <= now;
}

export function isTikTokSparkPublic(
  post: Pick<TikTokSparkPost, "status">,
): boolean {
  return post.status === TIKTOK_SPARK_PUBLIC_STATUS;
}

export function formatTikTokSparkAuthExpired(
  authEndTime: string | null | undefined,
): string {
  const end = parseTikTokSparkAuthEnd(authEndTime);
  if (end == null) return "authorisation expired";
  const day = new Date(end).getUTCDate();
  const month = new Date(end).toLocaleString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `authorisation expired ${day} ${month}`;
}

export function sparkPostPreviewCause(
  post: Pick<TikTokSparkPost, "status" | "preview_url" | "ad_auth_status" | "auth_end_time">,
  now = Date.now(),
): "expired" | "not_public" | null {
  if (isTikTokSparkAuthExpired(post, now)) return "expired";
  if (!isTikTokSparkPublic(post) || !post.preview_url) return "not_public";
  return null;
}

export async function fetchTikTokSparkPosts(input: {
  advertiserId: string;
  token: string;
  page?: number;
  pageSize?: number;
  request?: TikTokGet;
  now?: Date;
}): Promise<TikTokSparkPostPage> {
  const page = clampPage(input.page);
  const pageSize = clampPageSize(input.pageSize);
  const request = input.request ?? tiktokGet;
  const fetchedAt = (input.now ?? new Date()).toISOString();
  const res = await request<SparkListResponse>(
    TIKTOK_SPARK_POSTS_PATH,
    {
      advertiser_id: input.advertiserId,
      item_types: ["VIDEO"],
      page,
      page_size: pageSize,
    },
    input.token,
  );
  const posts = (res.list ?? [])
    .map((row) => normalizeSparkRow(row, fetchedAt))
    .filter((row): row is TikTokSparkPost => row != null);
  return {
    posts,
    page: res.page_info?.page ?? page,
    pageSize: res.page_info?.page_size ?? pageSize,
    totalNumber: res.page_info?.total_number ?? 0,
    totalPage: res.page_info?.total_page ?? 0,
  };
}
