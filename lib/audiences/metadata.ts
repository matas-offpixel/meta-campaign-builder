import type {
  AudienceStatus,
  AudienceSubtype,
  FunnelStage,
} from "../types/audience.ts";

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  top_of_funnel: "Top of funnel",
  mid_funnel: "Mid funnel",
  bottom_funnel: "Bottom funnel",
  retargeting: "Retargeting",
};

export const AUDIENCE_SUBTYPE_LABELS: Record<AudienceSubtype, string> = {
  page_engagement_fb: "FB page engagement",
  page_engagement_ig: "IG page engagement",
  page_followers_fb: "FB page followers",
  page_followers_ig: "IG page followers",
  video_views: "Video views",
  website_pixel: "Website pixel",
};

export const AUDIENCE_STATUS_LABELS: Record<AudienceStatus, string> = {
  draft: "Draft",
  creating: "Creating",
  ready: "Ready",
  failed: "Failed",
  archived: "Archived",
};

export const FUNNEL_STAGES = [
  "top_of_funnel",
  "mid_funnel",
  "bottom_funnel",
  "retargeting",
] as const satisfies readonly FunnelStage[];

export const AUDIENCE_SUBTYPES = [
  "page_engagement_fb",
  "page_engagement_ig",
  "page_followers_fb",
  "page_followers_ig",
  "video_views",
  "website_pixel",
] as const satisfies readonly AudienceSubtype[];

export const AUDIENCE_STATUSES = [
  "draft",
  "creating",
  "ready",
  "failed",
  "archived",
] as const satisfies readonly AudienceStatus[];

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === "string" && FUNNEL_STAGES.includes(value as FunnelStage);
}

export function isAudienceSubtype(value: unknown): value is AudienceSubtype {
  return (
    typeof value === "string" &&
    AUDIENCE_SUBTYPES.includes(value as AudienceSubtype)
  );
}

export function isAudienceStatus(value: unknown): value is AudienceStatus {
  return (
    typeof value === "string" &&
    AUDIENCE_STATUSES.includes(value as AudienceStatus)
  );
}
