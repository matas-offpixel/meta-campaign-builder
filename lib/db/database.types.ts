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
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "events"
            referencedColumns: ["id"]
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
            referencedRelation: "events"
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
          default_page_ids: string[]
          default_settlement_timing: string | null
          default_upfront_pct: number | null
          facebook_page_handle: string | null
          google_ads_account_id: string | null
          google_ads_customer_id: string | null
          google_drive_folder_url: string | null
          id: string
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
        }
        Insert: {
          billing_model?: string
          created_at?: string
          custom_minimum_fee?: number | null
          custom_rate_per_ticket?: number | null
          default_page_ids?: string[]
          default_settlement_timing?: string | null
          default_upfront_pct?: number | null
          facebook_page_handle?: string | null
          google_ads_account_id?: string | null
          google_ads_customer_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
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
        }
        Update: {
          billing_model?: string
          created_at?: string
          custom_minimum_fee?: number | null
          custom_rate_per_ticket?: number | null
          default_page_ids?: string[]
          default_settlement_timing?: string | null
          default_upfront_pct?: number | null
          facebook_page_handle?: string | null
          google_ads_account_id?: string | null
          google_ads_customer_id?: string | null
          google_drive_folder_url?: string | null
          id?: string
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
          user_id: string
        }
        Insert: {
          artist_id: string
          billing_order?: number
          created_at?: string
          event_id: string
          id?: string
          is_headliner?: boolean
          user_id: string
        }
        Update: {
          artist_id?: string
          billing_order?: number
          created_at?: string
          event_id?: string
          id?: string
          is_headliner?: boolean
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
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_funnel_overrides: {
        Row: {
          bofu_to_reg_rate: number | null
          client_id: string
          cost_per_lpv: number | null
          cost_per_reach: number | null
          cost_per_reg: number | null
          created_at: string
          event_code: string | null
          event_id: string | null
          id: string
          mofu_to_bofu_rate: number | null
          organic_lift_rate: number | null
          reg_to_sale_rate: number | null
          sellout_target_override: number | null
          tofu_to_mofu_rate: number | null
          updated_at: string
        }
        Insert: {
          bofu_to_reg_rate?: number | null
          client_id: string
          cost_per_lpv?: number | null
          cost_per_reach?: number | null
          cost_per_reg?: number | null
          created_at?: string
          event_code?: string | null
          event_id?: string | null
          id?: string
          mofu_to_bofu_rate?: number | null
          organic_lift_rate?: number | null
          reg_to_sale_rate?: number | null
          sellout_target_override?: number | null
          tofu_to_mofu_rate?: number | null
          updated_at?: string
        }
        Update: {
          bofu_to_reg_rate?: number | null
          client_id?: string
          cost_per_lpv?: number | null
          cost_per_reach?: number | null
          cost_per_reg?: number | null
          created_at?: string
          event_code?: string | null
          event_id?: string | null
          id?: string
          mofu_to_bofu_rate?: number | null
          organic_lift_rate?: number | null
          reg_to_sale_rate?: number | null
          sellout_target_override?: number | null
          tofu_to_mofu_rate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_funnel_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_funnel_overrides_event_id_fkey"
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
          created_at: string
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
          venue_name: string | null
        }
        Insert: {
          ad_spend_actual?: number | null
          announcement_at?: string | null
          budget_marketing?: number | null
          campaign_end_at?: string | null
          capacity?: number | null
          client_id: string
          created_at?: string
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
          venue_name?: string | null
        }
        Update: {
          ad_spend_actual?: number | null
          announcement_at?: string | null
          budget_marketing?: number | null
          campaign_end_at?: string | null
          capacity?: number | null
          client_id?: string
          created_at?: string
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
          created_at: string
          credentials_encrypted: string | null
          credentials_format: string
          google_customer_id: string | null
          id: string
          login_customer_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          google_customer_id?: string | null
          id?: string
          login_customer_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          created_at?: string
          credentials_encrypted?: string | null
          credentials_format?: string
          google_customer_id?: string | null
          id?: string
          login_customer_id?: string | null
          updated_at?: string
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
          date_range: Json | null
          event_id: string | null
          geo_targets: Json
          google_ads_account_id: string | null
          id: string
          name: string
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
          date_range?: Json | null
          event_id?: string | null
          geo_targets?: Json
          google_ads_account_id?: string | null
          id?: string
          name: string
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
          date_range?: Json | null
          event_id?: string | null
          geo_targets?: Json
          google_ads_account_id?: string | null
          id?: string
          name?: string
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
            referencedRelation: "events"
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
            referencedRelation: "events"
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
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
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
      clear_meta_system_user_token: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      get_d2c_credentials: {
        Args: { p_id: string; p_key: string }
        Returns: Json
      }
      get_google_ads_credentials: {
        Args: { p_account_id: string; p_key?: string }
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
      set_d2c_credentials: {
        Args: { p_credentials: Json; p_id: string; p_key: string }
        Returns: undefined
      }
      set_google_ads_credentials: {
        Args: { p_account_id: string; p_key?: string; p_plaintext: string }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
    },
  },
} as const
