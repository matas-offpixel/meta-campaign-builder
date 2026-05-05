export type FunnelStage =
  | "top_of_funnel"
  | "mid_funnel"
  | "bottom_funnel"
  | "retargeting";

export type AudienceSubtype =
  | "page_engagement_fb"
  | "page_engagement_ig"
  | "page_followers_fb"
  | "page_followers_ig"
  | "video_views"
  | "website_pixel";

export type AudienceStatus =
  | "draft"
  | "creating"
  | "ready"
  | "failed"
  | "archived";

export type AudienceSourceMeta =
  | {
      subtype: "video_views";
      threshold: 25 | 50 | 75 | 95 | 100;
      videoIds: string[];
    }
  | {
      subtype: "website_pixel";
      pixelEvent:
        | "PageView"
        | "ViewContent"
        | "InitiateCheckout"
        | "Purchase"
        | string;
      urlContains?: string;
    }
  | {
      subtype: "page_engagement_fb" | "page_engagement_ig";
      pageSlug?: string;
    }
  | {
      subtype: "page_followers_fb" | "page_followers_ig";
      pageSlug?: string;
    };

export interface MetaCustomAudience {
  id: string;
  userId: string;
  clientId: string;
  eventId: string | null;
  name: string;
  funnelStage: FunnelStage;
  audienceSubtype: AudienceSubtype;
  retentionDays: number;
  sourceId: string;
  sourceMeta: AudienceSourceMeta | Record<string, unknown>;
  metaAudienceId: string | null;
  metaAdAccountId: string;
  status: AudienceStatus;
  statusError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MetaCustomAudienceInsert = Omit<
  MetaCustomAudience,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "metaAudienceId"
  | "status"
  | "statusError"
>;

export type MetaCustomAudienceUpdate = Partial<
  Omit<MetaCustomAudience, "id" | "userId" | "createdAt" | "updatedAt">
>;
