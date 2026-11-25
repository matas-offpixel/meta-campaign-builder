/**
 * "Create {m} audiences in {account}" (25 Nov ruling on #1363): which of a
 * template's missing audiences the tab can make, as the existing audience
 * builder's draft rows, and the run that makes them.
 *
 * What it makes, and what it never does:
 *  - Retargeting pools on the draft's pixel: Page views (PageView) and
 *    Signups (CompleteRegistration), whole pixel, the item's days, as
 *    lib/audiences/bulk-website-types.ts builds them.
 *  - Artist page engagers: one audience per platform the account lacks
 *    (Facebook, Instagram), the item's days, the page id as the source, as
 *    lib/audiences/bulk-page-types.ts builds them. Both platforms take the
 *    Facebook page id (lib/meta/audience-payload.ts).
 *  - Video viewers only with this show's videos picked on the draft
 *    (lib/audience-templates/videos.ts): the item's threshold and days, the
 *    picked video ids and their page, as the builder's video rows. Without
 *    them the item "Needs videos" and Create leaves it out: never an item
 *    without video ids.
 *  - Never a customer list: genre lists are never re-uploaded (a held list
 *    is shared in Business Manager), and a show's Signups list is the sync's
 *    (SU2, "Create never touches it").
 *  - Never interests: they aren't audiences.
 *
 * Counts are Meta audiences (design, 25 Nov): every target is one, so a
 * page needing both platforms is 2. The footer's "{m} will be created", the
 * button's "{m}" and "Created {m}" are all this count (view.ts
 * templateCounts).
 *
 * The Meta write is the existing path (createMetaCustomAudienceBatch: the
 * OFFPIXEL_META_AUDIENCE_WRITES_ENABLED gate, meta_write_idempotency, reuse of
 * an identical Meta audience), passed in by the server action. Nothing here
 * calls Meta.
 *
 * Pure apart from `runTemplateCreate`, which takes its writes. No `@/`
 * imports, so node --test loads it.
 */

import { funnelStageForCell } from "../audiences/bulk-page-types.ts";
import { funnelStageForWebsiteCell } from "../audiences/bulk-website-types.ts";
import { PAGE_ENGAGER_SUBTYPES, type ResolvedItem, type TemplateItem } from "./resolve.ts";
import { isUsablePick, isVideoViewers, itemThreshold, type TemplateVideoPick } from "./videos.ts";

type PageSubtype = (typeof PAGE_ENGAGER_SUBTYPES)[number];

export type CreateTarget =
  | { kind: "pixel"; item: TemplateItem; pixelEvent: "PageView" | "CompleteRegistration"; retentionDays: number }
  | { kind: "page"; item: TemplateItem; subtype: PageSubtype; pageId: string; retentionDays: number }
  | { kind: "video"; item: TemplateItem; threshold: number; retentionDays: number; pick: TemplateVideoPick };

/** The draft's usable pick for an item, or null (lib/audience-templates/videos.ts pickFor). */
export type PickLookup = (item: TemplateItem) => TemplateVideoPick | null;

const NO_PICKS: PickLookup = () => null;

const POOL_EVENT: Record<string, "PageView" | "CompleteRegistration"> = { page_views: "PageView", signups: "CompleteRegistration" };

/** Meta keeps website audiences 180 days at most (bulk-website-types). */
const MAX_WEBSITE_DAYS = 180;

/** Meta's video audiences accept these shares (the builder's own list). */
const VIDEO_THRESHOLDS = new Set([25, 50, 75, 95, 100]);

/** The audiences Create would make for a resolved template, in item order. */
export function createTargets(items: ResolvedItem[], pixelId: string | null, picks: PickLookup = NO_PICKS): CreateTarget[] {
  return items.flatMap((r): CreateTarget[] => {
    if (r.status !== "create") return [];
    const it = r.item;
    if (isVideoViewers(it)) {
      const pick = picks(it);
      const threshold = itemThreshold(it);
      if (!isUsablePick(pick) || !it.retentionDays || !VIDEO_THRESHOLDS.has(threshold)) return [];
      return [{ kind: "video", item: it, threshold, retentionDays: it.retentionDays, pick }];
    }
    if (it.kind === "retargeting_pool") {
      const pixelEvent = it.listRole ? POOL_EVENT[it.listRole] : undefined;
      if (!pixelEvent || !pixelId || !it.retentionDays) return [];
      return [{ kind: "pixel", item: it, pixelEvent, retentionDays: Math.min(it.retentionDays, MAX_WEBSITE_DAYS) }];
    }
    if (it.kind === "page_engagers") {
      if (!it.pageId || !/^\d+$/.test(it.pageId)) return [];
      const days = it.retentionDays ?? 365;
      return r.missingPageSubtypes
        .filter((s): s is PageSubtype => (PAGE_ENGAGER_SUBTYPES as readonly string[]).includes(s))
        .map((subtype) => ({ kind: "page" as const, item: it, subtype, pageId: it.pageId!, retentionDays: days }));
    }
    return [];
  });
}

/** The items Create would make (each counted once, a page with both platforms too). */
export function createItems(targets: CreateTarget[]): TemplateItem[] {
  return [...new Set(targets.map((t) => t.item))];
}

/** A meta_custom_audiences draft row, the shape lib/db/meta-custom-audiences.ts createAudienceDrafts takes. */
export interface CreateInsert {
  userId: string;
  clientId: string;
  eventId: string | null;
  name: string;
  funnelStage: ReturnType<typeof funnelStageForCell>;
  audienceSubtype: "website_pixel" | "page_engagement_fb" | "page_engagement_ig" | "video_views";
  retentionDays: number;
  sourceId: string;
  sourceMeta: Record<string, unknown>;
  metaAdAccountId: string;
}

/** One row of the plan and the item it makes (several rows can make one item). */
export interface CreatePlanRow {
  item: number;
  row: CreateInsert;
}

const PLATFORM: Record<string, string> = { page_engagement_fb: "FB", page_engagement_ig: "IG" };

/**
 * The draft rows, named "[{template}] …" so the builder's list shows where
 * they came from. Names are row names, not page words: the payload builder
 * sanitises them for Meta. A video row is the show's: it carries the pick's
 * event, so it's never reused for another show.
 */
export function createPlan(
  targets: CreateTarget[],
  opts: { userId: string; clientId: string; accountId: string; pixelId: string | null; template: string },
): CreatePlanRow[] {
  const items = createItems(targets);
  return targets.map((t): CreatePlanRow => {
    const item = items.indexOf(t.item);
    const base = { userId: opts.userId, clientId: opts.clientId, metaAdAccountId: opts.accountId };
    if (t.kind === "pixel") {
      return {
        item,
        row: {
          ...base,
          eventId: null,
          name: `[${opts.template}] ${t.pixelEvent} ${t.retentionDays}d`,
          funnelStage: funnelStageForWebsiteCell(t.retentionDays),
          audienceSubtype: "website_pixel",
          retentionDays: t.retentionDays,
          sourceId: opts.pixelId!,
          sourceMeta: { subtype: "website_pixel", pixelEvent: t.pixelEvent, urlContains: [] },
        },
      };
    }
    if (t.kind === "video") {
      return {
        item,
        row: {
          ...base,
          eventId: t.pick.eventId || null,
          name: `[${opts.template}] ${t.pick.code} video ${t.threshold}% ${t.retentionDays}d`,
          funnelStage: funnelStageForWebsiteCell(t.retentionDays),
          audienceSubtype: "video_views",
          retentionDays: t.retentionDays,
          sourceId: t.pick.videoIds.join(","),
          sourceMeta: {
            subtype: "video_views",
            threshold: t.threshold,
            videoIds: [...t.pick.videoIds],
            contextId: t.pick.contextId,
            ...(t.pick.campaignIds?.length ? { campaignId: t.pick.campaignIds[0], campaignIds: [...t.pick.campaignIds] } : {}),
          },
        },
      };
    }
    const pageName = typeof t.item.detail.name === "string" ? t.item.detail.name : t.pageId;
    return {
      item,
      row: {
        ...base,
        eventId: null,
        name: `[${opts.template}] ${pageName} ${PLATFORM[t.subtype]} engagers ${t.retentionDays}d`,
        funnelStage: funnelStageForCell(t.subtype, t.retentionDays),
        audienceSubtype: t.subtype,
        retentionDays: t.retentionDays,
        sourceId: t.pageId,
        sourceMeta: { subtype: t.subtype, pageName, pageIds: [t.pageId] },
      },
    };
  });
}

export type CreateRunResult =
  | { ok: true; created: number; failed: number }
  | { ok: false; reason: "writes_off" | "unconfirmed" | "nothing_to_create" };

/**
 * Make the rows, then send them through the existing write path. With
 * audience writes off it stops before anything is written, local rows
 * included. Counts are Meta audiences: each row made, or not ("Try again"
 * runs Create again; a made audience reads Reused next time, so it isn't
 * asked for twice).
 */
export async function runTemplateCreate(deps: {
  writesEnabled: boolean;
  confirmed: boolean;
  plan: CreatePlanRow[];
  insertDrafts: (rows: CreateInsert[]) => Promise<Array<{ id: string }>>;
  createBatch: (ids: string[]) => Promise<{ successes: Array<{ audienceId: string }>; failures: unknown[] }>;
}): Promise<CreateRunResult> {
  if (!deps.writesEnabled) return { ok: false, reason: "writes_off" };
  if (!deps.confirmed) return { ok: false, reason: "unconfirmed" };
  if (deps.plan.length === 0) return { ok: false, reason: "nothing_to_create" };
  const drafts = await deps.insertDrafts(deps.plan.map((p) => p.row));
  const ids = drafts.map((d) => d.id);
  const res = ids.length ? await deps.createBatch(ids) : { successes: [], failures: [] };
  const made = new Set(res.successes.map((s) => s.audienceId));
  const created = ids.filter((id) => made.has(id)).length;
  return { ok: true, created, failed: deps.plan.length - created };
}
