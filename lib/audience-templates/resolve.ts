/**
 * Audience templates (R6, record RC5): which of a template's items already
 * exist in the target ad account ("Reused") and which would have to be made
 * ("Will be created").
 *
 * Reuse first. An item is Reused when every audience it needs is already
 * known in this ad account, and a Reused item never calls Meta. "Known" is
 * what the app has recorded, read from the database, never from Meta:
 *
 *   - a meta_custom_audiences row in the account (status ready, with a Meta
 *     id): customer lists by role, pixel pools, video viewers, single-page
 *     engagement audiences;
 *   - an engagement audience a launch made for a page in the account and
 *     recorded on its draft (pageGroups[].engagementAudienceStatuses, with
 *     the account id). Those have no meta_custom_audiences row, but they are
 *     in the account, so rebuilding them would be the duplicate R6 forbids.
 *
 * Interests are targeting, not audiences: there is nothing to create, so an
 * interest is always Reused.
 *
 * A pool is only reused when it isn't another show's: no event on the row
 * (an event's pool carries its code in the name, and the launch checks in
 * lib/launch-guard block another show's code), and for a pixel pool no URL
 * filter (a landing-page pool is that show's page).
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

import type { GenrePoolKey } from "../learning/genre/families.ts";

export type TemplateItemKind = "customer_list" | "retargeting_pool" | "page_engagers" | "interest";
export type PoolRole = "page_views" | "signups" | "video_viewers";
export type ListRole = "signups" | "similar" | "buyers";

/** One audience role in a template (an audience_template_items row). */
export interface TemplateItem {
  id?: string;
  kind: TemplateItemKind;
  listRole: string | null;
  familyKey: GenrePoolKey | null;
  pageId: string | null;
  retentionDays: number | null;
  interestId: string | null;
  interestName: string | null;
  metaAudienceId: string | null;
  detail: TemplateItemDetail;
}

/** Display extras (audience_template_items.detail). Not part of the role. */
export interface TemplateItemDetail {
  /** A customer list's name ("Tech house buyers") or a page's name. */
  name?: string;
  /** Video viewers: the share watched (75 = 75%). */
  threshold?: number;
  /** The shows (event codes) whose launches used this item, for the seed's ranking. */
  shows?: string[];
  /** A list's holding account (`act_…`), read from Meta by the seed. */
  heldIn?: string;
  /** A show's Signups list (#1367, lib/customer-lists/templates.ts): its event code. */
  code?: string;
  /** A show's Signups list: the event's ad account that holds it (`act_…`). */
  ad_account_id?: string;
  /** "show_signups" on a show's Signups list. */
  source?: string;
  /** A show's Signups list: what's on it now (sent less removed), from customer_list_syncs. Set on load, never stored. */
  signups?: number;
  /** A show's Signups list not made yet: when the sync makes it (ISO, 08:00 London). Set on load, never stored. */
  madeOn?: string;
  [key: string]: unknown;
}

export interface AudienceTemplate {
  id?: string;
  name: string;
  businessId: string | null;
  clientId: string | null;
  genreFamilies: GenrePoolKey[];
  /** The shows the template was built from, as names ("Locklead, Ewan McVicar"). Stored in `notes`. */
  shows: string[];
  confirmedBy: string | null;
  confirmedAt: string | null;
  items: TemplateItem[];
}

/** An audience the app knows exists in an ad account. */
export interface KnownAudience {
  source: "row" | "launch" | "meta";
  metaAudienceId: string;
  /** Always `act_…`. */
  accountId: string;
  subtype: string;
  listRole?: string | null;
  familyKey?: string | null;
  retentionDays?: number | null;
  /** The page the audience is for: only single-page audiences carry one. */
  pageId?: string | null;
  pixelId?: string | null;
  pixelEvent?: string | null;
  urlContains?: string[];
  threshold?: number | null;
  eventId?: string | null;
}

export type ItemStatus = "reused" | "create";

export interface ResolvedItem {
  item: TemplateItem;
  status: ItemStatus;
  /** The Meta ids it reuses, in the target account. */
  reusedIds: string[];
  /** Audiences Meta would be asked to make for this item with writes on. */
  metaCreates: number;
  /** A page item's platforms this account has no audience for (page_engagement_fb / _ig). Empty for other kinds. */
  missingPageSubtypes: string[];
  /**
   * A list with a Meta id that this account can't use yet: the account that
   * holds it, so it can be shared in Business Manager. A list is never
   * re-uploaded, so it costs no Meta create.
   */
  heldIn: string | null;
}

export interface ResolvedTemplate {
  accountId: string;
  items: ResolvedItem[];
  reused: number;
  toCreate: number;
  /** Meta create calls the "Will be created" items need (writes on). Reused items need none. */
  metaCreates: number;
}

/** Page engagers are Facebook + Instagram (frame RC-E). */
export const PAGE_ENGAGER_SUBTYPES = ["page_engagement_fb", "page_engagement_ig"] as const;

const POOL_PIXEL_EVENT: Record<string, string> = { page_views: "PageView", signups: "CompleteRegistration" };

export function normalizeAccount(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const body = s.startsWith("act_") ? s.slice(4) : s;
  return /^\d+$/.test(body) ? `act_${body}` : null;
}

function sameAccount(k: KnownAudience, accountId: string): boolean {
  return normalizeAccount(k.accountId) === accountId;
}

function matchList(item: TemplateItem, k: KnownAudience): boolean {
  return (
    k.subtype === "customer_list" &&
    k.listRole === item.listRole &&
    (item.familyKey == null || k.familyKey === item.familyKey)
  );
}

function matchPool(item: TemplateItem, k: KnownAudience, pixelId: string | null): boolean {
  if (item.retentionDays != null && k.retentionDays !== item.retentionDays) return false;
  // A pool tied to a show is that show's (its name carries the show's code).
  if (k.eventId != null) return false;
  if (item.listRole === "video_viewers") {
    const threshold = typeof item.detail.threshold === "number" ? item.detail.threshold : null;
    return k.subtype === "video_views" && (threshold == null || k.threshold === threshold);
  }
  const event = POOL_PIXEL_EVENT[item.listRole ?? ""];
  if (!event) return false;
  return (
    k.subtype === "website_pixel" &&
    k.pixelEvent === event &&
    (k.urlContains ?? []).length === 0 &&
    (pixelId == null || k.pixelId == null || k.pixelId === pixelId)
  );
}

function matchPage(item: TemplateItem, k: KnownAudience, subtype: string): boolean {
  return (
    k.subtype === subtype &&
    k.pageId != null &&
    k.pageId === item.pageId &&
    (item.retentionDays == null || k.retentionDays == null || k.retentionDays === item.retentionDays)
  );
}

/**
 * The audiences one item needs, each with the known audience that already
 * covers it (or null). A page needs one per platform; everything else one.
 */
function needs(item: TemplateItem, known: KnownAudience[], pixelId: string | null): Array<KnownAudience | null> {
  switch (item.kind) {
    case "interest":
      return [];
    case "customer_list":
      // A list saved with its Meta id is that list: this account can use it
      // when it holds it or it's shared here. Never matched by role instead.
      if (item.metaAudienceId) return [known.find((k) => k.metaAudienceId === item.metaAudienceId) ?? null];
      // A show's Signups list is that show's alone (SU2): never another show's list by role.
      if (item.listRole === "signups") return [null];
      return [known.find((k) => matchList(item, k)) ?? null];
    case "retargeting_pool":
      return [known.find((k) => matchPool(item, k, pixelId)) ?? null];
    case "page_engagers":
      return PAGE_ENGAGER_SUBTYPES.map((s) => known.find((k) => matchPage(item, k, s)) ?? null);
  }
}

/** Resolve a template's items in one ad account. Pure: reads only `known`. */
export function resolveTemplate(
  items: TemplateItem[],
  account: string,
  known: KnownAudience[],
  pixelId: string | null = null,
): ResolvedTemplate {
  const accountId = normalizeAccount(account);
  if (!accountId) throw new Error(`not an ad account: ${account}`);
  const here = known.filter((k) => sameAccount(k, accountId));
  const resolved = items.map((item): ResolvedItem => {
    const covered = needs(item, here, pixelId);
    const missing = covered.filter((c) => c == null).length;
    const listById = item.kind === "customer_list" && Boolean(item.metaAudienceId);
    // The seed stores the holder as heldIn; a show's Signups list (#1367) as ad_account_id.
    const heldIn = typeof item.detail.heldIn === "string" ? item.detail.heldIn : typeof item.detail.ad_account_id === "string" ? item.detail.ad_account_id : null;
    const holder = listById && missing > 0 ? heldIn : null;
    return {
      item,
      status: missing === 0 ? "reused" : "create",
      reusedIds: covered.flatMap((c) => (c ? [c.metaAudienceId] : [])),
      metaCreates: listById ? 0 : missing,
      missingPageSubtypes: item.kind === "page_engagers" ? PAGE_ENGAGER_SUBTYPES.filter((_, i) => covered[i] == null) : [],
      heldIn: holder,
    };
  });
  return {
    accountId,
    items: resolved,
    reused: resolved.filter((r) => r.status === "reused").length,
    toCreate: resolved.filter((r) => r.status === "create").length,
    metaCreates: resolved.reduce((sum, r) => sum + r.metaCreates, 0),
  };
}

// ─── Known audiences from what the app stored ────────────────────────────────

/** A meta_custom_audiences row, as much as resolving needs. */
export interface CustomAudienceRow {
  meta_audience_id: string | null;
  meta_ad_account_id: string | null;
  audience_subtype: string;
  list_role: string | null;
  retention_days: number | null;
  source_id: string | null;
  source_meta: Record<string, unknown> | null;
  event_id: string | null;
  status: string;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Known audiences from meta_custom_audiences. Ready rows with a Meta id
 * only. A page audience counts for its page only when it is that one page
 * (a combined "similar pages" audience isn't any one page's engagers).
 * `eventFamily` gives a customer list's family from its show when the row
 * doesn't carry one in source_meta.family_key.
 */
export function knownFromRows(rows: CustomAudienceRow[], eventFamily: (eventId: string) => string | null = () => null): KnownAudience[] {
  return rows.flatMap((r): KnownAudience[] => {
    const accountId = normalizeAccount(r.meta_ad_account_id);
    if (!r.meta_audience_id || !accountId || r.status !== "ready") return [];
    const meta = r.source_meta ?? {};
    const pageIds = strings(meta.pageIds);
    const familyKey =
      typeof meta.family_key === "string" ? meta.family_key : r.event_id ? eventFamily(r.event_id) : null;
    return [
      {
        source: "row",
        metaAudienceId: r.meta_audience_id,
        accountId,
        subtype: r.audience_subtype,
        listRole: r.list_role,
        familyKey,
        retentionDays: r.retention_days,
        pageId: r.audience_subtype.startsWith("page_") && pageIds.length === 1 ? pageIds[0]! : null,
        pixelId: r.audience_subtype === "website_pixel" ? r.source_id : null,
        pixelEvent: typeof meta.pixelEvent === "string" ? meta.pixelEvent : null,
        urlContains: strings(meta.urlContains),
        threshold: typeof meta.threshold === "number" ? meta.threshold : null,
        eventId: r.event_id,
      },
    ];
  });
}

const LAUNCH_TYPE: Record<string, { subtype: string; days: number }> = {
  fb_engagement_365d: { subtype: "page_engagement_fb", days: 365 },
  ig_engagement_365d: { subtype: "page_engagement_ig", days: 365 },
};

/**
 * Known audiences from drafts: the engagement audiences a launch made for
 * a page in an account (pageGroups[].engagementAudienceStatuses).
 */
export function knownFromDraftAudiences(audiences: unknown): KnownAudience[] {
  const groups = (audiences as { pageGroups?: unknown } | null)?.pageGroups;
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((g) => {
    const statuses = (g as { engagementAudienceStatuses?: unknown }).engagementAudienceStatuses;
    if (!Array.isArray(statuses)) return [];
    return statuses.flatMap((s): KnownAudience[] => {
      const st = s as Record<string, unknown>;
      const type = LAUNCH_TYPE[String(st.type ?? "")];
      const accountId = normalizeAccount(st.accountId as string | undefined);
      if (!type || !accountId || typeof st.id !== "string" || typeof st.pageId !== "string") return [];
      return [
        {
          source: "launch",
          metaAudienceId: st.id,
          accountId,
          subtype: type.subtype,
          retentionDays: type.days,
          pageId: st.pageId,
        },
      ];
    });
  });
}

/**
 * One known audience per Meta id per account (a shared list is known in each
 * account that can use it). A row beats a Meta read or a launch record.
 */
export function dedupeKnown(known: KnownAudience[]): KnownAudience[] {
  const rank = { row: 2, meta: 1, launch: 0 } as const;
  const byKey = new Map<string, KnownAudience>();
  for (const k of known) {
    const key = `${k.metaAudienceId}|${normalizeAccount(k.accountId) ?? k.accountId}`;
    const had = byKey.get(key);
    if (!had || rank[k.source] > rank[had.source]) byKey.set(key, k);
  }
  return [...byKey.values()];
}
