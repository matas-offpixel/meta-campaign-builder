// ─────────────────────────────────────────────────────────────────────────────
// Intelligence-layer domain types.
//
// Manual definitions because migration 020 hasn't been applied yet — these
// stand in until `supabase gen types` is re-run, at which point the helpers
// in lib/db/{venues,artists,event-artists,creative-tags,audience-seeds}.ts
// can switch to `Tables<"venues">` etc. directly.
//
// TODO(post-020): drop the manual definitions and re-export the generated
// types after migration 020 is applied.
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueRow {
  id: string;
  user_id: string;
  name: string;
  city: string;
  country: string;
  capacity: number | null;
  address: string | null;
  meta_page_id: string | null;
  meta_page_name: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type VenueInsert = Omit<VenueRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type VenueUpdate = Partial<Omit<VenueRow, "id" | "user_id" | "created_at" | "updated_at">>;

export interface ArtistRow {
  id: string;
  user_id: string;
  name: string;
  genres: string[];
  meta_page_id: string | null;
  meta_page_name: string | null;
  instagram_handle: string | null;
  spotify_id: string | null;
  website: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type ArtistInsert = Omit<ArtistRow, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type ArtistUpdate = Partial<Omit<ArtistRow, "id" | "user_id" | "created_at" | "updated_at">>;

export interface EventArtistRow {
  id: string;
  event_id: string;
  artist_id: string;
  user_id: string;
  is_headliner: boolean;
  billing_order: number;
  created_at: string;
}

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

/** Per-ad shape returned by /api/intelligence/creatives. */
export interface CreativeInsightRow {
  adId: string;
  adName: string;
  status: string | null;
  campaignId: string | null;
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
