import { AUDIENCE_SUBTYPE_LABELS } from "../audiences/metadata.ts";
import { normalizeWebsitePixelUrlContains } from "../audiences/pixel-url-contains.ts";
import type {
  AudienceSourceMeta,
  MetaCustomAudience,
} from "../types/audience.ts";

/**
 * Leaf equality operator for Meta rule JSON.
 *
 * Meta's actual audiences use `"eq"` (verified 2026-05-07 via Graph API
 * Explorer reading rule of 4thefans audience id 6984467206665). Earlier
 * iterations used `"="` based on a misreading; Meta accepts both for
 * filter rules but the manually-created reference audience uses `"eq"`.
 */
const META_RULE_OP_EQ = "eq";

// ─── Page / IG engagement & followers — event `value` strings ─────────────────
// All reverse-engineered from manual audiences in 4thefans ad account
// act_10151014958791885 via Graph API Explorer on 2026-05-07.
// Reference audiences:
//   FB engagement: id 6984467206665 ("Off/Pixel TEST FB engagement")
//   FB followers : id 6984477877465 ("Off/Pixel TEST FB followers")
//   IG engagement: id 6984477463665 ("Off/Pixel TEST IG engagement")
//   IG followers : id 6984477683065 ("Off/Pixel TEST IG followers")

/** FB Page · People who engaged with your Page (verified 2026-05-07) */
const META_PAGE_ENGAGEMENT_FB_EVENT = "page_engaged";

/** IG professional account · People who engaged with your professional account
 *  (verified 2026-05-07: subtype IG_BUSINESS, event_sources type ig_business). */
const META_PAGE_ENGAGEMENT_IG_EVENT = "ig_business_profile_all";

/** FB Page · People who like your Page (verified 2026-05-07) */
const META_PAGE_FOLLOWERS_FB_EVENT = "page_liked";

/** IG · People who follow this profile (verified 2026-05-07: SHOUTING_CASE).
 *  Note: this is the only event constant in our set that uses uppercase. */
const META_PAGE_FOLLOWERS_IG_EVENT = "INSTAGRAM_PROFILE_FOLLOW";

function metaLeafEq(field: string, value: string): Record<string, string> {
  return { field, operator: META_RULE_OP_EQ, value };
}

/**
 * Resolve the FB Page IDs for a page-engagement / page-followers audience.
 * Prefers `sourceMeta.pageIds` (multi-select) and falls back to the
 * comma-separated `sourceId`. Both engagement subtypes (FB + IG) carry FB Page
 * IDs here — the IG rule just wraps the same IDs in an `ig_business` event
 * source (verified 2026-05-07). Exported so the write path can pre-filter the
 * set against token access without duplicating the extraction logic.
 */
export function pageEngagementPageIds(
  audience: Pick<MetaCustomAudience, "sourceMeta" | "sourceId">,
): string[] {
  const pageMeta = audience.sourceMeta as { pageIds?: unknown };
  const fromMeta = Array.isArray(pageMeta.pageIds)
    ? pageMeta.pageIds.map((id) => String(id).trim()).filter(Boolean)
    : [];
  if (fromMeta.length > 0) return fromMeta;
  return audience.sourceId.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Meta hard limit: a single page-engagement Custom Audience accepts at most FIVE
 * stacked engagement sources. Verified via Meta's own UI — the "Create audience"
 * button only enables with ≤5 sources, and a 6+-source POST fails atomically with
 * #200 subcode 1713153. Larger source sets must be split into multiple audiences
 * (combined back with OR at ad-set targeting time).
 */
export const MAX_PAGE_ENGAGEMENT_SOURCES = 5;

/** Split `pageIds` into ordered chunks of at most `size` (default the Meta cap). */
export function chunkPageIds(
  pageIds: string[],
  size: number = MAX_PAGE_ENGAGEMENT_SOURCES,
): string[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const chunks: string[][] = [];
  for (let i = 0; i < pageIds.length; i += size) {
    chunks.push(pageIds.slice(i, i + size));
  }
  return chunks;
}

/** Trailing " (n of m)" suffix appended to a split audience's name. */
const PART_SUFFIX_RE = / \(\d+ of \d+\)$/;

/** Remove a trailing " (n of m)" suffix so re-splitting never double-suffixes. */
export function stripPartSuffix(name: string): string {
  return name.replace(PART_SUFFIX_RE, "");
}

/**
 * Name for part `index` (0-based) of `total`. With a single part the base name is
 * returned unchanged (no regression for ≤5-source audiences); otherwise a
 * 1-based " (i of total)" suffix is appended to the de-suffixed base.
 */
export function partAudienceName(
  baseName: string,
  index: number,
  total: number,
): string {
  const base = stripPartSuffix(baseName);
  return total > 1 ? `${base} (${index + 1} of ${total})` : base;
}

export function buildMetaCustomAudiencePayload(
  audience: MetaCustomAudience,
): Record<string, string> {
  // Meta's rule JSON expects retention_seconds as a NUMBER, not a string.
  // event_sources.id is also numeric in Meta's actual rules (verified 2026-05-07).
  const retentionSeconds = audience.retentionDays * 86_400;
  const sourceMeta = audience.sourceMeta as AudienceSourceMeta;
  // Working campaign-creator path (lib/meta/client.ts createEngagementAudience)
  // sends ONLY {name, rule, prefill}. No `subtype`, no `retention_days` —
  // retention is encoded inside rule.retention_seconds. Including extra
  // top-level fields triggers Meta's misleading #2654 errors.
  const base = {
    name: sanitizeAudienceName(audience.name),
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
    const pageIds = pageEngagementPageIds(audience);
    const eventValue = (() => {
      if (isFollowers) {
        return isIg ? META_PAGE_FOLLOWERS_IG_EVENT : META_PAGE_FOLLOWERS_FB_EVENT;
      }
      return isIg ? META_PAGE_ENGAGEMENT_IG_EVENT : META_PAGE_ENGAGEMENT_FB_EVENT;
    })();

    // ──────────────────────────────────────────────────────────────────
    // CRITICAL: do NOT send `subtype` for engagement audiences. The field
    // is deprecated since Sep 2018 and including it triggers Meta's
    // misleading #2654 "Invalid event name" error.
    //
    // Verified by working code in lib/meta/client.ts createEngagementAudience()
    // (used by the campaign creator tool to successfully create FB/IG
    // engagement audiences for Off/Pixel client ad accounts). That helper
    // sends ONLY {name, rule, prefill} — no subtype, no extra fields.
    //
    // Also: event_sources.id is sent as a STRING (not number-coerced).
    //
    // FOLLOWERS RETENTION CONSTRAINT (verified 2026-05-11 from Meta error
    // #2654 subcode 1713214 "Can't Choose Data Time Limit"):
    //   FB/IG followers audiences ("page_liked" event) MUST have retention_seconds = 0.
    //   These audiences are always-live "everyone who currently likes the Page"
    //   with no rolling window. Meta's UI even disables the retention field
    //   when this event is selected. The working campaign creator code in
    //   lib/meta/client.ts:1197 sets retentionSeconds: 0 for fb_likes
    //   regardless of any user input.
    //   We still preserve audience.retentionDays elsewhere for naming / UI
    //   readability even though the payload itself must send zero.
    const effectiveRetentionSeconds = isFollowers ? 0 : retentionSeconds;
    const rules = pageIds.map((pageId) => ({
      event_sources: [{ type: isIg ? "ig_business" : "page", id: pageId }],
      retention_seconds: effectiveRetentionSeconds,
      filter: {
        operator: "and",
        filters: [metaLeafEq("event", eventValue)],
      },
    }));
    return {
      ...base,
      // No `subtype` field — Meta deprecated it Sep 2018 for engagement audiences.
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
    // Verified 2026-05-07 from 4thefans audience id 6984471975065
    // ("Off/Pixel TEST 95% VV Manchester") and historical audiences:
    //   - Rule is a BARE JSON ARRAY, not an {inclusions: {...}} object
    //   - Each video gets one entry with event_name + object_id + context_id
    //   - context_id = the FB page ID where the video was published (NOT the ad account)
    //   - subtype enum is still "ENGAGEMENT" (despite VIDEO being a valid Meta enum,
    //     Meta's UI-created video audiences register as ENGAGEMENT subtype with
    //     data_source.sub_type=ENGAGEMENT_EVENTS)
    //
    // Threshold → event_name mapping (verified across multiple historical audiences):
    //   25/50/75% → video_view_<n>_percent
    //   95/100%   → video_completed (Meta does NOT use "video_view_95_percent")
    const sm = sourceMeta as typeof sourceMeta & { contextId?: string };
    if (!sm.contextId) {
      throw new Error(
        "Video views audience requires source_meta.contextId (the FB page ID that owns the videos)",
      );
    }
    const eventName = videoViewEvent(sourceMeta.threshold);
    const ruleArray = sourceMeta.videoIds.map((videoId) => ({
      event_name: eventName,
      object_id: videoId,
      context_id: sm.contextId,
    }));
    return {
      ...base,
      // Video views uses a bare-array rule with no per-entry retention — Meta
      // defaults to 730 days if top-level `retention_days` is omitted.
      // Engagement encodes retention in rule.retention_seconds; website pixel
      // encodes rule.retention_seconds too — only video_views needs this field.
      retention_days: String(audience.retentionDays),
      subtype: "ENGAGEMENT",
      rule: JSON.stringify(ruleArray),
    };
  }

  if (audience.audienceSubtype === "lookalike") {
    if (sourceMeta.subtype !== "lookalike") {
      throw new Error("Lookalike audience requires lookalike source_meta");
    }
    // Verified 2026-05-20 against Meta Marketing API docs (Lookalike Audiences):
    //   POST /act_{id}/customaudiences with subtype=LOOKALIKE,
    //   origin_audience_id=<seed Meta id>, lookalike_spec={type, ratio, country}.
    //
    // Unlike engagement audiences (PR #340 lesson — subtype field dropped because
    // Meta's POST deprecated it for engagement subtypes), LOOKALIKE audiences are
    // a DOCUMENTED EXCEPTION: subtype=LOOKALIKE IS REQUIRED at create time.
    //
    // Also unlike other subtypes, lookalikes do NOT use `rule` and do NOT take
    // `prefill` (lookalikes auto-refresh from the seed audience, so prefill
    // has no meaning). We construct the payload from scratch rather than
    // spreading `base`, because `base` includes prefill: "1".
    const lookalikeType = sourceMeta.type ?? "similarity";
    const lookalikeSpec = {
      type: lookalikeType,
      ratio: sourceMeta.ratio,
      country: sourceMeta.country,
    };
    return {
      name: sanitizeAudienceName(audience.name),
      subtype: "LOOKALIKE",
      origin_audience_id: sourceMeta.originAudienceId,
      lookalike_spec: JSON.stringify(lookalikeSpec),
    };
  }

  if (audience.audienceSubtype === "website_pixel") {
    if (sourceMeta.subtype !== "website_pixel") {
      throw new Error("Website pixel audience requires website source_meta");
    }
    // Verified 2026-05-07 from 4thefans audience id 6983230099865 ("Arsenal CL Final Pixel"):
    //   - URLs INCLUDE the https:// scheme (do NOT strip)
    //   - Inner filter group uses operator: "or" with template: "VISITORS_BY_URL"
    //   - Outer filter is "and" with TWO entries: the URL OR-group AND a trailing
    //     empty url filter `{field:"url",operator:"i_contains",value:""}` — this
    //     trailing empty filter is structural (Meta seems to require it) and not
    //     intuitive from any docs.
    //   - event_sources.id is NUMERIC (no quotes in JSON)
    //   - retention_seconds is NUMERIC (no quotes in JSON)
    const urlParts = normalizeWebsitePixelUrlContains(sourceMeta.urlContains);
    const filters: Array<Record<string, unknown>> = [];
    if (urlParts.length > 0) {
      filters.push({
        operator: "or",
        filters: urlParts.map((value) => ({
          field: "url",
          operator: "i_contains",
          value,
        })),
        template: "VISITORS_BY_URL",
      });
      // Trailing empty url filter — verified structural requirement.
      filters.push({ field: "url", operator: "i_contains", value: "" });
    } else {
      filters.push(metaLeafEq("event", sourceMeta.pixelEvent || "PageView"));
    }
    return {
      ...base,
      // No `subtype: "WEBSITE"` — same lesson as engagement audiences (PR #340).
      // Meta's POST endpoint deprecated the subtype field; including it triggers
      // #2654 subcode 1870053. rule + prefill is sufficient.
      rule: JSON.stringify({
        inclusions: {
          operator: "or",
          rules: [
            {
              event_sources: [{ type: "pixel", id: numericId(audience.sourceId) }],
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

/**
 * Coerce a numeric-string ID to a JSON number when it's safe (under
 * Number.MAX_SAFE_INTEGER). Meta's actual rule JSON serialises Page IDs,
 * pixel IDs, and IG account IDs as bare numerics, NOT strings. Verified
 * 2026-05-07 by reading rule fields on real audiences in act_10151014958791885.
 */
function numericId(id: string): number | string {
  const n = Number(id);
  if (!Number.isFinite(n)) return id;
  if (Math.abs(n) >= Number.MAX_SAFE_INTEGER) return id;
  return n;
}

/**
 * Meta's POST /customaudiences endpoint enforces strict name validation:
 * "less than 50 characters long, and it can contain only alphanumeric
 * characters and underscores."
 *
 * Despite Meta's UI accepting names with spaces, brackets, hyphens, and slashes
 * (visible in audience list views), POST requests with these characters fail
 * with #2654 "Invalid event name for custom audience" — the error message
 * misleadingly says "event name" but the actual validation target is the
 * audience name parameter.
 *
 * Verified 2026-05-07 via Graph API Explorer: same payload with name
 * "OffPixel_Manual_Test_FB" succeeds; with "OffPixel Manual Test FB" fails.
 *
 * This function:
 *   - Replaces spaces, hyphens, brackets, slashes, periods with underscores
 *   - Strips any remaining non-alphanumeric, non-underscore characters
 *   - Collapses consecutive underscores to one
 *   - Trims leading/trailing underscores
 *   - Truncates to 50 chars (Meta's hard limit)
 */
export function sanitizeAudienceName(raw: string): string {
  return raw
    .replace(/[\s\-/[\].]+/g, "_") // spaces, hyphens, brackets, slashes, dots → underscore
    .replace(/[^a-zA-Z0-9_]/g, "") // strip anything still non-alphanumeric/underscore
    .replace(/_+/g, "_") // collapse multiple underscores
    .replace(/^_+|_+$/g, "") // trim leading/trailing underscores
    .slice(0, 50);
}

// Verified 2026-05-07 across multiple 4thefans historical audiences
// ("Off/Pixel TEST 95% VV Manchester" id 6984471975065 used video_completed,
//  "Brighton 75% VV" id 6977434598665 used video_view_75_percent,
//  "WC26-LEEDS 50% VV" id 6980235735865 used video_view_50_percent).
// Meta's actual event constants — NOT the docs' "video_watched_*" names.
function videoViewEvent(threshold: 25 | 50 | 75 | 95 | 100): string {
  return {
    25: "video_view_25_percent",
    50: "video_view_50_percent",
    75: "video_view_75_percent",
    95: "video_completed",
    100: "video_completed",
  }[threshold];
}
