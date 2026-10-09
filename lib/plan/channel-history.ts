import type { SupabaseClient } from "@supabase/supabase-js";

import {
  EMPTY_CHANNEL_HISTORY,
  summariseChannelHistory,
  type ChannelHistoryPick,
} from "./mml-wizard.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

/**
 * Most-used ad account, pixel, page, Instagram, TikTok advertiser and
 * identity, and Google account for one client. Count, newest first on a
 * tie. The caller falls back to channel defaults when a field is null.
 */
export async function loadChannelHistory(
  supabase: AnyClient,
  userId: string,
  clientId: string,
): Promise<ChannelHistoryPick> {
  const [meta, tiktok, events] = await Promise.all([
    supabase
      .from("campaign_drafts")
      .select("draft_json, updated_at")
      .eq("user_id", userId)
      .eq("client_id", clientId),
    supabase
      .from("tiktok_campaign_drafts")
      .select("state, updated_at")
      .eq("user_id", userId)
      .eq("client_id", clientId),
    supabase.from("events").select("id").eq("user_id", userId).eq("client_id", clientId),
  ]);

  const eventIds = ((events.data ?? []) as { id: string }[]).map((row) => row.id);
  const google = eventIds.length
    ? await supabase
        .from("google_search_plans")
        .select("google_ads_account_id, updated_at")
        .eq("user_id", userId)
        .in("event_id", eventIds)
    : { data: [] as { google_ads_account_id: string | null; updated_at: string }[] };

  if (meta.error || tiktok.error || events.error || ("error" in google && google.error)) {
    return EMPTY_CHANNEL_HISTORY;
  }

  return summariseChannelHistory({
    meta: ((meta.data ?? []) as { draft_json: unknown; updated_at: string }[]).map((row) => ({
      draftJson: row.draft_json,
      updatedAt: row.updated_at,
    })),
    tiktok: ((tiktok.data ?? []) as { state: unknown; updated_at: string }[]).map((row) => ({
      state: row.state,
      updatedAt: row.updated_at,
    })),
    google: (
      (google.data ?? []) as { google_ads_account_id: string | null; updated_at: string }[]
    ).map((row) => ({
      accountId: row.google_ads_account_id,
      updatedAt: row.updated_at,
    })),
  });
}
