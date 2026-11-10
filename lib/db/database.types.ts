// Generated from the production schema (supabase gen types --project-id
// zbtldbfjbhfvpksmdvnt; 218 applied), then migration 219 (Drive pickup and
// share, not applied yet) added by hand from its SQL. The two copy-library
// tables (migrations 207 and 213) are left out on purpose: public routes
// import this file, and
// lib/learning/__tests__/cross-client-guard.test.ts keeps their names out of
// anything those routes can reach.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      active_creatives_snapshots: {
        Row: {
          build_version: string | null
          created_at: string
          custom_since: string | null
          custom_until: string | null
          date_preset: string
          event_id: string
          expires_at: string
          fetched_at: string
          id: string
          is_stale: boolean
          last_refresh_error: string | null
          payload: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          build_version?: string | null
          created_at?: string
          custom_since?: string | null
          custom_until?: string | null
          date_preset: string
          event_id: string
          expires_at: string
          fetched_at?: string
          id?: string
          is_stale?: boolean
          last_refresh_error?: string | null
          payload: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          build_version?: string | null
          created_at?: string
          custom_since?: string | null
          custom_until?: string | null
          date_preset?: string
          event_id?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          is_stale?: boolean
          last_refresh_error?: string | null
          payload?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_creatives_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "active_creatives_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_copy: {
        Row: {
          ad_account_id: string
          bodies: string[]
          call_to_action: string | null
          creative_id: string | null
          descriptions: string[]
          effective_object_story_id: string | null
          fetched_at: string
          link_caption: string | null
          meta_ad_id: string
          source: string
          titles: string[]
        }
        Insert: {
          ad_account_id: string
          bodies?: string[]
          call_to_action?: string | null
          creative_id?: string | null
          descriptions?: string[]
          effective_object_story_id?: string | null
          fetched_at?: string
          link_caption?: string | null
          meta_ad_id: string
          source: string
          titles?: string[]
        }
        Update: {
          ad_account_id?: string
          bodies?: string[]
          call_to_action?: string | null
          creative_id?: string | null
          descriptions?: string[]
          effective_object_story_id?: string | null
          fetched_at?: string
          link_caption?: string | null
          meta_ad_id?: string
          source?: string
          titles?: string[]
        }
        Relationships: []
      }
      ad_daily_insights: {
        Row: {
          actions: Json
          ad_account_id: string
          ad_name: string | null
          adset_name: string | null
          campaign_name: string | null
          campaign_objective: string | null
          clicks: number
          date: string
          fetched_at: string
          id: string
          impressions: number
          landing_page_views: number
          leads: number
          link_clicks: number
          meta_ad_id: string
          meta_adset_id: string | null
          meta_campaign_id: string | null
          optimization_goal: string | null
          promoted_event: string | null
          purchases: number
          reach: number
          registrations: number
          result_action_type: string | null
          spend: number
          video_plays_15s: number
          video_plays_3s: number
          video_plays_p100: number
        }
        Insert: {
          actions?: Json
          ad_account_id: string
          ad_name?: string | null
          adset_name?: string | null
          campaign_name?: string | null
          campaign_objective?: string | null
          clicks?: number
          date: string
          fetched_at?: string
          id?: string
          impressions?: number
          landing_page_views?: number
          leads?: number
          link_clicks?: number
          meta_ad_id: string
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          optimization_goal?: string | null
          promoted_event?: string | null
          purchases?: number
          reach?: number
          registrations?: number
          result_action_type?: string | null
          spend?: number
          video_plays_15s?: number
          video_plays_3s?: number
          video_plays_p100?: number
        }
        Update: {
          actions?: Json
          ad_account_id?: string
          ad_name?: string | null
          adset_name?: string | null
          campaign_name?: string | null
          campaign_objective?: string | null
          clicks?: number
          date?: string
          fetched_at?: string
          id?: string
          impressions?: number
          landing_page_views?: number
          leads?: number
          link_clicks?: number
          meta_ad_id?: string
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          optimization_goal?: string | null
          promoted_event?: string | null
          purchases?: number
          reach?: number
          registrations?: number
          result_action_type?: string | null
          spend?: number
          video_plays_15s?: number
          video_plays_3s?: number
          video_plays_p100?: number
        }
        Relationships: []
      }
      ad_plan_audiences: {
        Row: {
          age_max: number | null
          age_min: number | null
          audience_name: string | null
          city: string | null
          created_at: string
          daily_budget: number | null
          geo_bucket: string | null
          id: string
          info: string | null
          location: string | null
          objective: string
          placements: string[]
          plan_id: string
          proximity_km: number | null
          sort_order: number
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          audience_name?: string | null
          city?: string | null
          created_at?: string
          daily_budget?: number | null
          geo_bucket?: string | null
          id?: string
          info?: string | null
          location?: string | null
          objective: string
          placements?: string[]
          plan_id: string
          proximity_km?: number | null
          sort_order?: number
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          audience_name?: string | null
          city?: string | null
          created_at?: string
          daily_budget?: number | null
          geo_bucket?: string | null
          id?: string
          info?: string | null
          location?: string | null
          objective?: string
          placements?: string[]
          plan_id?: string
          proximity_km?: number | null
          sort_order?: number
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_plan_audiences_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ad_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_plan_days: {
        Row: {
          allocation_pct: number | null
          created_at: string
          day: string
          id: string
          notes: string | null
          objective_budgets: Json
          phase_marker: string | null
          plan_id: string
          ticket_target: number | null
          tickets_sold_cumulative: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          allocation_pct?: number | null
          created_at?: string
          day: string
          id?: string
          notes?: string | null
          objective_budgets?: Json
          phase_marker?: string | null
          plan_id: string
          ticket_target?: number | null
          tickets_sold_cumulative?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          allocation_pct?: number | null
          created_at?: string
          day?: string
          id?: string
          notes?: string | null
          objective_budgets?: Json
          phase_marker?: string | null
          plan_id?: string
          ticket_target?: number | null
          tickets_sold_cumulative?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_plan_days_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "ad_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_plan_templates: {
        Row: {
          created_at: string
          id: string
          name: string
          snapshot_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          snapshot_json: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          snapshot_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ad_plans: {
        Row: {
          created_at: string
          end_date: string
          event_id: string
          id: string
          landing_page_url: string | null
          legacy_spend: number | null
          name: string
          notes: string | null
          start_date: string
          status: string
          ticket_target: number | null
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          event_id: string
          id?: string
          landing_page_url?: string | null
          legacy_spend?: number | null
          name: string
          notes?: string | null
          start_date: string
          status?: string
          ticket_target?: number | null
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          event_id?: string
          id?: string
          landing_page_url?: string | null
          legacy_spend?: number | null
          name?: string
          notes?: string | null
          start_date?: string
          status?: string
          ticket_target?: number | null
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ad_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      additional_spend_entries: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["additional_spend_category"]
          created_at: string
          date: string
          event_id: string
          id: string
          label: string
          notes: string | null
          scope: string
          updated_at: string
          user_id: string
          venue_event_code: string | null
        }
        Insert: {
          amount: number
          category?: Database["public"]["Enums"]["additional_spend_category"]
          created_at?: string
          date: string
          event_id: string
          id?: string
          label?: string
          notes?: string | null
          scope?: string
          updated_at?: string
          user_id: string
          venue_event_code?: string | null
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["additional_spend_category"]
          created_at?: string
          date?: string
          event_id?: string
          id?: string
          label?: string
          notes?: string | null
          scope?: string
          updated_at?: string
          user_id?: string
          venue_event_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "additional_spend_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "additional_spend_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      additional_ticket_entries: {
        Row: {
          created_at: string | null
          date: string | null
          event_id: string
          id: string
          label: string
          notes: string | null
          revenue_amount: number | null
          scope: string
          source: string | null
          tickets_count: number
          tier_name: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          event_id: string
          id?: string
          label: string
          notes?: string | null
          revenue_amount?: number | null
          scope: string
          source?: string | null
          tickets_count: number
          tier_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string | null
          event_id?: string
          id?: string
          label?: string
          notes?: string | null
          revenue_amount?: number | null
          scope?: string
          source?: string | null
          tickets_count?: number
          tier_name?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "additional_ticket_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "additional_ticket_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          bandcamp_url: string | null
          beatport_url: string | null
          created_at: string
          enriched_at: string | null
          facebook_page_url: string | null
          genres: string[]
          id: string
          instagram_handle: string | null
          meta_page_id: string | null
          meta_page_name: string | null
          musicbrainz_id: string | null
          name: string
          notes: string | null
          popularity_score: number | null
          profile_image_url: string | null
          profile_jsonb: Json
          soundcloud_url: string | null
          spotify_id: string | null
          tiktok_handle: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          bandcamp_url?: string | null
          beatport_url?: string | null
          created_at?: string
          enriched_at?: string | null
          facebook_page_url?: string | null
          genres?: string[]
          id?: string
          instagram_handle?: string | null
          meta_page_id?: string | null
          meta_page_name?: string | null
          musicbrainz_id?: string | null
          name: string
          notes?: string | null
          popularity_score?: number | null
          profile_image_url?: string | null
          profile_jsonb?: Json
          soundcloud_url?: string | null
          spotify_id?: string | null
          tiktok_handle?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          bandcamp_url?: string | null
          beatport_url?: string | null
          created_at?: string
          enriched_at?: string | null
          facebook_page_url?: string | null
          genres?: string[]
          id?: string
          instagram_handle?: string | null
          meta_page_id?: string | null
          meta_page_name?: string | null
          musicbrainz_id?: string | null
          name?: string
          notes?: string | null
          popularity_score?: number | null
          profile_image_url?: string | null
          profile_jsonb?: Json
          soundcloud_url?: string | null
          spotify_id?: string | null
          tiktok_handle?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      attribution_order_matches: {
        Row: {
          client_id: string
          confidence_score: number | null
          event_id: string
          id: string
          match_strategy: string
          matched_at: string | null
          purchase_event_id: string
          touchpoint_id: string | null
        }
        Insert: {
          client_id: string
          confidence_score?: number | null
          event_id: string
          id?: string
          match_strategy: string
          matched_at?: string | null
          purchase_event_id: string
          touchpoint_id?: string | null
        }
        Update: {
          client_id?: string
          confidence_score?: number | null
          event_id?: string
          id?: string
          match_strategy?: string
          matched_at?: string | null
          purchase_event_id?: string
          touchpoint_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attribution_order_matches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_order_matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "attribution_order_matches_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_order_matches_purchase_event_id_fkey"
            columns: ["purchase_event_id"]
            isOneToOne: true
            referencedRelation: "ticketing_purchase_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attribution_order_matches_touchpoint_id_fkey"
            columns: ["touchpoint_id"]
            isOneToOne: false
            referencedRelation: "meta_click_touchpoints"
            referencedColumns: ["id"]
          },
        ]
      }
      audience_seeds: {
        Row: {
          created_at: string
          description: string | null
          filters: Json
          id: string
          meta_custom_audience_id: string | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          meta_custom_audience_id?: string | null
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          meta_custom_audience_id?: string | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      audience_source_cache: {
        Row: {
          build_version: string | null
          cache_key: string
          client_id: string
          expires_at: string
          fetched_at: string
          id: string
          payload: Json
          payload_size_bytes: number | null
          source_kind: string
          user_id: string
        }
        Insert: {
          build_version?: string | null
          cache_key: string
          client_id: string
          expires_at: string
          fetched_at?: string
          id?: string
          payload: Json
          payload_size_bytes?: number | null
          source_kind: string
          user_id: string
        }
        Update: {
          build_version?: string | null
          cache_key?: string
          client_id?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          payload?: Json
          payload_size_bytes?: number | null
          source_kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audience_source_cache_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_tag_thumbnail_url_index: {
        Row: {
          content_hash: string
          content_type: string
          created_at: string
          url_hash: string
        }
        Insert: {
          content_hash: string
          content_type: string
          created_at?: string
          url_hash: string
        }
        Update: {
          content_hash?: string
          content_type?: string
          created_at?: string
          url_hash?: string
        }
        Relationships: []
      }
      benchmark_alerts: {
        Row: {
          acknowledged_at: string | null
          alert_type: string
          benchmark_value: number | null
          client_id: string
          deviation_pct: number | null
          entity_id: string
          entity_name: string | null
          entity_type: string
          event_id: string | null
          id: string
          metric: string | null
          metric_value: number | null
          severity: string
          status: string
          surfaced_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          alert_type: string
          benchmark_value?: number | null
          client_id: string
          deviation_pct?: number | null
          entity_id: string
          entity_name?: string | null
          entity_type: string
          event_id?: string | null
          id?: string
          metric?: string | null
          metric_value?: number | null
          severity: string
          status?: string
          surfaced_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          alert_type?: string
          benchmark_value?: number | null
          client_id?: string
          deviation_pct?: number | null
          entity_id?: string
          entity_name?: string | null
          entity_type?: string
          event_id?: string | null
          id?: string
          metric?: string | null
          metric_value?: number | null
          severity?: string
          status?: string
          surfaced_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "benchmark_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "benchmark_alerts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      bm_ad_accounts: {
        Row: {
          account_id: string | null
          account_status: number | null
          ad_account_id: string
          business_id: string
          currency: string | null
          disable_reason: number | null
          first_seen_at: string
          id: string
          is_owned_by_bm: boolean
          last_seen_at: string
          name: string | null
          timezone_name: string | null
          user_has_access: boolean
          user_tasks: string[]
        }
        Insert: {
          account_id?: string | null
          account_status?: number | null
          ad_account_id: string
          business_id: string
          currency?: string | null
          disable_reason?: number | null
          first_seen_at?: string
          id?: string
          is_owned_by_bm?: boolean
          last_seen_at?: string
          name?: string | null
          timezone_name?: string | null
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Update: {
          account_id?: string | null
          account_status?: number | null
          ad_account_id?: string
          business_id?: string
          currency?: string | null
          disable_reason?: number | null
          first_seen_at?: string
          id?: string
          is_owned_by_bm?: boolean
          last_seen_at?: string
          name?: string | null
          timezone_name?: string | null
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bm_ad_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "client_business_managers"
            referencedColumns: ["business_id"]
          },
        ]
      }
      bm_ig_accounts: {
        Row: {
          business_id: string
          first_seen_at: string
          followers: number | null
          id: string
          ig_asset_id: string
          ig_user_id: string | null
          ig_username: string | null
          is_owned_by_bm: boolean
          last_seen_at: string
          media_count: number | null
          profile_pic_url: string | null
          user_has_access: boolean
          user_tasks: string[]
        }
        Insert: {
          business_id: string
          first_seen_at?: string
          followers?: number | null
          id?: string
          ig_asset_id: string
          ig_user_id?: string | null
          ig_username?: string | null
          is_owned_by_bm?: boolean
          last_seen_at?: string
          media_count?: number | null
          profile_pic_url?: string | null
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Update: {
          business_id?: string
          first_seen_at?: string
          followers?: number | null
          id?: string
          ig_asset_id?: string
          ig_user_id?: string | null
          ig_username?: string | null
          is_owned_by_bm?: boolean
          last_seen_at?: string
          media_count?: number | null
          profile_pic_url?: string | null
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bm_ig_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "client_business_managers"
            referencedColumns: ["business_id"]
          },
        ]
      }
      bm_page_access_events: {
        Row: {
          action: string
          asset_id: string | null
          asset_type: string
          at: string
          business_id: string
          detail: Json
          id: string
          page_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          asset_id?: string | null
          asset_type?: string
          at?: string
          business_id: string
          detail?: Json
          id?: string
          page_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          asset_id?: string | null
          asset_type?: string
          at?: string
          business_id?: string
          detail?: Json
          id?: string
          page_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bm_pages: {
        Row: {
          avatar_url: string | null
          business_id: string
          category: string | null
          first_seen_at: string
          followers: number | null
          id: string
          is_owned_by_bm: boolean
          last_grant_at: string | null
          last_grant_requested_tasks: string[] | null
          last_seen_at: string
          page_id: string
          page_name: string | null
          user_has_access: boolean
          user_tasks: string[]
        }
        Insert: {
          avatar_url?: string | null
          business_id: string
          category?: string | null
          first_seen_at?: string
          followers?: number | null
          id?: string
          is_owned_by_bm?: boolean
          last_grant_at?: string | null
          last_grant_requested_tasks?: string[] | null
          last_seen_at?: string
          page_id: string
          page_name?: string | null
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Update: {
          avatar_url?: string | null
          business_id?: string
          category?: string | null
          first_seen_at?: string
          followers?: number | null
          id?: string
          is_owned_by_bm?: boolean
          last_grant_at?: string | null
          last_grant_requested_tasks?: string[] | null
          last_seen_at?: string
          page_id?: string
          page_name?: string | null
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bm_pages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "client_business_managers"
            referencedColumns: ["business_id"]
          },
        ]
      }
      bm_pixels: {
        Row: {
          business_id: string
          creation_time: string | null
          data_use_setting: string | null
          enable_automatic_matching: boolean | null
          first_seen_at: string
          id: string
          is_owned_by_bm: boolean
          is_unavailable: boolean | null
          last_fired_time: string | null
          last_seen_at: string
          name: string | null
          pixel_id: string
          user_has_access: boolean
          user_tasks: string[]
        }
        Insert: {
          business_id: string
          creation_time?: string | null
          data_use_setting?: string | null
          enable_automatic_matching?: boolean | null
          first_seen_at?: string
          id?: string
          is_owned_by_bm?: boolean
          is_unavailable?: boolean | null
          last_fired_time?: string | null
          last_seen_at?: string
          name?: string | null
          pixel_id: string
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Update: {
          business_id?: string
          creation_time?: string | null
          data_use_setting?: string | null
          enable_automatic_matching?: boolean | null
          first_seen_at?: string
          id?: string
          is_owned_by_bm?: boolean
          is_unavailable?: boolean | null
          last_fired_time?: string | null
          last_seen_at?: string
          name?: string | null
          pixel_id?: string
          user_has_access?: boolean
          user_tasks?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "bm_pixels_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "client_business_managers"
            referencedColumns: ["business_id"]
          },
        ]
      }
      bulk_attach_drafts: {
        Row: {
          client_id: string | null
          created_at: string
          event_id: string | null
          id: string
          last_used_at: string
          name: string
          state: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          last_used_at?: string
          name?: string
          state?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          last_used_at?: string
          name?: string
          state?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_attach_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_attach_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "bulk_attach_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_attach_templates: {
        Row: {
          client_id: string | null
          created_at: string
          creative_config: Json
          description: string | null
          id: string
          match_pattern: Json
          name: string
          updated_at: string
          use_count: number
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          creative_config?: Json
          description?: string | null
          id?: string
          match_pattern?: Json
          name: string
          updated_at?: string
          use_count?: number
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          creative_config?: Json
          description?: string | null
          id?: string
          match_pattern?: Json
          name?: string
          updated_at?: string
          use_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_attach_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_automation_decisions: {
        Row: {
          action_delta: number | null
          action_recommended: string
          ad_account_id: string
          adset_id: string
          applied: boolean
          applied_at: string | null
          budget_after_pence: number
          budget_before_pence: number
          campaign_id: string
          channel: string
          decided_at: string
          draft_id: string | null
          dry_run: boolean
          guardrail_note: string | null
          id: string
          meta_response_json: Json | null
          metric: string
          metric_value: number | null
          metric_window: string
          reason_text: string | null
          rule_matched: string | null
          scope: string
        }
        Insert: {
          action_delta?: number | null
          action_recommended: string
          ad_account_id: string
          adset_id: string
          applied?: boolean
          applied_at?: string | null
          budget_after_pence: number
          budget_before_pence: number
          campaign_id: string
          channel?: string
          decided_at?: string
          draft_id?: string | null
          dry_run?: boolean
          guardrail_note?: string | null
          id?: string
          meta_response_json?: Json | null
          metric: string
          metric_value?: number | null
          metric_window: string
          reason_text?: string | null
          rule_matched?: string | null
          scope?: string
        }
        Update: {
          action_delta?: number | null
          action_recommended?: string
          ad_account_id?: string
          adset_id?: string
          applied?: boolean
          applied_at?: string | null
          budget_after_pence?: number
          budget_before_pence?: number
          campaign_id?: string
          channel?: string
          decided_at?: string
          draft_id?: string | null
          dry_run?: boolean
          guardrail_note?: string | null
          id?: string
          meta_response_json?: Json | null
          metric?: string
          metric_value?: number | null
          metric_window?: string
          reason_text?: string | null
          rule_matched?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_automation_decisions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "campaign_drafts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_drafts: {
        Row: {
          ad_account_id: string | null
          client_id: string | null
          created_at: string
          draft_json: Json
          event_id: string | null
          id: string
          name: string | null
          objective: string | null
          optimisation_automation_enabled: boolean
          optimisation_automation_live: boolean
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          client_id?: string | null
          created_at?: string
          draft_json?: Json
          event_id?: string | null
          id?: string
          name?: string | null
          objective?: string | null
          optimisation_automation_enabled?: boolean
          optimisation_automation_live?: boolean
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          client_id?: string | null
          created_at?: string
          draft_json?: Json
          event_id?: string | null
          id?: string
          name?: string | null
          objective?: string | null
          optimisation_automation_enabled?: boolean
          optimisation_automation_live?: boolean
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "campaign_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_asset_routes: {
        Row: {
          asset_id: string
          channel: string
          created_at: string
          derived_creative_id: string | null
          enabled: boolean
          plan_id: string
          updated_at: string
          upload_error: string | null
          upload_status: string
          user_id: string
        }
        Insert: {
          asset_id: string
          channel: string
          created_at?: string
          derived_creative_id?: string | null
          enabled?: boolean
          plan_id: string
          updated_at?: string
          upload_error?: string | null
          upload_status?: string
          user_id: string
        }
        Update: {
          asset_id?: string
          channel?: string
          created_at?: string
          derived_creative_id?: string | null
          enabled?: boolean
          plan_id?: string
          updated_at?: string
          upload_error?: string | null
          upload_status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_asset_routes_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_asset_routes_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_copy: {
        Row: {
          created_at: string
          fetch_error: string | null
          model: string | null
          page_text: string | null
          plan_id: string
          selected_ids: Json
          source_url: string | null
          suggestions: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fetch_error?: string | null
          model?: string | null
          page_text?: string | null
          plan_id: string
          selected_ids?: Json
          source_url?: string | null
          suggestions?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          fetch_error?: string | null
          model?: string | null
          page_text?: string | null
          plan_id?: string
          selected_ids?: Json
          source_url?: string | null
          suggestions?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_copy_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_creative_group_members: {
        Row: {
          asset_id: string
          group_id: string
          plan_id: string
          position: number
          user_id: string
        }
        Insert: {
          asset_id: string
          group_id: string
          plan_id: string
          position?: number
          user_id: string
        }
        Update: {
          asset_id?: string
          group_id?: string
          plan_id?: string
          position?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_creative_group_members_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_creative_group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_creative_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_creative_group_members_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_creative_groups: {
        Row: {
          created_at: string
          id: string
          meta_creative_id: string | null
          plan_id: string
          position: number
          sent_fingerprint: string | null
          stable_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meta_creative_id?: string | null
          plan_id: string
          position?: number
          sent_fingerprint?: string | null
          stable_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meta_creative_id?: string | null
          plan_id?: string
          position?: number
          sent_fingerprint?: string | null
          stable_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_creative_groups_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_google_launch: {
        Row: {
          created_at: string
          draft_id: string | null
          error: string | null
          launched_at: string | null
          launched_at_source: string | null
          plan_id: string
          platform_ad_account_id: string | null
          platform_campaign_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id?: string | null
          error?: string | null
          launched_at?: string | null
          launched_at_source?: string | null
          plan_id: string
          platform_ad_account_id?: string | null
          platform_campaign_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string | null
          error?: string | null
          launched_at?: string | null
          launched_at_source?: string | null
          plan_id?: string
          platform_ad_account_id?: string | null
          platform_campaign_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_google_launch_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "google_search_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_google_launch_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_intake_assets: {
        Row: {
          aspect_override: string | null
          asset_id: string
          created_at: string
          detected_bucket: string
          detected_height: number | null
          detected_width: number | null
          plan_id: string
          sort_order: number
          unreadable_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_override?: string | null
          asset_id: string
          created_at?: string
          detected_bucket: string
          detected_height?: number | null
          detected_width?: number | null
          plan_id: string
          sort_order?: number
          unreadable_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_override?: string | null
          asset_id?: string
          created_at?: string
          detected_bucket?: string
          detected_height?: number | null
          detected_width?: number | null
          plan_id?: string
          sort_order?: number
          unreadable_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_intake_assets_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_intake_assets_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_meta_launch: {
        Row: {
          created_at: string
          draft_id: string | null
          error: string | null
          launched_at: string | null
          launched_at_source: string | null
          plan_id: string
          platform_ad_account_id: string | null
          platform_campaign_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id?: string | null
          error?: string | null
          launched_at?: string | null
          launched_at_source?: string | null
          plan_id: string
          platform_ad_account_id?: string | null
          platform_campaign_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string | null
          error?: string | null
          launched_at?: string | null
          launched_at_source?: string | null
          plan_id?: string
          platform_ad_account_id?: string | null
          platform_campaign_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_meta_launch_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_meta_launch_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_predictions: {
        Row: {
          actual: number | null
          actual_at: string | null
          benchmark_rung: string | null
          closed_reason: string | null
          created_at: string
          date_range: unknown
          id: string
          line_kind: string
          metric: string
          n: number
          plan_id: string
          predicted_at: string
          runs_used: string[]
          source_kind: string
          unit: string | null
          user_id: string
          value: number
        }
        Insert: {
          actual?: number | null
          actual_at?: string | null
          benchmark_rung?: string | null
          closed_reason?: string | null
          created_at?: string
          date_range?: unknown
          id?: string
          line_kind: string
          metric: string
          n?: number
          plan_id: string
          predicted_at?: string
          runs_used?: string[]
          source_kind: string
          unit?: string | null
          user_id: string
          value: number
        }
        Update: {
          actual?: number | null
          actual_at?: string | null
          benchmark_rung?: string | null
          closed_reason?: string | null
          created_at?: string
          date_range?: unknown
          id?: string
          line_kind?: string
          metric?: string
          n?: number
          plan_id?: string
          predicted_at?: string
          runs_used?: string[]
          source_kind?: string
          unit?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_predictions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plan_templates: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          snapshot_json: Json
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          snapshot_json?: Json
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          snapshot_json?: Json
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaign_plan_tiktok_launch: {
        Row: {
          created_at: string
          draft_id: string | null
          error: string | null
          launched_at: string | null
          launched_at_source: string | null
          plan_id: string
          platform_ad_account_id: string | null
          platform_campaign_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id?: string | null
          error?: string | null
          launched_at?: string | null
          launched_at_source?: string | null
          plan_id: string
          platform_ad_account_id?: string | null
          platform_campaign_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string | null
          error?: string | null
          launched_at?: string | null
          launched_at_source?: string | null
          plan_id?: string
          platform_ad_account_id?: string | null
          platform_campaign_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plan_tiktok_launch_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "tiktok_campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_plan_tiktok_launch_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: true
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_plans: {
        Row: {
          audience_cluster_ref: string | null
          created_at: string
          creative_set_ref: string | null
          daily_budget_google: number
          daily_budget_meta: number
          daily_budget_tiktok: number
          destination_url: string
          end_date: string | null
          end_time: string | null
          event_id: string
          id: string
          name: string | null
          objective_intent: string
          phase: string | null
          start_date: string | null
          start_time: string | null
          status: string
          target_unit: string | null
          target_value: number | null
          total_daily_budget: number
          updated_at: string
          user_id: string
        }
        Insert: {
          audience_cluster_ref?: string | null
          created_at?: string
          creative_set_ref?: string | null
          daily_budget_google?: number
          daily_budget_meta?: number
          daily_budget_tiktok?: number
          destination_url: string
          end_date?: string | null
          end_time?: string | null
          event_id: string
          id?: string
          name?: string | null
          objective_intent: string
          phase?: string | null
          start_date?: string | null
          start_time?: string | null
          status?: string
          target_unit?: string | null
          target_value?: number | null
          total_daily_budget?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          audience_cluster_ref?: string | null
          created_at?: string
          creative_set_ref?: string | null
          daily_budget_google?: number
          daily_budget_meta?: number
          daily_budget_tiktok?: number
          destination_url?: string
          end_date?: string | null
          end_time?: string | null
          event_id?: string
          id?: string
          name?: string | null
          objective_intent?: string
          phase?: string | null
          start_date?: string | null
          start_time?: string | null
          status?: string
          target_unit?: string | null
          target_value?: number | null
          total_daily_budget?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "campaign_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          snapshot_json: Json
          tags: string[] | null
          template_json: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          snapshot_json?: Json
          tags?: string[] | null
          template_json?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          snapshot_json?: Json
          tags?: string[] | null
          template_json?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_asset_queue: {
        Row: {
          asset_blob_url: string | null
          asset_blob_urls: Json | null
          asset_name: string | null
          client_id: string
          confirmed_overrides: Json | null
          created_at: string
          dropbox_url: string | null
          error_message: string | null
          event_match_ambiguous: boolean | null
          funnel: string | null
          funnels: string[] | null
          generated_copy: string | null
          generated_cta: string | null
          generated_url: string | null
          id: string
          launched_meta_ad_ids: Json | null
          location: string | null
          media_file_count: number | null
          media_type: string | null
          nation: string | null
          notes: string | null
          resolved_event_code: string | null
          resolved_event_codes_multi: string[] | null
          resolved_event_id: string | null
          source_sheet_row_hash: string
          status: Database["public"]["Enums"]["asset_queue_status"]
          updated_at: string
        }
        Insert: {
          asset_blob_url?: string | null
          asset_blob_urls?: Json | null
          asset_name?: string | null
          client_id: string
          confirmed_overrides?: Json | null
          created_at?: string
          dropbox_url?: string | null
          error_message?: string | null
          event_match_ambiguous?: boolean | null
          funnel?: string | null
          funnels?: string[] | null
          generated_copy?: string | null
          generated_cta?: string | null
          generated_url?: string | null
          id?: string
          launched_meta_ad_ids?: Json | null
          location?: string | null
          media_file_count?: number | null
          media_type?: string | null
          nation?: string | null
          notes?: string | null
          resolved_event_code?: string | null
          resolved_event_codes_multi?: string[] | null
          resolved_event_id?: string | null
          source_sheet_row_hash: string
          status?: Database["public"]["Enums"]["asset_queue_status"]
          updated_at?: string
        }
        Update: {
          asset_blob_url?: string | null
          asset_blob_urls?: Json | null
          asset_name?: string | null
          client_id?: string
          confirmed_overrides?: Json | null
          created_at?: string
          dropbox_url?: string | null
          error_message?: string | null
          event_match_ambiguous?: boolean | null
          funnel?: string | null
          funnels?: string[] | null
          generated_copy?: string | null
          generated_cta?: string | null
          generated_url?: string | null
          id?: string
          launched_meta_ad_ids?: Json | null
          location?: string | null
          media_file_count?: number | null
          media_type?: string | null
          nation?: string | null
          notes?: string | null
          resolved_event_code?: string | null
          resolved_event_codes_multi?: string[] | null
          resolved_event_id?: string | null
          source_sheet_row_hash?: string
          status?: Database["public"]["Enums"]["asset_queue_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_asset_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_asset_queue_resolved_event_id_fkey"
            columns: ["resolved_event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "client_asset_queue_resolved_event_id_fkey"
            columns: ["resolved_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      client_asset_sheet_config: {
        Row: {
          client_id: string
          copy_templates: Json
          created_at: string
          cta_defaults: Json
          destination_url_pattern: Json
          google_sheet_id: string
          id: string
          last_scraped_at: string | null
          service_account_email: string | null
          sheet_range: string
          updated_at: string
        }
        Insert: {
          client_id: string
          copy_templates?: Json
          created_at?: string
          cta_defaults?: Json
          destination_url_pattern?: Json
          google_sheet_id: string
          id?: string
          last_scraped_at?: string | null
          service_account_email?: string | null
          sheet_range?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          copy_templates?: Json
          created_at?: string
          cta_defaults?: Json
          destination_url_pattern?: Json
          google_sheet_id?: string
          id?: string
          last_scraped_at?: string | null
          service_account_email?: string | null
          sheet_range?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_asset_sheet_config_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_business_managers: {
        Row: {
          access_token_encrypted: string | null
          added_by_user_id: string | null
          business_id: string
          business_name: string | null
          client_id: string | null
          created_at: string
          id: string
          last_error: string | null
          last_scanned_at: string | null
          scopes: string[]
          token_expired: boolean
          updated_at: string
        }
        Insert: {
          access_token_encrypted?: string | null
          added_by_user_id?: string | null
          business_id: string
          business_name?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_scanned_at?: string | null
          scopes?: string[]
          token_expired?: boolean
          updated_at?: string
        }
        Update: {
          access_token_encrypted?: string | null
          added_by_user_id?: string | null
          business_id?: string
          business_name?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_scanned_at?: string | null
          scopes?: string[]
          token_expired?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_business_managers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_claim_ladders: {
        Row: {
          claim_template: string
          client_id: string
          created_at: string
          id: string
          options: Json
          position: number
          trigger_kind: Database["public"]["Enums"]["claim_trigger_kind"]
          trigger_value: string
          updated_at: string
          user_id: string
        }
        Insert: {
          claim_template: string
          client_id: string
          created_at?: string
          id?: string
          options?: Json
          position: number
          trigger_kind: Database["public"]["Enums"]["claim_trigger_kind"]
          trigger_value: string
          updated_at?: string
          user_id: string
        }
        Update: {
          claim_template?: string
          client_id?: string
          created_at?: string
          id?: string
          options?: Json
          position?: number
          trigger_kind?: Database["public"]["Enums"]["claim_trigger_kind"]
          trigger_value?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_claim_ladders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_funnel_benchmarks: {
        Row: {
          client_id: string
          confidence: number | null
          created_at: string
          id: string
          n: number
          provenance: string
          rate: number
          stage: string
          updated_at: string
        }
        Insert: {
          client_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          n?: number
          provenance: string
          rate: number
          stage: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          n?: number
          provenance?: string
          rate?: number
          stage?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_funnel_benchmarks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_landing_pages: {
        Row: {
          box_logo_text: string | null
          brand_instagram_url_default: string | null
          brand_tiktok_url_default: string | null
          client_id: string
          created_at: string
          created_by: string | null
          default_provider: string
          id: string
          logo_style: string
          meta_capi_token_encrypted: string | null
          meta_pixel_id: string | null
          meta_pixel_id_verified_at: string | null
          meta_test_event_code: string | null
          partner_consent_enabled: boolean
          partner_name: string | null
          partner_privacy_policy_url: string | null
          privacy_policy_url: string | null
          show_off_pixel_attribution: boolean
          theme: Json
          updated_at: string
        }
        Insert: {
          box_logo_text?: string | null
          brand_instagram_url_default?: string | null
          brand_tiktok_url_default?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          default_provider?: string
          id?: string
          logo_style?: string
          meta_capi_token_encrypted?: string | null
          meta_pixel_id?: string | null
          meta_pixel_id_verified_at?: string | null
          meta_test_event_code?: string | null
          partner_consent_enabled?: boolean
          partner_name?: string | null
          partner_privacy_policy_url?: string | null
          privacy_policy_url?: string | null
          show_off_pixel_attribution?: boolean
          theme?: Json
          updated_at?: string
        }
        Update: {
          box_logo_text?: string | null
          brand_instagram_url_default?: string | null
          brand_tiktok_url_default?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          default_provider?: string
          id?: string
          logo_style?: string
          meta_capi_token_encrypted?: string | null
          meta_pixel_id?: string | null
          meta_pixel_id_verified_at?: string | null
          meta_test_event_code?: string | null
          partner_consent_enabled?: boolean
          partner_name?: string | null
          partner_privacy_policy_url?: string | null
          privacy_policy_url?: string | null
          show_off_pixel_attribution?: boolean
          theme?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_landing_pages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_optimisation_presets: {
        Row: {
          client_id: string
          created_at: string
          default_arm: string
          guardrails: Json
          id: string
          mode: string
          objective: string
          rules: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_id: string
          created_at?: string
          default_arm?: string
          guardrails?: Json
          id?: string
          mode?: string
          objective: string
          rules?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          default_arm?: string
          guardrails?: Json
          id?: string
          mode?: string
          objective?: string
          rules?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_optimisation_presets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_portal_snapshots: {
        Row: {
          build_version: string
          client_id: string
          created_at: string
          id: string
          payload_jsonb: Json
          refreshed_at: string
        }
        Insert: {
          build_version: string
          client_id: string
          created_at?: string
          id?: string
          payload_jsonb: Json
          refreshed_at?: string
        }
        Update: {
          build_version?: string
          client_id?: string
          created_at?: string
          id?: string
          payload_jsonb?: Json
          refreshed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_report_weekly_snapshots: {
        Row: {
          captured_at: string
          captured_by: string | null
          client_id: string
          created_at: string
          event_id: string
          id: string
          revenue: number | null
          tickets_sold: number | null
          tickets_sold_previous: number | null
          updated_at: string
          user_id: string
          week_start: string
        }
        Insert: {
          captured_at?: string
          captured_by?: string | null
          client_id: string
          created_at?: string
          event_id: string
          id?: string
          revenue?: number | null
          tickets_sold?: number | null
          tickets_sold_previous?: number | null
          updated_at?: string
          user_id: string
          week_start: string
        }
        Update: {
          captured_at?: string
          captured_by?: string | null
          client_id?: string
          created_at?: string
          event_id?: string
          id?: string
          revenue?: number | null
          tickets_sold?: number | null
          tickets_sold_previous?: number | null
          updated_at?: string
          user_id?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_report_weekly_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_report_weekly_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "client_report_weekly_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      client_reports: {
        Row: {
          client_id: string
          created_at: string
          enabled: boolean
          expires_at: string | null
          id: string
          season: string
          share_token: string
          storage_path: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          season: string
          share_token: string
          storage_path: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          enabled?: boolean
          expires_at?: string | null
          id?: string
          season?: string
          share_token?: string
          storage_path?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_ticketing_connections: {
        Row: {
          client_id: string
          created_at: string
          credentials: Json
          credentials_encrypted: string | null
          credentials_format: string
          external_account_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          credentials?: Json
          credentials_encrypted?: string | null
          credentials_format?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          credentials?: Json
          credentials_encrypted?: string | null
          credentials_format?: string
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_ticketing_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          client_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          role?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_venue_mappings: {
        Row: {
          client_id: string
          created_at: string
          event_code: string
          id: string
          nation_label: string | null
          notes: string | null
          sheet_label: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          event_code: string
          id?: string
          nation_label?: string | null
          notes?: string | null
          sheet_label: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          event_code?: string
          id?: string
          nation_label?: string | null
          notes?: string | null
          sheet_label?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_venue_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          billing_model: string
          created_at: string
          custom_minimum_fee: number | null
          custom_rate_per_ticket: number | null
          d2c_fallback_artwork_url: string | null
          default_instagram_actor_id: string | null
          default_page_ids: string[]
          default_settlement_timing: string | null
          default_tiktok_identity_bc_id: string | null
          default_tiktok_identity_id: string | null
          default_tiktok_identity_type: string | null
          default_upfront_pct: number | null
          drive_folder_id: string | null
          facebook_page_handle: string | null
          google_ads_account_id: string | null
          google_ads_customer_id: string | null
          google_drive_folder_url: string | null
          id: string
          ig_last_error: string | null
          instagram_business_id: string | null
          instagram_handle: string | null
          last_probed_at: string | null
          mailchimp_account_id: string | null
          mailchimp_audience_id: string | null
          meta_ad_account_id: string | null
          meta_business_id: string | null
          meta_pixel_id: string | null
          meta_system_user_token_encrypted: string | null
          meta_system_user_token_last_used_at: string | null
          meta_system_user_token_set_at: string | null
          name: string
          notes: string | null
          primary_type: string
          retainer_monthly_fee: number | null
          retainer_started_at: string | null
          slug: string
          status: string
          tiktok_account_id: string | null
          tiktok_ad_account_id: string | null
          tiktok_handle: string | null
          types: string[]
          updated_at: string
          user_id: string
          vertical: string
          voice_hashtags_enabled: boolean
        }
        Insert: {
          billing_model?: string
          created_at?: string
          custom_minimum_fee?: number | null
          custom_rate_per_ticket?: number | null
          d2c_fallback_artwork_url?: string | null
          default_instagram_actor_id?: string | null
          default_page_ids?: string[]
          default_settlement_timing?: string | null
          default_tiktok_identity_bc_id?: string | null
          default_tiktok_identity_id?: string | null
          default_tiktok_identity_type?: string | null
          default_upfront_pct?: number | null
          drive_folder_id?: string | null
          facebook_page_handle?: string | null
          google_ads_account_id?: string | null
          google_ads_customer_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
          ig_last_error?: string | null
          instagram_business_id?: string | null
          instagram_handle?: string | null
          last_probed_at?: string | null
          mailchimp_account_id?: string | null
          mailchimp_audience_id?: string | null
          meta_ad_account_id?: string | null
          meta_business_id?: string | null
          meta_pixel_id?: string | null
          meta_system_user_token_encrypted?: string | null
          meta_system_user_token_last_used_at?: string | null
          meta_system_user_token_set_at?: string | null
          name: string
          notes?: string | null
          primary_type: string
          retainer_monthly_fee?: number | null
          retainer_started_at?: string | null
          slug: string
          status?: string
          tiktok_account_id?: string | null
          tiktok_ad_account_id?: string | null
          tiktok_handle?: string | null
          types?: string[]
          updated_at?: string
          user_id: string
          vertical?: string
          voice_hashtags_enabled?: boolean
        }
        Update: {
          billing_model?: string
          created_at?: string
          custom_minimum_fee?: number | null
          custom_rate_per_ticket?: number | null
          d2c_fallback_artwork_url?: string | null
          default_instagram_actor_id?: string | null
          default_page_ids?: string[]
          default_settlement_timing?: string | null
          default_tiktok_identity_bc_id?: string | null
          default_tiktok_identity_id?: string | null
          default_tiktok_identity_type?: string | null
          default_upfront_pct?: number | null
          drive_folder_id?: string | null
          facebook_page_handle?: string | null
          google_ads_account_id?: string | null
          google_ads_customer_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
          ig_last_error?: string | null
          instagram_business_id?: string | null
          instagram_handle?: string | null
          last_probed_at?: string | null
          mailchimp_account_id?: string | null
          mailchimp_audience_id?: string | null
          meta_ad_account_id?: string | null
          meta_business_id?: string | null
          meta_pixel_id?: string | null
          meta_system_user_token_encrypted?: string | null
          meta_system_user_token_last_used_at?: string | null
          meta_system_user_token_set_at?: string | null
          name?: string
          notes?: string | null
          primary_type?: string
          retainer_monthly_fee?: number | null
          retainer_started_at?: string | null
          slug?: string
          status?: string
          tiktok_account_id?: string | null
          tiktok_ad_account_id?: string | null
          tiktok_handle?: string | null
          types?: string[]
          updated_at?: string
          user_id?: string
          vertical?: string
          voice_hashtags_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clients_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_mailchimp_account_id_fkey"
            columns: ["mailchimp_account_id"]
            isOneToOne: false
            referencedRelation: "mailchimp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_tiktok_account_id_fkey"
            columns: ["tiktok_account_id"]
            isOneToOne: false
            referencedRelation: "tiktok_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_asset_channel_ids: {
        Row: {
          asset_id: string
          channel: string
          created_at: string
          id: string
          platform_id: string
          scope: string
          user_id: string
        }
        Insert: {
          asset_id: string
          channel: string
          created_at?: string
          id?: string
          platform_id: string
          scope: string
          user_id: string
        }
        Update: {
          asset_id?: string
          channel?: string
          created_at?: string
          id?: string
          platform_id?: string
          scope?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_asset_channel_ids_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_assets: {
        Row: {
          aspect_ratio: string
          byte_size: number
          content_hash: string
          created_at: string
          duration_seconds: number | null
          filename: string
          id: string
          media_kind: string
          storage_bucket: string
          storage_path: string
          thumbnail_url: string | null
          user_id: string
        }
        Insert: {
          aspect_ratio: string
          byte_size: number
          content_hash: string
          created_at?: string
          duration_seconds?: number | null
          filename: string
          id?: string
          media_kind: string
          storage_bucket?: string
          storage_path: string
          thumbnail_url?: string | null
          user_id: string
        }
        Update: {
          aspect_ratio?: string
          byte_size?: number
          content_hash?: string
          created_at?: string
          duration_seconds?: number | null
          filename?: string
          id?: string
          media_kind?: string
          storage_bucket?: string
          storage_path?: string
          thumbnail_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      creative_enhancement_flags: {
        Row: {
          ad_account_id: string
          ad_id: string
          ad_name: string | null
          campaign_id: string | null
          client_id: string
          creative_id: string
          event_id: string | null
          flagged_features: Json
          id: string
          raw_features_spec: Json
          resolved_at: string | null
          resolved_by_user_id: string | null
          scanned_at: string
          severity_score: number
          tracked_only: boolean
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          ad_name?: string | null
          campaign_id?: string | null
          client_id: string
          creative_id: string
          event_id?: string | null
          flagged_features: Json
          id?: string
          raw_features_spec: Json
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          scanned_at?: string
          severity_score: number
          tracked_only?: boolean
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          ad_name?: string | null
          campaign_id?: string | null
          client_id?: string
          creative_id?: string
          event_id?: string | null
          flagged_features?: Json
          id?: string
          raw_features_spec?: Json
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          scanned_at?: string
          severity_score?: number
          tracked_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "creative_enhancement_flags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_enhancement_flags_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_enhancement_flags_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_insight_snapshots: {
        Row: {
          ad_account_id: string
          ad_id: string
          ad_name: string | null
          ad_status: string | null
          adset_id: string | null
          campaign_id: string | null
          campaign_name: string | null
          campaign_objective: string | null
          clicks: number | null
          cpc: number | null
          cpl: number | null
          cpm: number | null
          created_at: string
          creative_id: string | null
          creative_name: string | null
          ctr: number | null
          date_preset: string
          fatigue_score: string | null
          frequency: number | null
          id: string
          impressions: number | null
          link_clicks: number | null
          purchases: number | null
          raw_insights: Json | null
          reach: number | null
          registrations: number | null
          snapshot_at: string
          spend: number | null
          thumbnail_url: string | null
          user_id: string
        }
        Insert: {
          ad_account_id: string
          ad_id: string
          ad_name?: string | null
          ad_status?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          campaign_objective?: string | null
          clicks?: number | null
          cpc?: number | null
          cpl?: number | null
          cpm?: number | null
          created_at?: string
          creative_id?: string | null
          creative_name?: string | null
          ctr?: number | null
          date_preset: string
          fatigue_score?: string | null
          frequency?: number | null
          id?: string
          impressions?: number | null
          link_clicks?: number | null
          purchases?: number | null
          raw_insights?: Json | null
          reach?: number | null
          registrations?: number | null
          snapshot_at?: string
          spend?: number | null
          thumbnail_url?: string | null
          user_id: string
        }
        Update: {
          ad_account_id?: string
          ad_id?: string
          ad_name?: string | null
          ad_status?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          campaign_objective?: string | null
          clicks?: number | null
          cpc?: number | null
          cpl?: number | null
          cpm?: number | null
          created_at?: string
          creative_id?: string | null
          creative_name?: string | null
          ctr?: number | null
          date_preset?: string
          fatigue_score?: string | null
          frequency?: number | null
          id?: string
          impressions?: number | null
          link_clicks?: number | null
          purchases?: number | null
          raw_insights?: Json | null
          reach?: number | null
          registrations?: number | null
          snapshot_at?: string
          spend?: number | null
          thumbnail_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      creative_lab_artists: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          artist_id: string | null
          client_id: string
          clip_folder_last_error: string | null
          clip_folder_synced_at: string | null
          clip_folder_url: string | null
          clip_source: string
          created_at: string
          id: string
          ig_last_error: string | null
          ig_synced_at: string | null
          ig_username: string | null
          instagram_actor_id: string | null
          meta_page_id: string | null
          name: string
          played_cities: string[]
          rights_doc_ref: string | null
          starting_caption: string | null
          tiktok_identity_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          artist_id?: string | null
          client_id: string
          clip_folder_last_error?: string | null
          clip_folder_synced_at?: string | null
          clip_folder_url?: string | null
          clip_source?: string
          created_at?: string
          id?: string
          ig_last_error?: string | null
          ig_synced_at?: string | null
          ig_username?: string | null
          instagram_actor_id?: string | null
          meta_page_id?: string | null
          name: string
          played_cities?: string[]
          rights_doc_ref?: string | null
          starting_caption?: string | null
          tiktok_identity_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          artist_id?: string | null
          client_id?: string
          clip_folder_last_error?: string | null
          clip_folder_synced_at?: string | null
          clip_folder_url?: string | null
          clip_source?: string
          created_at?: string
          id?: string
          ig_last_error?: string | null
          ig_synced_at?: string | null
          ig_username?: string | null
          instagram_actor_id?: string | null
          meta_page_id?: string | null
          name?: string
          played_cities?: string[]
          rights_doc_ref?: string | null
          starting_caption?: string | null
          tiktok_identity_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_artists_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_captions: {
        Row: {
          artist_id: string | null
          caption_no: number
          clip_id: string | null
          created_at: string
          declared_names: string[]
          event_id: string
          facts_hash: string
          generated_by: string
          id: string
          lines: string[]
          mode: string
          primary_text: string | null
          quote_source: string | null
          quote_source_note: string | null
          quote_source_ref: string | null
          quote_weight: number | null
          size_variant: string
          status: string
          style: string
          style_version: string
          text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          artist_id?: string | null
          caption_no: number
          clip_id?: string | null
          created_at?: string
          declared_names?: string[]
          event_id: string
          facts_hash: string
          generated_by: string
          id?: string
          lines: string[]
          mode?: string
          primary_text?: string | null
          quote_source?: string | null
          quote_source_note?: string | null
          quote_source_ref?: string | null
          quote_weight?: number | null
          size_variant?: string
          status?: string
          style: string
          style_version: string
          text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          artist_id?: string | null
          caption_no?: number
          clip_id?: string | null
          created_at?: string
          declared_names?: string[]
          event_id?: string
          facts_hash?: string
          generated_by?: string
          id?: string
          lines?: string[]
          mode?: string
          primary_text?: string | null
          quote_source?: string | null
          quote_source_note?: string | null
          quote_source_ref?: string | null
          quote_weight?: number | null
          size_variant?: string
          status?: string
          style?: string
          style_version?: string
          text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_captions_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_captions_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_captions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_lab_captions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_clip_selections: {
        Row: {
          clip_id: string
          event_id: string
          selected: boolean
          set_at: string
          set_by: string | null
          user_id: string
        }
        Insert: {
          clip_id: string
          event_id: string
          selected: boolean
          set_at?: string
          set_by?: string | null
          user_id: string
        }
        Update: {
          clip_id?: string
          event_id?: string
          selected?: boolean
          set_at?: string
          set_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_clip_selections_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_clip_selections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_lab_clip_selections_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_clip_features: {
        Row: {
          artist_id: string
          clip_id: string
          set_at: string | null
          set_by: string | null
        }
        Insert: {
          artist_id: string
          clip_id: string
          set_at?: string | null
          set_by?: string | null
        }
        Update: {
          artist_id?: string
          clip_id?: string
          set_at?: string | null
          set_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_clip_features_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_clip_features_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_clips"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_clips: {
        Row: {
          artist_id: string
          audio_match: boolean | null
          audio_status: string
          clip_no: number
          created_at: string
          creative_asset_id: string
          crop_focus_x: number
          crop_focus_y: number
          event_id: string | null
          external_id: string | null
          fetched_at: string | null
          id: string
          ig_comments_count: number | null
          owner: string | null
          owner_set_at: string | null
          owner_set_by: string | null
          ig_followers_at_fetch: number | null
          ig_like_count: number | null
          ig_posted_at: string | null
          in_s: number | null
          out_s: number | null
          overlay_check: Json | null
          permalink: string | null
          render_asset_id: string | null
          rights_ref: string
          source: string
          source_file_id: string | null
          shown_on_event_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          artist_id: string
          audio_match?: boolean | null
          audio_status?: string
          clip_no: number
          created_at?: string
          creative_asset_id: string
          crop_focus_x?: number
          crop_focus_y?: number
          event_id?: string | null
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          ig_comments_count?: number | null
          ig_followers_at_fetch?: number | null
          ig_like_count?: number | null
          ig_posted_at?: string | null
          in_s?: number | null
          out_s?: number | null
          overlay_check?: Json | null
          owner?: string | null
          owner_set_at?: string | null
          owner_set_by?: string | null
          permalink?: string | null
          render_asset_id?: string | null
          rights_ref: string
          source: string
          source_file_id?: string | null
          shown_on_event_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          artist_id?: string
          audio_match?: boolean | null
          audio_status?: string
          clip_no?: number
          created_at?: string
          creative_asset_id?: string
          crop_focus_x?: number
          crop_focus_y?: number
          event_id?: string | null
          external_id?: string | null
          fetched_at?: string | null
          id?: string
          ig_comments_count?: number | null
          ig_followers_at_fetch?: number | null
          ig_like_count?: number | null
          ig_posted_at?: string | null
          in_s?: number | null
          out_s?: number | null
          overlay_check?: Json | null
          owner?: string | null
          owner_set_at?: string | null
          owner_set_by?: string | null
          permalink?: string | null
          render_asset_id?: string | null
          rights_ref?: string
          source?: string
          source_file_id?: string | null
          shown_on_event_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_clips_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_clips_creative_asset_id_fkey"
            columns: ["creative_asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_clips_render_asset_id_fkey"
            columns: ["render_asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_clips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_lab_clips_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_event_facts: {
        Row: {
          allowed_dates: string[]
          created_at: string
          event_id: string
          headliners: string[]
          lineup: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_dates?: string[]
          created_at?: string
          event_id: string
          headliners?: string[]
          lineup?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_dates?: string[]
          created_at?: string
          event_id?: string
          headliners?: string[]
          lineup?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_event_facts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_lab_event_facts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_ig_candidates: {
        Row: {
          artist_id: string
          aspect: string | null
          asset_id: string | null
          audio_match: boolean | null
          caption: string | null
          caption_fetched_at: string | null
          checked_at: string | null
          clip_id: string | null
          comments: number | null
          created_at: string
          fetched_at: string
          file_source: string
          followers_at_fetch: number | null
          has_file: boolean
          id: string
          ig_media_id: string
          likes: number | null
          media_product_type: string | null
          media_type: string | null
          overlay_check: Json | null
          permalink: string | null
          posted_at: string | null
          reason: string | null
          score: number | null
          slide_ids: string[]
          status: string
          thumb_height: number | null
          thumb_width: number | null
          thumbnail_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          artist_id: string
          aspect?: string | null
          asset_id?: string | null
          audio_match?: boolean | null
          caption?: string | null
          caption_fetched_at?: string | null
          checked_at?: string | null
          clip_id?: string | null
          comments?: number | null
          created_at?: string
          fetched_at?: string
          file_source: string
          followers_at_fetch?: number | null
          has_file: boolean
          id?: string
          ig_media_id: string
          likes?: number | null
          media_product_type?: string | null
          media_type?: string | null
          overlay_check?: Json | null
          permalink?: string | null
          posted_at?: string | null
          reason?: string | null
          score?: number | null
          slide_ids?: string[]
          status?: string
          thumb_height?: number | null
          thumb_width?: number | null
          thumbnail_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          artist_id?: string
          aspect?: string | null
          asset_id?: string | null
          audio_match?: boolean | null
          caption?: string | null
          caption_fetched_at?: string | null
          checked_at?: string | null
          clip_id?: string | null
          comments?: number | null
          created_at?: string
          fetched_at?: string
          file_source?: string
          followers_at_fetch?: number | null
          has_file?: boolean
          id?: string
          ig_media_id?: string
          likes?: number | null
          media_product_type?: string | null
          media_type?: string | null
          overlay_check?: Json | null
          permalink?: string | null
          posted_at?: string | null
          reason?: string | null
          score?: number | null
          slide_ids?: string[]
          status?: string
          thumb_height?: number | null
          thumb_width?: number | null
          thumbnail_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_ig_candidates_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_artists"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_renders: {
        Row: {
          aspect: string
          attempt: number
          caption_id: string
          clip_id: string
          created_at: string
          creative_asset_id: string | null
          drive_attempts: number
          drive_copied_at: string | null
          drive_error: string | null
          drive_file_id: string | null
          drive_file_name: string | null
          drive_next_attempt_at: string | null
          drive_render_attempt: number | null
          drive_status: string | null
          drive_winner_shortcut_id: string | null
          error: string | null
          id: string
          kind: string
          render_ms: number | null
          ssim: number | null
          status: string
          style_version: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect: string
          attempt?: number
          caption_id: string
          clip_id: string
          created_at?: string
          creative_asset_id?: string | null
          drive_attempts?: number
          drive_copied_at?: string | null
          drive_error?: string | null
          drive_file_id?: string | null
          drive_file_name?: string | null
          drive_next_attempt_at?: string | null
          drive_render_attempt?: number | null
          drive_status?: string | null
          drive_winner_shortcut_id?: string | null
          error?: string | null
          id?: string
          kind?: string
          render_ms?: number | null
          ssim?: number | null
          status?: string
          style_version: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect?: string
          attempt?: number
          caption_id?: string
          clip_id?: string
          created_at?: string
          creative_asset_id?: string | null
          drive_attempts?: number
          drive_copied_at?: string | null
          drive_error?: string | null
          drive_file_id?: string | null
          drive_file_name?: string | null
          drive_next_attempt_at?: string | null
          drive_render_attempt?: number | null
          drive_status?: string | null
          drive_winner_shortcut_id?: string | null
          error?: string | null
          id?: string
          kind?: string
          render_ms?: number | null
          ssim?: number | null
          status?: string
          style_version?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_renders_caption_id_fkey"
            columns: ["caption_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_captions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_renders_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_renders_creative_asset_id_fkey"
            columns: ["creative_asset_id"]
            isOneToOne: false
            referencedRelation: "creative_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_round_ad_launches: {
        Row: {
          ad_account_id: string | null
          created_at: string
          id: string
          meta_ad_id: string
          meta_adset_id: string
          meta_campaign_id: string | null
          round_ad_id: string
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          created_at?: string
          id?: string
          meta_ad_id: string
          meta_adset_id: string
          meta_campaign_id?: string | null
          round_ad_id: string
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          created_at?: string
          id?: string
          meta_ad_id?: string
          meta_adset_id?: string
          meta_campaign_id?: string | null
          round_ad_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_round_ad_launches_round_ad_id_fkey"
            columns: ["round_ad_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_round_ads"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_round_ads: {
        Row: {
          ad_name: string
          caption_id: string
          clip_id: string
          confirmed: boolean
          created_at: string
          id: string
          launch_error: string | null
          launch_state: string
          render_id: string | null
          result_metric: string | null
          retest_of: string | null
          role: string
          round_id: string
          updated_at: string
          user_id: string
          verdict: string | null
          verdict_cost_per_result: number | null
          verdict_fair_share: number | null
          verdict_reason: string | null
          verdict_results: number | null
          verdict_spend_share: number | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          ad_name: string
          caption_id: string
          clip_id: string
          confirmed?: boolean
          created_at?: string
          id?: string
          launch_error?: string | null
          launch_state?: string
          render_id?: string | null
          result_metric?: string | null
          retest_of?: string | null
          role?: string
          round_id: string
          updated_at?: string
          user_id: string
          verdict?: string | null
          verdict_cost_per_result?: number | null
          verdict_fair_share?: number | null
          verdict_reason?: string | null
          verdict_results?: number | null
          verdict_spend_share?: number | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          ad_name?: string
          caption_id?: string
          clip_id?: string
          confirmed?: boolean
          created_at?: string
          id?: string
          launch_error?: string | null
          launch_state?: string
          render_id?: string | null
          result_metric?: string | null
          retest_of?: string | null
          role?: string
          round_id?: string
          updated_at?: string
          user_id?: string
          verdict?: string | null
          verdict_cost_per_result?: number | null
          verdict_fair_share?: number | null
          verdict_reason?: string | null
          verdict_results?: number | null
          verdict_spend_share?: number | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_round_ads_caption_id_fkey"
            columns: ["caption_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_captions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_round_ads_clip_id_fkey"
            columns: ["clip_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_clips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_round_ads_render_id_fkey"
            columns: ["render_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_renders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_round_ads_retest_of_fkey"
            columns: ["retest_of"]
            isOneToOne: false
            referencedRelation: "creative_lab_round_ads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_round_ads_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_rounds: {
        Row: {
          ad_account_id: string | null
          approved_at: string | null
          approved_by: string | null
          artist_id: string
          built_at: string
          channel: string
          created_at: string
          cta: string | null
          destination_url: string | null
          draft_id: string | null
          event_id: string
          id: string
          instagram_actor_id: string | null
          judged_at: string | null
          launched_at: string | null
          meta_adset_id: string | null
          meta_adset_name: string | null
          meta_adset_status: string | null
          meta_campaign_id: string | null
          meta_campaign_objective: string | null
          page_id: string | null
          round_no: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          artist_id: string
          built_at?: string
          channel?: string
          created_at?: string
          cta?: string | null
          destination_url?: string | null
          draft_id?: string | null
          event_id: string
          id?: string
          instagram_actor_id?: string | null
          judged_at?: string | null
          launched_at?: string | null
          meta_adset_id?: string | null
          meta_adset_name?: string | null
          meta_adset_status?: string | null
          meta_campaign_id?: string | null
          meta_campaign_objective?: string | null
          page_id?: string | null
          round_no: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          artist_id?: string
          built_at?: string
          channel?: string
          created_at?: string
          cta?: string | null
          destination_url?: string | null
          draft_id?: string | null
          event_id?: string
          id?: string
          instagram_actor_id?: string | null
          judged_at?: string | null
          launched_at?: string | null
          meta_adset_id?: string | null
          meta_adset_name?: string | null
          meta_adset_status?: string | null
          meta_campaign_id?: string | null
          meta_campaign_objective?: string | null
          page_id?: string | null
          round_no?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_rounds_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_rounds_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_lab_rounds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_lab_rounds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_lab_style_settings: {
        Row: {
          client_id: string
          emoji_in_primary: boolean
          style: string
        }
        Insert: {
          client_id: string
          emoji_in_primary?: boolean
          style: string
        }
        Update: {
          client_id?: string
          emoji_in_primary?: boolean
          style?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_lab_style_settings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_renders: {
        Row: {
          asset_url: string | null
          created_at: string
          error_message: string | null
          event_id: string | null
          fields_jsonb: Json
          id: string
          provider_job_id: string | null
          status: string
          template_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          asset_url?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          fields_jsonb?: Json
          id?: string
          provider_job_id?: string | null
          status?: string
          template_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          asset_url?: string | null
          created_at?: string
          error_message?: string | null
          event_id?: string | null
          fields_jsonb?: Json
          id?: string
          provider_job_id?: string | null
          status?: string
          template_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_renders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_renders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_renders_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "creative_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_scores: {
        Row: {
          axis: string
          creative_name: string
          event_id: string
          fetched_at: string
          id: string
          score: number
          significance: boolean
          user_id: string
        }
        Insert: {
          axis: string
          creative_name: string
          event_id: string
          fetched_at?: string
          id?: string
          score: number
          significance?: boolean
          user_id: string
        }
        Update: {
          axis?: string
          creative_name?: string
          event_id?: string
          fetched_at?: string
          id?: string
          score?: number
          significance?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_scores_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_scores_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_tag_assignments: {
        Row: {
          confidence: number | null
          created_at: string
          creative_name: string
          event_id: string
          id: string
          meta_ad_id: string | null
          meta_creative_id: string | null
          model_version: string | null
          source: string
          tag_id: string
          thumbnail_hash: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          creative_name: string
          event_id: string
          id?: string
          meta_ad_id?: string | null
          meta_creative_id?: string | null
          model_version?: string | null
          source: string
          tag_id: string
          thumbnail_hash?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          creative_name?: string
          event_id?: string
          id?: string
          meta_ad_id?: string | null
          meta_creative_id?: string | null
          model_version?: string | null
          source?: string
          tag_id?: string
          thumbnail_hash?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_tag_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_tag_assignments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "creative_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_tags: {
        Row: {
          created_at: string
          description: string | null
          dimension: string | null
          event_id: string | null
          id: string
          meta_ad_id: string | null
          meta_creative_id: string | null
          source: string
          tag_type: string | null
          tag_value: string | null
          updated_at: string
          user_id: string
          value_key: string | null
          value_label: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          dimension?: string | null
          event_id?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_creative_id?: string | null
          source?: string
          tag_type?: string | null
          tag_value?: string | null
          updated_at?: string
          user_id: string
          value_key?: string | null
          value_label?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          dimension?: string | null
          event_id?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_creative_id?: string | null
          source?: string
          tag_type?: string | null
          tag_value?: string | null
          updated_at?: string
          user_id?: string
          value_key?: string | null
          value_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_tags_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "creative_tags_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_templates: {
        Row: {
          aspect_ratios: string[]
          channel: string
          created_at: string
          external_template_id: string | null
          fields_jsonb: Json
          id: string
          name: string
          notes: string | null
          provider: string
          updated_at: string
          user_id: string
        }
        Insert: {
          aspect_ratios?: string[]
          channel?: string
          created_at?: string
          external_template_id?: string | null
          fields_jsonb?: Json
          id?: string
          name: string
          notes?: string | null
          provider: string
          updated_at?: string
          user_id: string
        }
        Update: {
          aspect_ratios?: string[]
          channel?: string
          created_at?: string
          external_template_id?: string | null
          fields_jsonb?: Json
          id?: string
          name?: string
          notes?: string | null
          provider?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cron_health_reports: {
        Row: {
          any_stale: boolean
          generated_at: string
          id: string
          report_jsonb: Json
        }
        Insert: {
          any_stale?: boolean
          generated_at?: string
          id?: string
          report_jsonb: Json
        }
        Update: {
          any_stale?: boolean
          generated_at?: string
          id?: string
          report_jsonb?: Json
        }
        Relationships: []
      }
      cron_runs: {
        Row: {
          cron_name: string
          detail: Json
          error: string | null
          finished_at: string
          id: string
          ok: boolean
          rows_considered: number
          rows_written: number
          started_at: string
        }
        Insert: {
          cron_name: string
          detail?: Json
          error?: string | null
          finished_at?: string
          id?: string
          ok: boolean
          rows_considered?: number
          rows_written?: number
          started_at: string
        }
        Update: {
          cron_name?: string
          detail?: Json
          error?: string | null
          finished_at?: string
          id?: string
          ok?: boolean
          rows_considered?: number
          rows_written?: number
          started_at?: string
        }
        Relationships: []
      }
      d2c_autoresp_fires: {
        Row: {
          dry_run: boolean
          error: string | null
          event_id: string
          fired_at: string
          id: string
          is_test: boolean
          member_identifier: string
          provider: string
          provider_response_jsonb: Json | null
          send_id: string
        }
        Insert: {
          dry_run?: boolean
          error?: string | null
          event_id: string
          fired_at?: string
          id?: string
          is_test?: boolean
          member_identifier: string
          provider: string
          provider_response_jsonb?: Json | null
          send_id: string
        }
        Update: {
          dry_run?: boolean
          error?: string | null
          event_id?: string
          fired_at?: string
          id?: string
          is_test?: boolean
          member_identifier?: string
          provider?: string
          provider_response_jsonb?: Json | null
          send_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "d2c_autoresp_fires_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "d2c_autoresp_fires_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "d2c_autoresp_fires_send_id_fkey"
            columns: ["send_id"]
            isOneToOne: false
            referencedRelation: "d2c_scheduled_sends"
            referencedColumns: ["id"]
          },
        ]
      }
      d2c_brief_ingest_jobs: {
        Row: {
          client_id: string
          created_at: string
          error: string | null
          id: string
          result_event_id: string | null
          source: string
          source_uri: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          error?: string | null
          id?: string
          result_event_id?: string | null
          source: string
          source_uri?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          error?: string | null
          id?: string
          result_event_id?: string | null
          source?: string
          source_uri?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "d2c_brief_ingest_jobs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "d2c_brief_ingest_jobs_result_event_id_fkey"
            columns: ["result_event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "d2c_brief_ingest_jobs_result_event_id_fkey"
            columns: ["result_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      d2c_connections: {
        Row: {
          approved_by_matas: boolean
          client_id: string
          created_at: string
          credentials: Json
          credentials_encrypted: string | null
          external_account_id: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          live_enabled: boolean
          provider: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_by_matas?: boolean
          client_id: string
          created_at?: string
          credentials?: Json
          credentials_encrypted?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          live_enabled?: boolean
          provider: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_by_matas?: boolean
          client_id?: string
          created_at?: string
          credentials?: Json
          credentials_encrypted?: string | null
          external_account_id?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          live_enabled?: boolean
          provider?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "d2c_connections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      d2c_event_copy: {
        Row: {
          artwork_url: string | null
          client_id: string
          copy_jsonb: Json
          created_at: string
          event_id: string
          id: string
          source_brief_job_id: string | null
          updated_at: string
          user_id: string
          whatsapp_community_url: string | null
        }
        Insert: {
          artwork_url?: string | null
          client_id: string
          copy_jsonb?: Json
          created_at?: string
          event_id: string
          id?: string
          source_brief_job_id?: string | null
          updated_at?: string
          user_id: string
          whatsapp_community_url?: string | null
        }
        Update: {
          artwork_url?: string | null
          client_id?: string
          copy_jsonb?: Json
          created_at?: string
          event_id?: string
          id?: string
          source_brief_job_id?: string | null
          updated_at?: string
          user_id?: string
          whatsapp_community_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "d2c_event_copy_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "d2c_event_copy_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "d2c_event_copy_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      d2c_event_shares: {
        Row: {
          accessed_count: number
          created_at: string
          event_id: string
          id: string
          last_accessed_at: string | null
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          accessed_count?: number
          created_at?: string
          event_id: string
          id?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          accessed_count?: number
          created_at?: string
          event_id?: string
          id?: string
          last_accessed_at?: string | null
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "d2c_event_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "d2c_event_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      d2c_scheduled_sends: {
        Row: {
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          audience: Json
          bird_broadcast_id: string | null
          bird_campaign_edit_url: string | null
          bird_campaign_id: string | null
          channel: string
          connection_id: string
          created_at: string
          dry_run: boolean
          event_id: string
          id: string
          idempotency_key: string | null
          job_type: string | null
          result_jsonb: Json | null
          scheduled_for: string
          status: string
          template_id: string
          updated_at: string
          user_id: string
          variables: Json
        }
        Insert: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          audience?: Json
          bird_broadcast_id?: string | null
          bird_campaign_edit_url?: string | null
          bird_campaign_id?: string | null
          channel: string
          connection_id: string
          created_at?: string
          dry_run?: boolean
          event_id: string
          id?: string
          idempotency_key?: string | null
          job_type?: string | null
          result_jsonb?: Json | null
          scheduled_for: string
          status?: string
          template_id: string
          updated_at?: string
          user_id: string
          variables?: Json
        }
        Update: {
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          audience?: Json
          bird_broadcast_id?: string | null
          bird_campaign_edit_url?: string | null
          bird_campaign_id?: string | null
          channel?: string
          connection_id?: string
          created_at?: string
          dry_run?: boolean
          event_id?: string
          id?: string
          idempotency_key?: string | null
          job_type?: string | null
          result_jsonb?: Json | null
          scheduled_for?: string
          status?: string
          template_id?: string
          updated_at?: string
          user_id?: string
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "d2c_scheduled_sends_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "d2c_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "d2c_scheduled_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "d2c_scheduled_sends_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "d2c_scheduled_sends_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "d2c_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      d2c_templates: {
        Row: {
          body_markdown: string
          channel: string
          client_id: string | null
          created_at: string
          id: string
          name: string
          subject: string | null
          updated_at: string
          user_id: string
          variables_jsonb: Json
        }
        Insert: {
          body_markdown?: string
          channel: string
          client_id?: string | null
          created_at?: string
          id?: string
          name: string
          subject?: string | null
          updated_at?: string
          user_id: string
          variables_jsonb?: Json
        }
        Update: {
          body_markdown?: string
          channel?: string
          client_id?: string | null
          created_at?: string
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string
          user_id?: string
          variables_jsonb?: Json
        }
        Relationships: [
          {
            foreignKeyName: "d2c_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_tracking_entries: {
        Row: {
          client_id: string
          created_at: string
          date: string
          day_spend: number | null
          event_id: string
          id: string
          link_clicks: number | null
          notes: string | null
          revenue: number | null
          tickets: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          date: string
          day_spend?: number | null
          event_id: string
          id?: string
          link_clicks?: number | null
          notes?: string | null
          revenue?: number | null
          tickets?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          date?: string
          day_spend?: number | null
          event_id?: string
          id?: string
          link_clicks?: number | null
          notes?: string | null
          revenue?: number | null
          tickets?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_tracking_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_tracking_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "daily_tracking_entries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_artist_folder_misses: {
        Row: {
          drive_folder_id: string
          event_id: string
          folder_name: string
          id: string
          seen_at: string
        }
        Insert: {
          drive_folder_id: string
          event_id: string
          folder_name: string
          id?: string
          seen_at?: string
        }
        Update: {
          drive_folder_id?: string
          event_id?: string
          folder_name?: string
          id?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drive_artist_folder_misses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "drive_artist_folder_misses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_change_cursors: {
        Row: {
          drive_id: string
          page_token: string
          updated_at: string
        }
        Insert: {
          drive_id: string
          page_token: string
          updated_at?: string
        }
        Update: {
          drive_id?: string
          page_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      drive_folders: {
        Row: {
          client_id: string
          created_at: string
          drive_folder_id: string
          event_id: string | null
          id: string
          key: string
          name: string
        }
        Insert: {
          client_id: string
          created_at?: string
          drive_folder_id: string
          event_id?: string | null
          id?: string
          key: string
          name: string
        }
        Update: {
          client_id?: string
          created_at?: string
          drive_folder_id?: string
          event_id?: string | null
          id?: string
          key?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "drive_folders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drive_folders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "drive_folders_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      drive_kit_audit_files: {
        Row: {
          audited_at: string | null
          client_id: string
          drive_file_id: string
          event_id: string | null
          folder_key: string
          id: string
          mime_type: string | null
          name: string
          seen_at: string
        }
        Insert: {
          audited_at?: string | null
          client_id: string
          drive_file_id: string
          event_id?: string | null
          folder_key: string
          id?: string
          mime_type?: string | null
          name: string
          seen_at?: string
        }
        Update: {
          audited_at?: string | null
          client_id?: string
          drive_file_id?: string
          event_id?: string | null
          folder_key?: string
          id?: string
          mime_type?: string | null
          name?: string
          seen_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drive_kit_audit_files_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drive_kit_audit_files_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "drive_kit_audit_files_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_activity_snapshots: {
        Row: {
          event_id: string
          fetched_at: string
          id: string
          payload_jsonb: Json
          source: string
          user_id: string
        }
        Insert: {
          event_id: string
          fetched_at?: string
          id?: string
          payload_jsonb: Json
          source: string
          user_id: string
        }
        Update: {
          event_id?: string
          fetched_at?: string
          id?: string
          payload_jsonb?: Json
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_activity_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_activity_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_artists: {
        Row: {
          artist_id: string
          billing_order: number
          created_at: string
          event_id: string
          id: string
          is_headliner: boolean
          source: string
          user_id: string
        }
        Insert: {
          artist_id: string
          billing_order?: number
          created_at?: string
          event_id: string
          id?: string
          is_headliner?: boolean
          source?: string
          user_id: string
        }
        Update: {
          artist_id?: string
          billing_order?: number
          created_at?: string
          event_id?: string
          id?: string
          is_headliner?: boolean
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_artists_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_artists_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_code_lifetime_meta_cache: {
        Row: {
          campaign_names: Json
          client_id: string
          created_at: string
          event_code: string
          fetched_at: string
          meta_engagements: number | null
          meta_impressions: number | null
          meta_landing_page_views: number | null
          meta_link_clicks: number | null
          meta_reach: number | null
          meta_regs: number | null
          meta_video_plays_15s: number | null
          meta_video_plays_3s: number | null
          meta_video_plays_p100: number | null
          updated_at: string
        }
        Insert: {
          campaign_names?: Json
          client_id: string
          created_at?: string
          event_code: string
          fetched_at?: string
          meta_engagements?: number | null
          meta_impressions?: number | null
          meta_landing_page_views?: number | null
          meta_link_clicks?: number | null
          meta_reach?: number | null
          meta_regs?: number | null
          meta_video_plays_15s?: number | null
          meta_video_plays_3s?: number | null
          meta_video_plays_p100?: number | null
          updated_at?: string
        }
        Update: {
          campaign_names?: Json
          client_id?: string
          created_at?: string
          event_code?: string
          fetched_at?: string
          meta_engagements?: number | null
          meta_impressions?: number | null
          meta_landing_page_views?: number | null
          meta_link_clicks?: number | null
          meta_reach?: number | null
          meta_regs?: number | null
          meta_video_plays_15s?: number | null
          meta_video_plays_3s?: number | null
          meta_video_plays_p100?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_code_lifetime_meta_cache_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      event_daily_rollups: {
        Row: {
          ad_spend: number | null
          ad_spend_allocated: number | null
          ad_spend_generic_share: number | null
          ad_spend_presale: number | null
          ad_spend_specific: number | null
          created_at: string
          date: string
          event_id: string
          google_ads_clicks: number | null
          google_ads_conversions: number | null
          google_ads_impressions: number | null
          google_ads_spend: number | null
          google_ads_video_views: number | null
          id: string
          landing_page_views: number | null
          link_clicks: number | null
          meta_engagements: number | null
          meta_impressions: number | null
          meta_leads: number | null
          meta_purchases: number | null
          meta_reach: number | null
          meta_regs: number | null
          meta_video_plays_15s: number | null
          meta_video_plays_3s: number | null
          meta_video_plays_p100: number | null
          notes: string | null
          revenue: number | null
          source_eventbrite_at: string | null
          source_google_ads_at: string | null
          source_meta_at: string | null
          source_tiktok_at: string | null
          tickets_sold: number | null
          tiktok_avg_play_time_ms: number | null
          tiktok_clicks: number | null
          tiktok_engagement_results: number | null
          tiktok_impressions: number | null
          tiktok_post_engagement: number | null
          tiktok_reach: number | null
          tiktok_results: number | null
          tiktok_spend: number | null
          tiktok_video_views: number | null
          tiktok_video_views_100p: number | null
          tiktok_video_views_2s: number | null
          tiktok_video_views_6s: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_spend?: number | null
          ad_spend_allocated?: number | null
          ad_spend_generic_share?: number | null
          ad_spend_presale?: number | null
          ad_spend_specific?: number | null
          created_at?: string
          date: string
          event_id: string
          google_ads_clicks?: number | null
          google_ads_conversions?: number | null
          google_ads_impressions?: number | null
          google_ads_spend?: number | null
          google_ads_video_views?: number | null
          id?: string
          landing_page_views?: number | null
          link_clicks?: number | null
          meta_engagements?: number | null
          meta_impressions?: number | null
          meta_leads?: number | null
          meta_purchases?: number | null
          meta_reach?: number | null
          meta_regs?: number | null
          meta_video_plays_15s?: number | null
          meta_video_plays_3s?: number | null
          meta_video_plays_p100?: number | null
          notes?: string | null
          revenue?: number | null
          source_eventbrite_at?: string | null
          source_google_ads_at?: string | null
          source_meta_at?: string | null
          source_tiktok_at?: string | null
          tickets_sold?: number | null
          tiktok_avg_play_time_ms?: number | null
          tiktok_clicks?: number | null
          tiktok_engagement_results?: number | null
          tiktok_impressions?: number | null
          tiktok_post_engagement?: number | null
          tiktok_reach?: number | null
          tiktok_results?: number | null
          tiktok_spend?: number | null
          tiktok_video_views?: number | null
          tiktok_video_views_100p?: number | null
          tiktok_video_views_2s?: number | null
          tiktok_video_views_6s?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_spend?: number | null
          ad_spend_allocated?: number | null
          ad_spend_generic_share?: number | null
          ad_spend_presale?: number | null
          ad_spend_specific?: number | null
          created_at?: string
          date?: string
          event_id?: string
          google_ads_clicks?: number | null
          google_ads_conversions?: number | null
          google_ads_impressions?: number | null
          google_ads_spend?: number | null
          google_ads_video_views?: number | null
          id?: string
          landing_page_views?: number | null
          link_clicks?: number | null
          meta_engagements?: number | null
          meta_impressions?: number | null
          meta_leads?: number | null
          meta_purchases?: number | null
          meta_reach?: number | null
          meta_regs?: number | null
          meta_video_plays_15s?: number | null
          meta_video_plays_3s?: number | null
          meta_video_plays_p100?: number | null
          notes?: string | null
          revenue?: number | null
          source_eventbrite_at?: string | null
          source_google_ads_at?: string | null
          source_meta_at?: string | null
          source_tiktok_at?: string | null
          tickets_sold?: number | null
          tiktok_avg_play_time_ms?: number | null
          tiktok_clicks?: number | null
          tiktok_engagement_results?: number | null
          tiktok_impressions?: number | null
          tiktok_post_engagement?: number | null
          tiktok_reach?: number | null
          tiktok_results?: number | null
          tiktok_spend?: number | null
          tiktok_video_views?: number | null
          tiktok_video_views_100p?: number | null
          tiktok_video_views_2s?: number | null
          tiktok_video_views_6s?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_daily_rollups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_daily_rollups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_daily_ticket_history: {
        Row: {
          currency: string | null
          date: string
          event_id: string
          fetched_at: string
          id: string
          revenue_minor: number
          source: string
          tickets_sold: number
          user_id: string
        }
        Insert: {
          currency?: string | null
          date: string
          event_id: string
          fetched_at?: string
          id?: string
          revenue_minor?: number
          source: string
          tickets_sold?: number
          user_id: string
        }
        Update: {
          currency?: string | null
          date?: string
          event_id?: string
          fetched_at?: string
          id?: string
          revenue_minor?: number
          source?: string
          tickets_sold?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_daily_ticket_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_daily_ticket_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_funnel_targets: {
        Row: {
          bofu_target_cpa: number | null
          bofu_target_cplpv: number | null
          bofu_target_lpv: number | null
          bofu_target_purchases: number | null
          bofu_to_sale_rate: number | null
          client_id: string
          created_at: string | null
          derived_from_event_id: string | null
          id: string
          mofu_target_clicks: number | null
          mofu_target_cpc: number | null
          mofu_to_bofu_rate: number | null
          scope_type: string
          scope_value: string
          source: string
          tofu_target_cpm: number | null
          tofu_target_reach: number | null
          tofu_to_mofu_rate: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          bofu_target_cpa?: number | null
          bofu_target_cplpv?: number | null
          bofu_target_lpv?: number | null
          bofu_target_purchases?: number | null
          bofu_to_sale_rate?: number | null
          client_id: string
          created_at?: string | null
          derived_from_event_id?: string | null
          id?: string
          mofu_target_clicks?: number | null
          mofu_target_cpc?: number | null
          mofu_to_bofu_rate?: number | null
          scope_type: string
          scope_value: string
          source: string
          tofu_target_cpm?: number | null
          tofu_target_reach?: number | null
          tofu_to_mofu_rate?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          bofu_target_cpa?: number | null
          bofu_target_cplpv?: number | null
          bofu_target_lpv?: number | null
          bofu_target_purchases?: number | null
          bofu_to_sale_rate?: number | null
          client_id?: string
          created_at?: string | null
          derived_from_event_id?: string | null
          id?: string
          mofu_target_clicks?: number | null
          mofu_target_cpc?: number | null
          mofu_to_bofu_rate?: number | null
          scope_type?: string
          scope_value?: string
          source?: string
          tofu_target_cpm?: number | null
          tofu_target_reach?: number | null
          tofu_to_mofu_rate?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_funnel_targets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_funnel_targets_derived_from_event_id_fkey"
            columns: ["derived_from_event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_funnel_targets_derived_from_event_id_fkey"
            columns: ["derived_from_event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_key_moments: {
        Row: {
          budget_multiplier: number | null
          category: string
          created_at: string
          event_id: string
          id: string
          label: string
          moment_date: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          budget_multiplier?: number | null
          category: string
          created_at?: string
          event_id: string
          id?: string
          label: string
          moment_date: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          budget_multiplier?: number | null
          category?: string
          created_at?: string
          event_id?: string
          id?: string
          label?: string
          moment_date?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_key_moments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_key_moments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_releases: {
        Row: {
          capacity: number | null
          community_at: string | null
          created_at: string
          event_id: string
          id: string
          list_at: string | null
          name: string
          position: number
          price: number | null
          remaining: number | null
          sold: number | null
          state: Database["public"]["Enums"]["release_state"]
          state_at: string | null
          state_set_by: string | null
          state_source:
            | Database["public"]["Enums"]["release_state_source"]
            | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capacity?: number | null
          community_at?: string | null
          created_at?: string
          event_id: string
          id?: string
          list_at?: string | null
          name: string
          position: number
          price?: number | null
          remaining?: number | null
          sold?: number | null
          state?: Database["public"]["Enums"]["release_state"]
          state_at?: string | null
          state_set_by?: string | null
          state_source?:
            | Database["public"]["Enums"]["release_state_source"]
            | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capacity?: number | null
          community_at?: string | null
          created_at?: string
          event_id?: string
          id?: string
          list_at?: string | null
          name?: string
          position?: number
          price?: number | null
          remaining?: number | null
          sold?: number | null
          state?: Database["public"]["Enums"]["release_state"]
          state_at?: string | null
          state_set_by?: string | null
          state_source?:
            | Database["public"]["Enums"]["release_state_source"]
            | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_releases_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_releases_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_signups: {
        Row: {
          anonymized_at: string | null
          client_id: string
          consent_gdpr_at: string
          consent_wa_opt_in_at: string | null
          created_at: string
          deduplicated_signup_id: string | null
          deleted_at: string | null
          email_encrypted: string | null
          email_hash: string | null
          event_id: string
          geo_city: string | null
          geo_country: string | null
          geo_region: string | null
          id: string
          ig_handle: string | null
          ip_hash: string | null
          phone_country_code: string | null
          phone_encrypted: string | null
          phone_hash: string | null
          referrer_url: string | null
          source: string | null
          tt_handle: string | null
          user_agent: string | null
          utm: Json
        }
        Insert: {
          anonymized_at?: string | null
          client_id: string
          consent_gdpr_at: string
          consent_wa_opt_in_at?: string | null
          created_at?: string
          deduplicated_signup_id?: string | null
          deleted_at?: string | null
          email_encrypted?: string | null
          email_hash?: string | null
          event_id: string
          geo_city?: string | null
          geo_country?: string | null
          geo_region?: string | null
          id?: string
          ig_handle?: string | null
          ip_hash?: string | null
          phone_country_code?: string | null
          phone_encrypted?: string | null
          phone_hash?: string | null
          referrer_url?: string | null
          source?: string | null
          tt_handle?: string | null
          user_agent?: string | null
          utm?: Json
        }
        Update: {
          anonymized_at?: string | null
          client_id?: string
          consent_gdpr_at?: string
          consent_wa_opt_in_at?: string | null
          created_at?: string
          deduplicated_signup_id?: string | null
          deleted_at?: string | null
          email_encrypted?: string | null
          email_hash?: string | null
          event_id?: string
          geo_city?: string | null
          geo_country?: string | null
          geo_region?: string | null
          id?: string
          ig_handle?: string | null
          ip_hash?: string | null
          phone_country_code?: string | null
          phone_encrypted?: string | null
          phone_hash?: string | null
          referrer_url?: string | null
          source?: string | null
          tt_handle?: string | null
          user_agent?: string | null
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "event_signups_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_signups_deduplicated_signup_id_fkey"
            columns: ["deduplicated_signup_id"]
            isOneToOne: false
            referencedRelation: "event_signups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_signups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_signups_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticket_tiers: {
        Row: {
          created_at: string
          event_id: string
          id: string
          price: number | null
          quantity_available: number | null
          quantity_sold: number
          snapshot_at: string
          tier_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          price?: number | null
          quantity_available?: number | null
          quantity_sold?: number
          snapshot_at?: string
          tier_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          price?: number | null
          quantity_available?: number | null
          quantity_sold?: number
          snapshot_at?: string
          tier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_ticket_tiers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_ticketing_links: {
        Row: {
          connection_id: string
          created_at: string
          event_id: string
          external_api_base: string | null
          external_event_id: string
          external_event_url: string | null
          id: string
          manual_lock: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          event_id: string
          external_api_base?: string | null
          external_event_id: string
          external_event_url?: string | null
          id?: string
          manual_lock?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          event_id?: string
          external_api_base?: string | null
          external_event_id?: string
          external_event_url?: string | null
          id?: string
          manual_lock?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_ticketing_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "client_ticketing_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_ticketing_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_ticketing_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          ad_spend_actual: number | null
          announcement_at: string | null
          budget_marketing: number | null
          campaign_end_at: string | null
          capacity: number | null
          client_id: string
          clip_selection_mode: string
          created_at: string
          drive_cancel_marked_at: string | null
          drive_folder_id: string | null
          drive_folder_linked: boolean
          drive_share_permission_id: string | null
          drive_shared_at: string | null
          drive_shared_by: string | null
          drive_shared_with: string | null
          event_code: string | null
          event_date: string | null
          event_start_at: string | null
          event_timezone: string | null
          favourite: boolean
          general_sale_at: string | null
          genres: string[]
          google_ads_account_id: string | null
          google_drive_folder_id: string | null
          google_drive_folder_url: string | null
          id: string
          kind: string
          mailchimp_audience_id: string | null
          mailchimp_tag: string | null
          meta_ad_account_id: string | null
          meta_campaign_id: string | null
          meta_spend_cached: number | null
          meta_spend_cached_at: string | null
          name: string
          notes: string | null
          objective: string | null
          preferred_provider: string | null
          prereg_spend: number | null
          presale_at: string | null
          report_cadence: string
          signup_url: string | null
          slug: string
          sold_out_at: string | null
          status: string
          target_capacity: number | null
          ticket_price: number | null
          ticket_url: string | null
          tickets_sold: number | null
          tiktok_account_id: string | null
          updated_at: string
          user_id: string
          venue_city: string | null
          venue_country: string | null
          venue_id: string | null
          venue_key: string | null
          venue_name: string | null
        }
        Insert: {
          ad_spend_actual?: number | null
          announcement_at?: string | null
          budget_marketing?: number | null
          campaign_end_at?: string | null
          capacity?: number | null
          client_id: string
          clip_selection_mode?: string
          created_at?: string
          drive_cancel_marked_at?: string | null
          drive_folder_id?: string | null
          drive_folder_linked?: boolean
          drive_share_permission_id?: string | null
          drive_shared_at?: string | null
          drive_shared_by?: string | null
          drive_shared_with?: string | null
          event_code?: string | null
          event_date?: string | null
          event_start_at?: string | null
          event_timezone?: string | null
          favourite?: boolean
          general_sale_at?: string | null
          genres?: string[]
          google_ads_account_id?: string | null
          google_drive_folder_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
          kind?: string
          mailchimp_audience_id?: string | null
          mailchimp_tag?: string | null
          meta_ad_account_id?: string | null
          meta_campaign_id?: string | null
          meta_spend_cached?: number | null
          meta_spend_cached_at?: string | null
          name: string
          notes?: string | null
          objective?: string | null
          preferred_provider?: string | null
          prereg_spend?: number | null
          presale_at?: string | null
          report_cadence?: string
          signup_url?: string | null
          slug: string
          sold_out_at?: string | null
          status?: string
          target_capacity?: number | null
          ticket_price?: number | null
          ticket_url?: string | null
          tickets_sold?: number | null
          tiktok_account_id?: string | null
          updated_at?: string
          user_id: string
          venue_city?: string | null
          venue_country?: string | null
          venue_id?: string | null
          venue_key?: string | null
          venue_name?: string | null
        }
        Update: {
          ad_spend_actual?: number | null
          announcement_at?: string | null
          budget_marketing?: number | null
          campaign_end_at?: string | null
          capacity?: number | null
          client_id?: string
          clip_selection_mode?: string
          created_at?: string
          drive_cancel_marked_at?: string | null
          drive_folder_id?: string | null
          drive_folder_linked?: boolean
          drive_share_permission_id?: string | null
          drive_shared_at?: string | null
          drive_shared_by?: string | null
          drive_shared_with?: string | null
          event_code?: string | null
          event_date?: string | null
          event_start_at?: string | null
          event_timezone?: string | null
          favourite?: boolean
          general_sale_at?: string | null
          genres?: string[]
          google_ads_account_id?: string | null
          google_drive_folder_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
          kind?: string
          mailchimp_audience_id?: string | null
          mailchimp_tag?: string | null
          meta_ad_account_id?: string | null
          meta_campaign_id?: string | null
          meta_spend_cached?: number | null
          meta_spend_cached_at?: string | null
          name?: string
          notes?: string | null
          objective?: string | null
          preferred_provider?: string | null
          prereg_spend?: number | null
          presale_at?: string | null
          report_cadence?: string
          signup_url?: string | null
          slug?: string
          sold_out_at?: string | null
          status?: string
          target_capacity?: number | null
          ticket_price?: number | null
          ticket_url?: string | null
          tickets_sold?: number | null
          tiktok_account_id?: string | null
          updated_at?: string
          user_id?: string
          venue_city?: string | null
          venue_country?: string | null
          venue_id?: string | null
          venue_key?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_tiktok_account_id_fkey"
            columns: ["tiktok_account_id"]
            isOneToOne: false
            referencedRelation: "tiktok_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      external_event_candidates: {
        Row: {
          capacity: number | null
          client_id: string
          connection_id: string
          created_at: string
          event_name: string
          external_event_id: string
          id: string
          last_synced_at: string
          provider: string
          raw_payload: Json | null
          start_date: string | null
          status: string | null
          tickets_sold: number | null
          updated_at: string
          url: string | null
          user_id: string
          venue: string | null
        }
        Insert: {
          capacity?: number | null
          client_id: string
          connection_id: string
          created_at?: string
          event_name: string
          external_event_id: string
          id?: string
          last_synced_at?: string
          provider: string
          raw_payload?: Json | null
          start_date?: string | null
          status?: string | null
          tickets_sold?: number | null
          updated_at?: string
          url?: string | null
          user_id: string
          venue?: string | null
        }
        Update: {
          capacity?: number | null
          client_id?: string
          connection_id?: string
          created_at?: string
          event_name?: string
          external_event_id?: string
          id?: string
          last_synced_at?: string
          provider?: string
          raw_payload?: Json | null
          start_date?: string | null
          status?: string | null
          tickets_sold?: number | null
          updated_at?: string
          url?: string | null
          user_id?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_event_candidates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "external_event_candidates_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "client_ticketing_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      google_ad_plans: {
        Row: {
          ad_scheduling: Json
          bidding_strategy: string | null
          campaigns: Json
          created_at: string
          event_id: string
          geo_targets: Json
          google_ads_account_id: string | null
          google_budget: number | null
          google_budget_pct: number | null
          id: string
          rlsa_adjustments: Json
          status: string
          target_cpa: number | null
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          ad_scheduling?: Json
          bidding_strategy?: string | null
          campaigns?: Json
          created_at?: string
          event_id: string
          geo_targets?: Json
          google_ads_account_id?: string | null
          google_budget?: number | null
          google_budget_pct?: number | null
          id?: string
          rlsa_adjustments?: Json
          status?: string
          target_cpa?: number | null
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          ad_scheduling?: Json
          bidding_strategy?: string | null
          campaigns?: Json
          created_at?: string
          event_id?: string
          geo_targets?: Json
          google_ads_account_id?: string | null
          google_budget?: number | null
          google_budget_pct?: number | null
          id?: string
          rlsa_adjustments?: Json
          status?: string
          target_cpa?: number | null
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_ad_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "google_ad_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_ad_plans_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      google_ads_accounts: {
        Row: {
          account_name: string
          conversion_actions_checked_at: string | null
          created_at: string
          credentials_encrypted: string | null
          credentials_format: string
          enabled_conversion_actions: number | null
          google_customer_id: string | null
          id: string
          login_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          conversion_actions_checked_at?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          enabled_conversion_actions?: number | null
          google_customer_id?: string | null
          id?: string
          login_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          conversion_actions_checked_at?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          enabled_conversion_actions?: number | null
          google_customer_id?: string | null
          id?: string
          login_customer_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      google_ads_daily_snapshots: {
        Row: {
          advertising_channel_type: string | null
          campaign_name: string | null
          campaign_resource_name: string
          clicks: number
          conversion_value_micros: number
          conversions: number
          cost_micros: number
          customer_id: string
          date: string
          event_code: string | null
          fetched_at: string
          google_ads_account_id: string
          id: string
          impressions: number
          plan_id: string | null
          plan_kind: string | null
          search_impression_share: number | null
          trueview_average_cpv_micros: number | null
          user_id: string
          video_trueview_view_rate: number | null
          video_trueview_views: number | null
        }
        Insert: {
          advertising_channel_type?: string | null
          campaign_name?: string | null
          campaign_resource_name: string
          clicks?: number
          conversion_value_micros?: number
          conversions?: number
          cost_micros?: number
          customer_id: string
          date: string
          event_code?: string | null
          fetched_at?: string
          google_ads_account_id: string
          id?: string
          impressions?: number
          plan_id?: string | null
          plan_kind?: string | null
          search_impression_share?: number | null
          trueview_average_cpv_micros?: number | null
          user_id: string
          video_trueview_view_rate?: number | null
          video_trueview_views?: number | null
        }
        Update: {
          advertising_channel_type?: string | null
          campaign_name?: string | null
          campaign_resource_name?: string
          clicks?: number
          conversion_value_micros?: number
          conversions?: number
          cost_micros?: number
          customer_id?: string
          date?: string
          event_code?: string | null
          fetched_at?: string
          google_ads_account_id?: string
          id?: string
          impressions?: number
          plan_id?: string | null
          plan_kind?: string | null
          search_impression_share?: number | null
          trueview_average_cpv_micros?: number | null
          user_id?: string
          video_trueview_view_rate?: number | null
          video_trueview_views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "google_ads_daily_snapshots_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      google_ads_insights_runs: {
        Row: {
          accounts: number
          calls: number
          failed_accounts: Json
          id: string
          ok: boolean
          outcomes: Json
          rows_written: number
          run_at: string
          since: string
          until: string
        }
        Insert: {
          accounts?: number
          calls?: number
          failed_accounts?: Json
          id?: string
          ok: boolean
          outcomes?: Json
          rows_written?: number
          run_at?: string
          since: string
          until: string
        }
        Update: {
          accounts?: number
          calls?: number
          failed_accounts?: Json
          id?: string
          ok?: boolean
          outcomes?: Json
          rows_written?: number
          run_at?: string
          since?: string
          until?: string
        }
        Relationships: []
      }
      google_ads_location_snapshots: {
        Row: {
          campaign_resource_name: string
          clicks: number
          cost_micros: number
          country_criterion_id: number
          customer_id: string
          date: string
          fetched_at: string
          id: string
          impressions: number
          location_type: string
          user_id: string
        }
        Insert: {
          campaign_resource_name: string
          clicks?: number
          cost_micros?: number
          country_criterion_id: number
          customer_id: string
          date: string
          fetched_at?: string
          id?: string
          impressions?: number
          location_type: string
          user_id: string
        }
        Update: {
          campaign_resource_name?: string
          clicks?: number
          cost_micros?: number
          country_criterion_id?: number
          customer_id?: string
          date?: string
          fetched_at?: string
          id?: string
          impressions?: number
          location_type?: string
          user_id?: string
        }
        Relationships: []
      }
      google_ads_search_terms_snapshots: {
        Row: {
          ad_group_resource_name: string
          campaign_resource_name: string
          clicks: number
          conversions: number
          cost_micros: number
          customer_id: string
          date: string
          fetched_at: string
          id: string
          impressions: number
          match_type: string
          plan_id: string | null
          search_term: string
          user_id: string
        }
        Insert: {
          ad_group_resource_name: string
          campaign_resource_name: string
          clicks?: number
          conversions?: number
          cost_micros?: number
          customer_id: string
          date: string
          fetched_at?: string
          id?: string
          impressions?: number
          match_type: string
          plan_id?: string | null
          search_term: string
          user_id: string
        }
        Update: {
          ad_group_resource_name?: string
          campaign_resource_name?: string
          clicks?: number
          conversions?: number
          cost_micros?: number
          customer_id?: string
          date?: string
          fetched_at?: string
          id?: string
          impressions?: number
          match_type?: string
          plan_id?: string | null
          search_term?: string
          user_id?: string
        }
        Relationships: []
      }
      google_search_ad_groups: {
        Row: {
          campaign_id: string
          created_at: string
          default_cpc: number | null
          id: string
          name: string
          pushed_resource_name: string | null
          sort_order: number
        }
        Insert: {
          campaign_id: string
          created_at?: string
          default_cpc?: number | null
          id?: string
          name: string
          pushed_resource_name?: string | null
          sort_order?: number
        }
        Update: {
          campaign_id?: string
          created_at?: string
          default_cpc?: number | null
          id?: string
          name?: string
          pushed_resource_name?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "google_search_ad_groups_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "google_search_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      google_search_campaigns: {
        Row: {
          bid_adjustments: Json
          created_at: string
          daily_budget: number | null
          id: string
          monthly_budget: number | null
          name: string
          notes: string | null
          plan_id: string
          priority: string | null
          pushed_resource_name: string | null
          sort_order: number
        }
        Insert: {
          bid_adjustments?: Json
          created_at?: string
          daily_budget?: number | null
          id?: string
          monthly_budget?: number | null
          name: string
          notes?: string | null
          plan_id: string
          priority?: string | null
          pushed_resource_name?: string | null
          sort_order?: number
        }
        Update: {
          bid_adjustments?: Json
          created_at?: string
          daily_budget?: number | null
          id?: string
          monthly_budget?: number | null
          name?: string
          notes?: string | null
          plan_id?: string
          priority?: string | null
          pushed_resource_name?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "google_search_campaigns_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "google_search_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      google_search_keywords: {
        Row: {
          ad_group_id: string
          created_at: string
          est_cpc_high: number | null
          est_cpc_low: number | null
          id: string
          intent: string | null
          keyword: string
          match_type: string
          notes: string | null
          pushed_resource_name: string | null
        }
        Insert: {
          ad_group_id: string
          created_at?: string
          est_cpc_high?: number | null
          est_cpc_low?: number | null
          id?: string
          intent?: string | null
          keyword: string
          match_type: string
          notes?: string | null
          pushed_resource_name?: string | null
        }
        Update: {
          ad_group_id?: string
          created_at?: string
          est_cpc_high?: number | null
          est_cpc_low?: number | null
          id?: string
          intent?: string | null
          keyword?: string
          match_type?: string
          notes?: string | null
          pushed_resource_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_search_keywords_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "google_search_ad_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      google_search_negatives: {
        Row: {
          ad_group_id: string | null
          campaign_id: string | null
          created_at: string
          id: string
          keyword: string
          match_type: string
          plan_id: string
          pushed_resource_name: string | null
          reason: string | null
        }
        Insert: {
          ad_group_id?: string | null
          campaign_id?: string | null
          created_at?: string
          id?: string
          keyword: string
          match_type: string
          plan_id: string
          pushed_resource_name?: string | null
          reason?: string | null
        }
        Update: {
          ad_group_id?: string | null
          campaign_id?: string | null
          created_at?: string
          id?: string
          keyword?: string
          match_type?: string
          plan_id?: string
          pushed_resource_name?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_search_negatives_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "google_search_ad_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_search_negatives_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "google_search_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_search_negatives_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "google_search_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      google_search_plans: {
        Row: {
          bidding_strategy: string
          created_at: string
          daily_budget: number | null
          date_range: Json | null
          event_id: string | null
          geo_targets: Json
          google_ads_account_id: string | null
          id: string
          name: string
          pacing: string
          pushed_at: string | null
          status: string
          structure_mode: string
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bidding_strategy?: string
          created_at?: string
          daily_budget?: number | null
          date_range?: Json | null
          event_id?: string | null
          geo_targets?: Json
          google_ads_account_id?: string | null
          id?: string
          name: string
          pacing?: string
          pushed_at?: string | null
          status?: string
          structure_mode?: string
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bidding_strategy?: string
          created_at?: string
          daily_budget?: number | null
          date_range?: Json | null
          event_id?: string | null
          geo_targets?: Json
          google_ads_account_id?: string | null
          id?: string
          name?: string
          pacing?: string
          pushed_at?: string | null
          status?: string
          structure_mode?: string
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_search_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "google_search_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_search_plans_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      google_search_rsas: {
        Row: {
          ad_group_id: string
          created_at: string
          descriptions: Json
          final_url: string | null
          headlines: Json
          id: string
          path1: string | null
          path2: string | null
          pushed_resource_name: string | null
        }
        Insert: {
          ad_group_id: string
          created_at?: string
          descriptions?: Json
          final_url?: string | null
          headlines?: Json
          id?: string
          path1?: string | null
          path2?: string | null
          pushed_resource_name?: string | null
        }
        Update: {
          ad_group_id?: string
          created_at?: string
          descriptions?: Json
          final_url?: string | null
          headlines?: Json
          id?: string
          path1?: string | null
          path2?: string | null
          pushed_resource_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_search_rsas_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "google_search_ad_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      google_search_sitelinks: {
        Row: {
          created_at: string
          description1: string | null
          description2: string | null
          final_url: string | null
          id: string
          link_text: string
          plan_id: string
          pushed_resource_name: string | null
          sort_order: number
        }
        Insert: {
          created_at?: string
          description1?: string | null
          description2?: string | null
          final_url?: string | null
          id?: string
          link_text: string
          plan_id: string
          pushed_resource_name?: string | null
          sort_order?: number
        }
        Update: {
          created_at?: string
          description1?: string | null
          description2?: string | null
          final_url?: string | null
          id?: string
          link_text?: string
          plan_id?: string
          pushed_resource_name?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "google_search_sitelinks_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "google_search_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      google_video_ad_groups: {
        Row: {
          campaign_id: string
          cpv_bid: number | null
          created_at: string
          id: string
          name: string
          sort_order: number
          status: string
        }
        Insert: {
          campaign_id: string
          cpv_bid?: number | null
          created_at?: string
          id?: string
          name: string
          sort_order?: number
          status?: string
        }
        Update: {
          campaign_id?: string
          cpv_bid?: number | null
          created_at?: string
          id?: string
          name?: string
          sort_order?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_video_ad_groups_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "google_video_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      google_video_ads: {
        Row: {
          call_to_action: string | null
          created_at: string
          description: string | null
          extra_copy: Json
          final_url: string | null
          headline: string | null
          id: string
          long_headline: string | null
          name: string
          note: string | null
          plan_id: string
          sort_order: number
          status: string
          video_id: string | null
          video_value: string | null
        }
        Insert: {
          call_to_action?: string | null
          created_at?: string
          description?: string | null
          extra_copy?: Json
          final_url?: string | null
          headline?: string | null
          id?: string
          long_headline?: string | null
          name: string
          note?: string | null
          plan_id: string
          sort_order?: number
          status?: string
          video_id?: string | null
          video_value?: string | null
        }
        Update: {
          call_to_action?: string | null
          created_at?: string
          description?: string | null
          extra_copy?: Json
          final_url?: string | null
          headline?: string | null
          id?: string
          long_headline?: string | null
          name?: string
          note?: string | null
          plan_id?: string
          sort_order?: number
          status?: string
          video_id?: string | null
          video_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_video_ads_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "google_video_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      google_video_campaigns: {
        Row: {
          created_at: string
          daily_budget: number | null
          google_campaign_resource_name: string | null
          id: string
          name: string
          plan_id: string
          sort_order: number
          status: string
          tier: string | null
        }
        Insert: {
          created_at?: string
          daily_budget?: number | null
          google_campaign_resource_name?: string | null
          id?: string
          name: string
          plan_id: string
          sort_order?: number
          status?: string
          tier?: string | null
        }
        Update: {
          created_at?: string
          daily_budget?: number | null
          google_campaign_resource_name?: string | null
          id?: string
          name?: string
          plan_id?: string
          sort_order?: number
          status?: string
          tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_video_campaigns_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "google_video_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      google_video_placements: {
        Row: {
          ad_group_id: string
          created_at: string
          id: string
          kind: string | null
          label: string
          note: string | null
          resolved_id: string | null
          sort_order: number
          status: string
          value: string
        }
        Insert: {
          ad_group_id: string
          created_at?: string
          id?: string
          kind?: string | null
          label: string
          note?: string | null
          resolved_id?: string | null
          sort_order?: number
          status?: string
          value?: string
        }
        Update: {
          ad_group_id?: string
          created_at?: string
          id?: string
          kind?: string | null
          label?: string
          note?: string | null
          resolved_id?: string | null
          sort_order?: number
          status?: string
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_video_placements_ad_group_id_fkey"
            columns: ["ad_group_id"]
            isOneToOne: false
            referencedRelation: "google_video_ad_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      google_video_plans: {
        Row: {
          business_name: string | null
          call_to_action: string | null
          cpv_bid: number | null
          created_at: string
          daily_budget: number | null
          device_exclusions: string[]
          display_url: string | null
          end_date: string | null
          event_id: string | null
          exported_at: string | null
          final_url: string | null
          frequency_cap_per_day: number | null
          frequency_cap_per_week: number | null
          geo_targets: Json
          google_ads_account_id: string | null
          id: string
          include_video_partners: boolean
          language_codes: string[]
          name: string
          settings_rows: Json
          source_filename: string | null
          start_date: string | null
          status: string
          targeting_rows: Json
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          business_name?: string | null
          call_to_action?: string | null
          cpv_bid?: number | null
          created_at?: string
          daily_budget?: number | null
          device_exclusions?: string[]
          display_url?: string | null
          end_date?: string | null
          event_id?: string | null
          exported_at?: string | null
          final_url?: string | null
          frequency_cap_per_day?: number | null
          frequency_cap_per_week?: number | null
          geo_targets?: Json
          google_ads_account_id?: string | null
          id?: string
          include_video_partners?: boolean
          language_codes?: string[]
          name: string
          settings_rows?: Json
          source_filename?: string | null
          start_date?: string | null
          status?: string
          targeting_rows?: Json
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          business_name?: string | null
          call_to_action?: string | null
          cpv_bid?: number | null
          created_at?: string
          daily_budget?: number | null
          device_exclusions?: string[]
          display_url?: string | null
          end_date?: string | null
          event_id?: string | null
          exported_at?: string | null
          final_url?: string | null
          frequency_cap_per_day?: number | null
          frequency_cap_per_week?: number | null
          geo_targets?: Json
          google_ads_account_id?: string | null
          id?: string
          include_video_partners?: boolean
          language_codes?: string[]
          name?: string
          settings_rows?: Json
          source_filename?: string | null
          start_date?: string | null
          status?: string
          targeting_rows?: Json
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_video_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "google_video_plans_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_video_plans_google_ads_account_id_fkey"
            columns: ["google_ads_account_id"]
            isOneToOne: false
            referencedRelation: "google_ads_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      interest_clusters: {
        Row: {
          archived_at: string | null
          created_at: string
          evidence: Json | null
          evidence_refreshed_at: string | null
          id: string
          interests: Json
          last_used_at: string | null
          live_evidence: Json | null
          name: string
          source: string
          unresolved: Json
          updated_at: string
          use_count: number
          user_id: string
          vertical: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          evidence?: Json | null
          evidence_refreshed_at?: string | null
          id?: string
          interests?: Json
          last_used_at?: string | null
          live_evidence?: Json | null
          name: string
          source: string
          unresolved?: Json
          updated_at?: string
          use_count?: number
          user_id: string
          vertical: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          evidence?: Json | null
          evidence_refreshed_at?: string | null
          id?: string
          interests?: Json
          last_used_at?: string | null
          live_evidence?: Json | null
          name?: string
          source?: string
          unresolved?: Json
          updated_at?: string
          use_count?: number
          user_id?: string
          vertical?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount_excl_vat: number
          amount_incl_vat: number | null
          client_id: string
          created_at: string
          due_date: string | null
          event_id: string | null
          id: string
          invoice_number: string | null
          invoice_type: string
          issued_date: string | null
          notes: string | null
          paid_date: string | null
          quote_id: string | null
          status: string
          updated_at: string
          user_id: string
          vat_applicable: boolean
          vat_rate: number
        }
        Insert: {
          amount_excl_vat: number
          amount_incl_vat?: number | null
          client_id: string
          created_at?: string
          due_date?: string | null
          event_id?: string | null
          id?: string
          invoice_number?: string | null
          invoice_type: string
          issued_date?: string | null
          notes?: string | null
          paid_date?: string | null
          quote_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          vat_applicable?: boolean
          vat_rate?: number
        }
        Update: {
          amount_excl_vat?: number
          amount_incl_vat?: number | null
          client_id?: string
          created_at?: string
          due_date?: string | null
          event_id?: string | null
          id?: string
          invoice_number?: string | null
          invoice_type?: string
          issued_date?: string | null
          notes?: string | null
          paid_date?: string | null
          quote_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          vat_applicable?: boolean
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "invoices_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      launched_ad_sets: {
        Row: {
          ad_account_id: string | null
          advantage_plus: boolean | null
          advantage_plus_effective: boolean | null
          age_max: number | null
          age_min: number | null
          channel: string
          client_id: string | null
          created_at: string
          descriptor_source: string
          draft_id: string | null
          event_id: string | null
          geo: Json | null
          id: string
          initial_daily_budget_pence: number | null
          interest_ids: Json | null
          launch_note: string | null
          launch_run_id: string
          launched_at: string
          lookalike_range: string | null
          meta_adset_id: string
          meta_campaign_id: string | null
          objective: string | null
          phase_at_launch: string | null
          source_id: string | null
          source_name: string | null
          source_type: string | null
          suggestion_id: string | null
          user_id: string | null
        }
        Insert: {
          ad_account_id?: string | null
          advantage_plus?: boolean | null
          advantage_plus_effective?: boolean | null
          age_max?: number | null
          age_min?: number | null
          channel?: string
          client_id?: string | null
          created_at?: string
          descriptor_source?: string
          draft_id?: string | null
          event_id?: string | null
          geo?: Json | null
          id?: string
          initial_daily_budget_pence?: number | null
          interest_ids?: Json | null
          launch_note?: string | null
          launch_run_id: string
          launched_at?: string
          lookalike_range?: string | null
          meta_adset_id: string
          meta_campaign_id?: string | null
          objective?: string | null
          phase_at_launch?: string | null
          source_id?: string | null
          source_name?: string | null
          source_type?: string | null
          suggestion_id?: string | null
          user_id?: string | null
        }
        Update: {
          ad_account_id?: string | null
          advantage_plus?: boolean | null
          advantage_plus_effective?: boolean | null
          age_max?: number | null
          age_min?: number | null
          channel?: string
          client_id?: string | null
          created_at?: string
          descriptor_source?: string
          draft_id?: string | null
          event_id?: string | null
          geo?: Json | null
          id?: string
          initial_daily_budget_pence?: number | null
          interest_ids?: Json | null
          launch_note?: string | null
          launch_run_id?: string
          launched_at?: string
          lookalike_range?: string | null
          meta_adset_id?: string
          meta_campaign_id?: string | null
          objective?: string | null
          phase_at_launch?: string | null
          source_id?: string | null
          source_name?: string | null
          source_type?: string | null
          suggestion_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "launched_ad_sets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launched_ad_sets_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launched_ad_sets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "launched_ad_sets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      launched_ads: {
        Row: {
          ad_account_id: string | null
          ad_name: string | null
          asset_content_hashes: Json
          channel: string
          client_id: string | null
          created_at: string
          creative_name: string | null
          cta: string | null
          descriptor_source: string
          destination_url: string | null
          draft_id: string | null
          event_id: string | null
          id: string
          launch_run_id: string
          launched_at: string
          media_type: string | null
          meta_ad_id: string
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_creative_id: string | null
          placement_mode: string | null
          source_type: string | null
          url_tags_applied: boolean | null
          user_id: string | null
          variation_count: number | null
        }
        Insert: {
          ad_account_id?: string | null
          ad_name?: string | null
          asset_content_hashes?: Json
          channel?: string
          client_id?: string | null
          created_at?: string
          creative_name?: string | null
          cta?: string | null
          descriptor_source?: string
          destination_url?: string | null
          draft_id?: string | null
          event_id?: string | null
          id?: string
          launch_run_id: string
          launched_at?: string
          media_type?: string | null
          meta_ad_id: string
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_creative_id?: string | null
          placement_mode?: string | null
          source_type?: string | null
          url_tags_applied?: boolean | null
          user_id?: string | null
          variation_count?: number | null
        }
        Update: {
          ad_account_id?: string | null
          ad_name?: string | null
          asset_content_hashes?: Json
          channel?: string
          client_id?: string | null
          created_at?: string
          creative_name?: string | null
          cta?: string | null
          descriptor_source?: string
          destination_url?: string | null
          draft_id?: string | null
          event_id?: string | null
          id?: string
          launch_run_id?: string
          launched_at?: string
          media_type?: string | null
          meta_ad_id?: string
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_creative_id?: string | null
          placement_mode?: string | null
          source_type?: string | null
          url_tags_applied?: boolean | null
          user_id?: string | null
          variation_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "launched_ads_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launched_ads_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "launched_ads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "launched_ads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      lp_page_views: {
        Row: {
          created_at: string
          event_id: string
          geo_city: string | null
          geo_country: string | null
          geo_region: string | null
          id: string
          occurred_at: string
          referrer: string | null
          utm: Json
        }
        Insert: {
          created_at?: string
          event_id: string
          geo_city?: string | null
          geo_country?: string | null
          geo_region?: string | null
          id?: string
          occurred_at?: string
          referrer?: string | null
          utm?: Json
        }
        Update: {
          created_at?: string
          event_id?: string
          geo_city?: string | null
          geo_country?: string | null
          geo_region?: string | null
          id?: string
          occurred_at?: string
          referrer?: string | null
          utm?: Json
        }
        Relationships: [
          {
            foreignKeyName: "lp_page_views_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "lp_page_views_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      mailchimp_accounts: {
        Row: {
          account_name: string | null
          created_at: string
          credentials_encrypted: string | null
          credentials_format: string
          id: string
          mailchimp_dc: string | null
          mailchimp_login_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          id?: string
          mailchimp_dc?: string | null
          mailchimp_login_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string | null
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          id?: string
          mailchimp_dc?: string | null
          mailchimp_login_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mailchimp_audience_snapshots: {
        Row: {
          avg_click_rate: number | null
          avg_open_rate: number | null
          cleaned: number | null
          client_id: string | null
          email_subscribers: number | null
          event_id: string | null
          id: string
          mailchimp_audience_id: string
          member_count_since_send: number | null
          pending: number | null
          raw_json: Json | null
          snapshot_at: string
          total_contacts: number | null
          unsubscribed: number | null
          user_id: string | null
        }
        Insert: {
          avg_click_rate?: number | null
          avg_open_rate?: number | null
          cleaned?: number | null
          client_id?: string | null
          email_subscribers?: number | null
          event_id?: string | null
          id?: string
          mailchimp_audience_id: string
          member_count_since_send?: number | null
          pending?: number | null
          raw_json?: Json | null
          snapshot_at?: string
          total_contacts?: number | null
          unsubscribed?: number | null
          user_id?: string | null
        }
        Update: {
          avg_click_rate?: number | null
          avg_open_rate?: number | null
          cleaned?: number | null
          client_id?: string | null
          email_subscribers?: number | null
          event_id?: string | null
          id?: string
          mailchimp_audience_id?: string
          member_count_since_send?: number | null
          pending?: number | null
          raw_json?: Json | null
          snapshot_at?: string
          total_contacts?: number | null
          unsubscribed?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mailchimp_audience_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailchimp_audience_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "mailchimp_audience_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      mailchimp_tag_backfill_jobs: {
        Row: {
          completed_at: string | null
          error_count: number
          event_id: string
          id: string
          last_error: string | null
          last_processed_member_hash: string | null
          last_progress_at: string | null
          mailchimp_audience_id: string
          mailchimp_tag: string
          members_processed: number
          started_at: string
          status: string
          summary: Json | null
          total_members: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_count?: number
          event_id: string
          id?: string
          last_error?: string | null
          last_processed_member_hash?: string | null
          last_progress_at?: string | null
          mailchimp_audience_id: string
          mailchimp_tag: string
          members_processed?: number
          started_at?: string
          status?: string
          summary?: Json | null
          total_members?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_count?: number
          event_id?: string
          id?: string
          last_error?: string | null
          last_processed_member_hash?: string | null
          last_progress_at?: string | null
          mailchimp_audience_id?: string
          mailchimp_tag?: string
          members_processed?: number
          started_at?: string
          status?: string
          summary?: Json | null
          total_members?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailchimp_tag_backfill_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "mailchimp_tag_backfill_jobs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      mailchimp_tag_event_log: {
        Row: {
          action: string
          client_id: string | null
          event_id: string
          event_timestamp: string
          id: number
          inserted_at: string
          mailchimp_audience_id: string
          mailchimp_tag: string
          member_email_address: string | null
          member_email_hash: string
          raw_webhook_body: Json | null
          user_id: string
        }
        Insert: {
          action: string
          client_id?: string | null
          event_id: string
          event_timestamp: string
          id?: number
          inserted_at?: string
          mailchimp_audience_id: string
          mailchimp_tag: string
          member_email_address?: string | null
          member_email_hash: string
          raw_webhook_body?: Json | null
          user_id: string
        }
        Update: {
          action?: string
          client_id?: string | null
          event_id?: string
          event_timestamp?: string
          id?: number
          inserted_at?: string
          mailchimp_audience_id?: string
          mailchimp_tag?: string
          member_email_address?: string | null
          member_email_hash?: string
          raw_webhook_body?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailchimp_tag_event_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailchimp_tag_event_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "mailchimp_tag_event_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      mailchimp_tag_snapshots: {
        Row: {
          client_id: string | null
          day: string | null
          email_subscribers: number
          event_id: string
          id: string
          mailchimp_audience_id: string
          mailchimp_tag: string
          raw_json: Json | null
          snapshot_at: string
          snapshot_date: string | null
          total_contacts: number
          user_id: string
        }
        Insert: {
          client_id?: string | null
          day?: string | null
          email_subscribers?: number
          event_id: string
          id?: string
          mailchimp_audience_id: string
          mailchimp_tag: string
          raw_json?: Json | null
          snapshot_at: string
          snapshot_date?: string | null
          total_contacts?: number
          user_id: string
        }
        Update: {
          client_id?: string | null
          day?: string | null
          email_subscribers?: number
          event_id?: string
          id?: string
          mailchimp_audience_id?: string
          mailchimp_tag?: string
          raw_json?: Json | null
          snapshot_at?: string
          snapshot_date?: string | null
          total_contacts?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mailchimp_tag_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailchimp_tag_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "mailchimp_tag_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_audience_write_idempotency: {
        Row: {
          audience_id: string
          created_at: string
          idempotency_key: string
          meta_audience_id: string | null
          user_id: string
        }
        Insert: {
          audience_id: string
          created_at?: string
          idempotency_key: string
          meta_audience_id?: string | null
          user_id: string
        }
        Update: {
          audience_id?: string
          created_at?: string
          idempotency_key?: string
          meta_audience_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_audience_write_idempotency_audience_id_fkey"
            columns: ["audience_id"]
            isOneToOne: false
            referencedRelation: "meta_custom_audiences"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_click_touchpoints: {
        Row: {
          ad_id: string | null
          adset_id: string | null
          campaign_id: string | null
          clicked_at: string
          client_id: string
          email_hash: string | null
          event_id: string | null
          external_id_hash: string | null
          fbc: string
          fbclid: string
          id: string
          inserted_at: string | null
          landing_url: string | null
        }
        Insert: {
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          clicked_at: string
          client_id: string
          email_hash?: string | null
          event_id?: string | null
          external_id_hash?: string | null
          fbc: string
          fbclid: string
          id?: string
          inserted_at?: string | null
          landing_url?: string | null
        }
        Update: {
          ad_id?: string | null
          adset_id?: string | null
          campaign_id?: string | null
          clicked_at?: string
          client_id?: string
          email_hash?: string | null
          event_id?: string | null
          external_id_hash?: string | null
          fbc?: string
          fbclid?: string
          id?: string
          inserted_at?: string | null
          landing_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_click_touchpoints_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_click_touchpoints_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "meta_click_touchpoints_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_custom_audiences: {
        Row: {
          audience_subtype: string
          client_id: string
          created_at: string
          event_id: string | null
          funnel_stage: string
          id: string
          meta_ad_account_id: string
          meta_audience_id: string | null
          name: string
          retention_days: number
          source_id: string
          source_meta: Json
          status: string
          status_error: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          audience_subtype: string
          client_id: string
          created_at?: string
          event_id?: string | null
          funnel_stage: string
          id?: string
          meta_ad_account_id: string
          meta_audience_id?: string | null
          name: string
          retention_days: number
          source_id: string
          source_meta?: Json
          status?: string
          status_error?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          audience_subtype?: string
          client_id?: string
          created_at?: string
          event_id?: string | null
          funnel_stage?: string
          id?: string
          meta_ad_account_id?: string
          meta_audience_id?: string | null
          name?: string
          retention_days?: number
          source_id?: string
          source_meta?: Json
          status?: string
          status_error?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_custom_audiences_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_custom_audiences_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "meta_custom_audiences_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_write_idempotency: {
        Row: {
          created_at: string
          draft_id: string
          event_id: string | null
          id: string
          op_kind: string
          op_payload_hash: string
          op_result_id: string | null
          op_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          event_id?: string | null
          id?: string
          op_kind: string
          op_payload_hash: string
          op_result_id?: string | null
          op_status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          event_id?: string | null
          id?: string
          op_kind?: string
          op_payload_hash?: string
          op_result_id?: string | null
          op_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_write_idempotency_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_write_idempotency_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "meta_write_idempotency_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_dedupe_state: {
        Row: {
          data: Json | null
          dedupe_key: string
          fire_count: number
          last_fired_at: string
          muted: boolean
          muted_at: string | null
        }
        Insert: {
          data?: Json | null
          dedupe_key: string
          fire_count?: number
          last_fired_at?: string
          muted?: boolean
          muted_at?: string | null
        }
        Update: {
          data?: Json | null
          dedupe_key?: string
          fire_count?: number
          last_fired_at?: string
          muted?: boolean
          muted_at?: string | null
        }
        Relationships: []
      }
      page_events: {
        Row: {
          artwork_palette: Json | null
          bottom_images: Json
          content: Json
          countdown_label: string | null
          countdown_target_at: string | null
          created_at: string
          customisation: Json
          event_id: string
          evntree_url: string | null
          hero_images: Json
          id: string
          modules: Json
          provider: string
          status: string
          template_key: string
          theme_overrides: Json
          updated_at: string
          visibility: Json
          youtube_url: string | null
        }
        Insert: {
          artwork_palette?: Json | null
          bottom_images?: Json
          content?: Json
          countdown_label?: string | null
          countdown_target_at?: string | null
          created_at?: string
          customisation?: Json
          event_id: string
          evntree_url?: string | null
          hero_images?: Json
          id?: string
          modules?: Json
          provider?: string
          status?: string
          template_key?: string
          theme_overrides?: Json
          updated_at?: string
          visibility?: Json
          youtube_url?: string | null
        }
        Update: {
          artwork_palette?: Json | null
          bottom_images?: Json
          content?: Json
          countdown_label?: string | null
          countdown_target_at?: string | null
          created_at?: string
          customisation?: Json
          event_id?: string
          evntree_url?: string | null
          hero_images?: Json
          id?: string
          modules?: Json
          provider?: string
          status?: string
          template_key?: string
          theme_overrides?: Json
          updated_at?: string
          visibility?: Json
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "page_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "page_events_template_key_fkey"
            columns: ["template_key"]
            isOneToOne: false
            referencedRelation: "page_templates"
            referencedColumns: ["key"]
          },
        ]
      }
      page_templates: {
        Row: {
          block_types_supported: Json
          default_config: Json
          id: string
          key: string
          name: string
          version: number
        }
        Insert: {
          block_types_supported?: Json
          default_config?: Json
          id?: string
          key: string
          name: string
          version?: number
        }
        Update: {
          block_types_supported?: Json
          default_config?: Json
          id?: string
          key?: string
          name?: string
          version?: number
        }
        Relationships: []
      }
      plan_share_tokens: {
        Row: {
          can_edit: boolean
          created_at: string
          enabled: boolean
          plan_id: string
          token: string
          user_id: string
        }
        Insert: {
          can_edit?: boolean
          created_at?: string
          enabled?: boolean
          plan_id: string
          token: string
          user_id: string
        }
        Update: {
          can_edit?: boolean
          created_at?: string
          enabled?: boolean
          plan_id?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_share_tokens_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "campaign_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          announcement_date: string | null
          approved_at: string | null
          base_fee: number
          billing_mode: string
          capacity: number
          client_id: string
          converted_at: string | null
          created_at: string
          event_date: string | null
          event_id: string | null
          event_name: string
          id: string
          marketing_budget: number | null
          max_fee: number
          notes: string | null
          quote_number: string
          retainer_months: number | null
          sell_out_bonus: number
          service_tier: string
          settlement_timing: string
          sold_out_expected: boolean
          status: string
          updated_at: string
          upfront_pct: number
          user_id: string
          venue_city: string | null
          venue_country: string | null
          venue_name: string | null
        }
        Insert: {
          announcement_date?: string | null
          approved_at?: string | null
          base_fee: number
          billing_mode?: string
          capacity: number
          client_id: string
          converted_at?: string | null
          created_at?: string
          event_date?: string | null
          event_id?: string | null
          event_name: string
          id?: string
          marketing_budget?: number | null
          max_fee: number
          notes?: string | null
          quote_number: string
          retainer_months?: number | null
          sell_out_bonus?: number
          service_tier: string
          settlement_timing?: string
          sold_out_expected?: boolean
          status?: string
          updated_at?: string
          upfront_pct?: number
          user_id: string
          venue_city?: string | null
          venue_country?: string | null
          venue_name?: string | null
        }
        Update: {
          announcement_date?: string | null
          approved_at?: string | null
          base_fee?: number
          billing_mode?: string
          capacity?: number
          client_id?: string
          converted_at?: string | null
          created_at?: string
          event_date?: string | null
          event_id?: string | null
          event_name?: string
          id?: string
          marketing_budget?: number | null
          max_fee?: number
          notes?: string | null
          quote_number?: string
          retainer_months?: number | null
          sell_out_bonus?: number
          service_tier?: string
          settlement_timing?: string
          sold_out_expected?: boolean
          status?: string
          updated_at?: string
          upfront_pct?: number
          user_id?: string
          venue_city?: string | null
          venue_country?: string | null
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "quotes_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      release_reads: {
        Row: {
          created_at: string
          event_id: string
          id: string
          per_release: Json
          raw_ref: string | null
          read_at: string
          source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          per_release: Json
          raw_ref?: string | null
          read_at: string
          source: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          per_release?: Json
          raw_ref?: string | null
          read_at?: string
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_reads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "release_reads_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      report_shares: {
        Row: {
          can_edit: boolean
          client_id: string | null
          created_at: string
          enabled: boolean
          event_code: string | null
          event_id: string | null
          expires_at: string | null
          last_viewed_at: string | null
          scope: string
          show_creative_insights: boolean
          show_funnel_pacing: boolean
          token: string
          user_id: string
          view_count: number
        }
        Insert: {
          can_edit?: boolean
          client_id?: string | null
          created_at?: string
          enabled?: boolean
          event_code?: string | null
          event_id?: string | null
          expires_at?: string | null
          last_viewed_at?: string | null
          scope?: string
          show_creative_insights?: boolean
          show_funnel_pacing?: boolean
          token: string
          user_id: string
          view_count?: number
        }
        Update: {
          can_edit?: boolean
          client_id?: string | null
          created_at?: string
          enabled?: boolean
          event_code?: string | null
          event_id?: string | null
          expires_at?: string | null
          last_viewed_at?: string | null
          scope?: string
          show_creative_insights?: boolean
          show_funnel_pacing?: boolean
          token?: string
          user_id?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "report_shares_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "report_shares_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      share_insight_snapshots: {
        Row: {
          build_version: string | null
          created_at: string
          custom_since: string | null
          custom_until: string | null
          date_preset: string
          expires_at: string
          fetched_at: string
          id: string
          payload: Json
          share_token: string
        }
        Insert: {
          build_version?: string | null
          created_at?: string
          custom_since?: string | null
          custom_until?: string | null
          date_preset: string
          expires_at: string
          fetched_at?: string
          id?: string
          payload: Json
          share_token: string
        }
        Update: {
          build_version?: string | null
          created_at?: string
          custom_since?: string | null
          custom_until?: string | null
          date_preset?: string
          expires_at?: string
          fetched_at?: string
          id?: string
          payload?: Json
          share_token?: string
        }
        Relationships: []
      }
      signup_source_snapshots: {
        Row: {
          day: string
          event_id: string
          id: string
          raw_json: Json | null
          signups_day: number
          signups_total: number
          snapshot_at: string
          source: string
        }
        Insert: {
          day: string
          event_id: string
          id?: string
          raw_json?: Json | null
          signups_day?: number
          signups_total?: number
          snapshot_at?: string
          source: string
        }
        Update: {
          day?: string
          event_id?: string
          id?: string
          raw_json?: Json | null
          signups_day?: number
          signups_total?: number
          snapshot_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "signup_source_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "signup_source_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tag_performance: {
        Row: {
          ads: number
          baseline_cpr: number | null
          computed_at: string
          confidence: string
          cpr: number | null
          ctr: number | null
          dimension: string
          events_n: number
          funded_ads: number
          id: string
          impressions: number
          index: number | null
          landing_page_views: number
          link_clicks: number
          n_effective: number | null
          pool_index: number | null
          results: number
          scope: string
          scope_id: string
          shrunk_index: number | null
          spend: number
          stage: string
          value_key: string
          video_plays_3s: number
          window_days: number
        }
        Insert: {
          ads?: number
          baseline_cpr?: number | null
          computed_at?: string
          confidence: string
          cpr?: number | null
          ctr?: number | null
          dimension: string
          events_n?: number
          funded_ads?: number
          id?: string
          impressions?: number
          index?: number | null
          landing_page_views?: number
          link_clicks?: number
          n_effective?: number | null
          pool_index?: number | null
          results?: number
          scope: string
          scope_id: string
          shrunk_index?: number | null
          spend?: number
          stage: string
          value_key: string
          video_plays_3s?: number
          window_days?: number
        }
        Update: {
          ads?: number
          baseline_cpr?: number | null
          computed_at?: string
          confidence?: string
          cpr?: number | null
          ctr?: number | null
          dimension?: string
          events_n?: number
          funded_ads?: number
          id?: string
          impressions?: number
          index?: number | null
          landing_page_views?: number
          link_clicks?: number
          n_effective?: number | null
          pool_index?: number | null
          results?: number
          scope?: string
          scope_id?: string
          shrunk_index?: number | null
          spend?: number
          stage?: string
          value_key?: string
          video_plays_3s?: number
          window_days?: number
        }
        Relationships: []
      }
      ticket_sales_snapshots: {
        Row: {
          connection_id: string | null
          created_at: string
          currency: string | null
          event_id: string
          external_event_id: string | null
          gross_revenue_cents: number | null
          id: string
          raw_payload: Json | null
          snapshot_at: string
          source: string
          tickets_available: number | null
          tickets_sold: number
          user_id: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          currency?: string | null
          event_id: string
          external_event_id?: string | null
          gross_revenue_cents?: number | null
          id?: string
          raw_payload?: Json | null
          snapshot_at?: string
          source?: string
          tickets_available?: number | null
          tickets_sold?: number
          user_id: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          currency?: string | null
          event_id?: string
          external_event_id?: string | null
          gross_revenue_cents?: number | null
          id?: string
          raw_payload?: Json | null
          snapshot_at?: string
          source?: string
          tickets_available?: number | null
          tickets_sold?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_sales_snapshots_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "client_ticketing_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_sales_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ticket_sales_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_warnings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          claim: string
          created_at: string
          drive_file_id: string | null
          event_id: string
          format: string
          id: string
          release_id: string | null
          render_id: string | null
          runs_from: string | null
          runs_to: string | null
          state: Database["public"]["Enums"]["ticket_warning_state"]
          trigger: Json | null
          updated_at: string
          user_id: string
          why: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          claim: string
          created_at?: string
          drive_file_id?: string | null
          event_id: string
          format: string
          id?: string
          release_id?: string | null
          render_id?: string | null
          runs_from?: string | null
          runs_to?: string | null
          state?: Database["public"]["Enums"]["ticket_warning_state"]
          trigger?: Json | null
          updated_at?: string
          user_id: string
          why?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          claim?: string
          created_at?: string
          drive_file_id?: string | null
          event_id?: string
          format?: string
          id?: string
          release_id?: string | null
          render_id?: string | null
          runs_from?: string | null
          runs_to?: string | null
          state?: Database["public"]["Enums"]["ticket_warning_state"]
          trigger?: Json | null
          updated_at?: string
          user_id?: string
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticket_warnings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ticket_warnings_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_warnings_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "event_releases"
            referencedColumns: ["id"]
          },
        ]
      }
      ticketing_purchase_events: {
        Row: {
          amount_minor: number | null
          client_id: string
          currency: string | null
          email_hash: string | null
          event_id: string
          external_id_hash: string | null
          external_order_id: string
          fbc: string | null
          fbp: string | null
          id: string
          inserted_at: string | null
          ip_hash: string | null
          provider: string
          purchased_at: string
          raw_payload: Json | null
          ticket_count: number
          ua: string | null
        }
        Insert: {
          amount_minor?: number | null
          client_id: string
          currency?: string | null
          email_hash?: string | null
          event_id: string
          external_id_hash?: string | null
          external_order_id: string
          fbc?: string | null
          fbp?: string | null
          id?: string
          inserted_at?: string | null
          ip_hash?: string | null
          provider: string
          purchased_at: string
          raw_payload?: Json | null
          ticket_count?: number
          ua?: string | null
        }
        Update: {
          amount_minor?: number | null
          client_id?: string
          currency?: string | null
          email_hash?: string | null
          event_id?: string
          external_id_hash?: string | null
          external_order_id?: string
          fbc?: string | null
          fbp?: string | null
          id?: string
          inserted_at?: string | null
          ip_hash?: string | null
          provider?: string
          purchased_at?: string
          raw_payload?: Json | null
          ticket_count?: number
          ua?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ticketing_purchase_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticketing_purchase_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "ticketing_purchase_events_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_channel_allocations: {
        Row: {
          allocation_count: number
          channel_id: string
          created_at: string
          event_id: string
          id: string
          notes: string | null
          tier_name: string
          updated_at: string
        }
        Insert: {
          allocation_count: number
          channel_id: string
          created_at?: string
          event_id: string
          id?: string
          notes?: string | null
          tier_name: string
          updated_at?: string
        }
        Update: {
          allocation_count?: number
          channel_id?: string
          created_at?: string
          event_id?: string
          id?: string
          notes?: string | null
          tier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_channel_allocations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "tier_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_channel_allocations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tier_channel_allocations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_channel_sales: {
        Row: {
          channel_id: string
          created_at: string
          event_id: string
          id: string
          notes: string | null
          revenue_amount: number
          revenue_overridden: boolean
          snapshot_at: string
          tickets_sold: number
          tier_name: string
          updated_at: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          event_id: string
          id?: string
          notes?: string | null
          revenue_amount?: number
          revenue_overridden?: boolean
          snapshot_at?: string
          tickets_sold: number
          tier_name: string
          updated_at?: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          event_id?: string
          id?: string
          notes?: string | null
          revenue_amount?: number
          revenue_overridden?: boolean
          snapshot_at?: string
          tickets_sold?: number
          tier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tier_channel_sales_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "tier_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tier_channel_sales_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tier_channel_sales_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_channel_sales_daily_history: {
        Row: {
          captured_at: string
          event_id: string
          id: string
          revenue_total: number
          snapshot_date: string
          source_kind: string
          tickets_sold_total: number
        }
        Insert: {
          captured_at?: string
          event_id: string
          id?: string
          revenue_total?: number
          snapshot_date: string
          source_kind: string
          tickets_sold_total: number
        }
        Update: {
          captured_at?: string
          event_id?: string
          id?: string
          revenue_total?: number
          snapshot_date?: string
          source_kind?: string
          tickets_sold_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "tier_channel_sales_daily_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tier_channel_sales_daily_history_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_channels: {
        Row: {
          channel_name: string
          client_id: string
          created_at: string
          display_label: string
          id: string
          is_automatic: boolean
          provider_link: string | null
        }
        Insert: {
          channel_name: string
          client_id: string
          created_at?: string
          display_label: string
          id?: string
          is_automatic?: boolean
          provider_link?: string | null
        }
        Update: {
          channel_name?: string
          client_id?: string
          created_at?: string
          display_label?: string
          id?: string
          is_automatic?: boolean
          provider_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tier_channels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_accounts: {
        Row: {
          access_token_encrypted: string | null
          account_name: string
          created_at: string
          credentials_encrypted: string | null
          credentials_format: string
          id: string
          tiktok_advertiser_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          account_name: string
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          id?: string
          tiktok_advertiser_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          account_name?: string
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          id?: string
          tiktok_advertiser_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tiktok_active_creatives_snapshots: {
        Row: {
          ad_id: string
          ad_name: string | null
          ad_text: string | null
          campaign_id: string | null
          campaign_name: string | null
          clicks: number | null
          created_at: string
          ctr: number | null
          deeplink_url: string | null
          error_message: string | null
          event_id: string
          fetched_at: string
          id: string
          identity_id: string | null
          identity_type: string | null
          image_ids: string[] | null
          impressions: number | null
          kind: string
          reach: number | null
          spend: number | null
          status: string | null
          thumbnail_url: string | null
          tiktok_item_id: string | null
          updated_at: string
          user_id: string
          video_id: string | null
          video_views_100p: number | null
          video_views_2s: number | null
          video_views_6s: number | null
          window_since: string
          window_until: string
        }
        Insert: {
          ad_id: string
          ad_name?: string | null
          ad_text?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          created_at?: string
          ctr?: number | null
          deeplink_url?: string | null
          error_message?: string | null
          event_id: string
          fetched_at?: string
          id?: string
          identity_id?: string | null
          identity_type?: string | null
          image_ids?: string[] | null
          impressions?: number | null
          kind: string
          reach?: number | null
          spend?: number | null
          status?: string | null
          thumbnail_url?: string | null
          tiktok_item_id?: string | null
          updated_at?: string
          user_id: string
          video_id?: string | null
          video_views_100p?: number | null
          video_views_2s?: number | null
          video_views_6s?: number | null
          window_since: string
          window_until: string
        }
        Update: {
          ad_id?: string
          ad_name?: string | null
          ad_text?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          clicks?: number | null
          created_at?: string
          ctr?: number | null
          deeplink_url?: string | null
          error_message?: string | null
          event_id?: string
          fetched_at?: string
          id?: string
          identity_id?: string | null
          identity_type?: string | null
          image_ids?: string[] | null
          impressions?: number | null
          kind?: string
          reach?: number | null
          spend?: number | null
          status?: string | null
          thumbnail_url?: string | null
          tiktok_item_id?: string | null
          updated_at?: string
          user_id?: string
          video_id?: string | null
          video_views_100p?: number | null
          video_views_2s?: number | null
          video_views_6s?: number | null
          window_since?: string
          window_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_active_creatives_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tiktok_active_creatives_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_breakdown_snapshots: {
        Row: {
          avg_play_time_ms: number | null
          clicks: number | null
          created_at: string
          ctr: number | null
          dimension: string
          dimension_value: string
          event_id: string
          fetched_at: string
          id: string
          impressions: number | null
          reach: number | null
          spend: number | null
          updated_at: string
          user_id: string
          video_views_100p: number | null
          video_views_2s: number | null
          video_views_6s: number | null
          window_since: string
          window_until: string
        }
        Insert: {
          avg_play_time_ms?: number | null
          clicks?: number | null
          created_at?: string
          ctr?: number | null
          dimension: string
          dimension_value: string
          event_id: string
          fetched_at?: string
          id?: string
          impressions?: number | null
          reach?: number | null
          spend?: number | null
          updated_at?: string
          user_id: string
          video_views_100p?: number | null
          video_views_2s?: number | null
          video_views_6s?: number | null
          window_since: string
          window_until: string
        }
        Update: {
          avg_play_time_ms?: number | null
          clicks?: number | null
          created_at?: string
          ctr?: number | null
          dimension?: string
          dimension_value?: string
          event_id?: string
          fetched_at?: string
          id?: string
          impressions?: number | null
          reach?: number | null
          spend?: number | null
          updated_at?: string
          user_id?: string
          video_views_100p?: number | null
          video_views_2s?: number | null
          video_views_6s?: number | null
          window_since?: string
          window_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_breakdown_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tiktok_breakdown_snapshots_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_campaign_drafts: {
        Row: {
          client_id: string | null
          created_at: string
          event_id: string | null
          id: string
          name: string | null
          state: Json
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          name?: string | null
          state?: Json
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          event_id?: string | null
          id?: string
          name?: string | null
          state?: Json
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_campaign_drafts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiktok_campaign_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tiktok_campaign_drafts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_campaign_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          snapshot: Json
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          snapshot: Json
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          snapshot?: Json
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tiktok_manual_reports: {
        Row: {
          campaign_name: string
          client_id: string | null
          created_at: string
          date_range_end: string
          date_range_start: string
          event_id: string | null
          id: string
          imported_at: string
          snapshot_json: Json
          source: string
          tiktok_account_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_name: string
          client_id?: string | null
          created_at?: string
          date_range_end: string
          date_range_start: string
          event_id?: string | null
          id?: string
          imported_at?: string
          snapshot_json: Json
          source?: string
          tiktok_account_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_name?: string
          client_id?: string | null
          created_at?: string
          date_range_end?: string
          date_range_start?: string
          event_id?: string | null
          id?: string
          imported_at?: string
          snapshot_json?: Json
          source?: string
          tiktok_account_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_manual_reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiktok_manual_reports_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tiktok_manual_reports_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiktok_manual_reports_tiktok_account_id_fkey"
            columns: ["tiktok_account_id"]
            isOneToOne: false
            referencedRelation: "tiktok_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tiktok_write_idempotency: {
        Row: {
          created_at: string
          draft_id: string
          event_id: string
          id: string
          op_kind: string
          op_payload_hash: string
          op_result_id: string | null
          op_status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          draft_id: string
          event_id: string
          id?: string
          op_kind: string
          op_payload_hash: string
          op_result_id?: string | null
          op_status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          draft_id?: string
          event_id?: string
          id?: string
          op_kind?: string
          op_payload_hash?: string
          op_result_id?: string | null
          op_status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiktok_write_idempotency_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "tiktok_campaign_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiktok_write_idempotency_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "campaign_plan_benchmarks_v"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "tiktok_write_idempotency_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ad_account_list_cache: {
        Row: {
          accounts: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          accounts: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          accounts?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_facebook_tokens: {
        Row: {
          expires_at: string | null
          provider_token: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          expires_at?: string | null
          provider_token: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          expires_at?: string | null
          provider_token?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string | null
          address_full: string | null
          capacity: number | null
          city: string
          country: string
          created_at: string
          enriched_at: string | null
          google_maps_url: string | null
          google_place_id: string | null
          id: string
          latitude: number | null
          longitude: number | null
          meta_page_id: string | null
          meta_page_name: string | null
          name: string
          notes: string | null
          phone: string | null
          photo_reference: string | null
          profile_jsonb: Json
          rating: number | null
          updated_at: string
          user_id: string
          user_ratings_total: number | null
          website: string | null
        }
        Insert: {
          address?: string | null
          address_full?: string | null
          capacity?: number | null
          city: string
          country?: string
          created_at?: string
          enriched_at?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          meta_page_id?: string | null
          meta_page_name?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          photo_reference?: string | null
          profile_jsonb?: Json
          rating?: number | null
          updated_at?: string
          user_id: string
          user_ratings_total?: number | null
          website?: string | null
        }
        Update: {
          address?: string | null
          address_full?: string | null
          capacity?: number | null
          city?: string
          country?: string
          created_at?: string
          enriched_at?: string | null
          google_maps_url?: string | null
          google_place_id?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          meta_page_id?: string | null
          meta_page_name?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          photo_reference?: string | null
          profile_jsonb?: Json
          rating?: number | null
          updated_at?: string
          user_id?: string
          user_ratings_total?: number | null
          website?: string | null
        }
        Relationships: []
      }
      voice_samples: {
        Row: {
          artist_id: string | null
          caption: string
          client_id: string
          comments: number | null
          fetched_at: string
          id: string
          ig_media_id: string
          likes: number | null
          page_kind: string
          permalink: string | null
          posted_at: string | null
          user_id: string
        }
        Insert: {
          artist_id?: string | null
          caption: string
          client_id: string
          comments?: number | null
          fetched_at?: string
          id?: string
          ig_media_id: string
          likes?: number | null
          page_kind: string
          permalink?: string | null
          posted_at?: string | null
          user_id: string
        }
        Update: {
          artist_id?: string | null
          caption?: string
          client_id?: string
          comments?: number | null
          fetched_at?: string
          id?: string
          ig_media_id?: string
          likes?: number | null
          page_kind?: string
          permalink?: string | null
          posted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_samples_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "creative_lab_artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_samples_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_community_alias_destinations: {
        Row: {
          activated_at: string | null
          alias_id: string
          created_at: string
          id: string
          invite_code: string
          is_active: boolean
          label: string | null
          sort_order: number
        }
        Insert: {
          activated_at?: string | null
          alias_id: string
          created_at?: string
          id?: string
          invite_code: string
          is_active?: boolean
          label?: string | null
          sort_order?: number
        }
        Update: {
          activated_at?: string | null
          alias_id?: string
          created_at?: string
          id?: string
          invite_code?: string
          is_active?: boolean
          label?: string | null
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "wa_community_alias_destinations_alias_id_fkey"
            columns: ["alias_id"]
            isOneToOne: false
            referencedRelation: "wa_community_aliases"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_community_alias_events: {
        Row: {
          action: string
          alias_id: string
          at: string
          detail: Json
          id: string
          user_id: string | null
        }
        Insert: {
          action: string
          alias_id: string
          at?: string
          detail?: Json
          id?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          alias_id?: string
          at?: string
          detail?: Json
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_community_alias_events_alias_id_fkey"
            columns: ["alias_id"]
            isOneToOne: false
            referencedRelation: "wa_community_aliases"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_community_aliases: {
        Row: {
          active_invite_code: string | null
          brand: string | null
          client_id: string | null
          created_at: string
          created_by_user_id: string | null
          event_ref: string | null
          id: string
          interstitial_enabled: boolean
          is_active: boolean
          notes: string | null
          slug: string
          updated_at: string
          updated_by_user_id: string | null
        }
        Insert: {
          active_invite_code?: string | null
          brand?: string | null
          client_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          event_ref?: string | null
          id?: string
          interstitial_enabled?: boolean
          is_active?: boolean
          notes?: string | null
          slug: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Update: {
          active_invite_code?: string | null
          brand?: string | null
          client_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          event_ref?: string | null
          id?: string
          interstitial_enabled?: boolean
          is_active?: boolean
          notes?: string | null
          slug?: string
          updated_at?: string
          updated_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_community_aliases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      campaign_plan_benchmarks_v: {
        Row: {
          channel: string | null
          client_id: string | null
          cost: number | null
          event_code: string | null
          event_date: string | null
          event_id: string | null
          results: number | null
          spend: number | null
          unit: string | null
          venue_key: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      v_event_code_attribution_snapshot: {
        Row: {
          attribution_rate: number | null
          attribution_state: string | null
          cache_fetched_at: string | null
          client_id: string | null
          event_code: string | null
          meta_regs: number | null
          tickets_rollup_sum: number | null
          tickets_tier_channel_sum: number | null
          tickets_true: number | null
        }
        Relationships: [
          {
            foreignKeyName: "event_code_lifetime_meta_cache_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      assert_wa_alias_invite_homes: {
        Args: { p_alias_id: string }
        Returns: undefined
      }
      clear_meta_system_user_token: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      create_community_alias: {
        Args: {
          p_actor: string
          p_brand: string
          p_client_id: string
          p_event_ref: string
          p_invite_code: string
          p_label: string
          p_notes: string
          p_slug: string
        }
        Returns: Json
      }
      dearmor: { Args: { "": string }; Returns: string }
      gen_random_uuid: { Args: never; Returns: string }
      gen_salt: { Args: { "": string }; Returns: string }
      get_bm_access_token: {
        Args: { p_id: string; p_key: string }
        Returns: string
      }
      get_d2c_credentials: {
        Args: { p_id: string; p_key: string }
        Returns: Json
      }
      get_google_ads_credentials: {
        Args: { p_account_id: string; p_key?: string }
        Returns: string
      }
      get_landing_page_capi_token: {
        Args: { p_client_id: string; p_key: string }
        Returns: string
      }
      get_mailchimp_credentials: {
        Args: { p_account_id: string; p_key: string }
        Returns: string
      }
      get_meta_system_user_token: {
        Args: { p_client_id: string; p_key: string }
        Returns: string
      }
      get_ticketing_credentials: {
        Args: { p_connection_id: string; p_key: string }
        Returns: string
      }
      get_tiktok_credentials: {
        Args: { p_account_id: string; p_key: string }
        Returns: string
      }
      increment_bulk_attach_template_use_count: {
        Args: { template_id: string; template_user_id: string }
        Returns: undefined
      }
      increment_interest_cluster_use: {
        Args: { p_id: string }
        Returns: {
          archived_at: string | null
          created_at: string
          evidence: Json | null
          evidence_refreshed_at: string | null
          id: string
          interests: Json
          last_used_at: string | null
          live_evidence: Json | null
          name: string
          source: string
          unresolved: Json
          updated_at: string
          use_count: number
          user_id: string
          vertical: string
        }[]
        SetofOptions: {
          from: "*"
          to: "interest_clusters"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      landing_page_decrypt: {
        Args: { p_blob: string; p_key: string }
        Returns: string
      }
      landing_page_decrypt_batch: {
        Args: { p_blobs: string[]; p_key: string }
        Returns: string[]
      }
      landing_page_encrypt: {
        Args: { p_key: string; p_plaintext: string }
        Returns: string
      }
      meta_reconcile_event_spend: {
        Args: {
          p_event_code: string
          p_since_date: string
          p_until_date: string
        }
        Returns: {
          campaign_id: string
          campaign_name: string
          drift: number
          drift_pct: number
          event_code: string
          meta_clicks: number
          meta_impressions: number
          meta_spend: number
          rollup_spend_lifetime: number
          rollup_spend_window: number
          status: string
        }[]
      }
      pgp_armor_headers: {
        Args: { "": string }
        Returns: Record<string, unknown>[]
      }
      repoint_community_alias: {
        Args: {
          p_actor: string
          p_invite_code: string
          p_label?: string
          p_slug: string
        }
        Returns: Json
      }
      set_bm_access_token: {
        Args: { p_id: string; p_key: string; p_token: string }
        Returns: undefined
      }
      set_d2c_credentials: {
        Args: { p_credentials: Json; p_id: string; p_key: string }
        Returns: undefined
      }
      set_google_ads_credentials: {
        Args: { p_account_id: string; p_key?: string; p_plaintext: string }
        Returns: undefined
      }
      set_landing_page_capi_token: {
        Args: { p_client_id: string; p_key: string; p_token: string }
        Returns: undefined
      }
      set_mailchimp_credentials: {
        Args: { p_account_id: string; p_key: string; p_plaintext: string }
        Returns: undefined
      }
      set_meta_system_user_token: {
        Args: { p_client_id: string; p_key: string; p_token: string }
        Returns: undefined
      }
      set_ticketing_credentials: {
        Args: { p_connection_id: string; p_key: string; p_plaintext: string }
        Returns: undefined
      }
      set_tiktok_credentials: {
        Args: { p_account_id: string; p_key: string; p_plaintext: string }
        Returns: undefined
      }
      url_encode: { Args: { input: string }; Returns: string }
    }
    Enums: {
      additional_spend_category:
        | "PR"
        | "INFLUENCER"
        | "PRINT"
        | "RADIO"
        | "OTHER"
      asset_queue_status:
        | "pending"
        | "matched"
        | "confirmed"
        | "launched"
        | "skipped"
        | "error"
        | "matched_umbrella"
      claim_trigger_kind:
        | "count_pct"
        | "state_days"
        | "state"
        | "page_remaining"
      release_state:
        | "not_yet"
        | "on_sale"
        | "selling_fast"
        | "final_x"
        | "sold_out"
      release_state_source: "vendor_page" | "client_message" | "entry"
      ticket_warning_state:
        | "held"
        | "locked"
        | "scheduled"
        | "live"
        | "done"
        | "back_to_held"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      additional_spend_category: [
        "PR",
        "INFLUENCER",
        "PRINT",
        "RADIO",
        "OTHER",
      ],
      asset_queue_status: [
        "pending",
        "matched",
        "confirmed",
        "launched",
        "skipped",
        "error",
        "matched_umbrella",
      ],
      claim_trigger_kind: [
        "count_pct",
        "state_days",
        "state",
        "page_remaining",
      ],
      release_state: [
        "not_yet",
        "on_sale",
        "selling_fast",
        "final_x",
        "sold_out",
      ],
      release_state_source: ["vendor_page", "client_message", "entry"],
      ticket_warning_state: [
        "held",
        "locked",
        "scheduled",
        "live",
        "done",
        "back_to_held",
      ],
    },
  },
} as const
