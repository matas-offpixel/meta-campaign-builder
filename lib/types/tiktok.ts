/**
 * lib/types/tiktok.ts
 *
 * TikTok platform types — mirrors the shape of `lib/insights/types.ts`
 * for Meta so the cross-channel reporting aggregator can fan out to
 * either provider with a uniform contract. None of these are wired up
 * yet — the `app/api/tiktok/*` routes return
 * `{ ok: false, error: 'TikTok not configured' }` and the report tab
 * renders placeholders pending OAuth.
 */

export interface TikTokAccount {
  id: string;
  user_id: string;
  account_name: string;
  tiktok_advertiser_id: string | null;
  /** Token is never returned to the client — present in API surface only. */
  access_token_encrypted?: string | null;
  created_at: string;
  updated_at: string;
}

/** Aggregated totals across every campaign queried for an event. */
export interface TikTokTotals {
  impressions: number;
  reach: number | null;
  clicks: number;
  spend: number;
  video_views: number | null;
  cpm: number | null;
  cpc: number | null;
  ctr: number | null;
}

export interface TikTokCampaignRow {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  video_views: number | null;
  cpm: number | null;
  cpc: number | null;
  ctr: number | null;
}

export interface TikTokCreativeRow {
  id: string;
  campaign_id: string;
  name: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  video_views: number | null;
}

export interface TikTokInsightsPayload {
  /** ISO timestamp the data was fetched. */
  fetchedAt: string;
  totals: TikTokTotals;
  campaigns: TikTokCampaignRow[];
  matchedCampaignCount: number;
}

export type TikTokInsightsErrorReason =
  | "no_account"
  | "no_advertiser_id"
  | "no_access_token"
  | "tiktok_api_error"
  | "no_campaigns_matched"
  /** Stub error returned by the unwired API routes. */
  | "not_configured";

export interface TikTokInsightsError {
  reason: TikTokInsightsErrorReason;
  message: string;
}

export type TikTokInsightsResult =
  | { ok: true; data: TikTokInsightsPayload }
  | { ok: false; error: TikTokInsightsError };
