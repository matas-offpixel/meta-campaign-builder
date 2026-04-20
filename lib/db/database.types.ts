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
      artists: {
        Row: {
          created_at: string
          genres: string[]
          id: string
          instagram_handle: string | null
          meta_page_id: string | null
          meta_page_name: string | null
          name: string
          notes: string | null
          spotify_id: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          created_at?: string
          genres?: string[]
          id?: string
          instagram_handle?: string | null
          meta_page_id?: string | null
          meta_page_name?: string | null
          name: string
          notes?: string | null
          spotify_id?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          created_at?: string
          genres?: string[]
          id?: string
          instagram_handle?: string | null
          meta_page_id?: string | null
          meta_page_name?: string | null
          name?: string
          notes?: string | null
          spotify_id?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
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
          meta_ad_account_id: string | null
          meta_business_id: string | null
          meta_pixel_id: string | null
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
          meta_ad_account_id?: string | null
          meta_business_id?: string | null
          meta_pixel_id?: string | null
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
          meta_ad_account_id?: string | null
          meta_business_id?: string | null
          meta_pixel_id?: string | null
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
            foreignKeyName: "clients_tiktok_account_id_fkey"
            columns: ["tiktok_account_id"]
            isOneToOne: false
            referencedRelation: "tiktok_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_tags: {
        Row: {
          created_at: string
          event_id: string | null
          id: string
          meta_ad_id: string
          meta_creative_id: string | null
          tag_type: string
          tag_value: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id?: string | null
          id?: string
          meta_ad_id: string
          meta_creative_id?: string | null
          tag_type: string
          tag_value: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string | null
          id?: string
          meta_ad_id?: string
          meta_creative_id?: string | null
          tag_type?: string
          tag_value?: string
          user_id?: string
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
      events: {
        Row: {
          ad_spend_actual: number | null
          announcement_at: string | null
          budget_marketing: number | null
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
          name: string
          notes: string | null
          prereg_spend: number | null
          presale_at: string | null
          signup_url: string | null
          slug: string
          status: string
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
          name: string
          notes?: string | null
          prereg_spend?: number | null
          presale_at?: string | null
          signup_url?: string | null
          slug: string
          status?: string
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
          name?: string
          notes?: string | null
          prereg_spend?: number | null
          presale_at?: string | null
          signup_url?: string | null
          slug?: string
          status?: string
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
          google_customer_id: string | null
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          created_at?: string
          google_customer_id?: string | null
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          created_at?: string
          google_customer_id?: string | null
          id?: string
          updated_at?: string
          user_id?: string
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
          event_id: string | null
          expires_at: string | null
          last_viewed_at: string | null
          scope: string
          token: string
          user_id: string
          view_count: number
        }
        Insert: {
          can_edit?: boolean
          client_id?: string | null
          created_at?: string
          enabled?: boolean
          event_id?: string | null
          expires_at?: string | null
          last_viewed_at?: string | null
          scope?: string
          token: string
          user_id: string
          view_count?: number
        }
        Update: {
          can_edit?: boolean
          client_id?: string | null
          created_at?: string
          enabled?: boolean
          event_id?: string | null
          expires_at?: string | null
          last_viewed_at?: string | null
          scope?: string
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
      tiktok_accounts: {
        Row: {
          access_token_encrypted: string | null
          account_name: string
          created_at: string
          id: string
          tiktok_advertiser_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token_encrypted?: string | null
          account_name: string
          created_at?: string
          id?: string
          tiktok_advertiser_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token_encrypted?: string | null
          account_name?: string
          created_at?: string
          id?: string
          tiktok_advertiser_id?: string | null
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
          capacity: number | null
          city: string
          country: string
          created_at: string
          id: string
          meta_page_id: string | null
          meta_page_name: string | null
          name: string
          notes: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city: string
          country?: string
          created_at?: string
          id?: string
          meta_page_id?: string | null
          meta_page_name?: string | null
          name: string
          notes?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string
          country?: string
          created_at?: string
          id?: string
          meta_page_id?: string | null
          meta_page_name?: string | null
          name?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
