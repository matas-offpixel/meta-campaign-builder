/**
 * Untouched TikTok Marketing API rows captured 2026-09-10 for advertiser
 * 7639802149165301776 (Ironworks). Do not tidy. Same label shape as
 * IRONWORKS_IDENTITY_GET_ROW.
 */
/** CAPTURED 2026-09-10 GET /pixel/list/ — envelope data keys: page_info, pixels. */
export const IRONWORKS_PIXEL_LIST_ROW = {
  "activity_status": "ACTIVE",
  "advanced_matching_fields": {
    "email": true,
    "phone_number": true
  },
  "asset_ownership": {
    "asset_relation_status": "SHARED",
    "ownership_status": false,
    "updated_at": 0
  },
  "automatic_advanced_matching_fields": {
    "address": true,
    "email": true,
    "external_id": true,
    "name": true,
    "phone_number": true
  },
  "create_time": "2026-05-26T14:17:07Z",
  "enable_expanded_data_sharing": true,
  "enable_first_party_cookies": true,
  "events": [
    {
      "currency": "USD",
      "currency_value": "",
      "deprecated": false,
      "event_code": "",
      "event_id": "0",
      "event_type": "PAGE_VIEW",
      "name": "",
      "optimization_event": null,
      "rules": [],
      "statistic_type": "EVERY_TIME"
    },
    {
      "currency": "USD",
      "currency_value": "",
      "deprecated": false,
      "event_code": "",
      "event_id": "0",
      "event_type": "ON_WEB_REGISTER",
      "name": "",
      "optimization_event": "ON_WEB_REGISTER",
      "rules": [],
      "statistic_type": "EVERY_TIME"
    },
    {
      "currency": "USD",
      "currency_value": "",
      "deprecated": false,
      "event_code": "",
      "event_id": "0",
      "event_type": "LANDING_PAGE_VIEW",
      "name": "",
      "optimization_event": "LANDING_PAGE_VIEW",
      "rules": [],
      "statistic_type": "EVERY_TIME"
    },
    {
      "currency": "USD",
      "currency_value": "",
      "deprecated": false,
      "event_code": "",
      "event_id": "0",
      "event_type": "ENGAGED_SESSION",
      "name": "",
      "optimization_event": "ENGAGED_SESSION",
      "rules": [],
      "statistic_type": "EVERY_TIME"
    }
  ],
  "pixel_category": "CUSTOMIZE_EVENTS",
  "pixel_code": "D8AQMORC77U9J3L24UR0",
  "pixel_id": "7644201699552690194",
  "pixel_name": "Ironworks Pixel",
  "pixel_script": "\n\t<script>\n\t\t!function (w, d, t) {\n\t\t  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=[\"page\",\"track\",\"identify\",\"instances\",\"debug\",\"on\",\"off\",\"once\",\"ready\",\"alias\",\"group\",\"enableCookie\",\"disableCookie\"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++\n)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i=\"https://analytics.tiktok.com/i18n/pixel/events.js\";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement(\"script\");n.type=\"text/javascript\",n.async=!0,n.src=i+\"?sdkid=\"+e+\"&lib=\"+t;e=document.getElementsByTagName(\"script\")[0];e.parentNode.insertBefore(n,e)};\n\t\t\n\t\t  ttq.load('D8AQMORC77U9J3L24UR0');\n\t\t  ttq.page();\n\t\t}(window, document, 'ttq');\n\t</script>\n\t",
  "pixel_setup_mode": "STANDARD"
} as const;
/** CAPTURED 2026-09-10 GET /advertiser/info/ — envelope data keys: list. No advertiser_id on the row. */
export const IRONWORKS_ADVERTISER_INFO_ROW = {
  "display_timezone": "Europe/London",
  "timezone": "Etc/GMT",
  "currency": "GBP"
} as const;
/** CAPTURED 2026-09-10 GET /report/integrated/get/ — envelope data keys: page_info, list. Window 2026-08-12..2026-09-10 (30-day cap with stat_time_day). list[0]. */
export const IRONWORKS_INTEGRATED_REPORT_ROW = {
  "metrics": {
    "video_play_actions": "0",
    "video_views_p100": "0",
    "video_views_p25": "0",
    "real_time_conversion_rate": "0.00",
    "cost_per_conversion": "0.00",
    "conversion": "0",
    "cpm": "0.00",
    "real_time_cost_per_conversion": "0.00",
    "ctr": "0.00",
    "view_content": "0",
    "impressions": "0",
    "video_views_p50": "0",
    "conversion_rate": "0.00",
    "reach": "0",
    "real_time_conversion": "0",
    "spend": "0.00",
    "clicks": "0",
    "video_views_p75": "0"
  },
  "dimensions": {
    "stat_time_day": "2026-09-01 00:00:00",
    "campaign_id": "1873969439956706"
  }
} as const;
/** CAPTURED 2026-09-10 GET /file/video/ad/info/ — envelope data keys: list. No thumbnail_url. */
export const IRONWORKS_VIDEO_AD_INFO_ROW = {
  "allow_download": true,
  "allowed_placements": [
    "PLACEMENT_TOPBUZZ",
    "PLACEMENT_TIKTOK",
    "PLACEMENT_HELO",
    "PLACEMENT_PANGLE",
    "PLACEMENT_GLOBAL_APP_BUNDLE"
  ],
  "bit_rate": 7468141,
  "create_time": "2026-09-10T11:37:35Z",
  "displayable": true,
  "duration": 19.633,
  "file_name": "80_-_JJ_New_2-mtvgdfep.mp4",
  "fix_task_id": null,
  "flaw_types": null,
  "format": "mp4",
  "height": 1280,
  "material_id": "7683854663125270535",
  "modify_time": "2026-09-10T11:37:34Z",
  "preview_url": "https://v19-tt4b.tiktokcdn.com/e49755cabb902cee1b0ab897fe4d4a2e/6aa43025/video/tos/alisg/tos-alisg-v-0051c001-sg/oMAPiJAu7iBEzYUmzACK7iawHASqiiEaAKkAV/?a=1233&bti=Nzg3NWYzLTQ6&&bt=7293&ft=.bvrXInz7ThBlDrGXq8Zmo&mime_type=video_mp4&rc=ajltaGo5cmQ7ZDMzODYzNEBpajltaGo5cmQ7ZDMzODYzNEAwa3BrMmQ0ZmVhLS1kMC1zYSMwa3BrMmQ0ZmVhLS1kMC1zcw%3D%3D&vvpl=1&l=202609110045051CC374A02D797EFEC907&btag=e00078000&sp_exp=hash_v0&vid=v10033g50000dah8ia7og65gnesjn63g",
  "preview_url_expire_time": "2026-09-10 22:45:06",
  "signature": "b59a2ef45f3eb73d80c1003831968203",
  "size": 18328064,
  "video_cover_url": "http://p19-common-sign.tiktokcdn.com/tos-alisg-p-0051c001-sg/ocqB7KEwIEzLmPkHuYaiAiBUSpi7ACqNK7iAJ~tplv-noop.image?dr=18692&refresh_token=6fc26a52&x-expires=1789080325&x-signature=XT4CCGvijvEn7%2FGK6yk1copujGI%3D&t=9276707c&ps=14f1eb3e&shp=9e36835a&shcp=623c3a84&idc=my&VideoID=v10033g50000dah8ia7og65gnesjn63g",
  "video_id": "v10033g50000dah8ia7og65gnesjn63g",
  "width": 720
} as const;
