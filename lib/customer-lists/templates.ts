/**
 * A show's "{code} · Signups" list joins its audience templates (SU1).
 *
 * The app never writes to a list it didn't make: genre and high-value lists
 * get nothing from the sync. A template targets its genre lists (the
 * customer_list items CC-3 saves, list_role buyers) plus every one of its
 * shows' signup lists, and this is where the second part is kept.
 *
 * Templates whose shows include the event: `audience_templates.notes` is
 * CC-3's ", " list of show names (266 has no shows column), so a template
 * matches on the event code or on the show's name (CC-3's `showName` rule:
 * "AZYR b2b Partiboi69" → "AZYR"), case-insensitive, for the event's client.
 *
 * Where the list is stored (design A, Matas, 24 Nov): one item per show
 * list, kind customer_list, list_role signups, meta_audience_id the list,
 * family_key / page_id / retention_days / interest_id null, and detail
 * { name, code, ad_account_id, source: "show_signups" }. Migration 267
 * widens 266's unique key with meta_audience_id so two shows' items sit in
 * one template.
 *
 * Idempotent: a template that already holds the list is left. Rows and results carry
 * names and list ids, never person data.
 *
 * No `@/` imports, so node --test loads it.
 */

import type { Db } from "./sync.ts";

/** detail.source on the items this module writes. */
export const SHOW_SIGNUPS_SOURCE = "show_signups";

export type TemplateRow = {
  id: string;
  user_id: string | null;
  name: string;
  notes: string | null;
  client_id: string | null;
  /** A template #1363 proposes and prod doesn't have yet (dry run only). */
  proposed?: boolean;
};

export type TemplateAction = {
  templateId: string;
  template: string;
  proposed: boolean;
  action: "added" | "present" | "would_add" | "failed";
  error?: string;
};

/** A template's shows: `notes` as a ", " list. */
export function templateShows(notes: string | null): string[] {
  return (notes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** CC-3's rule (lib/audience-templates/seed.ts): the headline act's name. */
export function showName(name: string): string {
  return name.split(/\s+b2b\s+|:|\s+-\s+/i)[0]!.trim();
}

export function templateMatchesShow(t: Pick<TemplateRow, "notes">, code: string, eventName: string | null): boolean {
  const shows = templateShows(t.notes).map((s) => s.toLowerCase());
  if (shows.includes(code.toLowerCase())) return true;
  const n = eventName ? showName(eventName).toLowerCase() : "";
  return !!n && shows.includes(n);
}

/** The client's templates, paged. An unreadable table reads as none, with the code. */
export async function loadClientTemplates(db: Db, clientId: string | null): Promise<{ templates: TemplateRow[]; note: string | null }> {
  if (!clientId) return { templates: [], note: "the event has no client" };
  const res = await db.from("audience_templates").select("id, user_id, name, notes, client_id").eq("client_id", clientId).order("name").range(0, 999);
  if (res.error) return { templates: [], note: `audience_templates not readable (${res.error.code ?? "error"})` };
  const templates = (res.data ?? []) as TemplateRow[];
  return { templates, note: templates.length ? null : "the client has no templates" };
}

/**
 * Adds the show's list to every matching template (write), or says what it
 * would add (dry; a proposed template is always "would_add"). Never throws:
 * a failed template write is reported and retried on the next run.
 */
export async function addShowListToTemplates(args: {
  db: Db;
  mode: "write" | "dry";
  event: { code: string; name: string | null; client_id: string | null };
  list: { meta_audience_id: string | null; ad_account_id: string; name: string };
  /** The templates to match against; default the client's on the table. */
  templates?: TemplateRow[];
}): Promise<{ actions: TemplateAction[]; note: string | null }> {
  const { db, mode, event, list } = args;
  const loaded = args.templates ? { templates: args.templates, note: args.templates.length ? null : "no templates given" } : await loadClientTemplates(db, event.client_id);
  const matched = loaded.templates.filter((t) => templateMatchesShow(t, event.code, event.name));
  if (!matched.length) return { actions: [], note: loaded.note ?? "no template lists this show" };
  const actions: TemplateAction[] = [];
  for (const t of matched) {
    const act = (action: TemplateAction["action"], error?: string) => actions.push({ templateId: t.id, template: t.name, proposed: !!t.proposed, action, ...(error ? { error } : {}) });
    // A proposed template, or a list not made yet (dry run): nothing to read.
    if (t.proposed || !list.meta_audience_id) {
      act("would_add");
      continue;
    }
    const res = await db
      .from("audience_template_items")
      .select("id")
      .eq("template_id", t.id)
      .eq("kind", "customer_list")
      .eq("list_role", "signups")
      .eq("meta_audience_id", list.meta_audience_id)
      .limit(1);
    if (res.error) {
      act("failed", `audience_template_items read: ${res.error.code ?? "error"}`);
      continue;
    }
    if ((res.data ?? []).length) {
      act("present");
      continue;
    }
    if (mode === "dry") {
      act("would_add");
      continue;
    }
    const ins = await db.from("audience_template_items").insert({
      template_id: t.id,
      user_id: t.user_id,
      kind: "customer_list",
      list_role: "signups",
      family_key: null,
      page_id: null,
      retention_days: null,
      interest_id: null,
      meta_audience_id: list.meta_audience_id,
      detail: { name: list.name, code: event.code, ad_account_id: list.ad_account_id, source: SHOW_SIGNUPS_SOURCE },
    });
    // 23505: another run added it between the read and the insert.
    if (ins.error && ins.error.code === "23505") act("present");
    else if (ins.error) act("failed", `audience_template_items write: ${ins.error.code ?? "error"}`);
    else act("added");
  }
  return { actions, note: null };
}
