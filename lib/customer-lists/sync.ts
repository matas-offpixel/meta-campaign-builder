/**
 * Signups into Meta (SU1): the sync engine.
 *
 * Input: enabled customer_list_syncs rows, grouped by event (the cron and
 * `--run`), or the row `--enable` would write, in memory (`--dry-run`).
 * For each event that is active (presale day 08:00 London, or general sale
 * with no presale, to the end of show day), its show list "{code} · Signups",
 * read from CIRQLIN with scope=show:
 *
 *   first sync  no cursor: CIRQLIN's snapshot of everyone who counts, paged
 *               while has_more. Only after a good read is the list found
 *               (registered, or by name in the row's ad account) or made
 *               (subtype CUSTOM, customer_file_source USER_PROVIDED_ONLY),
 *               registered as meta_custom_audiences list_role 'signups', and
 *               sent (POST /{id}/users).
 *   daily       from the row's cursor: adds (POST /{id}/users) and removes
 *               (DELETE /{id}/users; withdrawn, deleted, flagged).
 *   weekly      the Monday 08:00 London run (or the first run 7 days after the
 *               last replace): a no-cursor read to the end, then the list's
 *               users are replaced (POST /{id}/usersreplace, one session,
 *               batches of 10,000, last_batch_flag on the last). A GDPR
 *               erasure never shows in `removed`, so this is what drops it,
 *               within 7 days. The snapshot's cursor is stored after.
 *
 * Every run with the list known also puts it in the event's audience
 * templates (lib/customer-lists/templates.ts). No other list is ever written:
 * a genre or high-value list the app didn't make gets nothing.
 *
 * Batches of 10,000, schema [EMAIL_SHA256, PHONE_SHA256], CIRQLIN's hashes as
 * they are. The row's cursor moves only after every batch of a page (or of
 * the whole replace) is on Meta, so a failure resends from the same cursor
 * (Meta's lists are sets: a resend never makes a duplicate, and that's why a
 * hand upload before the engine starts is safe). A failed CIRQLIN read,
 * `not_linked` (an unknown tag) included, leaves the row and the list as
 * they were.
 *
 * Writes: OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED exactly "true" and mode
 * "write", else the run is a dry run (CIRQLIN read, Meta GETs, counts). Every
 * Meta write goes through meta_write_idempotency with `{ required: true }`:
 * no ledger row, no call. customer_list_users keys hold the list, `op` (add,
 * remove, replace) and CIRQLIN's cursors or the replace session, never a hash.
 *
 * Person data: the hashes are in memory only, for the call. Rows, results,
 * errors and log lines carry counts, list ids and reasons.
 *
 * No `@/` imports, so node --test loads it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isArchivedClientStatus } from "../db/client-status.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "../meta/write-idempotency.ts";
import { recordRoleList } from "../retargeting/list-row.ts";
import type { ConsentScope, HashedEntry, HashedReader, HashedReadFailure, HashedReadResult } from "./cirqlin-hashed.ts";
import {
  customerListWritesEnabled,
  londonDate,
  normaliseAccount,
  PAGES_PER_RUN_MAX,
  replaceDue,
  replaceSessionId,
  REPLACE_PAGES_MAX,
  safeError,
  showListCreateBody,
  showListName,
  syncState,
  usersBatches,
  type UsersPayload,
} from "./rules.ts";
import { addShowListToTemplates, type TemplateAction, type TemplateRow } from "./templates.ts";

export type Db = Pick<SupabaseClient, "from">;

/** The show's own list. 267 keeps the column for a later kind the app makes; no other list is written. */
export type SyncKind = "show";

export interface SyncRow {
  /** Null for a row `--dry-run` plans and never writes. */
  id: string | null;
  event_id: string;
  kind: SyncKind;
  meta_audience_id: string | null;
  ad_account_id: string;
  enabled: boolean;
  cursor: string | null;
  sent_total: number;
  removed_total: number;
  last_sent_at: string | null;
  last_error: string | null;
  /** The last weekly full replace (migration 267). */
  last_replaced_at?: string | null;
  last_replace_count?: number | null;
  created_at?: string | null;
  /** The list's name, for the report (planned rows only). */
  list_name?: string | null;
}

export interface SyncEvent {
  id: string;
  event_code: string;
  /** events.name, to match CC-3's templates (their shows are names). */
  name?: string | null;
  user_id: string;
  client_id: string | null;
  client_status: string | null;
  mailchimp_tag: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  event_date: string | null;
  /** The account the event resolves to now (event, else venue): a row in another account is skipped. */
  account: string | null;
}

export type MetaAudience = { id: string; name: string; subtype: string | null; account_id: string | null };

export type UsersResult = { received: number; invalid: number };

/** Meta's usersreplace session: one id for the whole replace, batch_seq from 1. */
export type ReplaceSession = { session_id: number; batch_seq: number; last_batch_flag: boolean; estimated_num_total: number };

export interface CustomerListGraph {
  /** GET /{act}/customaudiences, every page (id, name, subtype, account_id). */
  listAudiences(account: string): Promise<MetaAudience[]>;
  /** GET /{id}?fields=id,name,subtype,account_id; null when Meta has no such audience. */
  getAudience(id: string): Promise<MetaAudience | null>;
  /** POST /{act}/customaudiences. Returns the id. */
  createList(account: string, body: Record<string, unknown>): Promise<string>;
  /** POST /{id}/users { payload }. */
  addUsers(audienceId: string, payload: UsersPayload): Promise<UsersResult>;
  /** DELETE /{id}/users { payload }. */
  removeUsers(audienceId: string, payload: UsersPayload): Promise<UsersResult>;
  /** POST /{id}/usersreplace { payload, session }. */
  replaceUsers(audienceId: string, payload: UsersPayload, session: ReplaceSession): Promise<UsersResult>;
}

export type RowOutcome =
  | "sent"
  | "replaced"
  | "up_to_date"
  | "would_send"
  | "would_create"
  | "would_replace"
  | "replace_too_large"
  | "replace_empty"
  | "waiting"
  | "show_passed"
  | "no_sale_date"
  | "archived_client"
  | "no_account"
  | "account_changed"
  | "no_crm_tag"
  | "no_ledger_draft"
  | "other_account"
  | "list_not_found"
  | "meta_error"
  | "row_write_failed"
  | `cirqlin_${HashedReadFailure["reason"]}`;

export interface RowReport {
  eventCode: string;
  kind: SyncKind;
  listId: string | null;
  listName: string | null;
  account: string;
  source: string | null;
  outcome: RowOutcome;
  /** Pages read from CIRQLIN this run. */
  pages: number;
  /** Adds sent (write) or that would be sent (dry). */
  added: number;
  /** Removes sent or that would be sent (dry). */
  removed: number;
  /** Users the weekly replace sent, or would send (dry). */
  replaced: number;
  /** The list's audience templates: added, present, would_add, failed. */
  templates: TemplateAction[];
  templatesNote: string | null;
  /** CIRQLIN's counts on the first page, when it gave them. */
  counts: { consented_show: number; consented_promoter: number; not_consented: number } | null;
  triggerAt: string | null;
  error: string | null;
}

export interface SyncResult {
  ok: boolean;
  mode: "write" | "dry";
  /** Mode "write" was asked for with the kill switch off: ran as a dry run. */
  writesOff: boolean;
  events: number;
  rows: RowReport[];
  metaReads: number;
  metaWrites: number;
  cirqlinReads: number;
}

export interface SyncDeps {
  db: Db;
  graph: CustomerListGraph;
  readHashed: HashedReader;
  env?: Record<string, string | undefined>;
  now: Date;
  mode: "write" | "dry";
  /** Counts-only log lines. Default console.log. */
  log?: (line: string) => void;
  /** Templates to match the show against instead of the table's (the dry run's #1363 proposals). */
  templates?: TemplateRow[];
}

export type SyncWork = { event: SyncEvent; rows: SyncRow[] };

function countedGraph(graph: CustomerListGraph, tally: { reads: number; writes: number }, allowWrites: boolean): CustomerListGraph {
  const refuse = (what: string) => {
    throw new Error(`Meta write refused in a dry run (${what})`);
  };
  return {
    listAudiences: async (a) => {
      tally.reads += 1;
      return graph.listAudiences(a);
    },
    getAudience: async (id) => {
      tally.reads += 1;
      return graph.getAudience(id);
    },
    createList: async (a, b) => {
      if (!allowWrites) refuse("create");
      tally.writes += 1;
      return graph.createList(a, b);
    },
    addUsers: async (id, p) => {
      if (!allowWrites) refuse("add");
      tally.writes += 1;
      return graph.addUsers(id, p);
    },
    removeUsers: async (id, p) => {
      if (!allowWrites) refuse("remove");
      tally.writes += 1;
      return graph.removeUsers(id, p);
    },
    replaceUsers: async (id, p, session) => {
      if (!allowWrites) refuse("replace");
      tally.writes += 1;
      return graph.replaceUsers(id, p, session);
    },
  };
}

/** The event's oldest draft: the ledger's key holder (migration 156 keys on a draft). Never read for its account. */
export async function loadLedgerDraftId(db: Db, eventId: string): Promise<string | null> {
  const res = await db.from("campaign_drafts").select("id").eq("event_id", eventId).order("created_at", { ascending: true }).limit(1);
  if (res.error) return null;
  return ((res.data ?? []) as { id: string }[])[0]?.id ?? null;
}

/** A registered "{code} · Signups" list for this show and account. */
async function registeredShowList(db: Db, eventId: string, account: string): Promise<string | null> {
  const res = await db
    .from("meta_custom_audiences")
    .select("meta_audience_id, meta_ad_account_id")
    .eq("event_id", eventId)
    .eq("audience_subtype", "customer_list")
    .eq("list_role", "signups")
    .eq("status", "ready")
    .limit(10);
  if (res.error) return null;
  const hit = ((res.data ?? []) as { meta_audience_id: string | null; meta_ad_account_id: string | null }[]).find(
    (r) => r.meta_audience_id && normaliseAccount(r.meta_ad_account_id) === account,
  );
  return hit?.meta_audience_id ?? null;
}

/** Same account, as Meta reports it (`account_id` is bare digits). */
export function sameAccount(audience: MetaAudience, account: string): boolean {
  return normaliseAccount(audience.account_id) === account;
}

/** A customer list: Meta's subtype CUSTOM. */
export function isCustomerList(audience: MetaAudience): boolean {
  return audience.subtype === "CUSTOM";
}

function emptyReport(event: SyncEvent, row: SyncRow, outcome: RowOutcome, triggerAt: Date | null): RowReport {
  return {
    eventCode: event.event_code,
    kind: row.kind,
    listId: row.meta_audience_id,
    listName: row.list_name ?? showListName(event.event_code),
    account: row.ad_account_id,
    source: "show",
    outcome,
    pages: 0,
    added: 0,
    removed: 0,
    replaced: 0,
    templates: [],
    templatesNote: null,
    counts: null,
    triggerAt: triggerAt ? triggerAt.toISOString() : null,
    error: null,
  };
}

export async function runCustomerListSync(deps: SyncDeps, work: SyncWork[]): Promise<SyncResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const writesOn = customerListWritesEnabled(deps.env ?? process.env);
  const mode: "write" | "dry" = deps.mode === "write" && writesOn ? "write" : "dry";
  const tally = { reads: 0, writes: 0 };
  const graph = countedGraph(deps.graph, tally, mode === "write");
  let cirqlinReads = 0;
  const readCache = new Map<string, Promise<HashedReadResult>>();
  const read = (tag: string, scope: ConsentScope, since: string | null): Promise<HashedReadResult> => {
    const key = `${tag}\u0000${scope}\u0000${since ?? ""}`;
    let hit = readCache.get(key);
    if (!hit) {
      cirqlinReads += 1;
      hit = deps.readHashed({ tag, scope, since });
      readCache.set(key, hit);
    }
    return hit;
  };
  const audienceCache = new Map<string, Promise<MetaAudience | null>>();
  const getAudience = (id: string) => {
    let hit = audienceCache.get(id);
    if (!hit) {
      hit = graph.getAudience(id);
      audienceCache.set(id, hit);
    }
    return hit;
  };
  const listingCache = new Map<string, Promise<MetaAudience[]>>();
  const listAudiences = (account: string) => {
    let hit = listingCache.get(account);
    if (!hit) {
      hit = graph.listAudiences(account);
      listingCache.set(account, hit);
    }
    return hit;
  };

  const reports: RowReport[] = [];
  let ok = true;

  for (const { event, rows } of work) {
    const state = syncState(event, deps.now);
    const triggerAt = "triggerAt" in state ? state.triggerAt : null;
    // Show rows only: no other list is ever written.
    const enabledRows = rows.filter((r) => r.enabled && r.kind === "show");

    const early: RowOutcome | null = isArchivedClientStatus(event.client_status)
      ? "archived_client"
      : state.state !== "active"
        ? state.state
        : !event.account
          ? "no_account"
          : !(event.mailchimp_tag ?? "").trim()
            ? "no_crm_tag"
            : null;
    if (early) {
      for (const row of enabledRows) reports.push(emptyReport(event, row, early, triggerAt));
      continue;
    }

    let ledgerDraftId: string | null = null;
    if (mode === "write") {
      ledgerDraftId = await loadLedgerDraftId(deps.db, event.id);
      if (!ledgerDraftId) {
        for (const row of enabledRows) reports.push(emptyReport(event, row, "no_ledger_draft", triggerAt));
        ok = false;
        continue;
      }
    }
    const ledger: MetaWriteContext | null = ledgerDraftId ? { supabase: deps.db, userId: event.user_id, draftId: ledgerDraftId, eventId: event.id } : null;
    const tag = event.mailchimp_tag!.trim();

    for (const row of enabledRows) {
      const report = emptyReport(event, row, "up_to_date", triggerAt);
      reports.push(report);
      try {
        await syncRow({ deps, mode, graph, read, getAudience, listAudiences, ledger, event, row, tag, report });
      } catch (err) {
        report.outcome = report.outcome === "up_to_date" ? "meta_error" : report.outcome;
        report.error = safeError(err);
      }
      if (["meta_error", "row_write_failed", "no_ledger_draft"].includes(report.outcome)) ok = false;
      log(
        `[customer-list-sync] event=${report.eventCode} list=${report.listId ?? "-"} account=${report.account} outcome=${report.outcome} pages=${report.pages} added=${report.added} removed=${report.removed} replaced=${report.replaced} templates=${report.templates.map((t) => `${t.action}`).join(",") || "-"}${report.error ? ` error=${report.error}` : ""}`,
      );
    }
  }

  return {
    ok,
    mode,
    writesOff: deps.mode === "write" && !writesOn,
    events: work.length,
    rows: reports,
    metaReads: tally.reads,
    metaWrites: tally.writes,
    cirqlinReads,
  };
}

type RowArgs = {
  deps: SyncDeps;
  mode: "write" | "dry";
  graph: CustomerListGraph;
  read: (tag: string, scope: ConsentScope, since: string | null) => Promise<HashedReadResult>;
  getAudience: (id: string) => Promise<MetaAudience | null>;
  listAudiences: (account: string) => Promise<MetaAudience[]>;
  ledger: MetaWriteContext | null;
  event: SyncEvent;
  row: SyncRow;
  tag: string;
  report: RowReport;
};

/** The show list reads scope=show. scope=promoter is kept in the client for later; nothing reads it yet. */
const SHOW_SCOPE: ConsentScope = "show";

async function syncRow(args: RowArgs): Promise<void> {
  const { deps, mode, graph, read, ledger, event, row, tag, report } = args;
  const account = row.ad_account_id;
  if (normaliseAccount(account) !== event.account) {
    report.outcome = "account_changed";
    return;
  }

  const doReplace = !!row.meta_audience_id && replaceDue(row, deps.now);
  const first = await read(tag, SHOW_SCOPE, doReplace ? null : row.cursor);
  if (!first.ok) {
    // Leaves the row, and Meta, as they were. not_linked: CIRQLIN has no page with this tag.
    report.outcome = `cirqlin_${first.reason}` as RowOutcome;
    return;
  }
  report.counts = first.page.counts;

  // The show list: the row's, else found (registered, or by name in the account), else made.
  const name = showListName(event.event_code);
  let listId = row.meta_audience_id;
  if (listId) {
    const audience = await args.getAudience(listId);
    if (!audience) {
      report.outcome = "list_not_found";
      return;
    }
    if (!sameAccount(audience, account)) {
      report.outcome = "other_account";
      return;
    }
  } else {
    listId = await registeredShowList(deps.db, event.id, account);
    if (!listId) {
      const byName = (await args.listAudiences(account)).find((a) => a.name === name && isCustomerList(a) && sameAccount(a, account));
      listId = byName?.id ?? null;
    }
    if (!listId) {
      if (mode === "dry") {
        report.outcome = "would_create";
      } else {
        listId = await withMetaWriteIdempotency(
          ledger,
          "customer_list_create",
          { event_id: event.id, ad_account_id: account, name },
          () => graph.createList(account, showListCreateBody(event.event_code)),
          { required: true },
        );
      }
    }
    if (listId && mode === "write") {
      if (row.id) {
        const upd = await deps.db.from("customer_list_syncs").update({ meta_audience_id: listId }).eq("id", row.id);
        if (upd.error) {
          report.listId = listId;
          report.outcome = "row_write_failed";
          report.error = safeError(upd.error);
          return;
        }
      }
      const reg = !event.client_id
        ? { ok: false, error: "event has no client" }
        : await recordRoleList(deps.db, {
            userId: event.user_id,
            clientId: event.client_id,
            eventId: event.id,
            name,
            role: "signups",
            metaAudienceId: listId,
            adAccountId: account,
            now: deps.now,
          });
      if (!reg.ok) report.error = safeError(`meta_custom_audiences not registered: ${reg.error ?? "unknown"}`);
    }
  }
  report.listId = listId;

  // The list joins its audience templates (every run: idempotent, so a failed write retries).
  const t = await addShowListToTemplates({
    db: deps.db,
    mode,
    event: { code: event.event_code, name: event.name ?? null, client_id: event.client_id },
    list: { meta_audience_id: listId, ad_account_id: account, name },
    templates: deps.templates,
  });
  report.templates = t.actions;
  report.templatesNote = t.note;
  const failedTemplates = t.actions.filter((a) => a.action === "failed");
  if (failedTemplates.length) report.error = safeError([report.error, ...failedTemplates.map((a) => `template ${a.template}: ${a.error}`)].filter(Boolean).join("; "));

  if (doReplace && listId) {
    await replaceList({ ...args, listId, first });
    return;
  }

  let since = row.cursor;
  let sentTotal = row.sent_total;
  let removedTotal = row.removed_total;
  let page: HashedReadResult = first;
  for (let n = 0; n < PAGES_PER_RUN_MAX; n += 1) {
    if (!page.ok) break; // A later page failed: what's done stays done; the next run resumes from the saved cursor.
    const p = page.page;
    report.pages += 1;
    const adds = usersBatches(p.added);
    const removes = usersBatches(p.removed);
    const addCount = adds.reduce((s, b) => s + b.data.length, 0);
    const removeCount = removes.reduce((s, b) => s + b.data.length, 0);

    if (mode === "dry" || !listId) {
      report.added += addCount;
      report.removed += removeCount;
    } else {
      let failed: string | null = null;
      for (const [op, batches] of [["add", adds], ["remove", removes]] as const) {
        for (let i = 0; i < batches.length && !failed; i += 1) {
          const batch = batches[i];
          try {
            const received = await withMetaWriteIdempotency(
              ledger,
              "customer_list_users",
              { audience_id: listId, op, since: since ?? null, next: p.cursor, batch: i, rows: batch.data.length },
              async () => {
                const r = op === "add" ? await graph.addUsers(listId!, batch) : await graph.removeUsers(listId!, batch);
                return String(r.received);
              },
              { required: true },
            );
            const count = Number(received) || 0;
            if (op === "add") report.added += count;
            else report.removed += count;
          } catch (err) {
            failed = `${op} batch ${i + 1} of ${batches.length} (${batch.data.length} rows): ${safeError(err)}`;
          }
        }
      }
      if (failed) {
        report.outcome = "meta_error";
        report.error = safeError(failed);
        if (row.id) await deps.db.from("customer_list_syncs").update({ last_error: report.error }).eq("id", row.id);
        return;
      }
      // Every batch of this page is on Meta: move the cursor.
      sentTotal += addCount;
      removedTotal += removeCount;
      const moved = p.cursor !== since;
      if (row.id && (moved || addCount || removeCount || row.last_error)) {
        const patch: Record<string, unknown> = { cursor: p.cursor, sent_total: sentTotal, removed_total: removedTotal, last_error: null };
        if (addCount || removeCount) patch.last_sent_at = deps.now.toISOString();
        const upd = await deps.db.from("customer_list_syncs").update(patch).eq("id", row.id);
        if (upd.error) {
          report.outcome = "row_write_failed";
          report.error = safeError(upd.error);
          return;
        }
        row.last_error = null;
      }
    }

    const next = p.cursor;
    if (!p.hasMore || !next || next === since) break;
    since = next;
    page = await read(tag, SHOW_SCOPE, since);
  }

  if (report.outcome === "up_to_date") {
    if (mode === "dry") report.outcome = report.added || report.removed ? "would_send" : "up_to_date";
    else report.outcome = report.added || report.removed ? "sent" : "up_to_date";
  }
}

/**
 * The weekly full replace: CIRQLIN's no-cursor snapshot read to the end
 * (has_more), then one usersreplace session over it. Nothing is sent unless
 * the whole snapshot was read. The cursor moves to the snapshot's only once
 * the last batch is on Meta.
 */
async function replaceList(args: RowArgs & { listId: string; first: Extract<HashedReadResult, { ok: true }> }): Promise<void> {
  const { deps, mode, graph, read, ledger, row, tag, report, listId } = args;
  const all: HashedEntry[] = [];
  let page: HashedReadResult = args.first;
  let since: string | null = null;
  let cursor: string | null = null;
  let complete = false;
  for (let n = 0; n < REPLACE_PAGES_MAX; n += 1) {
    if (!page.ok) {
      report.outcome = `cirqlin_${page.reason}` as RowOutcome;
      return;
    }
    report.pages += 1;
    all.push(...page.page.added);
    cursor = page.page.cursor;
    if (!page.page.hasMore) {
      complete = true;
      break;
    }
    if (!cursor || cursor === since) {
      // has_more with nowhere to go: half a snapshot is never a replace.
      report.outcome = "cirqlin_bad_shape";
      return;
    }
    since = cursor;
    page = await read(tag, SHOW_SCOPE, since);
  }
  if (!complete) {
    report.outcome = "replace_too_large";
    return;
  }
  const batches = usersBatches(all);
  const total = batches.reduce((s, b) => s + b.data.length, 0);
  if (!total) {
    // Meta can't replace with nobody; the daily removes already emptied what CIRQLIN withdrew.
    report.outcome = "replace_empty";
    return;
  }
  if (mode === "dry") {
    report.replaced = total;
    report.outcome = "would_replace";
    return;
  }
  const sessionId = replaceSessionId(listId, londonDate(deps.now));
  let sent = 0;
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const session: ReplaceSession = { session_id: sessionId, batch_seq: i + 1, last_batch_flag: i === batches.length - 1, estimated_num_total: total };
    try {
      const received = await withMetaWriteIdempotency(
        ledger,
        "customer_list_users",
        { audience_id: listId, op: "replace", session_id: sessionId, batch_seq: i + 1, of: batches.length, rows: batch.data.length },
        async () => String((await graph.replaceUsers(listId, batch, session)).received),
        { required: true },
      );
      sent += Number(received) || 0;
    } catch (err) {
      report.replaced = sent;
      report.outcome = "meta_error";
      report.error = safeError(`replace batch ${i + 1} of ${batches.length} (${batch.data.length} rows): ${safeError(err)}`);
      if (row.id) await deps.db.from("customer_list_syncs").update({ last_error: report.error }).eq("id", row.id);
      return;
    }
  }
  report.replaced = sent;
  report.outcome = "replaced";
  if (row.id) {
    const at = deps.now.toISOString();
    const upd = await deps.db
      .from("customer_list_syncs")
      .update({ cursor, last_replaced_at: at, last_replace_count: total, last_sent_at: at, last_error: null })
      .eq("id", row.id);
    if (upd.error) {
      report.outcome = "row_write_failed";
      report.error = safeError(upd.error);
    }
  }
}

// ─── Loading the cron's work ─────────────────────────────────────────────────

const PAGE = 1000;

export const EVENT_COLS = "id, event_code, name, user_id, client_id, mailchimp_tag, presale_at, general_sale_at, event_date, meta_ad_account_id, venue_id, venue_name";

export type EventRow = {
  id: string;
  event_code: string | null;
  name?: string | null;
  user_id: string;
  client_id: string | null;
  mailchimp_tag: string | null;
  presale_at: string | null;
  general_sale_at: string | null;
  event_date: string | null;
  meta_ad_account_id: string | null;
  venue_id: string | null;
  venue_name: string | null;
};

/** Every enabled row, paged (PostgREST caps a read at 1,000). */
export async function loadEnabledRows(db: Db): Promise<SyncRow[]> {
  const out: SyncRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await db.from("customer_list_syncs").select("*").eq("enabled", true).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (res.error) throw new Error(`customer_list_syncs: ${res.error.message}`);
    const page = (res.data ?? []) as SyncRow[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** The work for the given rows: events, their client's status and the account each resolves to now. */
export async function workForRows(
  db: Db,
  rows: SyncRow[],
  venueAccountOf: (event: EventRow) => Promise<string | null>,
  eventCodes?: string[],
): Promise<SyncWork[]> {
  const ids = [...new Set(rows.map((r) => r.event_id))];
  if (!ids.length) return [];
  const events: EventRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const res = await db.from("events").select(EVENT_COLS).in("id", ids.slice(i, i + 100));
    if (res.error) throw new Error(`events: ${res.error.message}`);
    events.push(...((res.data ?? []) as EventRow[]));
  }
  const clientIds = [...new Set(events.map((e) => e.client_id).filter((c): c is string => !!c))];
  const status = new Map<string, string | null>();
  if (clientIds.length) {
    const res = await db.from("clients").select("id, status").in("id", clientIds);
    if (res.error) throw new Error(`clients: ${res.error.message}`);
    for (const c of (res.data ?? []) as { id: string; status: string | null }[]) status.set(c.id, c.status);
  }
  const wanted = eventCodes?.length ? new Set(eventCodes) : null;
  const work: SyncWork[] = [];
  for (const e of events) {
    if (!e.event_code) continue;
    if (wanted && !wanted.has(e.event_code)) continue;
    const account = normaliseAccount(e.meta_ad_account_id) ?? normaliseAccount(await venueAccountOf(e));
    work.push({
      event: {
        id: e.id,
        event_code: e.event_code,
        name: e.name ?? null,
        user_id: e.user_id,
        client_id: e.client_id,
        client_status: e.client_id ? (status.get(e.client_id) ?? null) : null,
        mailchimp_tag: e.mailchimp_tag,
        presale_at: e.presale_at,
        general_sale_at: e.general_sale_at,
        event_date: e.event_date,
        account,
      },
      rows: rows.filter((r) => r.event_id === e.id),
    });
  }
  work.sort((a, b) => a.event.event_code.localeCompare(b.event.event_code));
  return work;
}
