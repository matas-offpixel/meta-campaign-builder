/**
 * Doc-derived v1.3 envelopes for the import reads. Not a live capture.
 *
 * Field names and nesting come from portal/docs get-campaigns,
 * get-ad-groups, get-ads, get-upgraded-smart-ad-groups,
 * get-upgraded-smart-ads, get-smart-campaigns (v1.3). Campaign ids are
 * placeholders. Drive `GET /api/tiktok/campaigns/import/raw` and replace
 * this file with the verbatim capture; where capture and doc disagree,
 * the mapper follows the capture and this header records the difference.
 *
 * VERIFIED LIVE (advertiser 7639802149165301776, 2026-09-15):
 * - `/campaign/get/` list + the two classification flags.
 * - `/ad/get/` with `filtering.campaign_automation_type:
 *   "UPGRADED_SMART_PLUS"` returns the full manual ad shape for an
 *   upgraded campaign (45 rows with `ad_id`, `ad_name`, `video_id`,
 *   `image_ids`, `tiktok_item_id`).
 * - `/smart_plus/adgroup/get/` returns one ad group with `targeting_spec`
 *   nested.
 * - `/advertiser/info/` → GBP, Etc/GMT.
 *
 * FALSIFIED LIVE:
 * - `/adgroup/get/` `fields` may not contain `connection_type`
 *   (rejected at `fields.32`; see `captured/adgroup-get-accepted-fields-2026-09-15.ts`).
 * - `/smart_plus/ad/get/` rows do NOT carry `ad_id`, `creative_id`, flat
 *   `video_id` or flat `image_ids`. #944 read all four and got nulls.
 *
 * UNKNOWN UNTIL CAPTURE:
 * - The `creative_list[]` shape below is the documented one
 *   (https://business-api.tiktok.com/portal/docs/get-upgraded-smart-ads/v1.3)
 *   and has not yet been seen on the wire.
 * - `page_size: 1000` on `/campaign/spc/get/`.
 * - Whether `excluded_audience_ids` comes back under `targeting_spec` on
 *   an upgraded ad group that has one.
 */

export const MANUAL_CAMPAIGN_GET = {
  campaign_id: "manual-campaign-1",
  campaign_name: "[IRW] Manual fixture",
  objective_type: "LEAD_GENERATION",
  virtual_objective_type: null,
  sales_destination: null,
  budget: 0,
  budget_mode: "BUDGET_MODE_INFINITE",
  operation_status: "ENABLE",
  campaign_automation_type: "MANUAL",
  is_smart_performance_campaign: false,
};

export const MANUAL_ADGROUP_GET = {
  adgroup_id: "manual-adgroup-1",
  adgroup_name: "Prospecting",
  campaign_id: "manual-campaign-1",
  budget: 80,
  budget_mode: "BUDGET_MODE_DAY",
  optimization_goal: "CONVERT",
  optimization_event: "ON_WEB_REGISTER",
  bid_type: "BID_TYPE_NO_BID",
  pixel_id: "7644201699552690194",
  location_ids: ["2635167"],
  age_groups: ["AGE_18_24", "AGE_25_34"],
  gender: "GENDER_UNLIMITED",
  languages: ["en"],
  interest_category_ids: ["123"],
  audience_ids: ["aud-1"],
  excluded_audience_ids: ["ticketholder-1"],
  saved_audience_id: "saved-spec-1",
  placements: ["PLACEMENT_TIKTOK"],
  placement_type: "PLACEMENT_TYPE_NORMAL",
  pacing: "PACING_MODE_SMOOTH",
  schedule_type: "SCHEDULE_START_END",
  schedule_start_time: "2026-01-01 09:00:00",
  schedule_end_time: "2026-01-14 09:00:00",
};

export const MANUAL_AD_GET = {
  ad_id: "manual-ad-1",
  ad_name: "Jamie Jones clip",
  campaign_id: "manual-campaign-1",
  adgroup_id: "manual-adgroup-1",
  video_id: "v901",
  image_ids: ["img-cover-1"],
  tiktok_item_id: null,
  identity_id: "identity-ironworks",
  identity_type: "BC_AUTH_TT",
  identity_authorized_bc_id: "bc-1",
  landing_page_url: "https://example.com/tickets",
  ad_text: "Tickets on sale",
  call_to_action: "LEARN_MORE",
  is_aco: false,
  creative_authorized: false,
};

export const UPGRADED_CAMPAIGN_GET = {
  campaign_id: "upgraded-campaign-1",
  campaign_name: "[IRW] Upgraded Smart+ fixture",
  objective_type: "WEB_CONVERSIONS",
  virtual_objective_type: "SALES",
  sales_destination: "WEBSITE",
  budget: 0,
  budget_mode: "BUDGET_MODE_INFINITE",
  operation_status: "ENABLE",
  campaign_automation_type: "UPGRADED_SMART_PLUS",
  is_smart_performance_campaign: false,
};

export const UPGRADED_ADGROUP_GET = {
  adgroup_id: "upgraded-adgroup-1",
  adgroup_name: "Smart+ group",
  campaign_id: "upgraded-campaign-1",
  budget: 120,
  budget_mode: "BUDGET_MODE_DAY",
  optimization_goal: "CONVERT",
  optimization_event: "ON_WEB_REGISTER",
  bid_type: "BID_TYPE_NO_BID",
  pixel_id: "7644201699552690194",
  budget_auto_adjust_strategy: "ON",
  smart_plus_adgroup_mode: "AUTO",
  targeting_optimization_mode: "AUTOMATIC",
  smart_audience_enabled: true,
  smart_interest_behavior_enabled: true,
  suggestion_audience_enabled: true,
  targeting_spec: {
    // Live Ironworks values: 18–54, en, 2648110.
    location_ids: ["2648110"],
    age_groups: ["AGE_18_24", "AGE_25_34", "AGE_35_44", "AGE_45_54"],
    gender: "GENDER_UNLIMITED",
    languages: ["en"],
    excluded_audience_ids: ["ticketholder-upgraded"],
    saved_audience_id: "saved-upgraded-1",
  },
};

/**
 * One `/smart_plus/ad/get/` row is one ASSET GROUP, not one ad — the
 * live Ironworks campaign returned three (`80% Sold` ×16, `Overlays` ×5,
 * `Feed : JJ` ×24 creatives). Text, CTA and landing page are ad-level
 * lists; the creative fields are all under `creative_info`.
 *
 * `smart_plus_creative_id` is documented as equal to the `ad_id` from
 * `/ad/get/` when `ad_ids_v2` is not sent — it is the join key, and the
 * `/ad/get/` rows below use the same ids so a mismatch would show.
 */
export const UPGRADED_SMART_PLUS_AD_GET = {
  smart_plus_ad_id: "smart-plus-ad-1",
  ad_name: "80% Sold",
  campaign_id: "upgraded-campaign-1",
  adgroup_id: "upgraded-adgroup-1",
  operation_status: "ENABLE",
  ad_text_list: [{ ad_text: "Tickets on sale" }, { ad_text: "Final release" }],
  call_to_action_list: [{ call_to_action: "SHOP_NOW" }],
  landing_page_url_list: [{ landing_page_url: "https://example.com/tickets" }],
  ad_configuration: {
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    identity_authorized_bc_id: "bc-1",
    creative_auto_add_toggle: true,
    creative_auto_enhancement_strategy_list: ["AUTO"],
  },
  creative_list: [
    {
      smart_plus_creative_id: "chosen-1",
      ad_material_id: "material-1",
      material_operation_status: "ENABLE",
      creative_info: {
        ad_format: "SINGLE_VIDEO",
        material_name: "80% - JJ New 1_vaES07ge.mp4",
        video_info: {
          video_id: "v-library-1",
          file_name: "80% - JJ New 1_vaES07ge.mp4",
          thumbnail_mode: "AUTO",
        },
        image_info: [{ web_uri: "img-1" }],
        music_info: { music_id: "music-1" },
        identity_type: "BC_AUTH_TT",
        identity_id: "identity-ironworks",
        identity_authorized_bc_id: "bc-1",
      },
    },
    {
      smart_plus_creative_id: "chosen-2",
      ad_material_id: "material-2",
      material_operation_status: "ENABLE",
      creative_info: {
        ad_format: "SINGLE_VIDEO",
        material_name: "JJ - Lineup - Motion 1",
        video_info: { video_id: "v-library-2", file_name: "JJ - Lineup - Motion 1" },
        image_info: [],
        identity_type: "BC_AUTH_TT",
        identity_id: "identity-ironworks",
      },
    },
    {
      // Same original, used by a second asset group. One creative in the draft.
      smart_plus_creative_id: "chosen-3",
      ad_material_id: "material-3",
      creative_info: {
        ad_format: "SINGLE_VIDEO",
        material_name: "80% - JJ New 1_vaES07ge.mp4",
        video_info: { video_id: "v-library-1" },
        identity_type: "BC_AUTH_TT",
        identity_id: "identity-ironworks",
      },
    },
    {
      smart_plus_creative_id: "chosen-spark",
      ad_material_id: "material-4",
      creative_info: {
        ad_format: "SINGLE_VIDEO",
        material_name: "Spark post",
        tiktok_item_id: "7684280114589548562",
        identity_type: "TT_USER",
        identity_id: "identity-ironworks",
      },
    },
    {
      smart_plus_creative_id: "chosen-carousel",
      ad_material_id: "material-5",
      creative_info: {
        ad_format: "CAROUSEL_ADS",
        material_name: "auto carousel generation_1",
        image_info: [{ web_uri: "img-carousel-1" }, { web_uri: "img-carousel-2" }],
      },
    },
  ],
};

/**
 * `/ad/get/` returns every creative in the campaign, chosen and
 * TikTok-added alike. `ad_id` matches `smart_plus_creative_id` above for
 * the chosen rows; `auto-*` rows exist only here.
 */
export const UPGRADED_AD_GET_ALL = [
  {
    ad_id: "chosen-1",
    ad_name: "80% - JJ New 1_vaES07ge.mp4_Feed : JJ",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    video_id: "v-library-1",
    image_ids: ["img-1"],
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    landing_page_url: "https://example.com/tickets",
    ad_text: "Tickets on sale",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "chosen-2",
    ad_name: "JJ - Lineup - Motion 1_Feed : JJ",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    video_id: "v-library-2",
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    landing_page_url: "https://example.com/tickets",
    ad_text: "Tickets on sale",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "chosen-3",
    ad_name: "80% - JJ New 1_vaES07ge.mp4_80% Sold",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    video_id: "v-library-1",
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "chosen-spark",
    ad_name: "Spark post_Feed : JJ",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    tiktok_item_id: "7684280114589548562",
    identity_id: "identity-ironworks",
    identity_type: "TT_USER",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "chosen-carousel",
    ad_name: "auto carousel generation_1",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    ad_format: "CAROUSEL_ADS",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "auto-music-refresh",
    ad_name: "Music_Refresh_80% - JJ New 1",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    video_id: "v-generated-1",
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "auto-ai-video",
    ad_name: "AI Generated Video-4_Feed : JJ",
    campaign_id: "upgraded-campaign-1",
    adgroup_id: "upgraded-adgroup-1",
    video_id: "v-generated-2",
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
];

/**
 * The advertiser's Creative Library (`/file/video/ad/search/`). The
 * generated variants above are deliberately absent: that is the carry
 * rule, not a gap in the fixture.
 */
export const CREATIVE_LIBRARY_VIDEO_IDS = ["v-library-1", "v-library-2", "v901"];

export const LEGACY_CAMPAIGN_GET = {
  campaign_id: "legacy-campaign-1",
  campaign_name: "[IRW] Legacy Smart+ fixture",
  objective_type: "TRAFFIC",
  operation_status: "ENABLE",
  campaign_automation_type: "SMART_PLUS",
  is_smart_performance_campaign: true,
};

export const LEGACY_SPC_GET = {
  campaign_id: "legacy-campaign-1",
  campaign_name: "[IRW] Legacy Smart+ fixture",
  objective_type: "TRAFFIC",
  budget: 90,
  budget_mode: "BUDGET_MODE_DAY",
  optimization_goal: "CLICK",
  pixel_id: "7644201699552690194",
  location_ids: ["2635167"],
  gender: "GENDER_UNLIMITED",
  languages: ["en"],
  identity_id: "identity-ironworks",
  identity_type: "TT_USER",
  landing_page_url: "https://example.com/tickets",
  smart_audience_enabled: true,
  creative_auto_add_toggle: true,
  spc_audience_age: "UNCLEAR_BUCKET",
  media_info_list: [
    { media_info: { video_info: { video_id: "v-library-1" } } },
    { media_info: { video_info: { video_id: "v-library-2" } } },
  ],
  title_list: [{ title: "Legacy title one" }, { title: "Legacy title two" }],
};
