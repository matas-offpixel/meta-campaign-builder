/**
 * Re-resolve a queue row's venue from asset_name + sheet location.
 * Used at prepare time when resolved_event_code was cleared or never set.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { listVenueMappings } from "@/lib/db/venue-mappings";

import {
  resolveVenue,
  type EventVenueContext,
  type VenueMapping,
} from "./venue-resolve";

export interface QueueVenueResolution {
  resolvedEventId: string | null;
  resolvedEventCode: string;
  eventMatchAmbiguous: boolean;
}

export interface ResolvedEventContext {
  id: string;
  name: string | null;
  event_code: string;
  venue_name: string | null;
  venue_city: string | null;
}

export async function resolveQueueRowVenue(
  supabase: SupabaseClient,
  clientId: string,
  row: {
    asset_name: string | null;
    location: string | null;
    nation: string | null;
    resolved_event_codes_multi: string[] | null;
  },
): Promise<QueueVenueResolution | null> {
  if (row.resolved_event_codes_multi?.length) return null;

  const location = row.location?.trim() ?? "";
  if (!location || location.toLowerCase() === "all") return null;

  const dbMappings = await listVenueMappings(clientId);
  const typedMappings: VenueMapping[] = dbMappings.map((m) => ({
    id: m.id,
    clientId: m.client_id,
    sheetLabel: m.sheet_label,
    eventCode: m.event_code,
    nationLabel: m.nation_label,
  }));

  const mappedEventCodes = [...new Set(typedMappings.map((m) => m.eventCode))];
  if (mappedEventCodes.length === 0) return null;

  const { data: events } = await supabase
    .from("events")
    .select("id, event_code, venue_name, venue_city, venue_country")
    .eq("client_id", clientId)
    .in("event_code", mappedEventCodes);

  const eventCodeToId = new Map<string, string>();
  const eventVenueContexts: EventVenueContext[] = [];
  for (const e of events ?? []) {
    eventCodeToId.set(e.event_code, e.id);
    eventVenueContexts.push({
      eventCode: e.event_code,
      venueName: e.venue_name,
      venueCity: e.venue_city,
      venueCountry: e.venue_country,
    });
  }

  const resolved = resolveVenue(location, typedMappings, {
    assetName: row.asset_name ?? "",
    events: eventVenueContexts,
  });
  if (!resolved || resolved.isUmbrella) return null;

  return {
    resolvedEventId: eventCodeToId.get(resolved.eventCode) ?? null,
    resolvedEventCode: resolved.eventCode,
    eventMatchAmbiguous: resolved.eventMatchAmbiguous,
  };
}

/** Load event ground-truth by id or event_code (prepare + bulk-attach fallbacks). */
export async function loadResolvedEventContext(
  supabase: SupabaseClient,
  clientId: string,
  resolvedEventId: string | null,
  resolvedEventCode: string | null,
): Promise<ResolvedEventContext | null> {
  if (resolvedEventId) {
    const { data } = await supabase
      .from("events")
      .select("id, name, event_code, venue_name, venue_city")
      .eq("id", resolvedEventId)
      .maybeSingle();
    return data;
  }

  if (resolvedEventCode) {
    const { data } = await supabase
      .from("events")
      .select("id, name, event_code, venue_name, venue_city")
      .eq("client_id", clientId)
      .eq("event_code", resolvedEventCode)
      .maybeSingle();
    return data;
  }

  return null;
}
