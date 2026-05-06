import { AUDIENCE_SUBTYPE_LABELS } from "../audiences/metadata.ts";
import { normalizeWebsitePixelUrlContains } from "../audiences/pixel-url-contains.ts";
import type {
  AudienceSourceMeta,
  MetaCustomAudience,
} from "../types/audience.ts";

export function buildMetaCustomAudiencePayload(
  audience: MetaCustomAudience,
): Record<string, string> {
  const retentionSeconds = String(audience.retentionDays * 86_400);
  const sourceMeta = audience.sourceMeta as AudienceSourceMeta;
  const base = {
    name: sanitizeAudienceName(audience.name),
    retention_days: String(audience.retentionDays),
    prefill: "1",
  };

  if (
    audience.audienceSubtype === "page_engagement_fb" ||
    audience.audienceSubtype === "page_engagement_ig" ||
    audience.audienceSubtype === "page_followers_fb" ||
    audience.audienceSubtype === "page_followers_ig"
  ) {
    const isIg =
      audience.audienceSubtype === "page_engagement_ig" ||
      audience.audienceSubtype === "page_followers_ig";
    const isFollowers =
      audience.audienceSubtype === "page_followers_fb" ||
      audience.audienceSubtype === "page_followers_ig";
    const pageMeta = sourceMeta as { pageIds?: string[] };
    const pageIds =
      Array.isArray(pageMeta.pageIds) && pageMeta.pageIds.length > 0
        ? pageMeta.pageIds
        : audience.sourceId.split(",").map((s) => s.trim()).filter(Boolean);
    const rules = pageIds.map((pageId) => ({
      event_sources: [{ type: isIg ? "ig_business" : "page", id: pageId }],
      retention_seconds: retentionSeconds,
      filter: {
        operator: "and",
        filters: [
          {
            field: "event",
            operator: "eq",
            value: isFollowers ? "page_liked" : "page_engaged",
          },
        ],
      },
    }));
    return {
      ...base,
      subtype: "ENGAGEMENT",
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules,
        },
      }),
    };
  }

  if (audience.audienceSubtype === "video_views") {
    if (sourceMeta.subtype !== "video_views" || sourceMeta.videoIds.length === 0) {
      throw new Error("Video views audience requires source_meta.videoIds");
    }
    return {
      ...base,
      subtype: "VIDEO_VIEWERS_VIEWED",
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: sourceMeta.videoIds.map((id) => ({
                type: "video",
                id,
              })),
              retention_seconds: retentionSeconds,
              filter: {
                operator: "and",
                filters: [
                  {
                    field: "event",
                    operator: "eq",
                    value: videoViewEvent(sourceMeta.threshold),
                  },
                ],
              },
            },
          ],
        },
      }),
    };
  }

  if (audience.audienceSubtype === "website_pixel") {
    if (sourceMeta.subtype !== "website_pixel") {
      throw new Error("Website pixel audience requires website source_meta");
    }
    const filters: Array<Record<string, unknown>> = [
      {
        field: "event",
        operator: "eq",
        value: sourceMeta.pixelEvent || "PageView",
      },
    ];
    const urlParts = normalizeWebsitePixelUrlContains(sourceMeta.urlContains);
    if (urlParts.length === 1) {
      filters.push({
        field: "url",
        operator: "i_contains",
        value: urlParts[0],
      });
    } else if (urlParts.length > 1) {
      filters.push({
        operator: "or",
        filters: urlParts.map((value) => ({
          field: "url",
          operator: "i_contains",
          value,
        })),
      });
    }
    return {
      ...base,
      subtype: "WEBSITE",
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ type: "pixel", id: audience.sourceId }],
              retention_seconds: retentionSeconds,
              filter: { operator: "and", filters },
            },
          ],
        },
      }),
    };
  }

  throw new Error(
    `${AUDIENCE_SUBTYPE_LABELS[audience.audienceSubtype]} is not supported`,
  );
}

function sanitizeAudienceName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_ \-[\]]/g, "").slice(0, 50).trim();
}

function videoViewEvent(threshold: 25 | 50 | 75 | 95 | 100): string {
  return {
    25: "video_watched_25_percent",
    50: "video_watched_50_percent",
    75: "video_watched_75_percent",
    95: "video_watched_95_percent",
    100: "video_watched_100_percent",
  }[threshold];
}
