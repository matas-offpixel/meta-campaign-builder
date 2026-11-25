/**
 * Audience templates tab (R6, record RC5 / frame RC-E): what the tab shows,
 * built from a template resolved in the draft's ad account. The component
 * (components/audience-templates/audience-templates-panel.tsx) only draws this.
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

import { TEMPLATE_NAMES, GROUP_LABEL, changedLine, footerLine, fw, heldLine, madeOnLine, pickedLine, signupsLine, tw } from "./words.ts";
import { createTargets, type PickLookup } from "./create.ts";
import { isUsablePick, isVideoViewers, itemThreshold } from "./videos.ts";
import { PAGE_ENGAGER_SUBTYPES, normalizeAccount, resolveTemplate, type ResolvedTemplate, type AudienceTemplate, type KnownAudience, type ResolvedItem, type TemplateItem, type TemplateItemKind } from "./resolve.ts";

export const GROUP_ORDER: readonly TemplateItemKind[] = ["customer_list", "retargeting_pool", "page_engagers", "interest"];

export interface TemplateRow {
  key: string;
  title: string;
  line: string;
  /**
   * "held": a customer list another account holds and the target can't use
   * yet. It is never re-uploaded, so it isn't "Will be created": the line
   * says where it's held, and the row has no status chip.
   */
  status: "reused" | "create" | "held" | "waiting" | "needs_videos";
  /** Empty for a held list; "Made on {date}" for a show's list the sync hasn't made yet (dashed, like Will be created). */
  statusLabel: string;
  /** How many items this row stands for (the interests row is all of them). */
  count: number;
  /** A line under the item's own (video viewers: what's needed, or what's picked). */
  note?: { text: string; tone: "ochre" | "muted" };
  /** Video viewers to make: "Pick this show's videos" before, "Change videos" after. */
  videos?: { action: "pick" | "change"; threshold: number; days: number };
}

export interface TemplateGroup {
  kind: TemplateItemKind;
  label: string;
  rows: TemplateRow[];
}

export interface TemplateHeader {
  name: string;
  /** "For house_tech + disco shows: …". */
  forLine: string;
  /** "confirmed by Matas Tue 24 Nov", or null when not confirmed. */
  confirmedLine: string | null;
  accountLine: string;
  confirmed: boolean;
}

export interface TemplateView {
  header: TemplateHeader;
  groups: TemplateGroup[];
  footer: string;
  reused: number;
  /** The footer's "{m} will be created": the audiences Create makes (willBeCreated), the same number as createCount. */
  toCreate: number;
  /** Customer lists held in another account (templates.item.held). */
  held: number;
  /** Shows' Signups lists the sync hasn't made yet ("Made on {date}"): never created here. */
  waiting: number;
  /** Video-viewer items with no videos picked ("Needs videos"): the footer's "{k} need videos picked". */
  needVideos: number;
  /** "Add to this draft": the made items it adds ({n}), and the ones left out ({m}). */
  addCount: number;
  leftOut: number;
  /** Create's button "{m}": the same number as toCreate, from willBeCreated. */
  createCount: number;
  /** The template resolved in the account, for "Add to this draft". */
  resolved: ResolvedTemplate;
  metaCreates: number;
  /** "{n} change since this template was saved", or null with no change. */
  changed: string | null;
  canSave: boolean;
}

export interface ViewContext {
  accountId: string;
  /** Meta's account name ("NX Promoter"); the id when no name is stored. */
  accountName: string;
  pixelId: string | null;
  /** Meta's pixel name ("NX Live Skiddle"); "…{last 4}" when none is stored. */
  pixelName: string | null;
  writesEnabled: boolean;
  /** user id → display name, for "confirmed by". */
  confirmerName: (userId: string) => string | null;
  /** act_… → Meta's account name, for "held in {account}"; the id when none is stored. */
  accountLabel?: (accountId: string) => string | null;
  /** The draft's picked videos for this template's video-viewer items (this event's only). */
  picks?: PickLookup;
}

/** "Tue 24 Nov": the frame's date, in London. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

export function templateOrder(name: string): number {
  const i = TEMPLATE_NAMES.indexOf(name);
  return i < 0 ? TEMPLATE_NAMES.length : i;
}

export function headerFor(t: AudienceTemplate, ctx: Pick<ViewContext, "accountName" | "confirmerName">): TemplateHeader {
  const forLine = tw("templates.for", { families: t.genreFamilies.join(" + "), shows: t.shows.join(", ") });
  const confirmed = Boolean(t.confirmedBy && t.confirmedAt);
  const name = t.confirmedBy ? ctx.confirmerName(t.confirmedBy) : null;
  return {
    name: t.name,
    forLine,
    confirmedLine: confirmed && name ? tw("templates.confirmed", { name, date: shortDate(t.confirmedAt!) }) : null,
    accountLine: tw("templates.account", { account: ctx.accountName }),
    confirmed,
  };
}

function pixelLabel(ctx: ViewContext): string {
  if (ctx.pixelName) return ctx.pixelName;
  return ctx.pixelId ? `…${ctx.pixelId.slice(-4)}` : "";
}

/**
 * The tab's counts, in one unit everywhere (design, 25 Nov): Meta audiences.
 * A page on Facebook + Instagram is 2 (one per platform), a list, a pool and
 * a video-viewer item 1 each, the interests row 1 however many interests it
 * holds. Held lists count 1 each, by the account that holds them; items
 * waiting for videos, and shows' lists not made yet, count as items.
 *
 * The footer's "{n} reused · {m} will be created", the button's "{m}" and
 * "Add to this draft"'s "{n}" / "{m}" all read it. `toCreate` is the rows
 * Create would ask Meta for, so it is also what "Created {m}" counts.
 */
export interface TemplateCounts {
  reused: number;
  toCreate: number;
  held: Array<{ account: string; n: number }>;
  needVideos: number;
  waiting: number;
  /** Every audience the template stands for in this account, in the same unit. */
  total: number;
}

function units(it: TemplateItem): number {
  return it.kind === "page_engagers" ? PAGE_ENGAGER_SUBTYPES.length : 1;
}

export function templateCounts(resolved: ResolvedTemplate, ctx: { accountId: string; pixelId: string | null; picks?: PickLookup }): TemplateCounts {
  const items = resolved.items;
  const interests = items.filter((r) => r.item.kind === "interest");
  const others = items.filter((r) => r.item.kind !== "interest");
  const interestRow = interests.length > 0 ? 1 : 0;
  const reused =
    (interests.some((r) => r.status === "reused") ? 1 : 0) +
    others.reduce((n, r) => {
      if (r.item.kind === "page_engagers") return n + units(r.item) - r.missingPageSubtypes.length;
      return n + (r.status === "reused" ? 1 : 0);
    }, 0);
  const holders = new Map<string, number>();
  for (const r of items) {
    const h = heldElsewhere(r, ctx.accountId);
    if (h) holders.set(h, (holders.get(h) ?? 0) + 1);
  }
  return {
    reused,
    toCreate: createTargets(items, ctx.pixelId, ctx.picks).length,
    held: [...holders.entries()].map(([account, n]) => ({ account, n })),
    needVideos: items.filter((r) => r.status === "create" && isVideoViewers(r.item) && !isUsablePick(ctx.picks?.(r.item) ?? null)).length,
    waiting: items.filter((r) => r.status === "create" && isShowSignups(r.item) && !r.item.metaAudienceId).length,
    total: interestRow + others.reduce((n, r) => n + units(r.item), 0),
  };
}

/** The footer's "{m} will be created" and Create's "{m}": one number (templateCounts). */
export function willBeCreated(resolved: ResolvedTemplate, pixelId: string | null, picks?: PickLookup, accountId = resolved.accountId): number {
  return templateCounts(resolved, { accountId, pixelId, picks }).toCreate;
}

/** The account holding a list the target can't use, when it isn't the target. */
export function heldElsewhere(r: ResolvedItem, accountId: string): string | null {
  if (r.item.kind !== "customer_list" || r.status !== "create" || !r.heldIn) return null;
  const holder = normalizeAccount(r.heldIn);
  return holder && holder !== normalizeAccount(accountId) ? holder : null;
}

function itemRow(r: ResolvedItem, ctx: ViewContext): TemplateRow {
  const it: TemplateItem = r.item;
  const holder = heldElsewhere(r, ctx.accountId);
  const status: TemplateRow["status"] = holder ? "held" : r.status;
  const statusLabel = status === "held" ? "" : tw(status === "reused" ? "templates.reused" : "templates.create");
  const base = { key: rowKey(it), status, statusLabel, count: 1 } as const;
  const days = it.retentionDays ?? 0;
  switch (it.kind) {
    case "customer_list": {
      if (isShowSignups(it)) {
        const code = it.detail.code ?? "";
        const title = it.detail.name ?? `${code} · Signups`;
        // SU2: before the sync makes the list, its status is the day it will be, never Will be created.
        if (!it.metaAudienceId) {
          return { ...base, status: "waiting", statusLabel: it.detail.madeOn ? madeOnLine(shortDate(it.detail.madeOn)) : "", title, line: signupsLine(code, null) };
        }
        const line = signupsLine(code, typeof it.detail.signups === "number" ? it.detail.signups : null);
        return { ...base, title, line: holder ? `${line}${fw("frame.sep")}${heldLine(ctx.accountLabel?.(holder) ?? holder)}` : line };
      }
      // RC-E's line; a list for every genre has no family, so it stops at the role.
      const line = it.familyKey
        ? fw("frame.list.line", { role: it.listRole ?? "", family: it.familyKey })
        : fw("frame.list.line", { role: it.listRole ?? "" }).replace(/, \{family\}$/, "");
      return {
        ...base,
        title: it.detail.name ?? "",
        line: holder ? `${line}${fw("frame.sep")}${heldLine(ctx.accountLabel?.(holder) ?? holder)}` : line,
      };
    }
    case "retargeting_pool":
      if (it.listRole === "video_viewers") {
        const row = { ...base, title: fw("frame.pool.video_viewers"), line: fw("frame.pool.video.line", { threshold: itemThreshold(it), days }) };
        if (r.status !== "create") return row;
        const videos = { threshold: itemThreshold(it), days };
        const pick = ctx.picks?.(it) ?? null;
        // Ruled 25 Nov: without this show's videos the item needs them, and Create leaves it out.
        if (!isUsablePick(pick)) {
          return { ...row, status: "needs_videos", statusLabel: tw("templates.item.videos"), note: { text: tw("templates.item.videos.line"), tone: "ochre" }, videos: { ...videos, action: "pick" } };
        }
        return { ...row, note: { text: pickedLine(pick.videoIds.length, pick.code), tone: "muted" }, videos: { ...videos, action: "change" } };
      }
      return {
        ...base,
        title: fw(it.listRole === "signups" ? "frame.pool.signups" : "frame.pool.page_views"),
        line: fw("frame.pool.pixel.line", { pixel: pixelLabel(ctx), days }),
      };
    case "page_engagers":
      return { ...base, title: it.detail.name ?? it.pageId ?? "", line: fw("frame.page.line", { days }) };
    case "interest":
      return { ...base, title: it.interestName ?? it.interestId ?? "", line: "" };
  }
}

export function rowKey(it: TemplateItem): string {
  // A show's Signups list is one item per list (267's key has meta_audience_id); the code tells a waiting one apart.
  const list = isShowSignups(it) ? [it.metaAudienceId ?? "", it.detail.code ?? ""] : [];
  return [it.kind, it.listRole ?? "", it.familyKey ?? "", it.pageId ?? "", it.retentionDays ?? "", it.interestId ?? "", ...list].join("|");
}

/** A show's "{code} · Signups" list (#1367 / SU2): role signups on a customer list. */
export function isShowSignups(it: TemplateItem): boolean {
  return it.kind === "customer_list" && it.listRole === "signups";
}

/** SU2: the genre lists first, then each show's list, by code. */
function customerListOrder(rows: ResolvedItem[]): ResolvedItem[] {
  const genre = rows.filter((r) => !isShowSignups(r.item));
  const shows = rows.filter((r) => isShowSignups(r.item)).sort((a, b) => (a.item.detail.code ?? "").localeCompare(b.item.detail.code ?? ""));
  return [...genre, ...shows];
}

/**
 * The tab's view of one template in one account. `pending` are pages added
 * with "Add page to this group" and not saved yet: they show as items and
 * count as changes.
 */
export function buildTemplateView(
  t: AudienceTemplate,
  known: KnownAudience[],
  ctx: ViewContext,
  pending: TemplateItem[] = [],
): TemplateView {
  const saved = new Set(t.items.map(rowKey));
  const added = pending.filter((p) => !saved.has(rowKey(p)));
  const resolved = resolveTemplate([...t.items, ...added], ctx.accountId, known, ctx.pixelId);
  const groups = GROUP_ORDER.map((kind): TemplateGroup => {
    const inKind = resolved.items.filter((r) => r.item.kind === kind);
    const rows = kind === "customer_list" ? customerListOrder(inKind) : inKind;
    if (kind !== "interest" || rows.length === 0) {
      return { kind, label: GROUP_LABEL[kind], rows: rows.map((r) => itemRow(r, ctx)) };
    }
    // Frame RC-E: every interest on one row, "{n} interests".
    return {
      kind,
      label: GROUP_LABEL[kind],
      rows: [
        {
          key: "interests",
          title: rows.map((r) => r.item.interestName ?? r.item.interestId ?? "").join(fw("frame.sep")),
          line: fw("frame.interests.line", { n: rows.length }),
          status: "reused",
          statusLabel: tw("templates.reused"),
          count: rows.length,
        },
      ],
    };
  });
  const c = templateCounts(resolved, ctx);
  const heldParts = c.held.map((h) => ({ account: ctx.accountLabel?.(h.account) ?? h.account, n: h.n }));
  return {
    header: headerFor(t, ctx),
    groups,
    footer: footerLine(c.reused, c.toCreate, ctx.accountName, ctx.writesEnabled, c.needVideos, heldParts),
    reused: c.reused,
    toCreate: c.toCreate,
    held: c.held.reduce((n, h) => n + h.n, 0),
    waiting: c.waiting,
    needVideos: c.needVideos,
    addCount: c.reused,
    leftOut: c.total - c.reused,
    createCount: c.toCreate,
    resolved,
    metaCreates: resolved.metaCreates,
    changed: added.length > 0 ? changedLine(added.length) : null,
    canSave: added.length > 0,
  };
}

/** A page added with "Add page to this group": Facebook + Instagram engagers, 365 days. */
export function pageItem(pageId: string, name: string): TemplateItem {
  return {
    kind: "page_engagers",
    listRole: null,
    familyKey: null,
    pageId,
    retentionDays: 365,
    interestId: null,
    interestName: null,
    metaAudienceId: null,
    detail: { name },
  };
}
