/**
 * Documented v1.3 envelopes for the six import reads.
 *
 * Live capture against advertiser 7639802149165301776 (Ironworks) was
 * not possible from this worktree — TIKTOK_TOKEN_KEY is not available
 * here. Field names and nesting match portal/docs get-campaigns,
 * get-ad-groups, get-ads, get-upgraded-smart-ad-groups,
 * get-upgraded-smart-ads, get-smart-campaigns (v1.3). Campaign ids in
 * these fixtures are placeholders. Replace with a verbatim Ironworks
 * row when a read-only capture can run.
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
    location_ids: ["2635167"],
    age_groups: ["AGE_25_34", "AGE_35_44"],
    gender: "GENDER_UNLIMITED",
    languages: ["en"],
  },
};

export const UPGRADED_SMART_PLUS_AD_GET = {
  ad_id: "upgraded-ad-1",
  ad_name: "Chosen asset group",
  campaign_id: "upgraded-campaign-1",
  creative_auto_add_toggle: true,
  creative_auto_enhancement_strategy_list: ["AUTO"],
  is_aco: true,
  creative_authorized: true,
  creative_list: [
    {
      creative_id: "chosen-1",
      video_id: "v-chosen-1",
      image_ids: ["img-1"],
      ad_text: "Chosen one",
      identity_id: "identity-ironworks",
      identity_type: "BC_AUTH_TT",
      landing_page_url: "https://example.com/tickets",
      call_to_action: "SHOP_NOW",
    },
    {
      creative_id: "chosen-2",
      video_id: "v-chosen-2",
      image_ids: [],
      ad_text: "Chosen two",
      identity_id: "identity-ironworks",
      identity_type: "BC_AUTH_TT",
      landing_page_url: "https://example.com/tickets",
    },
  ],
};

export const UPGRADED_AD_GET_ALL = [
  {
    ad_id: "chosen-1",
    ad_name: "Chosen one",
    campaign_id: "upgraded-campaign-1",
    video_id: "v-chosen-1",
    image_ids: ["img-1"],
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    landing_page_url: "https://example.com/tickets",
    ad_text: "Chosen one",
    is_aco: true,
    creative_authorized: true,
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "chosen-2",
    ad_name: "Chosen two",
    campaign_id: "upgraded-campaign-1",
    video_id: "v-chosen-2",
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    landing_page_url: "https://example.com/tickets",
    ad_text: "Chosen two",
    is_aco: true,
    creative_authorized: true,
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
  {
    ad_id: "auto-1",
    ad_name: "TikTok added",
    campaign_id: "upgraded-campaign-1",
    video_id: "v-auto-1",
    identity_id: "identity-ironworks",
    identity_type: "BC_AUTH_TT",
    landing_page_url: "https://example.com/tickets",
    ad_text: "Auto added",
    is_aco: true,
    creative_authorized: true,
    campaign_automation_type: "UPGRADED_SMART_PLUS",
  },
];

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
    { media_info: { video_info: { video_id: "v-legacy-1" } } },
    { media_info: { video_info: { video_id: "v-legacy-2" } } },
  ],
  title_list: [{ title: "Legacy title one" }, { title: "Legacy title two" }],
};
