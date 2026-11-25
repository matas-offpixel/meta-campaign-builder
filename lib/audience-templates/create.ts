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
 *  - Never a customer list: genre lists are never re-uploaded (a held list
 *    is shared in Business Manager), and a show's Signups list is the sync's
 *    (SU2, "Create never touches it").
 *  - Never video viewers: Meta needs the videos, and a template holds only
 *    the share watched and the days.
 *  - Never interests: they aren't audiences.
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

export type CreateTarget =
  | { kind: "pixel"; item: TemplateItem; pixelEvent: "PageView" | "CompleteRegistration"; retentionDays: number }
  | { kind: "page"; item: TemplateItem; subtype: (typeof PAGE_ENGAGER_SUBTYPES)[number]; pageId: string; retentionDays: number };

const POOL_EVENT: Record<string, "PageView" | "CompleteRegistration"> = { page_views: "PageView", signups: "CompleteRegistration" };

/** Meta keeps website audiences 180 days at most (bulk-website-types). */
const MAX_WEBSITE_DAYS = 180;

/** The audiences Create would make for a resolved template, in item order. */
export function createTargets(items: ResolvedItem[], pixelId: string | null): CreateTarget[] {
  return items.flatMap((r): CreateTarget[] => {
    if (r.status !== "create") return [];
    const it = r.item;
    if (it.kind === "retargeting_pool") {
      const pixelEvent = it.listRole ? POOL_EVENT[it.listRole] : undefined;
      if (!pixelEvent || !pixelId || !it.retentionDays) return [];
      return [{ kind: "pixel", item: it, pixelEvent, retentionDays: Math.min(it.retentionDays, MAX_WEBSITE_DAYS) }];
    }
    if (it.kind === "page_engagers") {
      if (!it.pageId || !/^\d+$/.test(it.pageId)) return [];
      const days = it.retentionDays ?? 365;
      return r.missingPageSubtypes
        .filter((s): s is (typeof PAGE_ENGAGER_SUBTYPES)[number] => (PAGE_ENGAGER_SUBTYPES as readonly string[]).includes(s))
        .map((subtype) => ({ kind: "page" as const, item: it, subtype, pageId: it.pageId!, retentionDays: days }));
    }
    return [];
  });
}

/** A meta_custom_audiences draft row, the shape lib/db/meta-custom-audiences.ts createAudienceDrafts takes. */
export interface CreateInsert {
  userId: string;
  clientId: string;
  eventId: null;
  name: string;
  funnelStage: ReturnType<typeof funnelStageForCell>;
  audienceSubtype: "website_pixel" | "page_engagement_fb" | "page_engagement_ig";
  retentionDays: number;
  sourceId: string;
  sourceMeta: Record<string, unknown>;
  metaAdAccountId: string;
}

const PLATFORM: Record<string, string> = { page_engagement_fb: "FB", page_engagement_ig: "IG" };

/**
 * The draft rows, named "[{template}] …" so the builder's list shows where
 * they came from. Names are row names, not page words: the payload builder
 * sanitises them for Meta.
 */
export function createInserts(
  targets: CreateTarget[],
  opts: { userId: string; clientId: string; accountId: string; pixelId: string | null; template: string },
): CreateInsert[] {
  return targets.map((t): CreateInsert => {
    if (t.kind === "pixel") {
      return {
        userId: opts.userId,
        clientId: opts.clientId,
        eventId: null,
        name: `[${opts.template}] ${t.pixelEvent} ${t.retentionDays}d`,
        funnelStage: funnelStageForWebsiteCell(t.retentionDays),
        audienceSubtype: "website_pixel",
        retentionDays: t.retentionDays,
        sourceId: opts.pixelId!,
        sourceMeta: { subtype: "website_pixel", pixelEvent: t.pixelEvent, urlContains: [] },
        metaAdAccountId: opts.accountId,
      };
    }
    const pageName = typeof t.item.detail.name === "string" ? t.item.detail.name : t.pageId;
    return {
      userId: opts.userId,
      clientId: opts.clientId,
      eventId: null,
      name: `[${opts.template}] ${pageName} ${PLATFORM[t.subtype]} engagers ${t.retentionDays}d`,
      funnelStage: funnelStageForCell(t.subtype, t.retentionDays),
      audienceSubtype: t.subtype,
      retentionDays: t.retentionDays,
      sourceId: t.pageId,
      sourceMeta: { subtype: t.subtype, pageName, pageIds: [t.pageId] },
      metaAdAccountId: opts.accountId,
    };
  });
}

export type CreateRunResult =
  | { ok: true; created: number; failed: number }
  | { ok: false; reason: "writes_off" | "unconfirmed" | "nothing_to_create" };

/**
 * Make the rows, then send them through the existing write path. With
 * audience writes off it stops before anything is written, local rows
 * included. Every row the batch couldn't make counts as failed ("Try again"
 * runs Create again; a made audience reads Reused next time, so it isn't
 * asked for twice).
 */
export async function runTemplateCreate(deps: {
  writesEnabled: boolean;
  confirmed: boolean;
  inserts: CreateInsert[];
  insertDrafts: (rows: CreateInsert[]) => Promise<Array<{ id: string }>>;
  createBatch: (ids: string[]) => Promise<{ successes: unknown[]; failures: unknown[] }>;
}): Promise<CreateRunResult> {
  if (!deps.writesEnabled) return { ok: false, reason: "writes_off" };
  if (!deps.confirmed) return { ok: false, reason: "unconfirmed" };
  if (deps.inserts.length === 0) return { ok: false, reason: "nothing_to_create" };
  const drafts = await deps.insertDrafts(deps.inserts);
  const ids = drafts.map((d) => d.id);
  const res = ids.length ? await deps.createBatch(ids) : { successes: [], failures: [] };
  const created = res.successes.length;
  return { ok: true, created, failed: deps.inserts.length - created };
}
