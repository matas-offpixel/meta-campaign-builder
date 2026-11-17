/**
 * RT2 / HR1 / RT13–RT15: the tiers' audiences, from one source set per show
 * (docs/design-record/2026-11-17-retargeting-campaign.html and -2.html).
 *
 * | Tier       | Includes (RT14's windows, each window its own audience)          | Leaves out                     |
 * |------------|------------------------------------------------------------------|--------------------------------|
 * | Bottom     | ticket-link visitors and checkout starters · 7, 14, 30 days ·    | buyers                         |
 * |            | registrations · 30, 90, 180 days · signup lists                  |                                |
 * | Mid Bottom | page visitors · 14, 30, 60 days · checkout starters · 60 days ·  | every Bottom include · buyers  |
 * |            | similar lists                                                    |                                |
 * | Mid        | video viewers 75 % · 90, 180, 365 days, one set per page ·       | every Mid Bottom and Bottom    |
 * |            | FB page and IG account engagers · 30, 90, 180 days               | include · buyers               |
 *
 * RT13: ticket links feed ticket-link visitors and checkout starters (the
 * pixel's InitiateCheckout on the ticket links' rules, never pixel-wide);
 * landing pages feed page visitors and registrations (CompleteRegistration
 * on their rules, RT15). Every link is one "URL contains" rule.
 *
 * The longest window of each source is RT2's, so who is in each tier
 * doesn't change (registrations aside); the shorter windows add no one and
 * show in Ads Manager how recent each tier's people are. Leave-outs take
 * every window of the hotter tiers.
 *
 * RT13 (revised 17 Nov): at its source's longest window each link is its own
 * audience — a ticket link's visitors at 30 days, a landing page's at 60 —
 * in place of one combined audience there, so Meta can size each link. The
 * shorter windows stay one audience across the links.
 *
 * A page-engagement audience takes at most 5 sources and a video audience
 * 200 videos (the builder's limits), so the sets are chunked here.
 *
 * Pure: no database, no Meta.
 */

import { landingLinks, ticketLinks, type ShowLink } from "./links.ts";

/** A short stable key for a link's rule (FNV-1a, 32 bits), so a per-link audience's key survives a reorder. */
export function linkKey(rule: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rule.length; i += 1) {
    hash ^= rule.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
import type { Tier } from "./words.ts";

/** RT14's windows, in days. The longest of each source is RT2's. */
export const RT14 = {
  ticketVisitors: [7, 14, 30],
  checkout: [7, 14, 30],
  registrations: [30, 90, 180],
  pageVisitors: [14, 30, 60],
  /** Mid Bottom's checkout starters: 60 days (its first 30 are Bottom's). */
  checkoutMidBottom: [60],
  video: [90, 180, 365],
  engagement: [30, 90, 180],
} as const;

export const RT2 = {
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
  /** RT13: the show's links, each one URL rule (CIRQLIN's pages, else RT2's two links). */
  links: ShowLink[];
  /** Every video of the show's ads, grouped by the page it ran from. */
  videos: { contextId: string; videoIds: string[] }[];
  pages: SourcePage[];
  lists: SourceList[];
};

/**
 * One audience the builder makes (or a list that already exists). `key` is
 * stable per show, so a retry reuses it; `label` is RT14's source name for
 * Ads Manager ("{code} · {label} · {n} days").
 */
export type TierAudience =
  /** `link`: a per-link audience (RT13, revised) names its link, for the size line. */
  | { key: string; kind: "pixel_url"; label: string; pixelId: string; urlContains: string[]; retentionDays: number; link?: string }
  | { key: string; kind: "pixel_event"; label: string; pixelId: string; pixelEvent: "InitiateCheckout" | "CompleteRegistration"; urlContains: string[]; retentionDays: number }
  | { key: string; kind: "video"; label: string; contextId: string; videoIds: string[]; threshold: 75; retentionDays: number }
  | { key: string; kind: "page_fb"; label: string; pageIds: string[]; retentionDays: number }
  /** The builder's IG engagement rule takes the FB Page ids of pages with an Instagram account (audience-payload.ts). */
  | { key: string; kind: "page_ig"; label: string; pageIds: string[]; retentionDays: number }
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

/**
 * The three tiers' includes and excludes, from one source set. A tier with
 * no include is left out (Mid when it can't be built; Bottom when RT13
 * finds it empty: `opts.bottom` false).
 */
export function tierSpecs(set: SourceSet, opts: { bottom?: boolean } = {}): TierSpec[] {
  const bottom: TierAudience[] = [];
  const midBottom: TierAudience[] = [];
  const mid: TierAudience[] = [];
  const ticketSet = ticketLinks(set.links);
  const landingSet = landingLinks(set.links);
  const tickets = ticketSet.map((link) => link.rule);
  const landing = landingSet.map((link) => link.rule);
  const longest = (days: readonly number[]) => days[days.length - 1]!;
  if (set.pixelId) {
    const pixelId = set.pixelId;
    if (tickets.length) {
      for (const days of RT14.ticketVisitors) {
        if (days !== longest(RT14.ticketVisitors)) bottom.push({ key: `bottom:ticket:${days}`, kind: "pixel_url", label: "Ticket-link visitors", pixelId, urlContains: tickets, retentionDays: days });
        // RT13 (revised): each ticket link its own audience at 30 days.
        else for (const link of ticketSet) bottom.push({ key: `bottom:ticket:${days}:${linkKey(link.rule)}`, kind: "pixel_url", label: `Ticket-link visitors · ${link.name}`, pixelId, urlContains: [link.rule], retentionDays: days, link: link.name });
      }
      for (const days of RT14.checkout) bottom.push({ key: `bottom:checkout:${days}`, kind: "pixel_event", label: "Checkout starters", pixelId, pixelEvent: "InitiateCheckout", urlContains: tickets, retentionDays: days });
    }
    if (landing.length) {
      for (const days of RT14.registrations) bottom.push({ key: `bottom:registrations:${days}`, kind: "pixel_event", label: "Registrations", pixelId, pixelEvent: "CompleteRegistration", urlContains: landing, retentionDays: days });
      for (const days of RT14.pageVisitors) {
        if (days !== longest(RT14.pageVisitors)) midBottom.push({ key: `mid_bottom:page:${days}`, kind: "pixel_url", label: "Page visitors", pixelId, urlContains: landing, retentionDays: days });
        // RT13 (revised): each landing page its own audience at 60 days.
        else for (const link of landingSet) midBottom.push({ key: `mid_bottom:page:${days}:${linkKey(link.rule)}`, kind: "pixel_url", label: `Page visitors · ${link.name}`, pixelId, urlContains: [link.rule], retentionDays: days, link: link.name });
      }
    }
    if (tickets.length) {
      for (const days of RT14.checkoutMidBottom) midBottom.push({ key: `mid_bottom:checkout:${days}`, kind: "pixel_event", label: "Checkout starters", pixelId, pixelEvent: "InitiateCheckout", urlContains: tickets, retentionDays: days });
    }
  }
  // Lists: Signups in Bottom, Similar in Mid Bottom (Matas, 17 Nov); each colder tier leaves them out with the rest of the hotter tier. Buyers are left out everywhere.
  for (const list of set.lists) {
    if (list.role === "signups") bottom.push({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: list.role });
    if (list.role === "similar") midBottom.push({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: list.role });
  }
  const buyers: TierAudience[] = set.lists.filter((list) => list.role === "buyers").map((list) => ({ key: `list:${list.metaAudienceId}`, kind: "list", metaAudienceId: list.metaAudienceId, role: "buyers" }));
  const pageName = (id: string) => set.pages.find((page) => page.id === id)?.name ?? id;
  for (const group of set.videos) {
    const parts = chunk(group.videoIds, RT2.videosPerAudience);
    parts.forEach((ids, part) => {
      for (const days of RT14.video) mid.push({ key: `mid:video:${group.contextId}:${part + 1}:${days}`, kind: "video", label: `Video viewers 75 % · ${pageName(group.contextId)}${parts.length > 1 ? ` · ${part + 1}` : ""}`, contextId: group.contextId, videoIds: ids, threshold: RT2.videoThreshold, retentionDays: days });
    });
  }
  const pages = usablePages(set.pages);
  const fbParts = chunk(pages.map((page) => page.id), RT2.pagesPerAudience);
  fbParts.forEach((ids, part) => {
    for (const days of RT14.engagement) mid.push({ key: `mid:fb:${part + 1}:${days}`, kind: "page_fb", label: `Page engagers${fbParts.length > 1 ? ` · ${part + 1}` : ""}`, pageIds: ids, retentionDays: days });
  });
  const igParts = chunk(pages.filter((page) => page.igId).map((page) => page.id), RT2.pagesPerAudience);
  igParts.forEach((ids, part) => {
    for (const days of RT14.engagement) mid.push({ key: `mid:ig:${part + 1}:${days}`, kind: "page_ig", label: `Instagram engagers${igParts.length > 1 ? ` · ${part + 1}` : ""}`, pageIds: ids, retentionDays: days });
  });
  const hot = opts.bottom === false ? [] : bottom;
  const specs: TierSpec[] = [];
  if (hot.length) specs.push({ tier: "bottom", includes: hot, excludes: [...buyers] });
  if (midBottom.length) specs.push({ tier: "mid_bottom", includes: midBottom, excludes: [...hot, ...buyers] });
  if (mid.length) specs.push({ tier: "mid", includes: mid, excludes: [...midBottom, ...hot, ...buyers] });
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

/** RT14's Ads Manager name: "{code} · {source} · {n} days" (a per-page video set adds the page). */
export function tierAudienceName(code: string, aud: Exclude<TierAudience, { kind: "list" }>): string {
  return `${code} · ${aud.label} · ${aud.retentionDays} days`;
}

/**
 * The audience builder's draft fields for a tier audience (the subtypes it
 * already makes: website_pixel, video_views, page_engagement_fb / _ig).
 * Visitors are PageView on the links' rules; checkout starters and
 * registrations are their event on those rules (RT13: never pixel-wide).
 */
export function retargetingAudienceDraft(aud: Exclude<TierAudience, { kind: "list" }>): { subtype: "website_pixel" | "video_views" | "page_engagement_fb" | "page_engagement_ig"; retentionDays: number; sourceId: string; sourceMeta: Record<string, unknown> } {
  if (aud.kind === "pixel_url") return { subtype: "website_pixel", retentionDays: aud.retentionDays, sourceId: aud.pixelId, sourceMeta: { subtype: "website_pixel", pixelEvent: "PageView", urlContains: aud.urlContains } };
  if (aud.kind === "pixel_event") return { subtype: "website_pixel", retentionDays: aud.retentionDays, sourceId: aud.pixelId, sourceMeta: { subtype: "website_pixel", pixelEvent: aud.pixelEvent, urlContains: aud.urlContains } };
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

/** RT13: each pixel audience's URL rules, by key (what Apply wrote and the daily read compares). */
export function pixelRules(specs: readonly TierSpec[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const spec of specs) for (const aud of [...spec.includes, ...spec.excludes]) {
    if (aud.kind === "pixel_url" || aud.kind === "pixel_event") out[aud.key] = [...aud.urlContains];
  }
  return out;
}

/**
 * RT13: the stored audiences whose rules differ from today's links, compared
 * exactly (order aside). A stored key with no rules today counts as changed;
 * a key with nothing stored has nothing to rewrite.
 */
export function ruleChanges(stored: Record<string, string[]>, current: Record<string, string[]>): string[] {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
  return Object.keys(stored).filter((key) => !current[key] || !same(stored[key]!, current[key]!)).sort();
}

/** RT13 (revised): the per-link audiences of a tier, in the links' order — the size line's entries. */
export function perLinkAudiences(spec: TierSpec | undefined): { key: string; name: string }[] {
  return (spec?.includes ?? []).flatMap((aud) => (aud.kind === "pixel_url" && aud.link ? [{ key: aud.key, name: aud.link }] : []));
}
