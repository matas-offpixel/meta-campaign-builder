/**
 * Which customer lists an event's signups go to (SU1, SU2), for
 * scripts/customer-list-sync.mts: `--enable` writes these rows, `--dry-run`
 * runs the sync on them in memory.
 *
 *   show   "{code} · Signups" in the event's ad account (events.meta_ad_account_id,
 *          else the venue's). meta_audience_id is the registered or same-named
 *          list when one exists, else null until presale day makes it.
 *   genre  every customer_list item with a meta_audience_id in the event's
 *          audience template (the client's template whose shows list the
 *          event's code, or the one `--template` names), plus the venue's
 *          high-value list (HIGH_VALUE_LIST_BY_ACCOUNT, or `--high-value`),
 *          found by name in meta_custom_audiences or the account's listing.
 *          A list held in another account, or that isn't a customer list, is
 *          skipped and reported. Nothing is ever created here.
 *
 * Reads only. No `@/` imports, so node --test loads it.
 */

import type { Db, CustomerListGraph, MetaAudience, SyncRow } from "./sync.ts";
import { isCustomerList, sameAccount } from "./sync.ts";
import { HIGH_VALUE_LIST_BY_ACCOUNT, normaliseAccount, pickAccount, showListName, type AccountPick } from "./rules.ts";

export type GenreCandidate = {
  name: string;
  metaAudienceId: string | null;
  source: string;
  /** null when it's added; else why not. */
  skipped: null | "other_account" | "not_customer_list" | "list_not_found" | "duplicate";
  heldIn: string | null;
};

export type EnablePlan = {
  eventId: string;
  eventCode: string;
  account: AccountPick;
  template: { id: string; name: string } | null;
  /** "no template": no audience_templates row lists this show. */
  templateNote: string | null;
  showList: { name: string; existingId: string | null; existingFrom: "registered" | "by_name" | "given" | null };
  genre: GenreCandidate[];
  rows: SyncRow[];
};

type TemplateRow = { id: string; name: string; notes: string | null; client_id: string | null };
type ItemRow = { template_id: string; kind: string; list_role: string | null; meta_audience_id: string | null; detail: Record<string, unknown> | null };

/** A template's shows: `notes` as a ", " list (CC-3's store, 266 has no shows column). */
export function templateShows(notes: string | null): string[] {
  return (notes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function loadTemplate(db: Db, clientId: string | null, code: string, templateName: string | null): Promise<{ template: TemplateRow | null; note: string | null }> {
  if (!clientId) return { template: null, note: "no template (event has no client)" };
  const res = await db.from("audience_templates").select("id, name, notes, client_id").eq("client_id", clientId).order("name").range(0, 999);
  if (res.error) return { template: null, note: `no template (audience_templates not readable: ${res.error.code ?? "error"})` };
  const rows = (res.data ?? []) as TemplateRow[];
  if (templateName) {
    const hit = rows.find((t) => t.name === templateName);
    return hit ? { template: hit, note: null } : { template: null, note: `no template named "${templateName}" for this client` };
  }
  const hits = rows.filter((t) => templateShows(t.notes).includes(code));
  if (!hits.length) return { template: null, note: rows.length ? "no template lists this show" : "no template (the client has none)" };
  if (hits.length > 1) return { template: null, note: `no template (${hits.length} list this show: pass --template)` };
  return { template: hits[0], note: null };
}

async function loadTemplateLists(db: Db, templateId: string): Promise<{ id: string; name: string }[]> {
  const res = await db.from("audience_template_items").select("template_id, kind, list_role, meta_audience_id, detail").eq("template_id", templateId).eq("kind", "customer_list").range(0, 999);
  if (res.error) return [];
  return ((res.data ?? []) as ItemRow[])
    .filter((i) => i.meta_audience_id && /^\d+$/.test(i.meta_audience_id))
    .map((i) => ({ id: i.meta_audience_id!, name: typeof i.detail?.name === "string" ? (i.detail.name as string) : i.meta_audience_id! }));
}

/** A list by exact name in the account: a ready meta_custom_audiences row first, else Meta's listing. */
export async function findListByName(db: Db, graph: Pick<CustomerListGraph, "listAudiences">, account: string, name: string): Promise<{ id: string | null; from: "registered" | "by_name" | null }> {
  const res = await db.from("meta_custom_audiences").select("meta_audience_id, meta_ad_account_id, name, status").eq("name", name).eq("audience_subtype", "customer_list").limit(20);
  if (!res.error) {
    const hit = ((res.data ?? []) as { meta_audience_id: string | null; meta_ad_account_id: string | null; status: string | null }[]).find(
      (r) => r.meta_audience_id && r.status === "ready" && normaliseAccount(r.meta_ad_account_id) === account,
    );
    if (hit?.meta_audience_id) return { id: hit.meta_audience_id, from: "registered" };
  }
  const listed = (await graph.listAudiences(account)).find((a) => a.name === name && isCustomerList(a) && sameAccount(a, account));
  return listed ? { id: listed.id, from: "by_name" } : { id: null, from: null };
}

export type PlanEvent = {
  id: string;
  event_code: string;
  client_id: string | null;
  meta_ad_account_id: string | null;
};

export async function planEnable(args: {
  db: Db;
  graph: Pick<CustomerListGraph, "listAudiences" | "getAudience">;
  event: PlanEvent;
  venueAccount: string | null;
  templateName?: string | null;
  /** Override the high-value list's name; "" for none. */
  highValueName?: string | null;
  /** Adopt this list as the show list (a hand upload), checked with a GET. */
  showAudienceId?: string | null;
  /** The rows already on the table for this event (so --enable keeps cursors). */
  existing?: SyncRow[];
}): Promise<EnablePlan> {
  const { db, graph, event } = args;
  const account = pickAccount(event.meta_ad_account_id, args.venueAccount);
  const code = event.event_code;
  const plan: EnablePlan = {
    eventId: event.id,
    eventCode: code,
    account,
    template: null,
    templateNote: null,
    showList: { name: showListName(code), existingId: null, existingFrom: null },
    genre: [],
    rows: [],
  };
  if (!account.chosen) return plan;
  const act = account.chosen;

  // Show list.
  const existingShow = args.existing?.find((r) => r.kind === "show" && normaliseAccount(r.ad_account_id) === act);
  if (args.showAudienceId) {
    const a = await graph.getAudience(args.showAudienceId);
    if (!a || !sameAccount(a, act) || !isCustomerList(a)) throw new Error(`--audience ${args.showAudienceId} is not a customer list in ${act}`);
    plan.showList.existingId = a.id;
    plan.showList.existingFrom = "given";
  } else if (existingShow?.meta_audience_id) {
    plan.showList.existingId = existingShow.meta_audience_id;
    plan.showList.existingFrom = "registered";
  } else {
    const found = await findListByName(db, graph, act, showListName(code));
    plan.showList.existingId = found.id;
    plan.showList.existingFrom = found.from;
  }

  // Genre lists: the template's, then the venue's high-value list.
  const t = await loadTemplate(db, event.client_id, code, args.templateName ?? null);
  plan.template = t.template ? { id: t.template.id, name: t.template.name } : null;
  plan.templateNote = t.note;
  const wanted: { name: string; id: string | null; source: string }[] = [];
  if (t.template) for (const l of await loadTemplateLists(db, t.template.id)) wanted.push({ name: l.name, id: l.id, source: `template:${t.template.name}` });
  const hvName = args.highValueName === undefined || args.highValueName === null ? (HIGH_VALUE_LIST_BY_ACCOUNT[act] ?? null) : args.highValueName.trim() || null;
  if (hvName) {
    const found = await findListByName(db, graph, act, hvName);
    wanted.push({ name: hvName, id: found.id, source: "venue_high_value" });
  }
  const seen = new Set<string>();
  for (const w of wanted) {
    const c: GenreCandidate = { name: w.name, metaAudienceId: w.id, source: w.source, skipped: null, heldIn: null };
    plan.genre.push(c);
    if (!w.id) {
      c.skipped = "list_not_found";
      continue;
    }
    if (seen.has(w.id)) {
      c.skipped = "duplicate";
      continue;
    }
    seen.add(w.id);
    const a: MetaAudience | null = await graph.getAudience(w.id);
    if (!a) {
      c.skipped = "list_not_found";
      continue;
    }
    c.heldIn = normaliseAccount(a.account_id);
    if (!sameAccount(a, act)) c.skipped = "other_account";
    else if (!isCustomerList(a)) c.skipped = "not_customer_list";
  }

  const keep = (kind: "show" | "genre", id: string | null) =>
    args.existing?.find((r) => r.kind === kind && (r.meta_audience_id ?? null) === id && normaliseAccount(r.ad_account_id) === act);
  const base = (kind: "show" | "genre", id: string | null, name: string, source: string | null): SyncRow => {
    const prior = keep(kind, id) ?? (kind === "show" && existingShow && !existingShow.meta_audience_id ? existingShow : undefined);
    return {
      id: prior?.id ?? null,
      event_id: event.id,
      kind,
      meta_audience_id: id,
      ad_account_id: act,
      enabled: true,
      cursor: prior?.cursor ?? null,
      sent_total: prior?.sent_total ?? 0,
      removed_total: prior?.removed_total ?? 0,
      last_sent_at: prior?.last_sent_at ?? null,
      last_error: prior?.last_error ?? null,
      list_name: name,
      source,
    };
  };
  plan.rows.push(base("show", plan.showList.existingId, plan.showList.name, "show"));
  for (const c of plan.genre) if (!c.skipped && c.metaAudienceId) plan.rows.push(base("genre", c.metaAudienceId, c.name, c.source));
  return plan;
}

/** The columns --enable writes for a planned row (no hashes, no person data). */
export function enableRowPayload(row: SyncRow): Record<string, unknown> {
  return {
    event_id: row.event_id,
    kind: row.kind,
    meta_audience_id: row.meta_audience_id,
    ad_account_id: row.ad_account_id,
    enabled: true,
  };
}
