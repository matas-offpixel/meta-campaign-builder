import type { SupabaseClient } from "@supabase/supabase-js";

import { venueKey } from "./venue-key.ts";
import { metaFieldsFromDraft, type ChannelHistoryEntry } from "./mml-wizard.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

/**
 * One row per Meta draft, TikTok draft and Google plan for this client.
 * The wizard scopes these to the event's venue, then the chosen account.
 */
export async function loadChannelHistory(
  supabase: AnyClient,
  userId: string,
  clientId: string,
): Promise<ChannelHistoryEntry[]> {
  const [meta, tiktok, events] = await Promise.all([
    supabase
      .from("campaign_drafts")
      .select("draft_json, updated_at, event_id")
      .eq("user_id", userId)
      .eq("client_id", clientId),
    supabase
      .from("tiktok_campaign_drafts")
      .select("state, updated_at, event_id")
      .eq("user_id", userId)
      .eq("client_id", clientId),
    supabase
      .from("events")
      .select("id, venue_key, venue_name")
      .eq("user_id", userId)
      .eq("client_id", clientId),
  ]);

  if (meta.error || tiktok.error || events.error) return [];

  const eventVenue = new Map<string, string | null>();
  for (const row of (events.data ?? []) as {
    id: string;
    venue_key: string | null;
    venue_name: string | null;
  }[]) {
    eventVenue.set(row.id, row.venue_key?.trim() || venueKey(row.venue_name));
  }

  const eventIds = [...eventVenue.keys()];
  const google = eventIds.length
    ? await supabase
        .from("google_search_plans")
        .select("google_ads_account_id, updated_at, event_id")
        .eq("user_id", userId)
        .in("event_id", eventIds)
    : { data: [] as { google_ads_account_id: string | null; updated_at: string; event_id: string }[], error: null };

  if (google.error) return [];

  const entries: ChannelHistoryEntry[] = [];
  for (const row of (meta.data ?? []) as {
    draft_json: unknown;
    updated_at: string;
    event_id: string | null;
  }[]) {
    const fields = metaFieldsFromDraft(row.draft_json);
    entries.push({
      venueKey: row.event_id ? (eventVenue.get(row.event_id) ?? null) : null,
      updatedAt: row.updated_at,
      metaAdAccountId: fields.adAccountId,
      metaPixelId: fields.pixelId,
      metaPageId: fields.pageId,
      metaIgAccountId: fields.igId,
      tiktokAdvertiserId: null,
      tiktokIdentityId: null,
      googleAdsAccountId: null,
    });
  }
  for (const row of (tiktok.data ?? []) as {
    state: unknown;
    updated_at: string;
    event_id: string | null;
  }[]) {
    const account = record(record(row.state)?.accountSetup);
    entries.push({
      venueKey: row.event_id ? (eventVenue.get(row.event_id) ?? null) : null,
      updatedAt: row.updated_at,
      metaAdAccountId: null,
      metaPixelId: null,
      metaPageId: null,
      metaIgAccountId: null,
      tiktokAdvertiserId: text(account?.advertiserId),
      tiktokIdentityId: text(account?.identityId),
      googleAdsAccountId: null,
    });
  }
  for (const row of (google.data ?? []) as {
    google_ads_account_id: string | null;
    updated_at: string;
    event_id: string | null;
  }[]) {
    entries.push({
      venueKey: row.event_id ? (eventVenue.get(row.event_id) ?? null) : null,
      updatedAt: row.updated_at,
      metaAdAccountId: null,
      metaPixelId: null,
      metaPageId: null,
      metaIgAccountId: null,
      tiktokAdvertiserId: null,
      tiktokIdentityId: null,
      googleAdsAccountId: row.google_ads_account_id,
    });
  }
  return entries;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
