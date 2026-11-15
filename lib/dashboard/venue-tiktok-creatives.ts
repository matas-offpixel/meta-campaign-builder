/**
 * lib/dashboard/venue-tiktok-creatives.ts
 *
 * Loads the TikTok concept groups for every event under one venue
 * (`client_id` + `event_code`) from `tiktok_active_creatives_snapshots`.
 * No TikTok API calls: the snapshot cron
 * (`/api/cron/tiktok-active-creatives`) is the only writer.
 *
 * The window is the per-event share report's: `resolveCanonicalTikTokWindow`,
 * and the snapshot is read only when that window is `computed` (the cron
 * writes at `resolveComputedTikTokWindow`). A manual-fallback or empty
 * window has no snapshot rows, so that event gets no TikTok group.
 *
 * Client status is not consulted, the same as the Meta venue-creatives
 * routes: share links never check it, and the internal route is reached
 * with an explicit client id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  groupTikTokCreatives,
  type TikTokCreativeInput,
} from "../reporting/group-tiktok-creatives.ts";
import { resolveCanonicalTikTokWindow } from "../share/tiktok-window.ts";
import type { TikTokShareAdRow } from "../tiktok/share-render.ts";
import { readActiveTikTokCreativesSnapshot } from "../tiktok/snapshots.ts";
import {
  tiktokCardFromGroup,
  type VenueTikTokEventGroup,
} from "./venue-tiktok-creatives-view.ts";

interface VenueEventRow {
  id: string;
  name: string | null;
  kind: string | null;
  event_date: string | null;
  event_start_at: string | null;
  campaign_end_at: string | null;
}

export async function loadVenueTikTokCreatives(
  supabase: SupabaseClient,
  input: { clientId: string; eventCode: string; now?: Date },
): Promise<VenueTikTokEventGroup[]> {
  const now = input.now ?? new Date();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, kind, event_date, event_start_at, campaign_end_at")
    .eq("client_id", input.clientId)
    .eq("event_code", input.eventCode)
    .order("event_date", { ascending: true, nullsFirst: true });
  if (error) throw new Error(error.message);

  const events = (data ?? []) as VenueEventRow[];
  const groups = await Promise.all(
    events.map((event) => loadEventGroup(supabase, event, now)),
  );
  return groups.filter((g): g is VenueTikTokEventGroup => g !== null);
}

async function loadEventGroup(
  supabase: SupabaseClient,
  event: VenueEventRow,
  now: Date,
): Promise<VenueTikTokEventGroup | null> {
  const window = await resolveCanonicalTikTokWindow(
    supabase,
    {
      id: event.id,
      kind: event.kind,
      event_date: event.event_date,
      event_start_at: event.event_start_at,
      campaign_end_at: event.campaign_end_at,
    },
    now,
  );
  if (window.source !== "computed") return null;

  const snapshot = await readActiveTikTokCreativesSnapshot(
    supabase,
    event.id,
    { since: window.since, until: window.until },
    { now },
  );
  if (!snapshot) return null;

  const delivering = snapshot.rows.filter(
    (row) => (row.cost ?? 0) > 0 || (row.impressions ?? 0) > 0,
  );
  const cards = groupTikTokCreatives(delivering.map(toCreativeInput)).map(
    tiktokCardFromGroup,
  );
  if (cards.length === 0) return null;

  return {
    event_id: event.id,
    event_name: event.name ?? "",
    window: { since: window.since, until: window.until },
    fetched_at: snapshot.fetchedAt.toISOString(),
    cards,
  };
}

function toCreativeInput(row: TikTokShareAdRow): TikTokCreativeInput {
  return {
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    spend: row.cost,
    impressions: row.impressions,
    reach: row.reach,
    clicks: row.clicks_all,
    video_views_2s: row.video_views_2s,
    video_views_6s: row.video_views_6s,
    video_views_100p: row.video_views_p100,
    thumbnail_url: row.thumbnail_url,
    deeplink_url: row.deeplink_url,
    video_id: row.video_id ?? null,
  };
}
