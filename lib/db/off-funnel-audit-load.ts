import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canonicalLandingPageUrl,
  resolveCanonicalLandingPage,
} from "@/lib/landing-pages/canonical-url";
import { assembleEventLandingPageRecord } from "@/lib/landing-pages/event-lookup";
import {
  selectOffFunnelAuditRows,
  type EventLandingPageRef,
  type LiveCampaignDestination,
  type OffFunnelAuditRow,
} from "@/lib/dashboard/off-funnel-audit";
import {
  liveDestinationsFromMetaSnapshot,
  liveDestinationsFromTikTokAds,
  type MetaSnapshotPayloadSlice,
} from "@/lib/dashboard/off-funnel-candidates";

/**
 * Load the off-funnel audit from cached snapshots + page_events.
 * Zero new Meta/TikTok reads.
 */

function firstEmbed<T extends Record<string, unknown>>(
  value: unknown,
): T | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as T) : null;
  }
  if (typeof value === "object") return value as T;
  return null;
}

async function loadLandingPageRefs(
  supabase: SupabaseClient,
  eventIds: string[],
  publicOrigin: string,
): Promise<Record<string, EventLandingPageRef>> {
  const out: Record<string, EventLandingPageRef> = {};
  if (eventIds.length === 0) return out;

  const { data, error } = await supabase
    .from("events")
    .select("id, name, slug, clients ( slug ), page_events ( id )")
    .in("id", eventIds);
  if (error) {
    throw new Error(`[off-funnel-audit] event lookup failed: ${error.message}`);
  }

  for (const row of data ?? []) {
    const raw = row as {
      id: string;
      name: string;
      slug: string | null;
      clients: unknown;
      page_events: unknown;
    };
    const client = firstEmbed<{ slug?: string | null }>(raw.clients);
    const page = firstEmbed<{ id?: string | null }>(raw.page_events);
    const record = assembleEventLandingPageRecord({
      eventId: raw.id,
      eventSlug: raw.slug,
      clientSlug: client?.slug ?? null,
      pageEventId: page?.id ?? null,
      customHost: null,
    });
    const resolved = record
      ? resolveCanonicalLandingPage({
          hasPage: record.hasPage,
          clientSlug: record.clientSlug,
          eventSlug: record.eventSlug,
          publicOrigin,
          customHost: record.customHost,
        })
      : { kind: "none" as const };
    out[raw.id] = {
      eventId: raw.id,
      eventName: raw.name,
      eventPageUrl: canonicalLandingPageUrl(resolved),
    };
  }
  return out;
}

async function loadMetaLive(
  supabase: SupabaseClient,
  eventId: string,
  eventName: string,
): Promise<LiveCampaignDestination[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from("active_creatives_snapshots")
    .select("payload, fetched_at")
    .eq("event_id", eventId)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[off-funnel-audit] meta snapshot read failed", error.message);
    return [];
  }
  if (!data) return [];
  return liveDestinationsFromMetaSnapshot(
    data.payload as MetaSnapshotPayloadSlice,
    { eventId, eventName },
  );
}

async function loadTikTokLive(
  supabase: SupabaseClient,
  eventId: string,
  eventName: string,
): Promise<LiveCampaignDestination[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as unknown as any;
  const { data, error } = await sb
    .from("tiktok_active_creatives_snapshots")
    .select("campaign_id, campaign_name, deeplink_url, spend, status, fetched_at, window_since, window_until")
    .eq("event_id", eventId)
    .eq("kind", "ok")
    .order("fetched_at", { ascending: false })
    .limit(400);
  if (error) {
    console.warn("[off-funnel-audit] tiktok snapshot read failed", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{
    campaign_id: string | null;
    campaign_name: string | null;
    deeplink_url: string | null;
    spend: number | string | null;
    status: string | null;
    fetched_at: string;
    window_since: string;
    window_until: string;
  }>;
  if (rows.length === 0) return [];
  const latestWindow = `${rows[0].window_since}|${rows[0].window_until}`;
  const latest = rows.filter(
    (r) => `${r.window_since}|${r.window_until}` === latestWindow,
  );
  return liveDestinationsFromTikTokAds(latest, { eventId, eventName });
}

export async function loadOffFunnelAuditForEvent(
  supabase: SupabaseClient,
  eventId: string,
  publicOrigin: string,
): Promise<OffFunnelAuditRow[]> {
  const lpByEventId = await loadLandingPageRefs(
    supabase,
    [eventId],
    publicOrigin,
  );
  const eventName = lpByEventId[eventId]?.eventName ?? "";
  const [meta, tiktok] = await Promise.all([
    loadMetaLive(supabase, eventId, eventName),
    loadTikTokLive(supabase, eventId, eventName),
  ]);
  return selectOffFunnelAuditRows([...meta, ...tiktok], lpByEventId);
}
