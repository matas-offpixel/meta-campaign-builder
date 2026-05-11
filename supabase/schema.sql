-- Schema dump: public schema
-- Generated: 2026-05-11T14:41:47.856Z
-- Source: db.zbtldbfjbhfvpksmdvnt.supabase.co (production)
-- NOTE: Generated via pg_catalog queries (Docker not available for pg_dump)

CREATE TABLE IF NOT EXISTS "active_creatives_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "date_preset" text NOT NULL,
  "custom_since" date,
  "custom_until" date,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_refresh_error" text,
  "is_stale" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "build_version" text
);

CREATE TABLE IF NOT EXISTS "ad_plan_audiences" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "objective" text NOT NULL,
  "geo_bucket" text,
  "city" text,
  "location" text,
  "proximity_km" numeric(5,1),
  "age_min" integer,
  "age_max" integer,
  "placements" text[] DEFAULT '{}'::text[] NOT NULL,
  "daily_budget" numeric(10,2),
  "total_budget" numeric(10,2),
  "audience_name" text,
  "info" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ad_plan_days" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "day" date NOT NULL,
  "phase_marker" text,
  "allocation_pct" numeric(5,2),
  "objective_budgets" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "tickets_sold_cumulative" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ticket_target" integer
);

CREATE TABLE IF NOT EXISTS "ad_plan_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ad_plans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "total_budget" numeric(12,2),
  "ticket_target" integer,
  "landing_page_url" text,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "legacy_spend" numeric(12,2)
);

CREATE TABLE IF NOT EXISTS "additional_spend_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "date" date NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  "category" additional_spend_category DEFAULT 'OTHER'::additional_spend_category NOT NULL,
  "label" text DEFAULT ''::text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "scope" text DEFAULT 'event'::text NOT NULL,
  "venue_event_code" text
);

CREATE TABLE IF NOT EXISTS "additional_ticket_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "event_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "tier_name" text,
  "tickets_count" integer NOT NULL,
  "revenue_amount" numeric DEFAULT 0,
  "date" date,
  "source" text,
  "label" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "artists" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "genres" text[] DEFAULT '{}'::text[] NOT NULL,
  "meta_page_id" text,
  "meta_page_name" text,
  "instagram_handle" text,
  "spotify_id" text,
  "website" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "musicbrainz_id" text,
  "facebook_page_url" text,
  "tiktok_handle" text,
  "soundcloud_url" text,
  "beatport_url" text,
  "bandcamp_url" text,
  "profile_image_url" text,
  "popularity_score" integer,
  "profile_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enriched_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "audience_seeds" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "meta_custom_audience_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "audience_source_cache" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "source_kind" text NOT NULL,
  "cache_key" text NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_size_bytes" integer DEFAULT octet_length((payload)::text),
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "build_version" text
);

CREATE TABLE IF NOT EXISTS "benchmark_alerts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid,
  "alert_type" text NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "entity_name" text,
  "metric" text,
  "metric_value" numeric,
  "benchmark_value" numeric,
  "deviation_pct" numeric,
  "severity" text NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "surfaced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "acknowledged_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "campaign_drafts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text,
  "objective" text,
  "draft_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ad_account_id" text,
  "status" text DEFAULT 'draft'::text,
  "client_id" uuid,
  "event_id" uuid
);

CREATE TABLE IF NOT EXISTS "campaign_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "tags" text[] DEFAULT '{}'::text[],
  "template_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "snapshot_json" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "client_report_weekly_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "week_start" date NOT NULL,
  "tickets_sold" integer,
  "tickets_sold_previous" integer,
  "revenue" numeric(12,2),
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL,
  "captured_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "client_ticketing_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_account_id" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "credentials_encrypted" bytea,
  "credentials_format" text DEFAULT 'v1'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS "clients" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "primary_type" text NOT NULL,
  "types" text[] DEFAULT '{}'::text[] NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "meta_ad_account_id" text,
  "meta_pixel_id" text,
  "default_page_ids" text[] DEFAULT '{}'::text[] NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "meta_business_id" text,
  "tiktok_ad_account_id" text,
  "google_ads_customer_id" text,
  "instagram_handle" text,
  "tiktok_handle" text,
  "facebook_page_handle" text,
  "google_drive_folder_url" text,
  "tiktok_account_id" uuid,
  "google_ads_account_id" uuid,
  "custom_rate_per_ticket" numeric(6,3),
  "custom_minimum_fee" numeric(10,2),
  "billing_model" text DEFAULT 'per_event'::text NOT NULL,
  "retainer_monthly_fee" numeric(10,2),
  "retainer_started_at" date,
  "default_upfront_pct" numeric(5,2) DEFAULT 75,
  "default_settlement_timing" text DEFAULT '1_month_before'::text,
  "last_probed_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "creative_enhancement_flags" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "ad_id" text NOT NULL,
  "creative_id" text NOT NULL,
  "ad_account_id" text NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid,
  "campaign_id" text,
  "ad_name" text,
  "flagged_features" jsonb NOT NULL,
  "severity_score" integer NOT NULL,
  "raw_features_spec" jsonb NOT NULL,
  "scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by_user_id" uuid,
  "tracked_only" boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS "creative_insight_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "ad_account_id" text NOT NULL,
  "ad_id" text NOT NULL,
  "date_preset" text NOT NULL,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ad_name" text,
  "ad_status" text,
  "campaign_id" text,
  "campaign_name" text,
  "campaign_objective" text,
  "adset_id" text,
  "creative_id" text,
  "creative_name" text,
  "thumbnail_url" text,
  "spend" numeric(12,2),
  "impressions" bigint,
  "clicks" integer,
  "ctr" numeric(8,4),
  "cpm" numeric(10,4),
  "cpc" numeric(10,4),
  "frequency" numeric(8,4),
  "reach" bigint,
  "link_clicks" integer,
  "purchases" integer,
  "registrations" integer,
  "cpl" numeric(10,2),
  "fatigue_score" text,
  "raw_insights" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "creative_renders" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid,
  "template_id" uuid NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "asset_url" text,
  "provider_job_id" text,
  "fields_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "creative_scores" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "creative_name" text NOT NULL,
  "axis" text NOT NULL,
  "score" integer NOT NULL,
  "significance" boolean DEFAULT false NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "creative_tag_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "creative_name" text NOT NULL,
  "tag_id" uuid NOT NULL,
  "source" text NOT NULL,
  "confidence" numeric(4,3),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "model_version" text
);

CREATE TABLE IF NOT EXISTS "creative_tags" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid,
  "meta_ad_id" text,
  "meta_creative_id" text,
  "tag_type" text,
  "tag_value" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "dimension" text,
  "value_key" text,
  "value_label" text,
  "description" text,
  "source" text DEFAULT 'motion_seed'::text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "creative_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "provider" text NOT NULL,
  "external_template_id" text,
  "fields_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "channel" text DEFAULT 'feed'::text NOT NULL,
  "aspect_ratios" text[] DEFAULT ARRAY['1:1'::text] NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "d2c_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "external_account_id" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "last_synced_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "d2c_scheduled_sends" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "template_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "channel" text NOT NULL,
  "audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "scheduled_for" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'scheduled'::text NOT NULL,
  "result_jsonb" jsonb,
  "dry_run" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "d2c_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid,
  "name" text NOT NULL,
  "channel" text NOT NULL,
  "subject" text,
  "body_markdown" text DEFAULT ''::text NOT NULL,
  "variables_jsonb" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "daily_tracking_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "date" date NOT NULL,
  "day_spend" numeric,
  "tickets" integer,
  "revenue" numeric,
  "link_clicks" integer,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_activity_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "source" text NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload_jsonb" jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_artists" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "artist_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "is_headliner" boolean DEFAULT false NOT NULL,
  "billing_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_daily_rollups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "date" date NOT NULL,
  "ad_spend" numeric(12,2),
  "link_clicks" integer,
  "tickets_sold" integer,
  "revenue" numeric(12,2),
  "source_meta_at" timestamp with time zone,
  "source_eventbrite_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "meta_regs" integer,
  "ad_spend_allocated" numeric(12,2),
  "ad_spend_specific" numeric(12,2),
  "ad_spend_generic_share" numeric(12,2),
  "ad_spend_presale" numeric(12,2),
  "tiktok_spend" numeric(12,2) DEFAULT 0,
  "tiktok_impressions" integer DEFAULT 0,
  "tiktok_clicks" integer DEFAULT 0,
  "tiktok_video_views" integer DEFAULT 0,
  "tiktok_results" integer DEFAULT 0,
  "source_tiktok_at" timestamp with time zone,
  "tiktok_reach" integer,
  "tiktok_video_views_2s" integer,
  "tiktok_video_views_6s" integer,
  "tiktok_video_views_100p" integer,
  "tiktok_avg_play_time_ms" integer,
  "tiktok_post_engagement" integer,
  "google_ads_spend" numeric(12,2),
  "google_ads_impressions" integer,
  "google_ads_clicks" integer,
  "google_ads_conversions" integer,
  "google_ads_video_views" integer,
  "source_google_ads_at" timestamp with time zone,
  "meta_impressions" integer,
  "meta_reach" integer,
  "meta_video_plays_3s" integer,
  "meta_video_plays_15s" integer,
  "meta_video_plays_p100" integer,
  "meta_engagements" integer
);

CREATE TABLE IF NOT EXISTS "event_funnel_overrides" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid,
  "event_code" text,
  "tofu_to_mofu_rate" numeric,
  "mofu_to_bofu_rate" numeric,
  "bofu_to_reg_rate" numeric DEFAULT 0.1827,
  "reg_to_sale_rate" numeric DEFAULT 0.51,
  "organic_lift_rate" numeric DEFAULT 0.57,
  "cost_per_reach" numeric,
  "cost_per_lpv" numeric,
  "cost_per_reg" numeric DEFAULT 1.00,
  "sellout_target_override" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_funnel_targets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "scope_type" text NOT NULL,
  "scope_value" text NOT NULL,
  "tofu_target_reach" integer,
  "tofu_target_cpm" numeric(10,2),
  "mofu_target_clicks" integer,
  "mofu_target_cpc" numeric(10,2),
  "bofu_target_lpv" integer,
  "bofu_target_cplpv" numeric(10,2),
  "bofu_target_purchases" integer,
  "bofu_target_cpa" numeric(10,2),
  "tofu_to_mofu_rate" numeric(5,4),
  "mofu_to_bofu_rate" numeric(5,4),
  "bofu_to_sale_rate" numeric(5,4),
  "source" text NOT NULL,
  "derived_from_event_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "event_key_moments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "moment_date" date NOT NULL,
  "label" text NOT NULL,
  "category" text NOT NULL,
  "source" text DEFAULT 'manual'::text NOT NULL,
  "budget_multiplier" numeric(5,2),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_ticket_tiers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "tier_name" text NOT NULL,
  "price" numeric,
  "quantity_sold" integer DEFAULT 0 NOT NULL,
  "quantity_available" integer,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_ticketing_links" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "external_event_id" text NOT NULL,
  "external_event_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "manual_lock" boolean DEFAULT false NOT NULL,
  "external_api_base" text
);

CREATE TABLE IF NOT EXISTS "events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "event_code" text,
  "capacity" integer,
  "genres" text[] DEFAULT '{}'::text[] NOT NULL,
  "venue_name" text,
  "venue_city" text,
  "venue_country" text,
  "event_timezone" text,
  "event_date" date,
  "event_start_at" timestamp with time zone,
  "announcement_at" timestamp with time zone,
  "presale_at" timestamp with time zone,
  "general_sale_at" timestamp with time zone,
  "ticket_url" text,
  "signup_url" text,
  "status" text DEFAULT 'upcoming'::text NOT NULL,
  "budget_marketing" numeric(12,2),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "favourite" boolean DEFAULT false NOT NULL,
  "tickets_sold" integer,
  "google_drive_folder_id" text,
  "google_drive_folder_url" text,
  "tiktok_account_id" uuid,
  "google_ads_account_id" uuid,
  "venue_id" uuid,
  "ticket_price" numeric(8,2),
  "ad_spend_actual" numeric(10,2),
  "prereg_spend" numeric(10,2),
  "meta_campaign_id" text,
  "meta_spend_cached" numeric(12,2),
  "meta_spend_cached_at" timestamp with time zone,
  "kind" text DEFAULT 'event'::text NOT NULL,
  "objective" text,
  "campaign_end_at" timestamp with time zone,
  "report_cadence" text DEFAULT 'daily'::text NOT NULL,
  "preferred_provider" text
);

CREATE TABLE IF NOT EXISTS "external_event_candidates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "connection_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "external_event_id" text NOT NULL,
  "event_name" text NOT NULL,
  "venue" text,
  "start_date" timestamp with time zone,
  "url" text,
  "capacity" integer,
  "tickets_sold" integer,
  "status" text,
  "raw_payload" jsonb,
  "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "google_ad_plans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "google_ads_account_id" uuid,
  "total_budget" numeric(10,2),
  "google_budget" numeric(10,2),
  "google_budget_pct" numeric(5,2),
  "bidding_strategy" text,
  "target_cpa" numeric(8,2),
  "geo_targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "rlsa_adjustments" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ad_scheduling" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "campaigns" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "google_ads_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_name" text NOT NULL,
  "google_customer_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "credentials_encrypted" bytea,
  "credentials_format" text DEFAULT 'v1'::text NOT NULL,
  "login_customer_id" text
);

CREATE TABLE IF NOT EXISTS "invoices" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid,
  "quote_id" uuid,
  "invoice_number" text,
  "invoice_type" text NOT NULL,
  "amount_excl_vat" numeric(10,2) NOT NULL,
  "vat_applicable" boolean DEFAULT true NOT NULL,
  "vat_rate" numeric(5,4) DEFAULT 0.2000 NOT NULL,
  "amount_incl_vat" numeric(10,2) DEFAULT 
CASE
    WHEN vat_applicable THEN round((amount_excl_vat * ((1)::numeric + vat_rate)), 2)
    ELSE amount_excl_vat
END,
  "issued_date" date,
  "due_date" date,
  "paid_date" date,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "meta_audience_write_idempotency" (
  "idempotency_key" text NOT NULL,
  "user_id" uuid NOT NULL,
  "audience_id" uuid NOT NULL,
  "meta_audience_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "meta_custom_audiences" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid,
  "name" text NOT NULL,
  "funnel_stage" text NOT NULL,
  "audience_subtype" text NOT NULL,
  "retention_days" integer NOT NULL,
  "source_id" text NOT NULL,
  "source_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "meta_audience_id" text,
  "meta_ad_account_id" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "status_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "quotes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "event_id" uuid,
  "quote_number" text NOT NULL,
  "event_name" text NOT NULL,
  "event_date" date,
  "announcement_date" date,
  "venue_name" text,
  "venue_city" text,
  "venue_country" text,
  "capacity" integer NOT NULL,
  "marketing_budget" numeric(10,2),
  "service_tier" text NOT NULL,
  "sold_out_expected" boolean DEFAULT false NOT NULL,
  "base_fee" numeric(10,2) NOT NULL,
  "sell_out_bonus" numeric(10,2) DEFAULT 0 NOT NULL,
  "max_fee" numeric(10,2) NOT NULL,
  "upfront_pct" numeric(5,2) DEFAULT 75 NOT NULL,
  "settlement_timing" text DEFAULT '1_month_before'::text NOT NULL,
  "billing_mode" text DEFAULT 'per_event'::text NOT NULL,
  "retainer_months" integer,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "approved_at" timestamp with time zone,
  "converted_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "report_shares" (
  "token" text NOT NULL,
  "event_id" uuid,
  "user_id" uuid NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "expires_at" timestamp with time zone,
  "view_count" integer DEFAULT 0 NOT NULL,
  "last_viewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "can_edit" boolean DEFAULT false NOT NULL,
  "scope" text DEFAULT 'event'::text NOT NULL,
  "client_id" uuid,
  "event_code" text,
  "show_creative_insights" boolean DEFAULT true NOT NULL,
  "show_funnel_pacing" boolean DEFAULT true NOT NULL
);

CREATE TABLE IF NOT EXISTS "share_insight_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "share_token" text NOT NULL,
  "date_preset" text NOT NULL,
  "custom_since" date,
  "custom_until" date,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "build_version" text
);

CREATE TABLE IF NOT EXISTS "ticket_sales_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "connection_id" uuid,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "tickets_sold" integer DEFAULT 0 NOT NULL,
  "tickets_available" integer,
  "gross_revenue_cents" bigint,
  "currency" text DEFAULT 'GBP'::text,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "source" text DEFAULT 'eventbrite'::text NOT NULL,
  "external_event_id" text
);

CREATE TABLE IF NOT EXISTS "tier_channel_allocations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "tier_name" text NOT NULL,
  "channel_id" uuid NOT NULL,
  "allocation_count" integer NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tier_channel_sales" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "tier_name" text NOT NULL,
  "channel_id" uuid NOT NULL,
  "tickets_sold" integer NOT NULL,
  "revenue_amount" numeric DEFAULT 0 NOT NULL,
  "revenue_overridden" boolean DEFAULT false NOT NULL,
  "notes" text,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tier_channel_sales_daily_history" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "event_id" uuid NOT NULL,
  "snapshot_date" date NOT NULL,
  "tickets_sold_total" integer NOT NULL,
  "revenue_total" numeric(12,2) DEFAULT 0 NOT NULL,
  "source_kind" text NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tier_channels" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "channel_name" text NOT NULL,
  "display_label" text NOT NULL,
  "is_automatic" boolean DEFAULT false NOT NULL,
  "provider_link" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "account_name" text NOT NULL,
  "tiktok_advertiser_id" text,
  "access_token_encrypted" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "credentials_encrypted" bytea,
  "credentials_format" text DEFAULT 'v1'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_active_creatives_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "ad_id" text NOT NULL,
  "ad_name" text,
  "campaign_id" text,
  "campaign_name" text,
  "status" text,
  "spend" numeric(12,2),
  "impressions" integer,
  "reach" integer,
  "clicks" integer,
  "ctr" numeric(8,4),
  "video_views_2s" integer,
  "video_views_6s" integer,
  "video_views_100p" integer,
  "thumbnail_url" text,
  "deeplink_url" text,
  "ad_text" text,
  "window_since" date NOT NULL,
  "window_until" date NOT NULL,
  "kind" text NOT NULL,
  "error_message" text,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_breakdown_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "dimension" text NOT NULL,
  "dimension_value" text NOT NULL,
  "spend" numeric(12,2),
  "impressions" integer,
  "reach" integer,
  "clicks" integer,
  "ctr" numeric(8,4),
  "video_views_2s" integer,
  "video_views_6s" integer,
  "video_views_100p" integer,
  "avg_play_time_ms" integer,
  "window_since" date NOT NULL,
  "window_until" date NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_campaign_drafts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid,
  "event_id" uuid,
  "name" text,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_campaign_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_manual_reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "client_id" uuid,
  "event_id" uuid,
  "tiktok_account_id" uuid,
  "campaign_name" text NOT NULL,
  "date_range_start" date NOT NULL,
  "date_range_end" date NOT NULL,
  "source" text DEFAULT 'manual_xlsx'::text NOT NULL,
  "imported_at" timestamp with time zone DEFAULT now() NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tiktok_write_idempotency" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "draft_id" uuid NOT NULL,
  "op_kind" text NOT NULL,
  "op_payload_hash" text NOT NULL,
  "op_result_id" text,
  "op_status" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "user_facebook_tokens" (
  "user_id" uuid NOT NULL,
  "provider_token" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "venues" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "city" text NOT NULL,
  "country" text DEFAULT 'GB'::text NOT NULL,
  "capacity" integer,
  "address" text,
  "meta_page_id" text,
  "meta_page_name" text,
  "website" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "google_place_id" text,
  "latitude" double precision,
  "longitude" double precision,
  "phone" text,
  "address_full" text,
  "google_maps_url" text,
  "rating" numeric(2,1),
  "user_ratings_total" integer,
  "photo_reference" text,
  "profile_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enriched_at" timestamp with time zone
);

-- Indexes
CREATE INDEX acs_event_preset_idx ON public.active_creatives_snapshots USING btree (event_id, date_preset, expires_at DESC);
CREATE INDEX acs_user_id_idx ON public.active_creatives_snapshots USING btree (user_id);
CREATE INDEX active_creatives_snapshots_build_version_idx ON public.active_creatives_snapshots USING btree (build_version) WHERE (build_version IS NOT NULL);
CREATE UNIQUE INDEX active_creatives_snapshots_event_window_key ON public.active_creatives_snapshots USING btree (event_id, date_preset, custom_since, custom_until) NULLS NOT DISTINCT;
CREATE UNIQUE INDEX active_creatives_snapshots_pkey ON public.active_creatives_snapshots USING btree (id);
CREATE UNIQUE INDEX ad_plan_audiences_pkey ON public.ad_plan_audiences USING btree (id);
CREATE INDEX ad_plan_audiences_plan_sort_idx ON public.ad_plan_audiences USING btree (plan_id, sort_order);
CREATE UNIQUE INDEX ad_plan_days_pkey ON public.ad_plan_days USING btree (id);
CREATE INDEX ad_plan_days_plan_day_idx ON public.ad_plan_days USING btree (plan_id, day);
CREATE UNIQUE INDEX ad_plan_days_unique ON public.ad_plan_days USING btree (plan_id, day);
CREATE UNIQUE INDEX ad_plan_templates_name_unique_per_user ON public.ad_plan_templates USING btree (user_id, name);
CREATE UNIQUE INDEX ad_plan_templates_pkey ON public.ad_plan_templates USING btree (id);
CREATE INDEX ad_plan_templates_user_idx ON public.ad_plan_templates USING btree (user_id);
CREATE UNIQUE INDEX ad_plans_pkey ON public.ad_plans USING btree (id);
CREATE INDEX ad_plans_user_event_idx ON public.ad_plans USING btree (user_id, event_id);
CREATE INDEX additional_spend_entries_event_date_idx ON public.additional_spend_entries USING btree (event_id, date DESC);
CREATE UNIQUE INDEX additional_spend_entries_pkey ON public.additional_spend_entries USING btree (id);
CREATE INDEX additional_spend_entries_venue_idx ON public.additional_spend_entries USING btree (venue_event_code) WHERE (scope = 'venue'::text);
CREATE INDEX additional_ticket_entries_event_id_idx ON public.additional_ticket_entries USING btree (event_id);
CREATE UNIQUE INDEX additional_ticket_entries_pkey ON public.additional_ticket_entries USING btree (id);
CREATE UNIQUE INDEX artists_pkey ON public.artists USING btree (id);
CREATE INDEX artists_user_id_idx ON public.artists USING btree (user_id);
CREATE UNIQUE INDEX artists_user_name_unique ON public.artists USING btree (user_id, name);
CREATE UNIQUE INDEX audience_seeds_pkey ON public.audience_seeds USING btree (id);
CREATE INDEX audience_seeds_user_id_idx ON public.audience_seeds USING btree (user_id);
CREATE UNIQUE INDEX audience_source_cache_pkey ON public.audience_source_cache USING btree (id);
CREATE UNIQUE INDEX audience_source_cache_user_id_client_id_source_kind_cache_k_key ON public.audience_source_cache USING btree (user_id, client_id, source_kind, cache_key);
CREATE INDEX idx_audience_source_cache_lookup ON public.audience_source_cache USING btree (user_id, client_id, source_kind, cache_key, expires_at);
CREATE UNIQUE INDEX benchmark_alerts_open_dedupe_idx ON public.benchmark_alerts USING btree (user_id, entity_id, alert_type) WHERE (status = 'open'::text);
CREATE UNIQUE INDEX benchmark_alerts_pkey ON public.benchmark_alerts USING btree (id);
CREATE INDEX idx_benchmark_alerts_today ON public.benchmark_alerts USING btree (user_id, status, surfaced_at DESC) WHERE (status = 'open'::text);
CREATE INDEX campaign_drafts_client_idx ON public.campaign_drafts USING btree (client_id);
CREATE INDEX campaign_drafts_event_idx ON public.campaign_drafts USING btree (event_id);
CREATE UNIQUE INDEX campaign_drafts_pkey ON public.campaign_drafts USING btree (id);
CREATE INDEX idx_campaign_drafts_ad_account_id ON public.campaign_drafts USING btree (ad_account_id);
CREATE INDEX idx_campaign_drafts_status ON public.campaign_drafts USING btree (status);
CREATE UNIQUE INDEX campaign_templates_pkey ON public.campaign_templates USING btree (id);
CREATE INDEX client_report_weekly_snapshots_client_idx ON public.client_report_weekly_snapshots USING btree (client_id, week_start DESC);
CREATE INDEX client_report_weekly_snapshots_event_idx ON public.client_report_weekly_snapshots USING btree (event_id, week_start DESC);
CREATE UNIQUE INDEX client_report_weekly_snapshots_event_week_unique ON public.client_report_weekly_snapshots USING btree (event_id, week_start);
CREATE UNIQUE INDEX client_report_weekly_snapshots_pkey ON public.client_report_weekly_snapshots USING btree (id);
CREATE UNIQUE INDEX client_ticketing_connections_pkey ON public.client_ticketing_connections USING btree (id);
CREATE INDEX client_ticketing_connections_status_idx ON public.client_ticketing_connections USING btree (status) WHERE (status = 'active'::text);
CREATE INDEX client_ticketing_connections_user_client_idx ON public.client_ticketing_connections USING btree (user_id, client_id);
CREATE UNIQUE INDEX client_ticketing_connections_user_id_client_id_provider_key ON public.client_ticketing_connections USING btree (user_id, client_id, provider);
CREATE INDEX clients_google_ads_account_id_idx ON public.clients USING btree (google_ads_account_id);
CREATE UNIQUE INDEX clients_pkey ON public.clients USING btree (id);
CREATE UNIQUE INDEX clients_slug_unique_per_user ON public.clients USING btree (user_id, slug);
CREATE INDEX clients_tiktok_account_id_idx ON public.clients USING btree (tiktok_account_id);
CREATE INDEX clients_user_status_idx ON public.clients USING btree (user_id, status);
CREATE UNIQUE INDEX creative_enhancement_flags_ad_id_scanned_at_key ON public.creative_enhancement_flags USING btree (ad_id, scanned_at);
CREATE UNIQUE INDEX creative_enhancement_flags_pkey ON public.creative_enhancement_flags USING btree (id);
CREATE INDEX idx_cef_client_scanned_at ON public.creative_enhancement_flags USING btree (client_id, scanned_at DESC);
CREATE INDEX idx_cef_client_unresolved ON public.creative_enhancement_flags USING btree (client_id, resolved_at) WHERE (resolved_at IS NULL);
CREATE INDEX idx_cef_client_unresolved_blocked ON public.creative_enhancement_flags USING btree (client_id, resolved_at) WHERE ((resolved_at IS NULL) AND (tracked_only = false));
CREATE INDEX idx_cef_event_unresolved ON public.creative_enhancement_flags USING btree (event_id, resolved_at) WHERE (resolved_at IS NULL);
CREATE INDEX cis_objective_idx ON public.creative_insight_snapshots USING btree (user_id, ad_account_id, campaign_objective);
CREATE INDEX cis_user_account_preset_idx ON public.creative_insight_snapshots USING btree (user_id, ad_account_id, date_preset, snapshot_at DESC);
CREATE UNIQUE INDEX creative_insight_snapshots_pkey ON public.creative_insight_snapshots USING btree (id);
CREATE UNIQUE INDEX creative_insight_snapshots_user_id_ad_account_id_ad_id_date_key ON public.creative_insight_snapshots USING btree (user_id, ad_account_id, ad_id, date_preset);
CREATE INDEX creative_renders_event_idx ON public.creative_renders USING btree (event_id, created_at DESC);
CREATE UNIQUE INDEX creative_renders_pkey ON public.creative_renders USING btree (id);
CREATE INDEX creative_renders_status_idx ON public.creative_renders USING btree (status, created_at) WHERE (status = ANY (ARRAY['queued'::text, 'rendering'::text]));
CREATE INDEX creative_renders_template_idx ON public.creative_renders USING btree (template_id, created_at DESC);
CREATE INDEX creative_scores_event_creative_idx ON public.creative_scores USING btree (event_id, creative_name);
CREATE UNIQUE INDEX creative_scores_event_id_creative_name_axis_fetched_at_key ON public.creative_scores USING btree (event_id, creative_name, axis, fetched_at);
CREATE UNIQUE INDEX creative_scores_pkey ON public.creative_scores USING btree (id);
CREATE INDEX creative_tag_assignments_event_creative_idx ON public.creative_tag_assignments USING btree (event_id, creative_name);
CREATE UNIQUE INDEX creative_tag_assignments_event_id_creative_name_tag_id_key ON public.creative_tag_assignments USING btree (event_id, creative_name, tag_id);
CREATE UNIQUE INDEX creative_tag_assignments_pkey ON public.creative_tag_assignments USING btree (id);
CREATE INDEX creative_tag_assignments_source_model_idx ON public.creative_tag_assignments USING btree (source, model_version);
CREATE INDEX creative_tags_event_id_idx ON public.creative_tags USING btree (event_id);
CREATE INDEX creative_tags_meta_ad_id_idx ON public.creative_tags USING btree (meta_ad_id);
CREATE UNIQUE INDEX creative_tags_pkey ON public.creative_tags USING btree (id);
CREATE UNIQUE INDEX creative_tags_unique ON public.creative_tags USING btree (user_id, meta_ad_id, tag_type, tag_value);
CREATE INDEX creative_tags_user_dimension_idx ON public.creative_tags USING btree (user_id, dimension);
CREATE UNIQUE INDEX creative_tags_user_dimension_value_key_unique ON public.creative_tags USING btree (user_id, dimension, value_key);
CREATE INDEX creative_tags_user_id_idx ON public.creative_tags USING btree (user_id);
CREATE INDEX creative_templates_channel_idx ON public.creative_templates USING btree (user_id, channel);
CREATE UNIQUE INDEX creative_templates_pkey ON public.creative_templates USING btree (id);
CREATE INDEX creative_templates_provider_idx ON public.creative_templates USING btree (user_id, provider);
CREATE UNIQUE INDEX d2c_connections_pkey ON public.d2c_connections USING btree (id);
CREATE INDEX d2c_connections_status_idx ON public.d2c_connections USING btree (status) WHERE (status = 'active'::text);
CREATE INDEX d2c_connections_user_client_idx ON public.d2c_connections USING btree (user_id, client_id);
CREATE UNIQUE INDEX d2c_connections_user_id_client_id_provider_key ON public.d2c_connections USING btree (user_id, client_id, provider);
CREATE INDEX d2c_scheduled_sends_event_idx ON public.d2c_scheduled_sends USING btree (event_id, scheduled_for DESC);
CREATE UNIQUE INDEX d2c_scheduled_sends_pkey ON public.d2c_scheduled_sends USING btree (id);
CREATE INDEX d2c_scheduled_sends_status_idx ON public.d2c_scheduled_sends USING btree (status, scheduled_for) WHERE (status = 'scheduled'::text);
CREATE INDEX d2c_templates_channel_idx ON public.d2c_templates USING btree (user_id, channel);
CREATE UNIQUE INDEX d2c_templates_pkey ON public.d2c_templates USING btree (id);
CREATE INDEX d2c_templates_user_client_idx ON public.d2c_templates USING btree (user_id, client_id);
CREATE INDEX daily_tracking_entries_client_id_date_idx ON public.daily_tracking_entries USING btree (client_id, date);
CREATE UNIQUE INDEX daily_tracking_entries_event_id_date_key ON public.daily_tracking_entries USING btree (event_id, date);
CREATE UNIQUE INDEX daily_tracking_entries_pkey ON public.daily_tracking_entries USING btree (id);
CREATE INDEX event_activity_snapshots_event_id_idx ON public.event_activity_snapshots USING btree (event_id);
CREATE UNIQUE INDEX event_activity_snapshots_pkey ON public.event_activity_snapshots USING btree (id);
CREATE INDEX event_activity_snapshots_user_id_idx ON public.event_activity_snapshots USING btree (user_id);
CREATE UNIQUE INDEX event_activity_unique ON public.event_activity_snapshots USING btree (event_id, source);
CREATE INDEX event_artists_artist_id_idx ON public.event_artists USING btree (artist_id);
CREATE INDEX event_artists_event_id_idx ON public.event_artists USING btree (event_id);
CREATE UNIQUE INDEX event_artists_pkey ON public.event_artists USING btree (id);
CREATE UNIQUE INDEX event_artists_unique ON public.event_artists USING btree (event_id, artist_id);
CREATE INDEX event_daily_rollups_event_date_google_ads_idx ON public.event_daily_rollups USING btree (event_id, date) WHERE (google_ads_spend > (0)::numeric);
CREATE INDEX event_daily_rollups_event_date_idx ON public.event_daily_rollups USING btree (event_id, date DESC);
CREATE INDEX event_daily_rollups_event_date_meta_imp_idx ON public.event_daily_rollups USING btree (event_id, date) WHERE (meta_impressions IS NOT NULL);
CREATE INDEX event_daily_rollups_event_date_tiktok_idx ON public.event_daily_rollups USING btree (event_id, date) WHERE (tiktok_spend > (0)::numeric);
CREATE UNIQUE INDEX event_daily_rollups_event_date_unique ON public.event_daily_rollups USING btree (event_id, date);
CREATE UNIQUE INDEX event_daily_rollups_pkey ON public.event_daily_rollups USING btree (id);
CREATE INDEX event_funnel_overrides_client_idx ON public.event_funnel_overrides USING btree (client_id);
CREATE UNIQUE INDEX event_funnel_overrides_pkey ON public.event_funnel_overrides USING btree (id);
CREATE UNIQUE INDEX event_funnel_overrides_scope_unique_idx ON public.event_funnel_overrides USING btree (client_id, COALESCE((event_id)::text, event_code));
CREATE UNIQUE INDEX event_funnel_targets_client_id_scope_type_scope_value_key ON public.event_funnel_targets USING btree (client_id, scope_type, scope_value);
CREATE UNIQUE INDEX event_funnel_targets_pkey ON public.event_funnel_targets USING btree (id);
CREATE INDEX idx_event_funnel_targets_client ON public.event_funnel_targets USING btree (client_id);
CREATE INDEX event_key_moments_event_date_idx ON public.event_key_moments USING btree (event_id, moment_date);
CREATE UNIQUE INDEX event_key_moments_pkey ON public.event_key_moments USING btree (id);
CREATE UNIQUE INDEX event_ticket_tiers_event_id_tier_name_key ON public.event_ticket_tiers USING btree (event_id, tier_name);
CREATE UNIQUE INDEX event_ticket_tiers_event_id_tier_name_snapshot_at_key ON public.event_ticket_tiers USING btree (event_id, tier_name, snapshot_at);
CREATE INDEX event_ticket_tiers_event_snapshot_idx ON public.event_ticket_tiers USING btree (event_id, snapshot_at DESC);
CREATE UNIQUE INDEX event_ticket_tiers_pkey ON public.event_ticket_tiers USING btree (id);
CREATE INDEX event_ticketing_links_connection_idx ON public.event_ticketing_links USING btree (connection_id);
CREATE UNIQUE INDEX event_ticketing_links_event_connection_external_unique ON public.event_ticketing_links USING btree (event_id, connection_id, external_event_id);
CREATE INDEX event_ticketing_links_event_idx ON public.event_ticketing_links USING btree (event_id);
CREATE INDEX event_ticketing_links_manual_lock_idx ON public.event_ticketing_links USING btree (manual_lock);
CREATE UNIQUE INDEX event_ticketing_links_pkey ON public.event_ticketing_links USING btree (id);
CREATE INDEX events_event_code_idx ON public.events USING btree (event_code);
CREATE INDEX events_favourite_idx ON public.events USING btree (user_id) WHERE favourite;
CREATE INDEX events_google_ads_account_id_idx ON public.events USING btree (google_ads_account_id);
CREATE INDEX events_kind_idx ON public.events USING btree (kind);
CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);
CREATE INDEX events_preferred_provider_idx ON public.events USING btree (preferred_provider);
CREATE UNIQUE INDEX events_slug_unique_per_user ON public.events USING btree (user_id, slug);
CREATE INDEX events_tiktok_account_id_idx ON public.events USING btree (tiktok_account_id);
CREATE INDEX events_user_client_idx ON public.events USING btree (user_id, client_id);
CREATE INDEX events_user_event_date_idx ON public.events USING btree (user_id, event_date);
CREATE INDEX events_venue_id_idx ON public.events USING btree (venue_id);
CREATE INDEX external_event_candidates_client_provider_idx ON public.external_event_candidates USING btree (client_id, provider);
CREATE UNIQUE INDEX external_event_candidates_connection_id_external_event_id_key ON public.external_event_candidates USING btree (connection_id, external_event_id);
CREATE INDEX external_event_candidates_connection_idx ON public.external_event_candidates USING btree (connection_id);
CREATE UNIQUE INDEX external_event_candidates_pkey ON public.external_event_candidates USING btree (id);
CREATE INDEX external_event_candidates_start_date_idx ON public.external_event_candidates USING btree (start_date);
CREATE INDEX google_ad_plans_event_id_idx ON public.google_ad_plans USING btree (event_id);
CREATE UNIQUE INDEX google_ad_plans_pkey ON public.google_ad_plans USING btree (id);
CREATE INDEX google_ad_plans_user_id_idx ON public.google_ad_plans USING btree (user_id);
CREATE UNIQUE INDEX google_ads_accounts_pkey ON public.google_ads_accounts USING btree (id);
CREATE UNIQUE INDEX google_ads_accounts_user_account_unique ON public.google_ads_accounts USING btree (user_id, account_name);
CREATE UNIQUE INDEX google_ads_accounts_user_customer_unique_idx ON public.google_ads_accounts USING btree (user_id, google_customer_id) WHERE (google_customer_id IS NOT NULL);
CREATE INDEX google_ads_accounts_user_id_idx ON public.google_ads_accounts USING btree (user_id);
CREATE INDEX invoices_client_id_idx ON public.invoices USING btree (client_id);
CREATE INDEX invoices_due_date_idx ON public.invoices USING btree (due_date);
CREATE INDEX invoices_event_id_idx ON public.invoices USING btree (event_id);
CREATE UNIQUE INDEX invoices_invoice_number_user_unique ON public.invoices USING btree (user_id, invoice_number) WHERE (invoice_number IS NOT NULL);
CREATE UNIQUE INDEX invoices_pkey ON public.invoices USING btree (id);
CREATE INDEX invoices_quote_id_idx ON public.invoices USING btree (quote_id);
CREATE INDEX invoices_status_idx ON public.invoices USING btree (status);
CREATE INDEX invoices_user_id_idx ON public.invoices USING btree (user_id);
CREATE UNIQUE INDEX meta_audience_write_idempotency_pkey ON public.meta_audience_write_idempotency USING btree (idempotency_key);
CREATE INDEX meta_custom_audiences_event_idx ON public.meta_custom_audiences USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX meta_custom_audiences_meta_audience_idx ON public.meta_custom_audiences USING btree (meta_audience_id) WHERE (meta_audience_id IS NOT NULL);
CREATE UNIQUE INDEX meta_custom_audiences_pkey ON public.meta_custom_audiences USING btree (id);
CREATE INDEX meta_custom_audiences_user_client_status_idx ON public.meta_custom_audiences USING btree (user_id, client_id, status);
CREATE INDEX quotes_client_id_idx ON public.quotes USING btree (client_id);
CREATE INDEX quotes_created_at_idx ON public.quotes USING btree (created_at DESC);
CREATE INDEX quotes_event_id_idx ON public.quotes USING btree (event_id);
CREATE UNIQUE INDEX quotes_pkey ON public.quotes USING btree (id);
CREATE UNIQUE INDEX quotes_quote_number_user_unique ON public.quotes USING btree (user_id, quote_number);
CREATE INDEX quotes_status_idx ON public.quotes USING btree (status);
CREATE INDEX quotes_user_id_idx ON public.quotes USING btree (user_id);
CREATE INDEX report_shares_client_id_idx ON public.report_shares USING btree (client_id);
CREATE INDEX report_shares_event_id_idx ON public.report_shares USING btree (event_id);
CREATE UNIQUE INDEX report_shares_pkey ON public.report_shares USING btree (token);
CREATE INDEX report_shares_user_id_idx ON public.report_shares USING btree (user_id);
CREATE INDEX report_shares_venue_idx ON public.report_shares USING btree (client_id, event_code) WHERE (scope = 'venue'::text);
CREATE INDEX share_insight_snapshots_build_version_idx ON public.share_insight_snapshots USING btree (build_version) WHERE (build_version IS NOT NULL);
CREATE UNIQUE INDEX share_insight_snapshots_pkey ON public.share_insight_snapshots USING btree (id);
CREATE UNIQUE INDEX share_insight_snapshots_unique_tuple ON public.share_insight_snapshots USING btree (share_token, date_preset, custom_since, custom_until) NULLS NOT DISTINCT;
CREATE INDEX sis_expires_idx ON public.share_insight_snapshots USING btree (expires_at);
CREATE INDEX sis_token_preset_idx ON public.share_insight_snapshots USING btree (share_token, date_preset, expires_at DESC);
CREATE INDEX ticket_sales_snapshots_connection_idx ON public.ticket_sales_snapshots USING btree (connection_id, snapshot_at DESC);
CREATE INDEX ticket_sales_snapshots_event_conn_external_idx ON public.ticket_sales_snapshots USING btree (event_id, connection_id, external_event_id);
CREATE INDEX ticket_sales_snapshots_event_snapshot_idx ON public.ticket_sales_snapshots USING btree (event_id, snapshot_at DESC);
CREATE UNIQUE INDEX ticket_sales_snapshots_event_snapshot_source_idx ON public.ticket_sales_snapshots USING btree (event_id, snapshot_at, source);
CREATE UNIQUE INDEX ticket_sales_snapshots_pkey ON public.ticket_sales_snapshots USING btree (id);
CREATE INDEX tier_channel_allocations_channel_id_idx ON public.tier_channel_allocations USING btree (channel_id);
CREATE INDEX tier_channel_allocations_event_id_idx ON public.tier_channel_allocations USING btree (event_id);
CREATE UNIQUE INDEX tier_channel_allocations_event_id_tier_name_channel_id_key ON public.tier_channel_allocations USING btree (event_id, tier_name, channel_id);
CREATE UNIQUE INDEX tier_channel_allocations_pkey ON public.tier_channel_allocations USING btree (id);
CREATE INDEX tier_channel_sales_channel_id_idx ON public.tier_channel_sales USING btree (channel_id);
CREATE INDEX tier_channel_sales_event_id_idx ON public.tier_channel_sales USING btree (event_id);
CREATE UNIQUE INDEX tier_channel_sales_event_id_tier_name_channel_id_key ON public.tier_channel_sales USING btree (event_id, tier_name, channel_id);
CREATE UNIQUE INDEX tier_channel_sales_pkey ON public.tier_channel_sales USING btree (id);
CREATE INDEX tier_channel_sales_daily_history_event_date_idx ON public.tier_channel_sales_daily_history USING btree (event_id, snapshot_date DESC);
CREATE UNIQUE INDEX tier_channel_sales_daily_history_event_id_snapshot_date_key ON public.tier_channel_sales_daily_history USING btree (event_id, snapshot_date);
CREATE UNIQUE INDEX tier_channel_sales_daily_history_pkey ON public.tier_channel_sales_daily_history USING btree (id);
CREATE UNIQUE INDEX tier_channels_client_id_channel_name_key ON public.tier_channels USING btree (client_id, channel_name);
CREATE INDEX tier_channels_client_id_idx ON public.tier_channels USING btree (client_id);
CREATE UNIQUE INDEX tier_channels_pkey ON public.tier_channels USING btree (id);
CREATE UNIQUE INDEX tiktok_accounts_pkey ON public.tiktok_accounts USING btree (id);
CREATE UNIQUE INDEX tiktok_accounts_user_account_unique ON public.tiktok_accounts USING btree (user_id, account_name);
CREATE INDEX tiktok_accounts_user_id_idx ON public.tiktok_accounts USING btree (user_id);
CREATE INDEX tiktok_acs_event_fetched_idx ON public.tiktok_active_creatives_snapshots USING btree (event_id, fetched_at DESC);
CREATE INDEX tiktok_acs_user_id_idx ON public.tiktok_active_creatives_snapshots USING btree (user_id);
CREATE UNIQUE INDEX tiktok_active_creatives_snaps_event_id_ad_id_window_since_w_key ON public.tiktok_active_creatives_snapshots USING btree (event_id, ad_id, window_since, window_until);
CREATE UNIQUE INDEX tiktok_active_creatives_snapshots_pkey ON public.tiktok_active_creatives_snapshots USING btree (id);
CREATE INDEX tiktok_breakdown_snapshots_event_dim_idx ON public.tiktok_breakdown_snapshots USING btree (event_id, dimension, fetched_at DESC);
CREATE UNIQUE INDEX tiktok_breakdown_snapshots_event_id_dimension_dimension_val_key ON public.tiktok_breakdown_snapshots USING btree (event_id, dimension, dimension_value, window_since, window_until);
CREATE UNIQUE INDEX tiktok_breakdown_snapshots_pkey ON public.tiktok_breakdown_snapshots USING btree (id);
CREATE INDEX tiktok_breakdown_snapshots_user_id_idx ON public.tiktok_breakdown_snapshots USING btree (user_id);
CREATE INDEX tiktok_campaign_drafts_client_idx ON public.tiktok_campaign_drafts USING btree (client_id);
CREATE INDEX tiktok_campaign_drafts_event_idx ON public.tiktok_campaign_drafts USING btree (event_id);
CREATE UNIQUE INDEX tiktok_campaign_drafts_pkey ON public.tiktok_campaign_drafts USING btree (id);
CREATE INDEX tiktok_campaign_drafts_user_updated_idx ON public.tiktok_campaign_drafts USING btree (user_id, updated_at DESC);
CREATE UNIQUE INDEX tiktok_campaign_templates_pkey ON public.tiktok_campaign_templates USING btree (id);
CREATE INDEX tiktok_campaign_templates_user_updated_idx ON public.tiktok_campaign_templates USING btree (user_id, updated_at DESC);
CREATE INDEX tiktok_manual_reports_campaign_name_idx ON public.tiktok_manual_reports USING btree (campaign_name);
CREATE INDEX tiktok_manual_reports_client_id_idx ON public.tiktok_manual_reports USING btree (client_id) WHERE (client_id IS NOT NULL);
CREATE INDEX tiktok_manual_reports_event_id_idx ON public.tiktok_manual_reports USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE UNIQUE INDEX tiktok_manual_reports_pkey ON public.tiktok_manual_reports USING btree (id);
CREATE UNIQUE INDEX tiktok_manual_reports_user_campaign_window_key ON public.tiktok_manual_reports USING btree (user_id, campaign_name, date_range_start, date_range_end);
CREATE INDEX tiktok_manual_reports_user_imported_idx ON public.tiktok_manual_reports USING btree (user_id, imported_at DESC);
CREATE UNIQUE INDEX tiktok_write_idempotency_draft_id_op_kind_op_payload_hash_key ON public.tiktok_write_idempotency USING btree (draft_id, op_kind, op_payload_hash);
CREATE INDEX tiktok_write_idempotency_draft_idx ON public.tiktok_write_idempotency USING btree (draft_id, op_kind, created_at DESC);
CREATE UNIQUE INDEX tiktok_write_idempotency_pkey ON public.tiktok_write_idempotency USING btree (id);
CREATE UNIQUE INDEX user_facebook_tokens_pkey ON public.user_facebook_tokens USING btree (user_id);
CREATE UNIQUE INDEX venues_google_place_id_user_idx ON public.venues USING btree (user_id, google_place_id) WHERE (google_place_id IS NOT NULL);
CREATE UNIQUE INDEX venues_pkey ON public.venues USING btree (id);
CREATE INDEX venues_user_id_idx ON public.venues USING btree (user_id);
CREATE UNIQUE INDEX venues_user_name_unique ON public.venues USING btree (user_id, name);
