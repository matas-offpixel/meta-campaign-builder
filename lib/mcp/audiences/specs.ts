/**
 * lib/mcp/audiences/specs.ts — create_audiences' specs, checked and turned
 * into the Audience Builder's draft rows (pure).
 *
 * Each kind maps onto a subtype the builder already makes
 * (lib/meta/audience-payload.ts), with the source_meta the retargeting
 * builder writes (lib/retargeting/audiences.ts retargetingAudienceDraft):
 *
 *   pixel_visitors   website_pixel, PageView on "URL contains" rules
 *   pixel_event      website_pixel, InitiateCheckout | CompleteRegistration | Purchase on URL rules
 *   page_engagers    page_engagement_fb (page_engaged)
 *   ig_engagers      page_engagement_ig (ig_business_profile_all)
 *   page_followers   page_followers_fb  (page_liked, retention 0 on Meta)
 *   ig_followers     page_followers_ig  (INSTAGRAM_PROFILE_FOLLOW, retention 0 on Meta)
 *   video_viewers    video_views at 75 % or 95 % (video_completed), a Page's videos
 *
 * Names are "{code} · {source} · {n} days" ("all time" for followers). The
 * stored retention for followers is 365 (the table's CHECK); Meta is sent 0.
 * Every source must be one audience_sources lists for the show, and a Page
 * or Instagram account must be accessible: anything else is a refusal, and
 * the tool refuses the whole call before anything is made.
 *
 * Relative imports only (node:test).
 */
import { buildMetaCustomAudiencePayload } from "../../meta/audience-payload.ts";
import { urlRule } from "../../retargeting/links.ts";
import type { AudienceSubtype, MetaCustomAudience, MetaCustomAudienceInsert } from "../../types/audience.ts";
import { AUDIENCE_FOR_DESIGN, AUD_WORDS } from "./words.ts";

export const SPEC_KINDS = ["pixel_visitors", "pixel_event", "page_engagers", "ig_engagers", "page_followers", "ig_followers", "video_viewers"] as const;
export type SpecKind = (typeof SPEC_KINDS)[number];

export const MAX_SPECS = 30;
/** meta_custom_audiences' CHECK (1–365) and the builder's own windows. */
export const MAX_RETENTION: Record<SpecKind, number> = {
  pixel_visitors: 180,
  pixel_event: 180,
  page_engagers: 365,
  ig_engagers: 365,
  page_followers: 365,
  ig_followers: 365,
  video_viewers: 365,
};
const FOLLOWER_STORED_RETENTION = 365;
export const PIXEL_EVENTS = ["InitiateCheckout", "CompleteRegistration", "Purchase"] as const;

/** The source labels in the names (PENDING DESIGN, with the words). */
export const SOURCE_LABELS = {
  visitors: "Visitors",
  InitiateCheckout: "Checkout starters",
  CompleteRegistration: "Registrations",
  Purchase: "Buyers",
  pageEngagers: "Page engagers",
  igEngagers: "engagers",
  pageFollowers: "Page followers",
  igFollowers: "followers",
  video: "video",
  allTime: "all time",
} as const;
AUDIENCE_FOR_DESIGN.push({
  key: "claude.mcp.aud.name",
  where: "create_audiences, each audience's name in Off/Pixel (Meta strips it to letters, digits and _)",
  candidate:
    "{code} · Visitors {rules} · {n} days | {code} · Checkout starters / Registrations / Buyers {rules} · {n} days | {code} · {Page} Page engagers · {n} days | {code} · @{ig} engagers · {n} days | {code} · {Page} Page followers · all time | {code} · @{ig} followers · all time | {code} · {Page} video 75 % / 95 % · {n} days",
});

export interface SpecInput {
  kind?: unknown;
  retention_days?: unknown;
  url_contains?: unknown;
  event?: unknown;
  page_id?: unknown;
  ig_id?: unknown;
  threshold?: unknown;
  video_ids?: unknown;
}

/** What audience_sources found for the show, as the specs need it. */
export interface SpecContext {
  code: string;
  eventId: string;
  clientId: string;
  userId: string;
  adAccountId: string;
  pixelId: string | null;
  /** Facebook Pages the show can build from: id → name and access. */
  pages: ReadonlyMap<string, { name: string; accessible: boolean }>;
  /** Instagram accounts: id → username and access. */
  igs: ReadonlyMap<string, { username: string; accessible: boolean }>;
  /** The show's ad videos by the Page each ran from. */
  videosByPage: ReadonlyMap<string, readonly string[]>;
}

export type SpecResult = { ok: true; insert: MetaCustomAudienceInsert } | { ok: false; why: string };

const META_ID = /^\d{5,32}$/;
const idOf = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

function retentionOf(kind: SpecKind, v: unknown): number | string {
  if (kind === "page_followers" || kind === "ig_followers") return FOLLOWER_STORED_RETENTION;
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > MAX_RETENTION[kind]) return AUD_WORDS.whyRetention(MAX_RETENTION[kind]);
  return n;
}

/**
 * A link's "URL contains" rule, the retargeting builder's (RT13 urlRule: the
 * host to the end of the path, exactly as given), so the same link gives the
 * same rule and the audience is reused. A bare "ra.co/events/1" is read as https.
 */
export function urlFragment(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const rule = urlRule(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);
  return rule && rule.split("/")[0]!.includes(".") ? rule : null;
}

function urlsOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const item of list.slice(0, 20)) {
    const f = typeof item === "string" ? urlFragment(item) : null;
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

const days = (n: number) => `${n} days`;
export const audienceName = (code: string, source: string, window: string) => `${code} · ${source} · ${window}`;

export function buildSpec(input: SpecInput, ctx: SpecContext): SpecResult {
  const kind = typeof input.kind === "string" && (SPEC_KINDS as readonly string[]).includes(input.kind) ? (input.kind as SpecKind) : null;
  if (!kind) return { ok: false, why: AUD_WORDS.whyKind(SPEC_KINDS) };
  const retention = retentionOf(kind, input.retention_days);
  if (typeof retention === "string") return { ok: false, why: retention };
  const base = { userId: ctx.userId, clientId: ctx.clientId, eventId: ctx.eventId, funnelStage: "retargeting" as const, metaAdAccountId: ctx.adAccountId, retentionDays: retention };
  const row = (subtype: AudienceSubtype, name: string, sourceId: string, sourceMeta: Record<string, unknown>): SpecResult => ({
    ok: true,
    insert: { ...base, audienceSubtype: subtype, name, sourceId, sourceMeta: sourceMeta as MetaCustomAudienceInsert["sourceMeta"] },
  });

  if (kind === "pixel_visitors" || kind === "pixel_event") {
    if (!ctx.pixelId) return { ok: false, why: AUD_WORDS.whyNoPixel };
    const urls = urlsOf(input.url_contains);
    if (urls.length === 0) return { ok: false, why: AUD_WORDS.whyUrl };
    let event = "PageView";
    let label: string = SOURCE_LABELS.visitors;
    if (kind === "pixel_event") {
      if (typeof input.event !== "string" || !(PIXEL_EVENTS as readonly string[]).includes(input.event)) return { ok: false, why: AUD_WORDS.whyEvent };
      event = input.event;
      label = SOURCE_LABELS[input.event as (typeof PIXEL_EVENTS)[number]];
    }
    return row("website_pixel", audienceName(ctx.code, `${label} ${urls.join(" + ")}`, days(retention)), ctx.pixelId, { subtype: "website_pixel", pixelEvent: event, urlContains: urls });
  }

  if (kind === "page_engagers" || kind === "page_followers" || kind === "video_viewers") {
    const id = idOf(input.page_id);
    const page = META_ID.test(id) ? ctx.pages.get(id) : undefined;
    if (!page) {
      if (kind === "video_viewers" && ctx.igs.has(idOf(input.ig_id) || id)) return { ok: false, why: AUD_WORDS.whyVideoIg };
      return { ok: false, why: AUD_WORDS.whySource(id || "?", ctx.code) };
    }
    if (!page.accessible) return { ok: false, why: AUD_WORDS.whyAccess(page.name) };
    if (kind === "page_engagers") return row("page_engagement_fb", audienceName(ctx.code, `${page.name} ${SOURCE_LABELS.pageEngagers}`, days(retention)), id, { subtype: "page_engagement_fb", pageIds: [id], pageName: page.name });
    if (kind === "page_followers") return row("page_followers_fb", audienceName(ctx.code, `${page.name} ${SOURCE_LABELS.pageFollowers}`, SOURCE_LABELS.allTime), id, { subtype: "page_followers_fb", pageIds: [id], pageName: page.name });
    const threshold = Number(input.threshold);
    if (threshold !== 75 && threshold !== 95) return { ok: false, why: AUD_WORDS.whyThreshold };
    const given = Array.isArray(input.video_ids) ? [...new Set(input.video_ids.map(idOf).filter((v) => META_ID.test(v)))].slice(0, 1000) : [];
    const videoIds = given.length ? given : [...(ctx.videosByPage.get(id) ?? [])];
    if (videoIds.length === 0) return { ok: false, why: AUD_WORDS.whyNoVideos(ctx.code, page.name) };
    return row("video_views", audienceName(ctx.code, `${page.name} ${SOURCE_LABELS.video} ${threshold} %`, days(retention)), videoIds.join(","), { subtype: "video_views", threshold, videoIds, contextId: id });
  }

  // ig_engagers / ig_followers
  const id = idOf(input.ig_id);
  const ig = META_ID.test(id) ? ctx.igs.get(id) : undefined;
  if (!ig) return { ok: false, why: AUD_WORDS.whySource(id || "?", ctx.code) };
  if (!ig.accessible) return { ok: false, why: AUD_WORDS.whyAccess(`@${ig.username}`) };
  if (kind === "ig_engagers") return row("page_engagement_ig", audienceName(ctx.code, `@${ig.username} ${SOURCE_LABELS.igEngagers}`, days(retention)), id, { subtype: "page_engagement_ig", pageIds: [id], pageName: `@${ig.username}` });
  return row("page_followers_ig", audienceName(ctx.code, `@${ig.username} ${SOURCE_LABELS.igFollowers}`, SOURCE_LABELS.allTime), id, { subtype: "page_followers_ig", pageIds: [id], pageName: `@${ig.username}` });
}

/**
 * The rule the builder would post for this row (buildMetaCustomAudiencePayload),
 * with the retention for video (the only subtype that sends it outside the
 * rule). Two rows with the same key are the same audience on Meta.
 */
export function ruleKey(insert: Pick<MetaCustomAudience, "audienceSubtype" | "retentionDays" | "sourceId" | "sourceMeta" | "name">): string | null {
  try {
    const p = buildMetaCustomAudiencePayload({ ...insert, id: "", userId: "", clientId: "", eventId: null, funnelStage: "retargeting", metaAudienceId: null, metaAdAccountId: "", status: "draft", statusError: null, createdAt: "", updatedAt: "" } as MetaCustomAudience);
    return JSON.stringify([p.rule ?? null, p.retention_days ?? null, p.subtype ?? null]);
  } catch {
    return null;
  }
}
