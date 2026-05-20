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
  | "website_pixel"
  | "lookalike";

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
      campaignId?: string;
      campaignIds?: string[];
      campaignName?: string;
      campaignSummaries?: Array<{ id: string; name: string }>;
      videoIds: string[];
      /**
       * FB page ID that owns the videos. Required for Meta's video custom audience
       * rule shape (each rule entry needs object_id + context_id, where
       * context_id = the publishing page's ID, NOT the ad account ID).
       * Verified 2026-05-07 from audience id 6984471975065.
       */
      contextId?: string;
    }
  | {
      subtype: "website_pixel";
      pixelEvent:
        | "PageView"
        | "ViewContent"
        | "InitiateCheckout"
        | "Purchase"
        | "AddToCart"
        | string;
      /** URL fragments (combined with OR on Meta). Legacy single string is coerced on DB read. */
      urlContains?: string | string[];
      pixelName?: string;
    }
  | {
      subtype: "page_engagement_fb" | "page_engagement_ig";
      pageSlug?: string;
      pageName?: string;
      pageIds?: string[];
    }
  | {
      subtype: "page_followers_fb" | "page_followers_ig";
      pageSlug?: string;
      pageName?: string;
      pageIds?: string[];
    }
  | {
      subtype: "lookalike";
      /** Meta-side audience id of the seed (used as origin_audience_id at POST time). */
      originAudienceId: string;
      /** Lookalike ratio (Meta accepts 0.01–0.20 in 0.01 increments). */
      ratio: number;
      /** ISO-2 country code where the lookalike segment is drawn from. */
      country: string;
      /** Display name of the seed audience (for UI + DB row name building). */
      seedName: string;
      /** Local audiences-table id of the seed when the seed is one of OUR rows. Null when seed came from the live Meta list. */
      seedLocalAudienceId?: string | null;
      /** AudienceSubtype of the seed when known (informational; not used at POST time). */
      seedSubtype?: string | null;
      /** "similarity" by default. Reserved for future "reach"/"custom_ratio" extensions. */
      type?: "similarity" | "reach" | "custom_ratio";
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
