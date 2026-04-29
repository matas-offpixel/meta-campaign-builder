import type { SupabaseClient } from "@supabase/supabase-js";

import type { TikTokShareAdRow } from "./share-render.ts";

const TABLE = "tiktok_active_creatives_snapshots";

export interface TikTokActiveCreativesWindow {
  since: string;
  until: string;
}

export type TikTokActiveCreativesSnapshotPayload =
  | { kind: "ok"; rows: TikTokShareAdRow[]; fetchedAt?: string }
  | { kind: "skip"; reason: string }
  | { kind: "error"; message: string };

export interface TikTokActiveCreativesSnapshotRecord {
  kind: "ok";
  rows: TikTokShareAdRow[];
  fetchedAt: Date;
}

interface SnapshotRow {
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  status: string | null;
  spend: number | string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  ctr: number | string | null;
  video_views_2s: number | null;
  video_views_6s: number | null;
  video_views_100p: number | null;
  thumbnail_url: string | null;
  deeplink_url: string | null;
  ad_text: string | null;
  fetched_at: string;
}

export async function readActiveTikTokCreativesSnapshot(
  supabase: SupabaseClient,
  eventId: string,
  window: TikTokActiveCreativesWindow,
): Promise<TikTokActiveCreativesSnapshotRecord | null> {
  const { data, error } = await asAny(supabase)
    .from(TABLE)
    .select(
      "ad_id, ad_name, campaign_id, campaign_name, status, spend, impressions, reach, clicks, ctr, video_views_2s, video_views_6s, video_views_100p, thumbnail_url, deeplink_url, ad_text, fetched_at",
    )
    .eq("event_id", eventId)
    .eq("window_since", window.since)
    .eq("window_until", window.until)
    .eq("kind", "ok")
    .order("fetched_at", { ascending: false });

  if (error) {
    console.warn("[tiktok-active-creatives-snapshots] read failed", error.message);
    return null;
  }
  const rows = ((data ?? []) as SnapshotRow[]).map(rowToAd);
  if (rows.length === 0) return null;
  const fetchedAt = new Date((data as SnapshotRow[])[0]?.fetched_at ?? Date.now());
  return { kind: "ok", rows, fetchedAt };
}

export async function writeActiveTikTokCreativesSnapshot(
  supabase: SupabaseClient,
  key: {
    eventId: string;
    userId: string;
    window: TikTokActiveCreativesWindow;
  },
  payload: TikTokActiveCreativesSnapshotPayload,
): Promise<boolean> {
  if (payload.kind !== "ok") {
    console.warn(
      `[tiktok-active-creatives-snapshots] refused write event=${key.eventId} kind=${payload.kind} — keeping last-good`,
    );
    return false;
  }

  const fetchedAt = payload.fetchedAt ?? new Date().toISOString();
  const rows = payload.rows.map((row) => ({
    user_id: key.userId,
    event_id: key.eventId,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    status: normalizeStatus(row.primary_status),
    spend: row.cost,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks_all,
    ctr: row.ctr_all,
    video_views_2s: row.video_views_2s,
    video_views_6s: row.video_views_6s,
    video_views_100p: row.video_views_p100,
    thumbnail_url: row.thumbnail_url,
    deeplink_url: row.deeplink_url ?? row.post_url ?? null,
    ad_text: row.ad_text,
    window_since: key.window.since,
    window_until: key.window.until,
    kind: "ok",
    error_message: null,
    fetched_at: fetchedAt,
  }));

  if (rows.length === 0) return true;

  const { error } = await asAny(supabase).from(TABLE).upsert(rows, {
    onConflict: "event_id,ad_id,window_since,window_until",
  });
  if (error) {
    console.warn("[tiktok-active-creatives-snapshots] write failed", error.message);
    return false;
  }
  return true;
}

export async function listActiveTikTokCreativesSnapshotsForCron(
  supabase: SupabaseClient,
  beforeMs: number,
): Promise<Array<{ eventId: string; fetchedAt: Date }>> {
  const before = new Date(beforeMs).toISOString();
  const { data, error } = await asAny(supabase)
    .from(TABLE)
    .select("event_id, fetched_at")
    .lt("fetched_at", before)
    .order("fetched_at", { ascending: true });
  if (error) {
    console.warn("[tiktok-active-creatives-snapshots] list failed", error.message);
    return [];
  }
  return (data ?? []).map((row: { event_id: string; fetched_at: string }) => ({
    eventId: row.event_id,
    fetchedAt: new Date(row.fetched_at),
  }));
}

function rowToAd(row: SnapshotRow): TikTokShareAdRow {
  const spend = safeNumber(row.spend);
  const impressions = row.impressions ?? 0;
  const clicks = row.clicks ?? 0;
  return {
    ad_id: row.ad_id,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    thumbnail_url: row.thumbnail_url,
    deeplink_url: row.deeplink_url,
    ad_text: row.ad_text,
    ad_name: row.ad_name ?? row.ad_id,
    primary_status: row.status ?? "UNKNOWN",
    secondary_status: "UNKNOWN",
    reach: row.reach,
    cost_per_1000_reached:
      row.reach && row.reach > 0 ? (spend / row.reach) * 1000 : null,
    frequency: row.reach && row.reach > 0 ? impressions / row.reach : null,
    clicks_all: clicks,
    ctr_all: safeNullableNumber(row.ctr),
    secondary_source: null,
    primary_source: null,
    attribution_source: null,
    currency: "GBP",
    post_url: row.deeplink_url,
    cost: spend,
    impressions,
    impressions_raw: null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    clicks_destination: clicks,
    cpc_destination: clicks > 0 ? spend / clicks : null,
    ctr_destination: safeNullableNumber(row.ctr),
    video_views_2s: row.video_views_2s,
    video_views_6s: row.video_views_6s,
    video_views_p25: null,
    video_views_p50: null,
    video_views_p75: null,
    video_views_p100: row.video_views_100p,
    avg_play_time_per_user: null,
    avg_play_time_per_video_view: null,
    interactive_addon_impressions: null,
    interactive_addon_destination_clicks: null,
  };
}

function normalizeStatus(status: string | null | undefined): string {
  if (!status) return "UNKNOWN";
  const normalized = status.toUpperCase();
  if (normalized.includes("ACTIVE")) return "ACTIVE";
  if (normalized.includes("PAUSED")) return "PAUSED";
  if (normalized.includes("NOT")) return "NOT_DELIVERING";
  return "UNKNOWN";
}

function safeNumber(value: number | string | null): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeNullableNumber(value: number | string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asAny(supabase: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return supabase as unknown as any;
}
