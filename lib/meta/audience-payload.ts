import { AUDIENCE_SUBTYPE_LABELS } from "../audiences/metadata.ts";
import {
  normalizeWebsitePixelUrlContains,
  stripHttpSchemeFromPixelUrlFragment,
} from "../audiences/pixel-url-contains.ts";
import type {
  AudienceSourceMeta,
  MetaCustomAudience,
} from "../types/audience.ts";

/** Leaf equality operator for Meta rule JSON (rejecting `eq` — Marketing API subcode 1870053). */
const META_RULE_OP_EQ = "=";

// ─── Page / IG engagement & followers — event `value` strings ─────────────────
// Reverse-engineered from manual audience 2026-05-06 (Ads Manager → Audiences → rule preview).

/** FB Page · People who engaged with your Page */
const META_PAGE_ENGAGEMENT_FB_EVENT = "user-engaged";

/** IG professional account · People who engaged with your professional account */
const META_PAGE_ENGAGEMENT_IG_EVENT = "user-engaged";

/** FB Page · People who like your Page */
const META_PAGE_FOLLOWERS_FB_EVENT = "page_like";

/** IG · People who follow this profile (same rule shape as FB followers in Ads Manager export) */
const META_PAGE_FOLLOWERS_IG_EVENT = "page_like";

function metaLeafEq(field: string, value: string): Record<string, string> {
  return { field, operator: META_RULE_OP_EQ, value };
}

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
    const eventValue = (() => {
      if (isFollowers) {
        return isIg ? META_PAGE_FOLLOWERS_IG_EVENT : META_PAGE_FOLLOWERS_FB_EVENT;
      }
      return isIg ? META_PAGE_ENGAGEMENT_IG_EVENT : META_PAGE_ENGAGEMENT_FB_EVENT;
    })();

    const rules = pageIds.map((pageId) => ({
      event_sources: [{ type: isIg ? "ig_business" : "page", id: pageId }],
      retention_seconds: retentionSeconds,
      filter: {
        operator: "and",
        filters: [metaLeafEq("event", eventValue)],
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
      subtype: "VIDEO",
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
                  metaLeafEq("event", videoViewEvent(sourceMeta.threshold)),
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
      metaLeafEq("event", sourceMeta.pixelEvent || "PageView"),
    ];
    const urlParts = normalizeWebsitePixelUrlContains(
      sourceMeta.urlContains,
    ).map(stripHttpSchemeFromPixelUrlFragment);
    if (urlParts.length === 1) {
      const [singleUrl] = urlParts;
      filters.push({
        field: "url",
        operator: "i_contains",
        value: singleUrl,
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
