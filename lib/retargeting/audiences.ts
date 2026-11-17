/**
 * RT2 / HR1: the tiers' audiences, from one source set per show
 * (docs/design-record/2026-11-17-retargeting-campaign.html).
 *
 * | Tier       | Includes                                                         | Leaves out                     |
 * |------------|------------------------------------------------------------------|--------------------------------|
 * | Bottom     | ticket-link visitors and checkout starters, 30 days · signup     | buyers                         |
 * |            | lists                                                            |                                |
 * | Mid Bottom | page visitors and checkout starters, 60 days · similar lists     | every Bottom include · buyers  |
 * |            | (Matas, 17 Nov)                                                  |                                |
 * | Mid        | video viewers 75 %, 365 days (every video of the show's ads) ·   | every Mid Bottom and Bottom    |
 * |            | FB page and IG account engagers, 180 days (promoter, event or    | include · buyers               |
 * |            | venue, each lineup act; pages with a role only)                  |                                |
 *
 * Every audience is built from the same source set, so the windows can't
 * drift apart (audit §3.3, point 4). A page-engagement audience takes at
 * most 5 sources and a video audience 200 videos (the builder's limits),
 * so the sets are chunked here and each chunk is one audience. Exclusions
 * are the hotter tiers' include ids plus buyers (excluded_custom_audiences).
 *
 * Signup lists go in Bottom only; Similar lists go in Mid Bottom (Matas, 17 Nov), so Mid leaves them out with the rest of Mid Bottom.
 * Pure: no database, no Meta.
 */

import type { Tier } from "./words.ts";

export const RT2 = {
  bottomDays: 30,
  midBottomDays: 60,
  engagementDays: 180,
  videoDays: 365,
  videoThreshold: 75,
  /** MAX_PAGE_ENGAGEMENT_SOURCES (lib/meta/audience-payload.ts). */
  pagesPerAudience: 5,
  /** MAX_VIDEO_VIEWS_VIDEOS. */
  videosPerAudience: 200,
} as const;

export type ListRole = "signups" | "similar" | "buyers";

export const LIST_ROLE_LABEL: Record<ListRole, string> = { signups: "Signups", similar: "Similar", buyers: "Buyers" };

export type SourcePage = {
  id: string;
  name: string;
  /** The page's Instagram business account, when Meta returned one. */
  igId: string | null;
  kind: "promoter" | "event" | "venue" | "lineup";
  /** The operator's Facebook user holds a role on the page (at least ADVERTISE); null when it wasn't read. */
  hasRole: boolean | null;
};

export type SourceList = { metaAudienceId: string; name: string; role: ListRole; uploadedAt: string };

export type SourceSet = {
  pixelId: string | null;
  /** URL fragments for the pixel's `i_contains` rule (host and path). */
  ticketUrl: string | null;
  pageUrl: string | null;
  /** Every video of the show's ads, grouped by the page it ran from. */
  videos: { contextId: string; videoIds: string[] }[];
  pages: SourcePage[];
  lists: SourceList[];
};

/** One audience the builder makes (or a list that already exists). `key` is stable per show, so a retry reuses it. */
export type TierAudience =
  | { key: string; kind: "pixel_url"; pixelId: string; urlContains: string[]; retentionDays: number }
  | { key: string; kind: "pixel_event"; pixelId: string; pixelEvent: "InitiateCheckout"; retentionDays: number }
  | { key: string; kind: "video"; contextId: string; videoIds: string[]; threshold: 75; retentionDays: number }
  | { key: string; kind: "page_fb"; pageIds: string[]; retentionDays: number }
  /** The builder's IG engagement rule takes the FB Page ids of pages with an Instagram account (audience-payload.ts). */
  | { key: string; kind: "page_ig"; pageIds: string[]; retentionDays: number }
  | { key: string; kind: "list"; metaAudienceId: string; role: ListRole };

export type TierSpec = { tier: Tier; includes: TierAudience[]; excludes: TierAudience[] };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The pages Mid can use: a role held (or not read: Apply checks again). Deduped by id. */
export function usablePages(pages: readonly SourcePage[]): SourcePage[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (page.hasRole === false || seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

/** Lineup pages Meta would refuse (no role), named once each. */
export function pagesWithoutRole(pages: readonly SourcePage[]): SourcePage[] {
  const seen = new Set<string>();
  return pages.filter((page) => {
    if (page.hasRole !== false || seen.has(page.id)) return false;
    seen.add(page.id);
    return true;
  });
}

/** Mid can be built: a page with a role, or video views (RT8). */
export function midBuildable(set: Pick<SourceSet, "pages" | "videos">): boolean {
  return usablePages(set.pages).length > 0 || set.videos.some((group) => group.videoIds.length > 0);
}

/** The three tiers' includes and excludes, from one source set. A tier with no include is left out (Mid, when it can't be built). */
export function tierSpecs(set: SourceSet): TierSpec[] {
  const bottom: TierAudience[] = [];
  const midBottom: TierAudience[] = [];
  const mid: TierAudience[] = [];
  if (set.pixelId) {
    if (set.ticketUrl) bottom.push({ key: `bottom:ticket:${RT2.bottomDays}`, kind: "pixel_url", pixelId: set.pixelId, urlContains: [set.ticketUrl], retentionDays: RT2.bottomDays });
    bottom.push({ key: `bottom:checkout:${RT2.bottomDays}`, kind: "pixel_event", pixelId: set.pixelId, pixelEvent: "InitiateCheckout", retentionDays: RT2.bottomDays });
    if (set.pageUrl) midBottom.push({ key: `mid_bottom:page:${RT2.midBottomDays}`, kind: "pixel_url", pixelId: set.pixelId, urlContains: [set.pageUrl], retentionDays: RT2.midBottomDays });
    midBottom.push({ key: `mid_bottom:checkout:${RT2.midBottomDays}`, kind: "pixel_event", pixelId: set.pixelId, pixelEvent: "InitiateCheckout", retentionDays: RT2.midBottomDays });
  }
  // Lists: Signups in Bottom, Similar in Mid Bottom (Matas, 17 Nov); each colder tier leaves them out with the rest of the hotter tier. Buyers are left out everywhere.
  for (const list of set.lists) {
    if (list.role === "signups") bottom.push({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: list.role });
    if (list.role === "similar") midBottom.push({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: list.role });
  }
  const buyers: TierAudience[] = set.lists.filter((list) => list.role === "buyers").map((list) => ({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: "buyers" }));
  for (const group of set.videos) {
    chunk(group.videoIds, RT2.videosPerAudience).forEach((ids, part) => mid.push({ key: `mid:video:${group.contextId}:${part + 1}`, kind: "video", contextId: group.contextId, videoIds: ids, threshold: RT2.videoThreshold, retentionDays: RT2.videoDays }));
  }
  const pages = usablePages(set.pages);
  chunk(pages.map((page) => page.id), RT2.pagesPerAudience).forEach((ids, part) => mid.push({ key: `mid:fb:${part + 1}`, kind: "page_fb", pageIds: ids, retentionDays: RT2.engagementDays }));
  const igPages = pages.filter((page) => page.igId).map((page) => page.id);
  chunk(igPages, RT2.pagesPerAudience).forEach((ids, part) => mid.push({ key: `mid:ig:${part + 1}`, kind: "page_ig", pageIds: ids, retentionDays: RT2.engagementDays }));
  const specs: TierSpec[] = [];
  if (bottom.length) specs.push({ tier: "bottom", includes: bottom, excludes: [...buyers] });
  if (midBottom.length) specs.push({ tier: "mid_bottom", includes: midBottom, excludes: [...bottom, ...buyers] });
  if (mid.length) specs.push({ tier: "mid", includes: mid, excludes: [...midBottom, ...bottom, ...buyers] });
  return specs;
}

/**
 * The tier a person lands in, from the audiences they're in (keys): a tier
 * matches when the person is in one of its includes and none of its
 * excludes. The Acceptance test asserts at most one tier ever matches.
 */
export function tiersMatching(specs: readonly TierSpec[], memberOf: ReadonlySet<string>): Tier[] {
  return specs.filter((spec) => spec.includes.some((aud) => memberOf.has(aud.key)) && !spec.excludes.some((aud) => memberOf.has(aud.key))).map((spec) => spec.tier);
}

/** URL fragment for the pixel rule: host and path, no scheme, query or trailing slash. */
export function urlFragment(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

/** The builder's name for a tier audience (Meta side, never on the panel). */
export function tierAudienceName(code: string, aud: Exclude<TierAudience, { kind: "list" }>): string {
  const prefix = `[${code}] Retargeting`;
  if (aud.kind === "pixel_url") return `${prefix} · ${aud.key.startsWith("bottom") ? "ticket link" : "page"} ${aud.retentionDays}d`;
  if (aud.kind === "pixel_event") return `${prefix} · checkout ${aud.retentionDays}d`;
  if (aud.kind === "video") return `${prefix} · 75% video ${aud.retentionDays}d · ${aud.key.split(":").at(-1)}`;
  if (aud.kind === "page_fb") return `${prefix} · FB engagers ${aud.retentionDays}d · ${aud.key.split(":").at(-1)}`;
  return `${prefix} · IG engagers ${aud.retentionDays}d · ${aud.key.split(":").at(-1)}`;
}

/**
 * The audience builder's draft fields for a tier audience (the subtypes it
 * already makes: website_pixel, video_views, page_engagement_fb / _ig).
 * Pixel visits are PageView with a URL rule; checkout starters are the
 * pixel's InitiateCheckout with none.
 */
export function retargetingAudienceDraft(aud: Exclude<TierAudience, { kind: "list" }>): { subtype: "website_pixel" | "video_views" | "page_engagement_fb" | "page_engagement_ig"; retentionDays: number; sourceId: string; sourceMeta: Record<string, unknown> } {
  if (aud.kind === "pixel_url") return { subtype: "website_pixel", retentionDays: aud.retentionDays, sourceId: aud.pixelId, sourceMeta: { subtype: "website_pixel", pixelEvent: "PageView", urlContains: aud.urlContains } };
  if (aud.kind === "pixel_event") return { subtype: "website_pixel", retentionDays: aud.retentionDays, sourceId: aud.pixelId, sourceMeta: { subtype: "website_pixel", pixelEvent: aud.pixelEvent, urlContains: [] } };
  if (aud.kind === "video") return { subtype: "video_views", retentionDays: aud.retentionDays, sourceId: aud.videoIds.join(","), sourceMeta: { subtype: "video_views", threshold: aud.threshold, videoIds: aud.videoIds, contextId: aud.contextId } };
  if (aud.kind === "page_fb") return { subtype: "page_engagement_fb", retentionDays: aud.retentionDays, sourceId: aud.pageIds.join(","), sourceMeta: { subtype: "page_engagement_fb", pageIds: aud.pageIds } };
  return { subtype: "page_engagement_ig", retentionDays: aud.retentionDays, sourceId: aud.pageIds.join(","), sourceMeta: { subtype: "page_engagement_ig", pageIds: aud.pageIds } };
}

/** RT2 (#1299 6ec5353): videos grouped by the page each one ran from, one audience per page; a video with no page is left out. */
export function groupVideosByPage(videos: readonly { id: string; pageId?: string | null }[]): { contextId: string; videoIds: string[] }[] {
  const byPage = new Map<string, string[]>();
  for (const video of videos) {
    if (!video.pageId) continue;
    const list = byPage.get(video.pageId) ?? [];
    if (!list.includes(video.id)) list.push(video.id);
    byPage.set(video.pageId, list);
  }
  return [...byPage].sort((a, b) => a[0].localeCompare(b[0])).map(([contextId, videoIds]) => ({ contextId, videoIds }));
}
