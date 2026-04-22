// ─────────────────────────────────────────────────────────────────────────────
// Intelligence-layer domain types.
//
// Tables that map 1:1 onto the generated Supabase schema (venues, artists,
// event_artists) re-export `Tables<"...">` directly so the row shape stays
// in lockstep with `database.types.ts` after each `supabase gen types` run.
//
// Tables with CHECK-constrained text columns or JSON payloads
// (creative_tags.tag_type, audience_seeds.filters) keep manual narrowed
// shapes — Supabase serialises those as plain `string`/`Json`, which
// throws away the discriminated unions the UI depends on.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/lib/db/database.types";

export type VenueRow = Tables<"venues">;
export type VenueInsert = TablesInsert<"venues">;
export type VenueUpdate = TablesUpdate<"venues">;

export type ArtistRow = Tables<"artists">;
export type ArtistInsert = TablesInsert<"artists">;
export type ArtistUpdate = TablesUpdate<"artists">;

export type EventArtistRow = Tables<"event_artists">;

/** Joined shape returned by listEventArtists — artist columns flattened in. */
export interface EventArtistJoined {
  id: string;
  event_id: string;
  artist_id: string;
  is_headliner: boolean;
  billing_order: number;
  artist_name: string;
  genres: string[];
  meta_page_id: string | null;
  meta_page_name: string | null;
}

export type CreativeTagType = "format" | "hook" | "genre" | "style" | "asset_type";

export interface CreativeTagRow {
  id: string;
  user_id: string;
  event_id: string | null;
  meta_ad_id: string;
  meta_creative_id: string | null;
  tag_type: CreativeTagType;
  tag_value: string;
  created_at: string;
}

export type CreativeTagInsert = Omit<CreativeTagRow, "id" | "created_at"> & {
  id?: string;
  created_at?: string;
};

/** Filter-set payload stored on audience_seeds.filters. JSON-serialisable. */
export interface AudienceSeedFilters {
  eventIds?: string[];
  artistIds?: string[];
  venueIds?: string[];
  genres?: string[];
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface AudienceSeedRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  filters: AudienceSeedFilters;
  meta_custom_audience_id: string | null;
  created_at: string;
  updated_at: string;
}

export type AudienceSeedInsert = {
  user_id: string;
  name: string;
  description?: string | null;
  filters?: AudienceSeedFilters;
  meta_custom_audience_id?: string | null;
};

export type AudienceSeedUpdate = Partial<{
  name: string;
  description: string | null;
  filters: AudienceSeedFilters;
  meta_custom_audience_id: string | null;
}>;

/**
 * Date window passed through from the UI to /api/intelligence/creatives.
 * Mirrors Meta Graph's `date_preset` enum 1:1 — keeping the same string
 * values means the value can flow straight through to Meta without an
 * extra mapping table.
 */
export type CreativeDatePreset =
  | "today"
  | "yesterday"
  | "last_3d"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "maximum";

/** Per-ad shape returned by /api/intelligence/creatives. */
export interface CreativeInsightRow {
  adId: string;
  adName: string;
  status: string | null;
  campaignId: string | null;
  /** Human-readable campaign name (added in H1 so H3 can filter). */
  campaignName: string | null;
  /**
   * Meta campaign objective string, e.g. `OUTCOME_LEADS`,
   * `OUTCOME_SALES`, `LINK_CLICKS`. Pulled verbatim from Meta — the
   * group-mapping (leads / sales / traffic / awareness / engagement /
   * other) lives in `lib/intelligence/objective-metrics.ts` (H3) so
   * we never embed business rules in the wire shape.
   */
  campaignObjective: string | null;
  adsetId: string | null;
  creativeId: string | null;
  creativeName: string | null;
  thumbnailUrl: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  frequency: number;
  reach: number;
  linkClicks: number;
  purchases: number;
  /**
   * Sum of registration-flavoured Meta action types
   * (`complete_registration`, `lead`, `registration`, `view_content`).
   * Added in H1 so the cache table can answer "which lead-objective
   * ads are converting" without a second Graph round-trip.
   */
  registrations: number;
  /** Cost per link click. null when linkClicks is 0. */
  cpl: number | null;
  fatigueScore: "ok" | "warning" | "critical";
  tags: { id: string; type: CreativeTagType; value: string }[];
}

/** Compact event row returned by /api/intelligence/audiences. */
export interface AudienceEventSummary {
  id: string;
  name: string;
  client_id: string | null;
  client_name: string | null;
  event_date: string | null;
  capacity: number | null;
  venue_name: string | null;
  venue_city: string | null;
  genres: string[];
  artists: { name: string; isHeadliner: boolean }[];
  status: string;
}

export interface AudienceQueryResponse {
  events: AudienceEventSummary[];
  totalCapacity: number;
  genreBreakdown: Record<string, number>;
  geoBreakdown: Record<string, number>;
}
