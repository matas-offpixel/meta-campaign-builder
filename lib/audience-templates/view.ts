/**
 * Audience templates tab (R6, record RC5 / frame RC-E): what the tab shows,
 * built from a template resolved in the draft's ad account. The component
 * (components/audience-templates/audience-templates-panel.tsx) only draws this.
 *
 * Pure. No `@/` imports, so node --test can load it.
 */

import { TEMPLATE_NAMES, GROUP_LABEL, changedLine, footerLine, fw, heldLine, tw } from "./words.ts";
import { normalizeAccount, resolveTemplate, type AudienceTemplate, type KnownAudience, type ResolvedItem, type TemplateItem, type TemplateItemKind } from "./resolve.ts";

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
  status: "reused" | "create" | "held";
  /** Empty for a held list. */
  statusLabel: string;
  /** How many items this row stands for (the interests row is all of them). */
  count: number;
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
  /** Items that will be created; held lists aren't among them. */
  toCreate: number;
  /** Customer lists held in another account (templates.item.held). */
  held: number;
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
        return { ...base, title: fw("frame.pool.video_viewers"), line: fw("frame.pool.video.line", { threshold: Number(it.detail.threshold ?? 0), days }) };
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
  return [it.kind, it.listRole ?? "", it.familyKey ?? "", it.pageId ?? "", it.retentionDays ?? "", it.interestId ?? ""].join("|");
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
    const rows = resolved.items.filter((r) => r.item.kind === kind);
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
  // A held list is shared in Business Manager, never re-uploaded: not one of the creates.
  const held = resolved.items.filter((r) => heldElsewhere(r, ctx.accountId)).length;
  const toCreate = resolved.toCreate - held;
  return {
    header: headerFor(t, ctx),
    groups,
    footer: footerLine(resolved.reused, toCreate, ctx.accountName, ctx.writesEnabled),
    reused: resolved.reused,
    toCreate,
    held,
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
