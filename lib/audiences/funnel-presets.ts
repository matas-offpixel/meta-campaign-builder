import type {
  AudienceSourceMeta,
  AudienceSubtype,
  FunnelStage,
} from "../types/audience.ts";

export interface FunnelStagePreset {
  id: string;
  label: string;
  audienceSubtype: AudienceSubtype;
  retentionDays: number;
  defaultSourceMeta: AudienceSourceMeta;
}

export const FUNNEL_STAGE_PRESETS = {
  top_of_funnel: [
    pagePreset("tof-fb-page-engagement-365", "FB page engagement, 365d", "page_engagement_fb", 365),
    pagePreset("tof-ig-page-engagement-365", "IG page engagement, 365d", "page_engagement_ig", 365),
    pagePreset("tof-fb-page-followers-365", "FB page followers, 365d", "page_followers_fb", 365),
    pagePreset("tof-ig-page-followers-365", "IG page followers, 365d", "page_followers_ig", 365),
    videoPreset("tof-video-views-50-365", "Video views 50%, 365d", 50, 365),
    pixelPreset("tof-pixel-page-view-180", "Website pixel PageView, 180d", "PageView", 180),
  ],
  mid_funnel: [
    pagePreset("mid-fb-page-engagement-60", "FB page engagement, 60d", "page_engagement_fb", 60),
    pagePreset("mid-ig-page-engagement-60", "IG page engagement, 60d", "page_engagement_ig", 60),
    videoPreset("mid-video-views-75-60", "Video views 75%, 60d", 75, 60),
    pixelPreset(
      "mid-pixel-view-content-60",
      "Website pixel ViewContent, 60d",
      "ViewContent",
      60,
    ),
  ],
  bottom_funnel: [
    pagePreset("bottom-fb-page-engagement-30", "FB page engagement, 30d", "page_engagement_fb", 30),
    pagePreset("bottom-ig-page-engagement-30", "IG page engagement, 30d", "page_engagement_ig", 30),
    videoPreset("bottom-video-views-95-30", "Video views 95%, 30d", 95, 30),
    pixelPreset(
      "bottom-pixel-initiate-checkout-30",
      "Website pixel InitiateCheckout, 30d",
      "InitiateCheckout",
      30,
    ),
  ],
  retargeting: [],
} as const satisfies Record<FunnelStage, readonly FunnelStagePreset[]>;

function pagePreset(
  id: string,
  label: string,
  subtype: Extract<
    AudienceSubtype,
    | "page_engagement_fb"
    | "page_engagement_ig"
    | "page_followers_fb"
    | "page_followers_ig"
  >,
  retentionDays: number,
): FunnelStagePreset {
  return {
    id,
    label,
    audienceSubtype: subtype,
    retentionDays,
    defaultSourceMeta: { subtype },
  };
}

function videoPreset(
  id: string,
  label: string,
  threshold: 25 | 50 | 75 | 95 | 100,
  retentionDays: number,
): FunnelStagePreset {
  return {
    id,
    label,
    audienceSubtype: "video_views",
    retentionDays,
    defaultSourceMeta: {
      subtype: "video_views",
      threshold,
      videoIds: [],
    },
  };
}

function pixelPreset(
  id: string,
  label: string,
  pixelEvent: "PageView" | "ViewContent" | "InitiateCheckout" | "Purchase",
  retentionDays: number,
): FunnelStagePreset {
  return {
    id,
    label,
    audienceSubtype: "website_pixel",
    retentionDays,
    defaultSourceMeta: {
      subtype: "website_pixel",
      pixelEvent,
    },
  };
}
