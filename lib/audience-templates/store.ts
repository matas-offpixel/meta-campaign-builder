/**
 * audience_templates / audience_template_items (migration 266) ⇄ the
 * AudienceTemplate shape. Pure. No `@/` imports, so node --test can load it.
 *
 * `notes` holds the template's shows as a ", " list: 266 has no shows
 * column, and RC5's header prints them ("For {families} shows: {shows}").
 */

import { isGenrePoolKey, type GenrePoolKey } from "../learning/genre/families.ts";
import type { AudienceTemplate, TemplateItem, TemplateItemKind } from "./resolve.ts";

/**
 * The audience_template_items unique key, as migration 267 (#1367) rebuilds
 * it: 266's seven columns plus meta_audience_id, nulls not distinct. Every
 * upsert of items uses this string; it only works once 267 is applied.
 */
export const ITEM_CONFLICT_KEY = "template_id,kind,list_role,family_key,page_id,retention_days,interest_id,meta_audience_id";

const KINDS: readonly TemplateItemKind[] = ["customer_list", "retargeting_pool", "page_engagers", "interest"];

export interface TemplateRowIn {
  id: string;
  name: string;
  business_id: string | null;
  client_id: string | null;
  genre_families: string[] | null;
  notes: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface ItemRowIn {
  id: string;
  template_id: string;
  kind: string;
  list_role: string | null;
  family_key: string | null;
  page_id: string | null;
  retention_days: number | null;
  interest_id: string | null;
  interest_name: string | null;
  meta_audience_id: string | null;
  detail: Record<string, unknown> | null;
}

export function itemFromRow(r: ItemRowIn): TemplateItem | null {
  if (!(KINDS as readonly string[]).includes(r.kind)) return null;
  return {
    id: r.id,
    kind: r.kind as TemplateItemKind,
    listRole: r.list_role,
    familyKey: isGenrePoolKey(r.family_key) ? r.family_key : null,
    pageId: r.page_id,
    retentionDays: r.retention_days,
    interestId: r.interest_id,
    interestName: r.interest_name,
    metaAudienceId: r.meta_audience_id,
    detail: (r.detail ?? {}) as TemplateItem["detail"],
  };
}

export function templateFromRows(t: TemplateRowIn, items: ItemRowIn[]): AudienceTemplate {
  return {
    id: t.id,
    name: t.name,
    businessId: t.business_id,
    clientId: t.client_id,
    genreFamilies: (t.genre_families ?? []).filter((k): k is GenrePoolKey => isGenrePoolKey(k)),
    shows: (t.notes ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    confirmedBy: t.confirmed_by,
    confirmedAt: t.confirmed_at,
    items: items.filter((i) => i.template_id === t.id).flatMap((i) => itemFromRow(i) ?? []),
  };
}

export function itemRow(item: TemplateItem, userId: string) {
  return {
    user_id: userId,
    kind: item.kind,
    list_role: item.listRole,
    family_key: item.familyKey,
    page_id: item.pageId,
    retention_days: item.retentionDays,
    interest_id: item.interestId,
    interest_name: item.interestName,
    meta_audience_id: item.metaAudienceId,
    detail: item.detail,
  };
}

/**
 * The items --apply may write. A customer list is written only with its Meta
 * id: with meta_audience_id in the key, an id-less row would sit beside the
 * row a later run writes once Meta has the list, instead of being that row.
 */
export function writableItems(items: TemplateItem[]): { write: TemplateItem[]; held: TemplateItem[] } {
  const held = items.filter((i) => i.kind === "customer_list" && !i.metaAudienceId);
  return { write: items.filter((i) => !held.includes(i)), held };
}

/** The rows a template writes (the script's --apply). */
export function templateRows(t: AudienceTemplate, userId: string, confirmed: { by: string; at: string } | null) {
  return {
    template: {
      user_id: userId,
      client_id: t.clientId,
      business_id: t.businessId,
      name: t.name,
      genre_families: t.genreFamilies,
      notes: t.shows.join(", "),
      confirmed_by: confirmed?.by ?? null,
      confirmed_at: confirmed?.at ?? null,
    },
    items: writableItems(t.items).write.map((i) => itemRow(i, userId)),
  };
}
