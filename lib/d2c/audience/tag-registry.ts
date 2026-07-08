/**
 * lib/d2c/audience/tag-registry.ts
 *
 * Mailchimp tag discovery + recommendation for the multi-tag audience picker
 * (Goal 5). Two seams:
 *   - `getAudienceTags` — GET /lists/{id}/tags (5-min in-memory cache), the
 *     network side.
 *   - `recommendTagsForEvent` / `buildSegmentOpts` — PURE, testable, no
 *     server-only imports (per feedback_node_test_react_server_no_dom).
 *
 * Relative imports only so the pure seams run under `node --test` without the
 * `@/` alias resolver (PR #694 lesson).
 */

import { mailchimpJson } from "../mailchimp/client.ts";

export interface AudienceTag {
  id: number;
  name: string;
  member_count: number;
}

/** Event geo/identity fields the recommender keys off. */
export interface TagRecommendationEvent {
  /** The event's own pinned tag name (e.g. "T26-ALGARVE"). Always recommended. */
  ownTag?: string | null;
  venue_city?: string | null;
  venue_country?: string | null;
  event_code?: string | null;
}

export interface TagRecommendation {
  recommended: AudienceTag[];
  other: AudienceTag[];
}

function normalise(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/**
 * Split an audience's tags into a pre-selected "recommended" set and the
 * remainder. A tag is recommended when its name (case-insensitive):
 *   - equals the event's own tag, OR
 *   - contains the venue city, OR
 *   - contains the venue country, OR
 *   - contains the event code.
 * Recommended tags are ranked by member_count desc (highest reach first);
 * the rest are alphabetical. Pure.
 */
export function recommendTagsForEvent(
  event: TagRecommendationEvent,
  allTags: AudienceTag[],
): TagRecommendation {
  const own = normalise(event.ownTag);
  const city = normalise(event.venue_city);
  const country = normalise(event.venue_country);
  const code = normalise(event.event_code);

  const isRecommended = (tag: AudienceTag): boolean => {
    const name = normalise(tag.name);
    if (!name) return false;
    if (own && name === own) return true;
    if (city && name.includes(city)) return true;
    if (country && name.includes(country)) return true;
    if (code && name.includes(code)) return true;
    return false;
  };

  const recommended: AudienceTag[] = [];
  const other: AudienceTag[] = [];
  for (const tag of allTags) {
    (isRecommended(tag) ? recommended : other).push(tag);
  }

  recommended.sort(
    (a, b) => b.member_count - a.member_count || a.name.localeCompare(b.name),
  );
  other.sort((a, b) => a.name.localeCompare(b.name));

  return { recommended, other };
}

/** A single Mailchimp static-segment membership condition. */
export interface SegmentCondition {
  condition_type: "StaticSegment";
  field: "static_segment";
  op: "static_is";
  value: number;
}

export interface SegmentOpts {
  match: "any";
  conditions: SegmentCondition[];
}

/**
 * Build Mailchimp `recipients.segment_opts` for a multi-tag "match any" send.
 * `tagIdMap` maps a tag NAME → its numeric static-segment id (a Mailchimp tag
 * IS a static segment — see reference_mailchimp_tag_is_segment_id). Throws with
 * an actionable message on the first unresolved tag rather than silently
 * dropping it. Pure.
 */
export function buildSegmentOpts(
  tagIdMap: Record<string, number>,
  tags: string[],
): SegmentOpts {
  const conditions: SegmentCondition[] = tags.map((tag) => {
    const id = tagIdMap[tag];
    if (typeof id !== "number" || !Number.isFinite(id)) {
      throw new Error(`Tag "${tag}" could not be resolved to a segment id`);
    }
    return {
      condition_type: "StaticSegment",
      field: "static_segment",
      op: "static_is",
      value: id,
    };
  });
  return { match: "any", conditions };
}

/** Resolve the effective tag list for a send: audience.tags[] or [audience.tag]. */
export function resolveAudienceTags(audience: {
  tags?: unknown;
  tag?: unknown;
}): string[] {
  if (Array.isArray(audience.tags)) {
    const list = audience.tags
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim());
    if (list.length > 0) return list;
  }
  if (typeof audience.tag === "string" && audience.tag.trim()) {
    return [audience.tag.trim()];
  }
  return [];
}

// ─── Network seam ────────────────────────────────────────────────────────────

interface MailchimpTagsResponse {
  tags?: Array<{ id?: number; name?: string; member_count?: number }>;
}

const TAG_CACHE_TTL_MS = 5 * 60 * 1000;
const tagCache = new Map<string, { at: number; tags: AudienceTag[] }>();

/**
 * List all tags in a Mailchimp audience with member counts, cached in-memory
 * for 5 minutes per (serverPrefix, listId). The `/lists/{id}/tags` endpoint
 * returns tag id + name + member_count directly.
 */
export async function getAudienceTags(
  serverPrefix: string,
  apiKey: string,
  listId: string,
  opts?: { nowMs?: number },
): Promise<AudienceTag[]> {
  const now = opts?.nowMs ?? Date.now();
  const key = `${serverPrefix}:${listId}`;
  const hit = tagCache.get(key);
  if (hit && now - hit.at < TAG_CACHE_TTL_MS) return hit.tags;

  const res = await mailchimpJson<MailchimpTagsResponse>(
    serverPrefix,
    apiKey,
    `/3.0/lists/${encodeURIComponent(listId)}/tags?count=1000`,
    { method: "GET" },
  );
  const tags: AudienceTag[] = (res.tags ?? [])
    .filter((t) => typeof t.id === "number" && typeof t.name === "string")
    .map((t) => ({
      id: t.id as number,
      name: (t.name as string).trim(),
      member_count: typeof t.member_count === "number" ? t.member_count : 0,
    }));
  tagCache.set(key, { at: now, tags });
  return tags;
}

/** Test-only: clear the tag cache between cases. */
export function __clearTagCacheForTests(): void {
  tagCache.clear();
}
