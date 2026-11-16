-- 251_client_member_write_guard.sql
--
-- Client dashboard members (client_users) can't write to agency tables
-- through the database API.
--
-- A member signs in at /admin/login with an ordinary Supabase session. The
-- agency tables' owner policies are `auth.uid() = user_id`, so with the
-- public anon key and their own JWT a member could insert rows owned by
-- themselves straight through PostgREST — clients, events, drafts, plans,
-- launch rows, audiences, the asset queue, Creative Lab rows, ticketing
-- connections and links — and point them at agency ad accounts, campaigns,
-- audiences or Drive folders. Routes that only check `row.user_id = caller`
-- would then act on those rows. The /api operator gate (#1276) and the
-- operator-only Meta token (#1277) close the routes; this closes the
-- database itself.
--
-- The test is a role, not a table: a session that belongs to a client_users
-- member gets no INSERT, UPDATE or DELETE. It's added as a RESTRICTIVE
-- policy per table, which Postgres ANDs with the existing owner policies, so
-- nothing else about those policies changes.
--
-- What keeps working:
--   * Members' reads: migration 137's member SELECT policies are untouched.
--   * The client dashboard's own writes: service-role server actions under
--     requireClientContext() (lib/actions/*). The service role bypasses RLS.
--   * Operators and every other account: not client_users members (checked
--     read-only on prod, 16 Nov 2026: 1 client_users row, 0 for operators).
--     Membership is the test because the database can't read the app's
--     operator list (isOperator).
--   * user_facebook_tokens is left out on purpose: /api/auth/facebook-token
--     writes the member's own row with their session (#1276 allowlist).
--
-- The tables are every public table whose permissive write policies key on
-- auth.uid() (read from pg_policies on prod, 16 Nov 2026: 113 tables), less
-- user_facebook_tokens: 112. A table that doesn't exist is skipped with a
-- notice.

create or replace function public.is_client_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.client_users cu where cu.user_id = auth.uid());
$$;

comment on function public.is_client_member() is
  'True when the calling session belongs to a client_users member. Restrictive write policies on agency tables use it (migration 251).';

revoke all on function public.is_client_member() from public;
grant execute on function public.is_client_member() to authenticated;

do $$
declare
  t text;
  tables text[] := array[
    'ad_plan_audiences',
    'ad_plan_days',
    'ad_plan_templates',
    'ad_plans',
    'additional_spend_entries',
    'additional_ticket_entries',
    'artists',
    'audience_seeds',
    'benchmark_alerts',
    'bulk_attach_drafts',
    'bulk_attach_templates',
    'campaign_drafts',
    'campaign_plan_asset_routes',
    'campaign_plan_copy',
    'campaign_plan_creative_group_members',
    'campaign_plan_creative_groups',
    'campaign_plan_google_launch',
    'campaign_plan_intake_assets',
    'campaign_plan_meta_launch',
    'campaign_plan_predictions',
    'campaign_plan_templates',
    'campaign_plan_tiktok_launch',
    'campaign_plans',
    'campaign_templates',
    'client_asset_queue',
    'client_asset_sheet_config',
    'client_claim_ladders',
    'client_landing_pages',
    'client_optimisation_presets',
    'client_report_weekly_snapshots',
    'client_reports',
    'client_ticketing_connections',
    'client_venue_mappings',
    'clients',
    'creative_asset_channel_ids',
    'creative_assets',
    'creative_insight_snapshots',
    'creative_lab_artists',
    'creative_lab_captions',
    'creative_lab_clip_features',
    'creative_lab_clip_selections',
    'creative_lab_clips',
    'creative_lab_event_facts',
    'creative_lab_ig_candidates',
    'creative_lab_renders',
    'creative_lab_round_ad_launches',
    'creative_lab_round_ads',
    'creative_lab_rounds',
    'creative_lab_style_settings',
    'creative_renders',
    'creative_scores',
    'creative_tag_assignments',
    'creative_tags',
    'creative_templates',
    'd2c_brief_ingest_jobs',
    'd2c_connections',
    'd2c_event_copy',
    'd2c_event_shares',
    'd2c_scheduled_sends',
    'd2c_templates',
    'daily_tracking_entries',
    'event_activity_snapshots',
    'event_artists',
    'event_count_aliases',
    'event_daily_rollups',
    'event_funnel_targets',
    'event_key_moments',
    'event_offers',
    'event_reference_shows',
    'event_releases',
    'event_ticketing_links',
    'events',
    'external_event_candidates',
    'google_ad_plans',
    'google_ads_accounts',
    'google_search_ad_groups',
    'google_search_campaigns',
    'google_search_keywords',
    'google_search_negatives',
    'google_search_plans',
    'google_search_rsas',
    'google_search_sitelinks',
    'google_video_ad_groups',
    'google_video_ads',
    'google_video_campaigns',
    'google_video_placements',
    'google_video_plans',
    'interest_clusters',
    'invoices',
    'launched_ad_sets',
    'launched_ads',
    'mailchimp_accounts',
    'marketing_budget_entries',
    'meta_audience_write_idempotency',
    'meta_custom_audiences',
    'page_events',
    'plan_share_tokens',
    'quotes',
    'reference_lift_library',
    'release_reads',
    'report_shares',
    'ticket_sales_snapshots',
    'ticket_warnings',
    'tier_channel_allocations',
    'tier_channel_sales',
    'tier_channels',
    'tiktok_accounts',
    'tiktok_campaign_drafts',
    'tiktok_campaign_templates',
    'tiktok_manual_reports',
    'venues',
    'voice_samples'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'migration 251: skip %, not present', t;
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', 'client_member_no_insert', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_update', t);
    execute format('drop policy if exists %I on public.%I', 'client_member_no_delete', t);
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (not public.is_client_member())',
      'client_member_no_insert', t);
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (not public.is_client_member()) with check (not public.is_client_member())',
      'client_member_no_update', t);
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (not public.is_client_member())',
      'client_member_no_delete', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
