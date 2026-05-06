-- Tracked-only rows (e.g. inline_comment only): stored for ops/analytics but excluded from
-- banner counts and severity UX; see lib/meta/enhancement-policy.ts.

alter table creative_enhancement_flags
  add column if not exists tracked_only boolean not null default false;

-- Backfill: true when no BLOCKED-tier keys appear in flagged_features (matches POLICY_BLOCKED_FEATURES).
update creative_enhancement_flags
set tracked_only = not (
  flagged_features ?| array[
    'standard_enhancements',
    'text_optimizations',
    'product_extensions',
    'contextual_multi_ads',
    'video_auto_crop',
    'video_filtering',
    'video_uncrop',
    'ig_video_native_subtitle',
    'image_animation',
    'image_templates',
    'image_touchups',
    'image_background_gen',
    'image_uncrop',
    'show_summary',
    'show_destination_blurbs',
    'video_to_image',
    'carousel_to_video',
    'multi_photo_to_video',
    'text_translation',
    'description_automation',
    'replace_media_text',
    'add_text_overlay',
    'creative_stickers',
    'ads_with_benefits',
    'site_extensions',
    'local_store_extension',
    'profile_card',
    'reveal_details_over_time',
    'enhance_cta',
    'media_type_automation',
    'media_order',
    'advantage_plus_creative',
    'biz_ai',
    'cv_transformation',
    'pac_relaxation',
    'pac_recomposition',
    'adapt_to_placement',
    'hide_price'
  ]::text[]
)
where resolved_at is null;

create index if not exists idx_cef_client_unresolved_blocked
  on creative_enhancement_flags (client_id, resolved_at)
  where resolved_at is null and tracked_only = false;

notify pgrst, 'reload schema';
