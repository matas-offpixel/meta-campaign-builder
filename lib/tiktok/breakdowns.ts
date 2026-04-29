import type { SupabaseClient } from "@supabase/supabase-js";

import { TikTokApiError, tiktokGet, TIKTOK_CHUNK_CONCURRENCY } from "./client.ts";
import { campaignNameMatchesEventCode } from "./matching.ts";

type TikTokGet = typeof tiktokGet;

export type TikTokBreakdownDimension =
  | "country"
  | "region"
  | "city"
  | "age"
  | "gender"
  | "age_gender"
  | "interest_category";

export interface TikTokBreakdownRow {
  dimension: TikTokBreakdownDimension;
  dimension_value: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number | null;
  video_views_2s: number;
  video_views_6s: number;
  video_views_100p: number;
  avg_play_time_ms: number | null;
}

export type TikTokBreakdownSnapshotPayload =
  | { kind: "ok"; rows: TikTokBreakdownRow[]; fetchedAt?: string }
  | { kind: "skip"; reason: string }
  | { kind: "error"; message: string };

export interface FetchTikTokBreakdownsInput {
  advertiserId: string;
  token: string;
  eventCode: string;
  since: string;
  until: string;
  dimensions: TikTokBreakdownDimension[];
  request?: TikTokGet;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface TikTokIntegratedRow {
  dimensions?: Record<string, string | undefined>;
  metrics?: Record<string, string | number | null | undefined>;
}

interface TikTokIntegratedResponse {
  list?: TikTokIntegratedRow[];
  page_info?: {
    page?: number;
    total_page?: number;
  };
}

interface TikTokCampaignGetRow {
  campaign_id?: string;
  campaign_name?: string;
}

interface TikTokCampaignGetResponse {
  list?: TikTokCampaignGetRow[];
}

const METRICS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "ctr",
  "video_watched_2s",
  "video_watched_6s",
  "video_views_p100",
  "average_video_play",
];
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const MAX_WINDOW_DAYS = 30;

const DIMENSION_MAP: Record<TikTokBreakdownDimension, string[]> = {
  country: ["country_code"],
  region: ["province_id"],
  city: ["city_id"],
  age: ["age"],
  gender: ["gender"],
  age_gender: ["age", "gender"],
  interest_category: ["interest_category"],
};

export async function fetchTikTokBreakdowns(
  input: FetchTikTokBreakdownsInput,
): Promise<TikTokBreakdownRow[]> {
  if (TIKTOK_CHUNK_CONCURRENCY !== 1) {
    throw new Error("TikTok breakdown chunks must run serially.");
  }

  const request = input.request ?? tiktokGet;
  const sleep = input.sleep ?? defaultSleep;
  const retryDelayMs = input.retryDelayMs ?? 10_000;
  const campaignIds = new Set<string>();
  const rawRows: Array<TikTokBreakdownRow & { campaignId: string }> = [];

  for (const dimension of input.dimensions) {
    const apiDimensions = ["campaign_id", ...DIMENSION_MAP[dimension]];
    for (const window of buildDateWindows(input.since, input.until)) {
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const res = await requestWithOneRateLimitRetry(
          request,
          "/report/integrated/get/",
          {
            advertiser_id: input.advertiserId,
            report_type: "BASIC",
            data_level: "AUCTION_CAMPAIGN",
            dimensions: apiDimensions,
            metrics: METRICS,
            start_date: window.since,
            end_date: window.until,
            page,
            page_size: PAGE_SIZE,
          },
          input.token,
          retryDelayMs,
          sleep,
        );

        for (const row of res.list ?? []) {
          const campaignId = row.dimensions?.campaign_id;
          if (!campaignId) continue;
          const dimensionValue = valueForDimension(dimension, row.dimensions ?? {});
          if (!dimensionValue) continue;
          campaignIds.add(campaignId);
          const metrics = row.metrics ?? {};
          rawRows.push({
            campaignId,
            dimension,
            dimension_value: dimensionValue,
            spend: numberMetric(metrics.spend),
            impressions: numberMetric(metrics.impressions),
            reach: numberMetric(metrics.reach),
            clicks: numberMetric(metrics.clicks),
            ctr: nullableNumberMetric(metrics.ctr),
            video_views_2s: numberMetric(metrics.video_watched_2s),
            video_views_6s: numberMetric(metrics.video_watched_6s),
            video_views_100p: numberMetric(metrics.video_views_p100),
            avg_play_time_ms: nullableNumberMetric(metrics.average_video_play),
          });
        }

        const pageInfo = res.page_info;
        if (!pageInfo?.total_page || page >= pageInfo.total_page) break;
      }
    }
  }

  const campaignNames = await fetchCampaignNames({
    advertiserId: input.advertiserId,
    token: input.token,
    campaignIds: [...campaignIds],
    request,
  });
  const hasNames = campaignNames.size > 0;
  const byKey = new Map<string, TikTokBreakdownRow>();

  for (const row of rawRows) {
    const campaignName = campaignNames.get(row.campaignId) ?? "(unnamed)";
    if (
      hasNames &&
      !campaignNameMatchesEventCode(campaignName, input.eventCode)
    ) {
      continue;
    }
    const key = `${row.dimension}:${row.dimension_value}`;
    const existing = byKey.get(key) ?? {
      dimension: row.dimension,
      dimension_value: row.dimension_value,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      ctr: null,
      video_views_2s: 0,
      video_views_6s: 0,
      video_views_100p: 0,
      avg_play_time_ms: null,
    };
    existing.spend += row.spend;
    existing.impressions += row.impressions;
    existing.reach += row.reach;
    existing.clicks += row.clicks;
    existing.video_views_2s += row.video_views_2s;
    existing.video_views_6s += row.video_views_6s;
    existing.video_views_100p += row.video_views_100p;
    existing.avg_play_time_ms = weightedAverage(
      existing.avg_play_time_ms,
      existing.impressions - row.impressions,
      row.avg_play_time_ms,
      row.impressions,
    );
    byKey.set(key, existing);
  }

  return [...byKey.values()]
    .map((row) => ({
      ...row,
      spend: round2(row.spend),
      impressions: Math.round(row.impressions),
      reach: Math.round(row.reach),
      clicks: Math.round(row.clicks),
      ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : row.ctr,
      video_views_2s: Math.round(row.video_views_2s),
      video_views_6s: Math.round(row.video_views_6s),
      video_views_100p: Math.round(row.video_views_100p),
      avg_play_time_ms:
        row.avg_play_time_ms == null ? null : Math.round(row.avg_play_time_ms),
    }))
    .sort((a, b) =>
      a.dimension === b.dimension
        ? b.spend - a.spend
        : a.dimension.localeCompare(b.dimension),
    );
}

export async function writeTikTokBreakdownSnapshots(
  supabase: SupabaseClient,
  key: {
    userId: string;
    eventId: string;
    window: { since: string; until: string };
  },
  payload: TikTokBreakdownSnapshotPayload,
): Promise<boolean> {
  if (payload.kind !== "ok") {
    console.warn(
      `[tiktok-breakdown-snapshots] refused write event=${key.eventId} kind=${payload.kind} — keeping last-good`,
    );
    return false;
  }
  if (payload.rows.length === 0) return true;
  const fetchedAt = payload.fetchedAt ?? new Date().toISOString();
  const rows = payload.rows.map((row) => ({
    user_id: key.userId,
    event_id: key.eventId,
    dimension: row.dimension,
    dimension_value: row.dimension_value,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks,
    ctr: row.ctr,
    video_views_2s: row.video_views_2s,
    video_views_6s: row.video_views_6s,
    video_views_100p: row.video_views_100p,
    avg_play_time_ms: row.avg_play_time_ms,
    window_since: key.window.since,
    window_until: key.window.until,
    fetched_at: fetchedAt,
  }));

  const { error } = await asAny(supabase).from("tiktok_breakdown_snapshots").upsert(
    rows,
    {
      onConflict: "event_id,dimension,dimension_value,window_since,window_until",
    },
  );
  if (error) {
    console.warn("[tiktok-breakdown-snapshots] write failed", error.message);
    return false;
  }
  return true;
}

async function requestWithOneRateLimitRetry(
  request: TikTokGet,
  path: "/report/integrated/get/",
  params: Parameters<TikTokGet>[1],
  token: string,
  retryDelayMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<TikTokIntegratedResponse> {
  try {
    return await request<TikTokIntegratedResponse>(path, params, token);
  } catch (err) {
    if (err instanceof TikTokApiError && err.code === 50001) {
      await sleep(retryDelayMs);
      return request<TikTokIntegratedResponse>(path, params, token);
    }
    throw err;
  }
}

async function fetchCampaignNames(input: {
  advertiserId: string;
  token: string;
  campaignIds: string[];
  request: TikTokGet;
}): Promise<Map<string, string>> {
  if (input.campaignIds.length === 0) return new Map();
  const res = await input.request<TikTokCampaignGetResponse>(
    "/campaign/get/",
    {
      advertiser_id: input.advertiserId,
      campaign_ids: input.campaignIds,
      fields: ["campaign_id", "campaign_name"],
      page_size: PAGE_SIZE,
    },
    input.token,
  );
  const out = new Map<string, string>();
  for (const row of res.list ?? []) {
    if (row.campaign_id && row.campaign_name) {
      out.set(row.campaign_id, row.campaign_name);
    }
  }
  return out;
}

function valueForDimension(
  dimension: TikTokBreakdownDimension,
  dims: Record<string, string | undefined>,
): string | null {
  if (dimension === "age_gender") {
    const age = dims.age;
    const gender = dims.gender;
    return age && gender ? `${age}:${gender}` : null;
  }
  const key = DIMENSION_MAP[dimension][0];
  return key ? (dims[key] ?? null) : null;
}

export function buildDateWindows(
  since: string,
  until: string,
): Array<{ since: string; until: string }> {
  const windows: Array<{ since: string; until: string }> = [];
  let cursor = parseYmdUtc(since);
  const end = parseYmdUtc(until);
  while (cursor.getTime() <= end.getTime()) {
    const windowEnd = minDate(addDaysUtc(cursor, MAX_WINDOW_DAYS - 1), end);
    windows.push({ since: formatYmdUtc(cursor), until: formatYmdUtc(windowEnd) });
    cursor = addDaysUtc(windowEnd, 1);
  }
  return windows;
}

function numberMetric(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumberMetric(
  value: string | number | null | undefined,
): number | null {
  if (value == null) return null;
  const n = numberMetric(value);
  return Number.isFinite(n) ? n : null;
}

function weightedAverage(
  currentAverage: number | null,
  currentWeight: number,
  nextAverage: number | null,
  nextWeight: number,
): number | null {
  if (nextAverage == null || nextWeight <= 0) return currentAverage;
  if (currentAverage == null || currentWeight <= 0) return nextAverage;
  return (
    (currentAverage * currentWeight + nextAverage * nextWeight) /
    (currentWeight + nextWeight)
  );
}

function parseYmdUtc(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid YYYY-MM-DD date: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUtc(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

function formatYmdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asAny(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}
