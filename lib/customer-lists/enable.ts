/**
 * The customer list an event's signups go to (SU1), for
 * scripts/customer-list-sync.mts: `--enable` writes this row, `--dry-run`
 * runs the sync on it in memory.
 *
 *   show  "{code} · Signups" in the event's ad account (events.meta_ad_account_id,
 *         else the venue's). meta_audience_id is the registered or same-named
 *         list when one exists (or the one `--audience` names), else null
 *         until presale day makes it.
 *
 * That is the only list. Genre and high-value lists are never written: a
 * show's list joins its audience templates instead (lib/customer-lists/templates.ts).
 *
 * Reads only. No `@/` imports, so node --test loads it.
 */

import type { Db, CustomerListGraph, SyncRow } from "./sync.ts";
import { isCustomerList, sameAccount } from "./sync.ts";
import { normaliseAccount, pickAccount, showListName, type AccountPick } from "./rules.ts";

export type EnablePlan = {
  eventId: string;
  eventCode: string;
  account: AccountPick;
  showList: { name: string; existingId: string | null; existingFrom: "registered" | "by_name" | "given" | null };
  rows: SyncRow[];
};

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
    showList: { name: showListName(code), existingId: null, existingFrom: null },
    rows: [],
  };
  if (!account.chosen) return plan;
  const act = account.chosen;

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

  const prior = existingShow;
  plan.rows.push({
    id: prior?.id ?? null,
    event_id: event.id,
    kind: "show",
    meta_audience_id: plan.showList.existingId,
    ad_account_id: act,
    enabled: true,
    cursor: prior?.cursor ?? null,
    sent_total: prior?.sent_total ?? 0,
    removed_total: prior?.removed_total ?? 0,
    last_sent_at: prior?.last_sent_at ?? null,
    last_error: prior?.last_error ?? null,
    last_replaced_at: prior?.last_replaced_at ?? null,
    last_replace_count: prior?.last_replace_count ?? null,
    created_at: prior?.created_at ?? null,
    list_name: plan.showList.name,
  });
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
